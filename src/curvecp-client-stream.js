'use strict'

var setImmediate = require('async.util.setimmediate')
var Duplex = require('stream').Duplex
var inherits = require('inherits')
var extend = require('extend.js')
var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')
var util = require('./curvecp-util.js')
var Uint64BE = require('int64-buffer').Uint64BE

var CurveCPClientStream = function (options) {
  var self = this
  this.__ourNonceCounter = 0
  this.__remoteNonceCounter = 0
  this.__canSend = true
  this.__initiateSend = false
  if (!options) {
    options = {}
  }
  if (!options.logger) {
    options.logger = winston
  }
  this._log = winstonWrapper(options.logger)
  this._log.addMeta({
    module: 'curvecp-client-stream'
  })
  extend(this, options)
  options.objectMode = false
  options.decodeStrings = false
  options.allowHalfOpen = false
  Duplex.call(this, options)
  setImmediate(function () {
    self.emit('connect')
  })
  this.socket.on('data', function (message) {
    if (message.length < 64 || message.length > 1152) {
      return
    }
    var messageType = message.subarray(0, 8)
    if (util.isEqual(messageType, util.SERVER_MSG)) {
      self._onServerMessage(message)
    } else {
      self._log.warn('invalid packet received')
    }
  })
}

inherits(CurveCPClientStream, Duplex)

CurveCPClientStream.prototype._increaseCounter = function () {
  this.__ourNonceCounter += 1
}

CurveCPClientStream.prototype._createNonceFromCounter = function (prefix) {
  this._increaseCounter()
  var nonce = new Uint8Array(24)
  nonce.set(nacl.util.decodeUTF8(prefix))
  var counter = new Uint8Array(new Uint64BE(this.__ourNonceCounter).toBuffer()).reverse()
  nonce.set(counter, 16)
  return nonce
}

CurveCPClientStream.prototype._setExtensions = function (array) {
  array.set(this.serverExtension, 8)
  array.set(this.clientExtension, 24)
  return array
}

CurveCPClientStream.prototype.__validNonce = function (message, offset) {
  var remoteNonce = new Uint64BE(new Buffer(message.subarray(offset, 8).reverse())).toNumber()
  if (remoteNonce > this.__remoteNonceCounter || (this.__remoteNonceCounter === 0 && remoteNonce === 0)) {
    this.__remoteNonceCounter = remoteNonce
    return true
  } else {
    return false
  }
}

CurveCPClientStream.prototype._createVouch = function () {
  var nonce = util.createRandomNonce('CurveCPV')
  return util.encrypt(this.clientConnectionPublicKey, nonce, 8, this.clientPrivateKey, this.serverPublicKey)
}

CurveCPClientStream.prototype._canSend = function () {
  return this.__canSend
}

CurveCPClientStream.prototype._setCanSend = function (canSend) {
  if (canSend === this.__canSend) {
    return
  }
  this.__canSend = canSend
  if (canSend && this.__pendingWrite) {
    this._write(this.__pendingWrite.chunk, this.__pendingWrite.encoding, this.__pendingWrite.done)
    this.__pendingWrite = null
  }
}

CurveCPClientStream.prototype._validExtensions = function (array) {
  return util.isEqual(array.subarray(8, 8 + 16), this.clientExtension) &&
    util.isEqual(array.subarray(8 + 16, 8 + 16 + 16), this.serverExtension)
}

CurveCPClientStream.prototype._sendClientMessage = function (message, done) {
  this._log.debug('sendClientMessage ' + nacl.util.encodeBase64(this.clientPublicKey) + ' > ' + nacl.util.encodeBase64(this.serverPublicKey))
  var result = new Uint8Array(96 + message.length)
  result.set(util.CLIENT_MSG)
  result.set(this.clientConnectionPublicKey, 40)
  var nonce = this._createNonceFromCounter('CurveCP-client-M')
  var messageBox = util.encryptShared(message, nonce, 16, this.sharedKey)
  result.set(messageBox, 8 + 16 + 16 + 32)
  result = this._setExtensions(result)
  this.socket.write(new Buffer(result), done)
}

CurveCPClientStream.prototype._sendInitiate = function (message, done) {
  this._log.debug('sendInitiate ' + nacl.util.encodeBase64(this.clientPublicKey) + ' > ' + nacl.util.encodeBase64(this.serverPublicKey))
  if (message.length & 15) {
    this._log.warn('message is of incorrect length, needs to be multiple of 16')
    return
  }
  var result = new Uint8Array(544 + message.length)
  result.set(util.INITIATE_MSG)
  result.set(this.clientConnectionPublicKey, 40)
  result.set(this.serverCookie, 72)
  var initiateBoxData = new Uint8Array(352 + message.length)
  initiateBoxData.set(this.clientPublicKey)
  initiateBoxData.set(this._createVouch(), 32)
  initiateBoxData.set(this.serverName, 96)
  initiateBoxData.set(message, 352)
  var nonce = this._createNonceFromCounter('CurveCP-client-I')
  result.set(util.encryptShared(initiateBoxData, nonce, 16, this.sharedKey), 168)
  result = this._setExtensions(result)
  this.socket.write(new Buffer(result), done)
  this._setCanSend(false)
}

CurveCPClientStream.prototype._onServerMessage = function (message) {
  this._log.debug('onServerMessage@Client')
  if (!this._validExtensions(message)) {
    this._log.warn('Invalid extensions')
    return
  }
  if (!this.__validNonce(message, 40)) {
    this._log.warn('Invalid nonce received')
    return
  }
  var boxData = util.decryptShared(message.subarray(40), 'CurveCP-server-M', this.sharedKey)
  if (boxData === undefined || !boxData) {
    this._log.warn('not able to decrypt box data')
    return
  }
  this._setCanSend(true)
  var buffer = new Buffer(boxData)
  this.push(buffer)
}

CurveCPClientStream.prototype._write = function (chunk, encoding, done) {
  this._log.debug('_write')
  if (this._canSend()) {
    if (this.__initiateSend) {
      this._sendClientMessage(chunk, done)
    } else {
      this.__initiateSend = true
      this._sendInitiate(chunk, done)
    }
  } else {
    if (this.__pendingWrite) {
      done(new Error('Error: You can not write to stream while previous write did not yet return'))
      return
    }
    this.__pendingWrite = {
      chunk: chunk,
      encoding: encoding,
      done: done
    }
  }
}

CurveCPClientStream.prototype._read = function (size) {
  this._log.debug('_read')
}

Object.defineProperty(CurveCPClientStream.prototype, 'remoteAddress', {
  get: function () {
    return nacl.util.encodeBase64(this.serverPublicKey)
  }
})

module.exports = CurveCPClientStream
