'use strict'
var hat = require('hat')
var Bitfield = require('bitfield')
var parseTorrent = require('parse-torrent')
var Q = require('q')
var fs = require('fs')
var path = require('path')

var PSTR = new Buffer([0x13, 0x42, 0x69, 0x74, 0x54, 0x6f, 0x72, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c])
var HANDSHAKE_LENGTH = 48
var MESSAGE_RESERVED = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
var MESSAGE_UNCHOKE = new Buffer([0x00, 0x00, 0x00, 0x01, 0x01])

var toBuffer = function (str, encoding) {
  return Buffer.isBuffer(str) ? str : new Buffer(str, encoding)
}

var Server = function (torrenting, storageRoot) {
  this.torrenting = torrenting
  this.storageroot = storageRoot
  this.peerId = toBuffer('-TS0008-' + hat(48), 'utf-8')
}

Server.prototype.onMessage = function (scope, infoHash, publicKey, message) {
  if (this.isHandshake(message)) {
    this.sendHandshake(infoHash, publicKey)
    this.sendBitfield(infoHash, publicKey)
  } else if (this.isExtendedMetadata(message)) {
    this.sendMetadata(infoHash, publicKey, message)
  } else if (this.isRequest(message)) {
    this.sendPiece(infoHash, publicKey, message)
  }
}

Server.prototype.isHandshake = function (message) {
  var pstrlen = message.readUInt8(message)
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
  var torrentLocation = path.join(this.storageLocation, infoHash + '.torrent')
  Q.nfcall(fs.readFile, torrentLocation)
    .then(parseTorrent)
    .then(function (torrentData) {
      var bitfield = new Bitfield(torrentData.pieces.length)
      for (var i = 0; i < bitfield.buffer.length; i++) {
        bitfield.set(i)
      }
      server._sendMessage(infoHash, publicKey, 5, [], bitfield.buffer)
      server.torrenting.send(infoHash, publicKey, MESSAGE_UNCHOKE)
    })
}

Server.prototype.isExtendedMetadata = function (message) {}
Server.prototype.sendMetadata = function (infoHash, publicKey, message) {}
Server.prototype.isRequest = function (message) {}
Server.prototype.sendPiece = function (infoHash, publicKey, message) {}

module.exports = Server
