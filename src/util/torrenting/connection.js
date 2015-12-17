'use strict'
var inherits = require('inherits')
var Duplex = require('stream').Duplex

var PSTR = new Buffer([0x13, 0x42, 0x69, 0x74, 0x54, 0x6f, 0x72, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x63, 0x6f, 0x6c])

var Connection = function (infoHash, publicKey, torrenting) {
  Duplex.call(this)
  this.infoHash = infoHash
  this.publicKey = publicKey
  this.torrenting = torrenting
  this.buffer = new Buffer(0)
}

inherits(Connection, Duplex)

Connection.prototype._write = function (chunk, encoding, done) {
  if (this.isHandshake(chunk)) {
    this.torrenting.send(this.infoHash, this.publicKey, chunk)
  } else {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this._purgeBuffer()
  }
  done()
}

Connection.prototype._purgeBuffer = function () {
  if (this.buffer.length < 4) return
  var length = this.buffer.readUInt32BE(0)
  if (this.buffer.length >= length + 4) {
    var message = this.buffer.slice(0, length + 4)
    this.torrenting.send(this.infoHash, this.publicKey, message)
    this.buffer = this.buffer.slice(length + 4 + 1)
    this._purgeBuffer()
  }
}

Connection.prototype.isHandshake = function (message) {
  var pstrlen = message.readUInt8(0)
  if (pstrlen !== PSTR.length - 1) {
    return false
  }
  var protocol = message.slice(1, PSTR.length)
  return protocol.toString('utf-8') === PSTR.slice(1).toString('utf-8')
}

Connection.prototype._read = function (size) {}

Connection.prototype.destroy = function () {
  this.end()
}

module.exports = Connection
