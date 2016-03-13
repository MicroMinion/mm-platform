'use strict'

var expect = require('chai').expect
var isBuffer = require('is-buffer')
var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var nacl = require('tweetnacl')

var PROTOCOL = 'bt'

/**
 * Emit messages of the format scope.infoHash
 * @event Torrenting#message
 * @param {string} publicKey sender of BitTorrent packet
 * @param {Buffer} message BitTorrent message
 */

/**
 * Interface for sending/receiving BitTorrent packets
 *
 * @constructor
 * @param {ProtocolDispatcher} dispatcher
 * @fires Torrenting#message
 * @listens ProtocolDispatcher#bt
 */
var Torrenting = function (dispatcher) {
  EventEmitter.call(this, {
    delimiter: '.'
  })
  this.dispatcher = dispatcher
  this._setupDispatcher()
}

inherits(Torrenting, EventEmitter)

/**
 * @private
 */
Torrenting.prototype._setupDispatcher = function () {
  var torrenting = this
  this.dispatcher.on(PROTOCOL, function (scope, publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
    var infoHash = message.slice(0, 20)
    message = message.slice(20)
    torrenting.emit(scope + '.' + infoHash, publicKey, message)
  })
}
/**
 * Send BitTorrent packet
 *
 * @param {Buffer} infoHash
 * @param {string} publicKey
 * @param {Buffer} message
 */
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

module.exports = Torrenting