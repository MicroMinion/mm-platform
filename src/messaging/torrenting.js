'use strict'

var curve = require('./crypto-curvecp.js')
var expect = require('chai').expect
var isBuffer = require('is-buffer')

var PROTOCOL = 'to'

var Torrenting = function (dispatcher) {
  this.dispatcher = dispatcher
}

Torrenting.prototype._setupDispatcher = function () {
  var torrenting = this
  this.dispatcher.on(PROTOCOL, function (scope, publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(curve.fromBase64(publicKey)).to.have.length(32)
    var infoHash = message.slice(0, 20)
    message = message.slice(20)
    torrenting.emit(scope + '.' + infoHash, publicKey, message)
  })
}
Torrenting.prototype.send = function (infoHash, publicKey, message) {
  expect(publicKey).to.be.a('string')
  expect(isBuffer(message)).to.be.true
  expect(isBuffer(infoHash)).to.be.true
  expect(message.length).to.be.greaterThan(0)
  expect(infoHash.length).to.equal(20)
  var buffer = Buffer.concat([infoHash, message])
  message = message
  this.dispatcher.send(PROTOCOL, publicKey, buffer)
}
