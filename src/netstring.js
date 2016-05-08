'use strict'

var debug = require('debug')('mm-platform:netstring')
var inherits = require('inherits')
var Duplex = require('stream').Duplex
var ns = require('./ns.js')
var assert = require('assert')
var validation = require('./validation.js')
var _ = require('lodash')

var NetstringStream = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'stream'))
  this.stream = options.stream
  var self = this
  this.stream.on('data', function (data) {
    debug('data received')
    assert(_.isBuffer(data))
    debug(data.toString())
    if (!self.buffer) {
      self.buffer = data
    } else {
      self.buffer = Buffer.concat([self.buffer, data])
    }
    try {
      self._processBuffer()
    } catch (e) {
      assert(_.isError(e))
      debug(e)
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
}

inherits(NetstringStream, Duplex)

/**
 * @private
 */
NetstringStream.prototype._processBuffer = function () {
  debug('_processBuffer')
  assert(_.isBuffer(this.buffer))
  var self = this
  if (this.buffer.length === 0) {
    return
  }
  var messageLength = ns.nsLength(this.buffer)
  debug('message length: ' + messageLength)
  debug('buffer length: ' + this.buffer.length)
  if (this.buffer.length >= messageLength) {
    var payload = ns.nsPayload(self.buffer)
    process.nextTick(function () {
      self.emit('data', payload)
    })
    this.buffer = this.buffer.slice(messageLength)
    debug('buffer length after processing: ' + this.buffer.length)
    this._processBuffer()
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

NetstringStream.prototype.connect = function (connectionInfo) {
  assert(validation.validConnectionInfo(connectionInfo))
  this.stream.connect(connectionInfo)
}

Object.defineProperty(NetstringStream.prototype, 'remoteAddress', {
  get: function () {
    return this.stream.remoteAddress
  }
})

module.exports = NetstringStream
