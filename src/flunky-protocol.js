'use strict'

var inherits = require('inherits')
var Duplex = require('stream').Duplex
var protobuf = require('protocol-buffers')
var fs = require('fs')
var assert = require('assert')
var path = require('path')
var debug = require('debug')('flunky-platform:flunky-protocol')
var validation = require('./validation.js')
var _ = require('lodash')

var proto = fs.readFileSync(path.join(path.resolve(__dirname), 'flunky-protocol.proto'))
var FlunkyMessage = protobuf(proto).FlunkyMessage

var FlunkyProtocol = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options.stream))
  assert(_.has(options.friends))
  assert(_.has(options.devices))
  assert(_.has(options.directory))
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.friends = options.friends
  this.devices = options.devices
  this.directory = options.directory
  var flunkyProtocol = this
  this.directory.on('lookup', function (boxId, signId) {
    debug('lookup received')
    assert(validation.validKeyString(boxId))
    assert(validation.validKeyString(signId))
    if (!flunkyProtocol.remoteAddress && flunkyProtocol.stream.isConnected()) {
      if (flunkyProtocol.stream.remoteAddress && boxId === flunkyProtocol.stream.remoteAddress) {
        flunkyProtocol.remoteAddress = signId
        flunkyProtocol.emit('connect')
      }
    }
  })
  this.stream.on('data', function (data) {
    debug('data received')
    assert(_.isBuffer(data))
    var message = FlunkyMessage.decode(data)
    message.sender = flunkyProtocol.remoteAddress
    message.scope = flunkyProtocol._getScope(message.sender)
    assert(validation.validReceivedMessage(message))
    flunkyProtocol.emit('data', message)
  })
  this.stream.on('close', function () {
    flunkyProtocol.emit('close')
  })
  this.stream.on('connect', function () {
    if (!flunkyProtocol.remoteAddress) {
      flunkyProtocol.directory.getSignId(flunkyProtocol.stream.remoteAddress)
    } else {
      flunkyProtocol.emit('connect')
    }
  })
  this.stream.on('drain', function () {
    flunkyProtocol.emit('drain')
  })
  this.stream.on('end', function () {
    flunkyProtocol.emit('end')
  })
  this.stream.on('error', function (err) {
    assert(_.isError(err))
    flunkyProtocol.emit('error', err)
  })
  this.stream.on('timeout', function () {
    flunkyProtocol.emit('timeout')
  })
  this.stream.on('lookup', function (err, address, family) {
    flunkyProtocol.emit('lookup', err, address, family)
  })
}

inherits(FlunkyProtocol, Duplex)

FlunkyProtocol.prototype.connect = function (publicKey) {
  debug('connect')
  assert(validation.validKeyString(publicKey))
  var self = this
  this.remoteAddress = publicKey
  this.directory.getConnectionInfo(publicKey, function (err, result) {
    if (err) {
      assert(_.isError(err))
      assert(_.isNil(result))
      self.emit('error', err)
      self.emit('lookup', err, null, null)
    } else {
      assert(_.isNil(err))
      assert(validation.validConnectionInfo(result))
      self.emit('lookup', null, result, 'flunky')
      self.stream.connect(result)
    }
  })
}

FlunkyProtocol.prototype.isConnected = function () {
  return this.stream.isConnected() && this.remoteAddress
}

FlunkyProtocol.prototype._read = function (size) {}

FlunkyProtocol.prototype._write = function (chunk, encoding, callback) {
  assert(validation.validSendMessage(chunk))
  assert(validation.validCallback(callback))
  debug('_write')
  var message = {
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  }
  debug(message)
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
  assert(validation.validKeyString(publicKey))
  if (this.devices.inScope(publicKey)) {
    return 'self'
  } else if (this.friends.inScope(publicKey)) {
    return 'friends'
  } else {
    return 'public'
  }
}

FlunkyProtocol.prototype.destroy = function () {
  this.stream.destroy()
}

module.exports = FlunkyProtocol
