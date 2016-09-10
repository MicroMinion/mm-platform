'use strict'

var inherits = require('inherits')
var Duplex = require('stream').Duplex
var assert = require('assert')
var validation = require('./validation.js')
var _ = require('lodash')
var ProtoBuf = require('protobufjs')

var definition = {
  'name': 'Message',
  'fields': [{
    'rule': 'required',
    'type': 'string',
    'name': 'topic',
    'id': 1
  }, {
    'rule': 'required',
    'type': 'string',
    'name': 'protocol',
    'id': 2
  }, {
    'rule': 'required',
    'type': 'string',
    'name': 'payload',
    'id': 3
  }]
}

var builder = ProtoBuf.newBuilder()
builder.create(definition)
var Message = builder.build('Message')

var MMProtocol = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'stream'))
  assert(_.has(options, 'platform'))
  assert(_.has(options, 'logger'))
  this._log = options.logger
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.platform = options.platform
  var self = this
  this.stream.on('data', function (data) {
    self._log.debug('mm-protocol data received')
    assert(_.isBuffer(data))
    self._processData(data)
  })
  this.stream.on('close', function () {
    self.emit('close')
  })
  this.stream.on('connect', function () {
    self.emit('connect')
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

MMProtocol.prototype._processData = function (data) {
  var self = this
  try {
    var _message = Message.decode(data)
    var message = {
      topic: _message.topic,
      protocol: _message.protocol,
      payload: _message.payload
    }
    message.sender = self.remoteAddress
    message.scope = self._getScope(message.sender)
    assert(validation.validReceivedMessage(message))
    self.emit('data', message)
  } catch (e) {
    self._log.warn('invalid message received - dropped', {
      error: e,
      remote: self.remoteAddress
    })
  }
}

MMProtocol.prototype.connect = function (publicKey) {
  assert(validation.validKeyString(publicKey))
  this.stream.connect(publicKey)
}

MMProtocol.prototype.isConnected = function () {
  return this.stream.isConnected() && _.isString(this.remoteAddress)
}

MMProtocol.prototype.toMetadata = function () {
  return this.stream.stream._stream.toMetadata()
}

MMProtocol.prototype._read = function (size) {}

MMProtocol.prototype._write = function (chunk, encoding, callback) {
  assert(validation.validSendMessage(chunk))
  assert(validation.validCallback(callback))
  var message = new Message({
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  })
  this.stream.write(message.toBuffer(), 'buffer', callback)
}

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
MMProtocol.prototype._getScope = function (publicKey) {
  this._log.debug('_getScope', {
    publicKey: publicKey
  })
  assert(validation.validKeyString(publicKey))
  if (this.platform.devices.inScope(publicKey)) {
    return 'self'
  } else if (this.platform.friends.inScope(publicKey)) {
    return 'friends'
  } else {
    return 'public'
  }
}

MMProtocol.prototype.destroy = function () {
  this.stream.destroy()
}

Object.defineProperty(MMProtocol.prototype, 'remoteAddress', {
  get: function () {
    return this.stream.remoteAddress
  }
})

module.exports = MMProtocol
