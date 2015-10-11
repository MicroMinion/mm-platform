'use strict'
var hat = require('hat')
var Bitfield = require('bitfield')
var parseTorrent = require('parse-torrent')
var Q = require('q')
var fs = require('fs')
var path = require('path')
var FSChunkStore = require('fs-chunk-store')
var _ = require('lodash')
var bencode = require('bencode')

var PSTR = new Buffer([0x13, 0x42, 0x69, 0x74, 0x54, 0x6f, 0x72, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c])
var HANDSHAKE_LENGTH = 48
var MESSAGE_RESERVED = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
var MESSAGE_UNCHOKE = new Buffer([0x00, 0x00, 0x00, 0x01, 0x01])

var STORE_PURGE_INTERVAL = 1000 * 60 * 5

var toBuffer = function (str, encoding) {
  return Buffer.isBuffer(str) ? str : new Buffer(str, encoding)
}

var Server = function (torrenting, storageRoot) {
  var server = this
  this.torrenting = torrenting
  this.storageroot = storageRoot
  this.peerId = toBuffer('-TS0008-' + hat(48), 'utf-8')
  /*
   * store cache with infoHash as key
   * Every key contains the following object:
   * {lastAccess: Date, requests: [requestArray], store: store}
   */
  this.stores = {}
  setInterval(function () {
    _.forEach(_.keys(server.stores), function (infoHash) {
      if (Math.abs(new Date() - server.stores[infoHash].lastAccess) > STORE_PURGE_INTERVAL) {
        delete server.stores[infoHash]
      }
    })
  }, STORE_PURGE_INTERVAL)
}

Server.prototype.onMessage = function (scope, infoHash, publicKey, message) {
  if (this.isHandshake(message)) {
    this.sendHandshake(infoHash, publicKey)
    this.sendBitfield(infoHash, publicKey)
  } else if (this.isExtended(message)) {
    this.sendExtended(infoHash, publicKey, message)
  } else if (this.isRequest(message)) {
    this.sendPiece(infoHash, publicKey, message)
  }
}

Server.prototype.isHandshake = function (message) {
  var pstrlen = message.readUInt8(0)
  if (pstrlen !== HANDSHAKE_LENGTH + PSTR.length) {
    return false
  }
  var protocol = message.slice(1, PSTR.length)
  return protocol === PSTR
}

Server.prototype.sendHandshake = function (infoHash, publicKey) {
  infoHash = new Buffer(infoHash, 'hex')
  var reserved = new Buffer(MESSAGE_RESERVED)
  reserved[5] |= 0x10
  var message = Buffer.concat([PSTR, reserved, infoHash, this.peerId], PSTR.length + HANDSHAKE_LENGTH)
  this.torrenting.send(infoHash, publicKey, message)
}

Server.prototype._sendMessage = function (infoHash, publicKey, id, numbers, data) {
  var dataLength = data ? data.length : 0
  var buffer = new Buffer(5 + 4 * numbers.length)

  buffer.writeUInt32BE(buffer.length + dataLength - 4, 0)
  buffer[4] = id
  for (var i = 0; i < numbers.length; i++) {
    buffer.writeUInt32BE(numbers[i], 5 + 4 * i)
  }
  if (data) {
    buffer = Buffer.concat([buffer, data])
  }
  this.torrenting.send(infoHash, publicKey, buffer)
}

Server.prototype.sendBitfield = function (infoHash, publicKey) {
  var server = this
  this._loadTorrent(infoHash)
    .then(function (torrentData) {
      var bitfield = new Bitfield(torrentData.pieces.length)
      for (var i = 0; i < bitfield.buffer.length; i++) {
        bitfield.set(i)
      }
      server._sendMessage(infoHash, publicKey, 5, [], bitfield.buffer)
      server.torrenting.send(infoHash, publicKey, MESSAGE_UNCHOKE)
    })
}

Server.prototype._loadTorrent = function (infoHash) {
  var torrentLocation = path.join(this.storageLocation, infoHash + '.torrent')
  return Q.nfcall(fs.readFile, torrentLocation)
    .then(parseTorrent)
}

