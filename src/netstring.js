'use strict'

var inherits = require('inherits')
var Duplex = require('stream').Duplex
var ns = require('./ns.js')
var assert = require('assert')
var validation = require('./validation.js')
var _ = require('lodash')

var NetstringStream = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'stream'))
  assert(_.has(options, 'logger'))
  this._log = options.logger
  this.stream = options.stream
  var self = this
  this.stream.on('data', function (data) {
    assert(_.isBuffer(data))
    self._log.debug('netstring data received', {
      data: data.toString()
    })
    if (!self.buffer) {
      self.buffer = data
    } else {
      self.buffer = Buffer.concat([self.buffer, data])
    }
    try {
      self._processBuffer()
    } catch (e) {
      assert(_.isError(e))
      self._log.warn('failed to process netstring buffer', {
        error: e
      })
      delete self.buffer
    }
  })
  Duplex.call(this, {
    allowHalfOpen: false
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
    self.emit('error', err)
  })
  this.stream.on('timeout', function () {
    self.emit('timeout')
  })
  this.stream.on('lookup', function (err, address, family) {
    self.emit('lookup', err, address, family)
  })
  this.stream.on('finish', function () {
    self.emit('finish')
  })
}

inherits(NetstringStream, Duplex)

/**
 * @private
 */
NetstringStream.prototype._processBuffer = function () {
  assert(_.isBuffer(this.buffer))
  var self = this
  if (this.buffer.length === 0) {
    return
  }
  var messageLength = ns.nsLength(this.buffer)
  if (this.buffer.length >= messageLength) {
    var payload = ns.nsPayload(this.buffer)
    this.buffer = this.buffer.slice(messageLength)
    this.emit('data', payload)
    process.nextTick(function () {
      self._processBuffer()
    })
  }
}

/**
 * Send a message to TransportManager
 *
 * @public
 * @param {string} protocol
 * @param {string} publicKey
 * @param {Buffer} message
 */
NetstringStream.prototype._write = function (chunk, encoding, callback) {
  assert(_.isBuffer(chunk))
  assert(validation.validCallback(callback))
  assert(_.isBuffer(ns.nsWrite(chunk)))
  this.stream.write(ns.nsWrite(chunk), encoding, callback)
}

NetstringStream.prototype._read = function (size) {}

NetstringStream.prototype.destroy = function () {
  this.stream.destroy()
}

NetstringStream.prototype.isConnected = function () {
  return this.stream.isConnected()
}

NetstringStream.prototype.connect = function (boxId, connectionInfo) {
  this.stream.connect(boxId, connectionInfo)
}

Object.defineProperty(NetstringStream.prototype, 'remoteAddress', {
  get: function () {
    return this.stream.remoteAddress
  }
})

module.exports = NetstringStream
