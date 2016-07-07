'use strict'

var inherits = require('inherits')
var Duplex = require('stream').Duplex
var protobuf = require('protocol-buffers')
var fs = require('fs')
var assert = require('assert')
var path = require('path')
var debug = require('debug')('mm-platform:mm-protocol')
var validation = require('./validation.js')
var _ = require('lodash')

var proto = fs.readFileSync(path.join(path.resolve(__dirname), 'mm-protocol.proto'))
var Message = protobuf(proto).Message

var DIRECTORY_TIMEOUT = 5 * 1000

var MMProtocol = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'stream'))
  assert(_.has(options, 'friends'))
  assert(_.has(options, 'devices'))
  assert(_.has(options, 'directory'))
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.friends = options.friends
  this.devices = options.devices
  this.directory = options.directory
  var self = this
  this.directory.on('lookup', function (boxId, signId) {
    debug('lookup received')
    assert(validation.validKeyString(boxId))
    assert(validation.validKeyString(signId))
    if (!self.remoteAddress && self.stream.isConnected()) {
      if (self.stream.remoteAddress && boxId === self.stream.remoteAddress) {
        self.remoteAddress = signId
        self.emit('connect')
      }
    }
  })
  this.stream.on('data', function (data) {
    debug('data received')
    assert(_.isBuffer(data))
    try {
      var message = Message.decode(data)
      message.sender = self.remoteAddress
      message.scope = self._getScope(message.sender)
      assert(validation.validReceivedMessage(message))
      self.emit('data', message)
    } catch (e) {
      debug('invalid message received - dropped')
      debug(e)
    }
  })
  this.stream.on('close', function () {
    self.emit('close')
  })
  this.stream.on('connect', function () {
    if (!self.remoteAddress) {
      self.directory.getSignId(self.stream.remoteAddress)
      setTimeout(function () {
        if (!self.remoteAddress) {
          self.emit('error', new Error('Directory Lookup Timeout'))
          debug('directory timeout')
        }
      }, DIRECTORY_TIMEOUT)
    } else {
      self.emit('connect')
    }
  })
  this.stream.on('drain', function () {
    self.emit('drain')
  })
  this.stream.on('end', function () {
    self.emit('end')
  })
  this.stream.on('error', function (err) {
    assert(_.isError(err))
    self.emit('error', err)
  })
  this.stream.on('timeout', function () {
    self.emit('timeout')
  })
  this.stream.on('lookup', function (err, address, family) {
    self.emit('lookup', err, address, family)
  })
}

inherits(MMProtocol, Duplex)

MMProtocol.prototype.connect = function (publicKey) {
  debug('connect')
  assert(validation.validKeyString(publicKey))
  var self = this
  this.remoteAddress = publicKey
  this.directory.getNodeInfo(publicKey, function (err, result) {
    if (err) {
      assert(_.isError(err))
      assert(_.isNil(result))
      self.emit('error', err)
      self.emit('lookup', err, null, null)
    } else {
      assert(_.isNil(err))
      assert(validation.validNodeInfo(result))
      self.emit('lookup', null, result, 'mm')
      self.stream.connect(result.boxId, result.connectionInfo)
    }
  })
}

MMProtocol.prototype.isConnected = function () {
  return this.stream.isConnected() && this.remoteAddress
}

MMProtocol.prototype._read = function (size) {}

MMProtocol.prototype._write = function (chunk, encoding, callback) {
  assert(validation.validSendMessage(chunk))
  assert(validation.validCallback(callback))
  debug('_write')
  var message = {
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  }
  debug(message)
  this.stream.write(Message.encode(message), 'buffer', callback)
}

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
MMProtocol.prototype._getScope = function (publicKey) {
  assert(validation.validKeyString(publicKey))
  if (this.devices.inScope(publicKey)) {
    return 'self'
  } else if (this.friends.inScope(publicKey)) {
    return 'friends'
  } else {
    return 'public'
  }
}

MMProtocol.prototype.destroy = function () {
  this.stream.destroy()
}

module.exports = MMProtocol