Server.prototype.isExtended = function (message) {
  var id = message.readUInt8(4)
  return id === 20
}

Server.prototype.sendExtended = function (infoHash, publicKey, message) {
  var extendedId = message.readUInt8(5)
  if (extendedId === 0) {
    this.sendExtendedHandshake(infoHash, publicKey)
  } else if (extendedId === 1) {
    this.sendMetadata(infoHash, publicKey, message)
  }
}

Server.prototype.sendMetadata = function (infoHash, publicKey, message) {
  var server = this
  var msg = bencode.decode(message.slice(6))
  if (msg.msg_type === 0) {
    this._loadTorrent(infoHash)
      .then(function (torrentData) {
        var msgResponse = {
          msg_type: 1,
          piece: msg.piece,
          total_size: torrentData.infoBuffer.length
        }
        var start = 16384 * msgResponse.piece
        var end = _.min(start + 16384, torrentData.infoBuffer.length)
        var buf = torrentData.infoBuffer.slice(start, end)
        msgResponse = bencode.encode(msgResponse)
        var msg = Buffer.concat([msgResponse, buf])
        server._sendMessage(infoHash, publicKey, 20, [1], msg)
      })
  }
}

Server.prototype.sendExtendedHandshake = function (infoHash, publicKey) {
  var server = this
  this._loadTorrent(infoHash)
    .then(function (torrentData) {
      var msg = {
        m: {
          'ut_metadata': 1
        },
        metadata_size: torrentData.infoBuffer.length
      }
      var buf = bencode.encode(msg)
      server._sendMessage(infoHash, publicKey, 20, [0], buf)
    })
}

Server.prototype.isRequest = function (message) {
  var len = message.readUInt32BE(0)
  var id = message.readUInt8(4)
  return len === 13 && id === 6
}

Server.prototype.createStore = function (infoHash) {
  var torrentLocation = path.join(this.storageLocation, infoHash + '.torrent')
  var storageLocation = path.join(this.storageLocation, infoHash)
  var server = this
  var stores = this.stores
  Q.nfcall(fs.readFile, torrentLocation)
    .then(parseTorrent)
    .then(function (torrentData) {
      var store = FSChunkStore(torrentData.pieceLength, {
        files: torrentData.files.map(function (file) {
          return {
            path: path.join(storageLocation, file.path),
            length: file.length,
            offset: file.offset
          }
        })
      })
      stores[infoHash].store = store
    })
    .then(function () {
      _.forEach(server.stores[infoHash].requests, function (request) {
        server.resolveRequest(infoHash, request[0], request[1], request[2], request[3])
      })
    })
  this.stores[infoHash] = {
    lastAccess: new Date(),
    requests: []
  }
}

Server.prototype.sendPiece = function (infoHash, publicKey, message) {
  var index = message.readUInt32BE(5)
  var offset = message.readUInt32BE(9)
  var length = message.readUInt32BE(13)
  if (!_.has(this.stores, infoHash)) {
    this.createStore(infoHash)
    this.addRequest(infoHash, publicKey, index, offset, length)
  } else {
    this.stores[infoHash].lastAccess = new Date()
    if (_.has(this.stores, 'store')) {
      this.resolveRequest(infoHash, publicKey, index, offset, length)
    } else {
      this.addRequest(infoHash, publicKey, index, offset, length)
    }
  }
}

Server.prototype.resolveRequest = function (infoHash, publicKey, index, offset, length) {
  var server = this
  return Q.nfcall(this.stores[infoHash].store.get, {offset: offset, length: length})
    .then(function (buffer) {
      server._sendMessage(infoHash, publicKey, 7, [index, offset], buffer)
    })
}

Server.prototype.addRequest = function (infoHash, publicKey, index, offset, length) {
  if (!_.has(this.stores[infoHash], 'requests')) {
    this.stores[infoHash].requests = []
  }
  this.stores[infoHash].push([publicKey, index, offset, length])
}

module.exports = Server
