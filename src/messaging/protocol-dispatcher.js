var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var TransportManager = require('./transport-manager.js')
var debug = require('debug')('flunky-platform:messaging:protocol-dispatcher')
var isBuffer = require('is-buffer')
var ns = require('netstring')

var expect = require('chai').expect

var ProtocolDispatcher = function (messaging) {
  expect(messaging).to.be.an('object')
  debug('initialize')
  EventEmitter.call(this)
  this.messaging = messaging
  this.transportManager
  this._setupTransportManager()
  this.buffers = {}
}

inherits(ProtocolDispatcher, EventEmitter)

ProtocolDispatcher.prototype.disable = function () {
  this.transportManager.disable()
}

ProtocolDispatcher.prototype.enable = function () {
  this.transportManager.enable()
}

ProtocolDispatcher.prototype._setupTransportManager = function () {
  var dispatcher = this
  this.transportManager = new TransportManager(this.messaging)
  this.transportManager.on('message', function (publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(isBuffer(message)).to.be.true
    debug('message event')
    debug('message length: ' + message.length)
    if (_.has(dispatcher.buffers, publicKey)) {
      dispatcher.buffers[publicKey] = Buffer.concat([dispatcher.buffers[publicKey], message])
    } else {
      dispatcher.buffers[publicKey] = message
    }
    dispatcher.processBuffer(publicKey)
  })
}

ProtocolDispatcher.prototype.processBuffer = function (publicKey) {
  expect(publicKey).to.be.a('string')
  debug('processBuffer')
  var buffer = this.buffers[publicKey]
  if (buffer.length === 0) {
    return
  }
  var messageLength = ns.nsLength(buffer)
  debug('message length: ' + messageLength)
  debug('buffer length: ' + buffer.length)
  if (buffer.length >= messageLength) {
    this.processMessage(publicKey, ns.nsPayload(buffer))
    this.buffers[publicKey] = new Buffer(buffer.length - messageLength)
    buffer.copy(this.buffers[publicKey], 0, messageLength)
    debug('buffer length after processing: ' + this.buffers[publicKey].length)
    this.processBuffer(publicKey)
  }
}

ProtocolDispatcher.prototype.processMessage = function (publicKey, message) {
  expect(publicKey).to.be.a('string')
  expect(isBuffer(message)).to.be.true
  debug('processMessage')
  var protocol = message.toString('utf-8', 0, 2)
  debug(protocol)
  this.emit(protocol, publicKey, message.slice(2))
}

ProtocolDispatcher.prototype.send = function (protocol, publicKey, message) {
  expect(protocol).to.be.a('string')
  expect(protocol.length).to.equal(2)
  expect(publicKey).to.be.a('string')
  expect(isBuffer(message)).to.be.true
  expect(message.length).to.be.greaterThan(0)
  var buffer = Buffer.concat([new Buffer(protocol), message])
  return this.transportManager.send(publicKey, ns.nsWrite(buffer))
}

ProtocolDispatcher.prototype.connect = function (publicKey) {
  return this.transportManager.connect(publicKey)
}

/*
var Messaging = function() {
  EventEmitter.call(this)
}

inherits(Messaging, EventEmitter)

Messaging.prototype.send = function(publicKey, message) {
  var buffer = new Buffer(8)
  message.copy(buffer, 0, 0, 8)
  this.emit('message', publicKey, buffer)
  var buffer = new Buffer(message.length - 8 + 8)
  message.copy(buffer, 0, 8)
  buffer.writeUInt32BE(8, message.length - 8)
  buffer.writeUInt16BE(1, message.length - 8 + 4)
  buffer.write('XY', message.length - 8 + 4 + 2)
  this.emit('message', publicKey, buffer)
}

var dispatcher = new ProtocolDispatcher()
dispatcher.transportManager = new Messaging()
dispatcher._setupTransportManager()

dispatcher.on(1, function(publicKey, message) {
  debug(message.toString())
})

dispatcher.send(1, 'local', new Buffer('abcdefghijklmnopqrstuvwxyz'))
*/

module.exports = ProtocolDispatcher
