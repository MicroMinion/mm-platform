'use strict'

var inherits = require('inherits')
var Duplex = require('stream').Duplex
var protobuf = require('protocol-buffers')
var fs = require('fs')
var assert = require('assert')
var path = require('path')
var validation = require('./validation.js')
var _ = require('lodash')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')

var proto = fs.readFileSync(path.join(path.resolve(__dirname), 'mm-protocol.proto'))
var Message = protobuf(proto).Message

var MMProtocol = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'stream'))
  assert(_.has(options, 'platform'))
  if (!options.logger) {
    options.logger = winston
  }
  this._log = winstonWrapper(options.logger)
  this._log.addMeta({
    module: 'mm-platform:mm-protocol'
  })
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.platform = options.platform
  var self = this
  this.stream.on('data', function (data) {
    self._log.debug('data received')
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
    var message = Message.decode(data)
    self._log.debug(message)
    message.sender = self.remoteAddress
    message.scope = self._getScope(message.sender)
    assert(validation.validReceivedMessage(message))
    self.emit('data', message)
  } catch (e) {
    self._log.warn('invalid message received - dropped', {
      error: e,
      message: data
    })
  }
}

MMProtocol.prototype.connect = function (publicKey) {
  this._log.debug('connect')
  assert(validation.validKeyString(publicKey))
  var self = this
  this.platform.directory.getNodeInfo(publicKey, function (err, result) {
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
  return this.stream.isConnected() && _.isString(this.remoteAddress)
}

MMProtocol.prototype.toMetadata = function () {
  return this.stream.stream._stream.toMetadata()
}

MMProtocol.prototype._read = function (size) {}

MMProtocol.prototype._write = function (chunk, encoding, callback) {
  this._log.debug('_write')
  assert(validation.validSendMessage(chunk))
  assert(validation.validCallback(callback))
  var message = {
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  }
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
