'use strict'
var hat = require('hat')

var PSTR = new Buffer([0x13, 0x42, 0x69, 0x74, 0x54, 0x6f, 0x72, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c])
var HANDSHAKE_LENGTH = 48
var MESSAGE_RESERVED = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]

var toBuffer = function (str, encoding) {
  return Buffer.isBuffer(str) ? str : new Buffer(str, encoding)
}

var Server = function (torrenting) {
  this.torrenting = torrenting
  this.peerId = toBuffer('-TS0008-' + hat(48), 'utf-8')
}

Server.prototype.onMessage = function (scope, infoHash, publicKey, message) {
  if (this.isHandshake(message)) {
    this.sendHandshake(infoHash, publicKey)
    this.sendBitfield(infoHash, publicKey)
    this.sendUnchoke(infoHash, publicKey)
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
  // TODO: Add extensions
  var message = Buffer.concat([PSTR, reserved, infoHash, this.peerId], PSTR.length + HANDSHAKE_LENGTH)
  this.torrenting.send(infoHash, publicKey, message)
}

Server.prototype.sendBitfield = function (infoHash, publicKey) {}
Server.prototype.sendUnchoke = function (infoHash, publicKey) {}
Server.prototype.isExtendedMetadata = function (message) {}
Server.prototype.sendMetadata = function (infoHash, publicKey, message) {}
Server.prototype.isRequest = function (message) {}
Server.prototype.sendPiece = function (infoHash, publicKey, message) {}

module.exports = Server
