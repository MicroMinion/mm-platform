'use strict'
var util = require('./curvecp-util.js')
var Uint64BE = require('int64-buffer').Uint64BE
var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var extend = require('extend.js')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')
var nacl = require('tweetnacl')
var isBuffer = require('is-buffer')
var assert = require('assert')
nacl.util = require('tweetnacl-util')

var CurveCPServerStream = function (options) {
  if (!options) {
    options = {}
  }
  if (!options.logger) {
    options.logger = winston
  }
  this._log = winstonWrapper(options.logger)
  this._log.addMeta({
    module: 'curvecp-server-stream'
  })
  extend(this, options)
  EventEmitter.call(this)
  this.__remoteNonceCounter = 0
  this.__ourNonceCounter = 0
}

inherits(CurveCPServerStream, EventEmitter)

CurveCPServerStream.prototype._validExtensions = function (message) {
  return util.isEqual(message.subarray(8, 8 + 16), this.serverExtension) &&
    util.isEqual(message.subarray(8 + 16, 8 + 16 + 16), this.clientExtension)
}

CurveCPServerStream.prototype.__validNonce = function (message, offset) {
  var remoteNonce = new Uint64BE(new Buffer(message.subarray(offset, 8).reverse())).toNumber()
  if (remoteNonce > this.__remoteNonceCounter || (this.__remoteNonceCounter === 0 && remoteNonce === 0)) {
    this.__remoteNonceCounter = remoteNonce
    return true
  } else {
    return false
  }
}

CurveCPServerStream.prototype.destroy = function () {
  var self = this
  setImmediate(function () {
    self.emit('close')
  })
}

CurveCPServerStream.prototype.process = function (message, socket) {
  this.stream = socket
  this._onClientMessage(message)
}

CurveCPServerStream.prototype._onClientMessage = function (message) {
  this._log.debug('onClientMessage@Server')
  if (!this._validExtensions(message)) {
    this._log.warn('Invalid extensions')
    return
  }
  if (!util.isEqual(message.subarray(40, 40 + 32), this.clientConnectionPublicKey)) {
    this._log.warn('Invalid client connection key')
    return
  }
  if (!this.__validNonce(message, 40 + 32)) {
    this._log.warn('Invalid nonce received')
    return
  }
  var boxData = util.decryptShared(message.subarray(40 + 32), 'CurveCP-client-M', this.sharedKey)
  if (boxData === undefined || !boxData) {
    this._log.warn('not able to decrypt box data')
    return
  }
  var buffer = new Buffer(boxData)
  assert(isBuffer(buffer))
  this.emit('data', buffer)
}

CurveCPServerStream.prototype._increaseCounter = function () {
  this.__ourNonceCounter += 1
}

CurveCPServerStream.prototype._createNonceFromCounter = function (prefix) {
  this._increaseCounter()
  var nonce = new Uint8Array(24)
  nonce.set(nacl.util.decodeUTF8(prefix))
  var counter = new Uint8Array(new Uint64BE(this.__ourNonceCounter).toBuffer()).reverse()
  nonce.set(counter, 16)
  return nonce
}

CurveCPServerStream.prototype._sendServerMessage = function (message, done) {
  this._log.debug('sendServerMessage')
  var result = new Uint8Array(64 + message.length)
  result.set(util.SERVER_MSG)
  var nonce = this._createNonceFromCounter('CurveCP-server-M')
  var messageBox = util.encryptShared(message, nonce, 16, this.sharedKey)
  result.set(messageBox, 8 + 16 + 16)
  result = this._setExtensions(result)
  this.stream.write(new Buffer(result), done)
}

CurveCPServerStream.prototype._setExtensions = function (array) {
  array.set(this.clientExtension, 8)
  array.set(this.serverExtension, 24)
  return array
}

CurveCPServerStream.prototype.write = function (chunk, done) {
  this._log.debug('write')
  this._sendServerMessage(chunk, done)
}

Object.defineProperty(CurveCPServerStream.prototype, 'remoteAddress', {
  get: function () {
    return nacl.util.encodeBase64(this.clientPublicKey)
  }
})

module.exports = CurveCPServerStream
