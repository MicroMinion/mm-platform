'use strict'

var debug = require('debug')('flunky-platform:netstring')
var inherits = require('inherits')
var Duplex = require('stream').Duplex
var ns = require('./ns.js')

var NetstringStream = function (options) {
  this.stream = options.stream
  this.buffer = new Buffer(0)
  var self = this
  this.stream.on('data', function (data) {
    Buffer.concat([self.buffer, data])
    try {
      self._processBuffer()
    } catch (e) {
      debug(e)
      self.buffer = new Buffer()
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
  var self = this
  var buffer = this.buffer
  if (buffer.length === 0) {
    return
  }
  var messageLength = ns.nsLength(buffer)
  debug('message length: ' + messageLength)
  debug('buffer length: ' + buffer.length)
  if (buffer.length >= messageLength) {
    process.nextTick(function () {
      self.emit('data', ns.nsPayload(buffer))
    })
    this._processMessage(ns.nsPayload(buffer))
    this.buffers = new Buffer(buffer.length - messageLength)
    buffer.copy(this.buffer, 0, messageLength)
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
  this.stream.write(ns.nsWrite(chunk), encoding, callback)
}

NetstringStream.prototype.destroy = function () {
  this.stream.destroy()
}

NetstringStream.prototype.isConnected = function () {
  return this.stream.isConnected()
}

NetstringStream.prototype.connect = function (connectionInfo) {
  this.stream.connect(connectionInfo)
}

Object.defineProperty(NetstringStream.prototype, 'remoteAddress', {
  get: function () {
    return this.stream.remoteAddress
  }
})

module.exports = NetstringStream
