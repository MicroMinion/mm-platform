var inherits = require('inherits')
var Duplex = require('stream').Duplex
var protobuf = require('protocol-buffers')
var fs = require('fs')
var expect = require('chai').expect

var FlunkyMessage = protobuf(fs.readFileSync('flunky-protocol.proto')).FlunkyMessage

var FlunkyProtocol = function (options) {
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.friends = options.friends
  this.devices = options.devices
  var flunkyProtocol = this
  this.stream.on('data', function (data) {
    var message = FlunkyMessage.decode(data)
    message.sender = flunkyProtocol.remoteAddress
    message.scope = flunkyProtocol._getScope(message.publicKey)
    flunkyProtocol.emit('data', message)
  })
  this.stream.on('close', function () {
    flunkyProtocol.emit('close')
  })
  this.stream.on('connect', function () {
    flunkyProtocol.emit('connect')
  })
  this.stream.on('drain', function () {
    flunkyProtocol.emit('drain')
  })
  this.stream.on('end', function () {
    flunkyProtocol.emit('end')
  })
  this.stream.on('error', function (err) {
    flunkyProtocol.emit('error', err)
  })
  this.stream.on('lookup', function (err, address, family) {
    if (err) {
    }
  // TODO
  })
  this.stream.on('timeout', function () {
    // TODO
  })
}

inherits(FlunkyProtocol, Duplex)

FlunkyProtocol.prototype.address = function () {
  return this.stream.address()
}

FlunkyProtocol.prototype.connect = function () {
  this.stream.connect()
}

FlunkyProtocol.prototype.destroy = function () {
  // TODO: Implement
}

FlunkyProtocol.prototype._read = function (size) {}

FlunkyProtocol.prototype._write = function (chunk, encoding, callback) {
  var message = {
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  }
  this.stream.write(FlunkyMessage.encode(message), 'buffer', callback)
}

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
FlunkyProtocol.prototype._getScope = function (publicKey) {
  expect(publicKey).to.be.a('string')
  if (this.devices.inScope(publicKey)) {
    return 'self'
  } else if (this.friends.inScope(publicKey)) {
    return 'friends'
  } else {
    return 'public'
  }
}

module.exports = FlunkyProtocol
