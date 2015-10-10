'use strict'
var inherits = require('inherits')
var Duplex = require('stream').Duplex

var Connection = function (infoHash, publicKey, torrenting) {
  Duplex.call(this)
  this.infoHash = infoHash
  this.publicKey = publicKey
  this.torrenting = torrenting
}

Connection.prototype._write = function (chunk, encoding, done) {
  this.torrenting.send(this.infoHash, this.publicKey, chunk)
  done()
}

inherits(Connection, Duplex)

module.exports = Connection
