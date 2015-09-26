'use strict'

var curve = require('./crypto-curvecp.js')
var expect = require('chai').expect
var PROTOCOL = 'to'

var Torrenting = function (dispatcher) {
  this.dispatcher = dispatcher
}

Torrenting.prototype._setupDispatcher = function () {
  var torrenting = this
  this.dispatcher.on(PROTOCOL, function (scope, publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(curve.fromBase64(publicKey)).to.have.length(32)
    var infoHash = '' // TODO: Extract infohash
    message = message // TODO: Remove infohash so we get a clean wire protocol message
    torrenting.emit(scope + '.' + infoHash, publicKey, message)
  })
}
Torrenting.prototype.send = function (infoHash, publicKey, message) {
  // TODO: Implemeting wrapping infoHash in message
  message = message
  this.dispatcher.send(PROTOCOL, publicKey, message)
}
