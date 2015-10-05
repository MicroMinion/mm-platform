'use strict'
var inherits = require('inherits')
var Duplex = require('stream').Duplex

// TODO: Implement Duplex connection

var Connection = function (publicKey) {
  Duplex.call(this)
  this.publicKey = publicKey
}

inherits(Conncetion, Duplex)

module.exports = Connection
