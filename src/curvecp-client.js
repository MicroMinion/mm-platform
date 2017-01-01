'use strict'

var _ = require('lodash')
var transport = require('1tp').net
var util = require('./curvecp-util.js')
var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var extend = require('extend.js')
var EventEmitter = require('events').EventEmitter
var Uint64BE = require('int64-buffer').Uint64BE
var inherits = require('inherits')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')
var Message = require('curvecp').Message
var assert = require('assert')
var isBuffer = require('is-buffer')

var HELLO_WAIT = [1000000000, 1500000000, 2250000000, 3375000000, 5062500000, 7593750000, 11390625000, 17085937500]
var INITIATE_WAIT = 1000 * 10

var CurveCPClient = function (options) {
  this.__ourNonceCounter = 0
  this.__remoteNonceCounter = 0
  var keyPair = nacl.box.keyPair()
  this.clientConnectionPublicKey = keyPair.publicKey
  this.clientConnectionPrivateKey = keyPair.secretKey
  this._connected = false
  this._in_progress = false
  EventEmitter.call(this)
  if (!options) {
    options = {}
  }
  if (!options.logger) {
    options.logger = winston
  }
  this._log = winstonWrapper(options.logger)
  this._log.addMeta({
    module: 'curvecp-client'
  })
  extend(this, {
    clientExtension: new Uint8Array(16),
    serverExtension: new Uint8Array(16),
    clientPublicKey: null,
    clientPrivateKey: null,
    serverName: new Uint8Array(256)
  }, options)
  EventEmitter.call(this)
  this.serverName = util.codifyServerName(this.serverName)
}

inherits(CurveCPClient, EventEmitter)

CurveCPClient.prototype.connect = function (destination, connectionInfo) {
  assert(!this._in_progress, 'connect can only be executed once on CurveCPClient')
  this._in_progress = true
  this._log.info('connect ' + destination)
  this.serverPublicKey = nacl.util.decodeBase64(destination)
  if (connectionInfo.length === 0) {
    this.emit('error', new Error('No connectionInfo specified'))
    return
  }
  this._connectSocket(connectionInfo)
}

CurveCPClient.prototype.destroy = function () {
  var self = this
  if (this.socket) {
    this.socket.destroy()
    setImmediate(function () {
      self.emit('close')
    })
  }
}

CurveCPClient.prototype._connectSocket = function (connectionInfo) {
  var self = this
  var socket = new transport.Socket({
    parallelConnectionSetup: true
  })
  socket.setLogger(self._log)
  socket.once('error', function (err) {
    self._log.debug(err)
    self.emit('error', new Error('Connection failed'))
  })
  socket.once('connect', function () {
    self._log.info('connected', connectionInfo)
    self._sendHello(socket, 0)
  })
  socket.once('data', function (data) {
    if (!self._connected) {
      self._connected = true
      self._onMessage(data, socket)
    }
  })
  socket.connect(connectionInfo)
}

CurveCPClient.prototype._onMessage = function (message, socket) {
  this._log.debug('_onMessage@Client')
  if (message.length < 64 || message.length > 1152) {
    return
  }
  var messageType = message.subarray(0, 8)
  if (util.isEqual(messageType, util.SERVER_MSG) && this.serverCookie) {
    if (this._initiateTimeout) {
      clearTimeout(this._initiateTimeout)
      this.emit('connect')
    }
    this._onServerMessage(message, socket)
  } else if (util.isEqual(messageType, util.COOKIE_MSG) && !this.serverCookie) {
    this._onCookie(message, socket)
  } else {
    this._log.warn('invalid packet received')
  }
}

CurveCPClient.prototype._increaseCounter = function () {
  this.__ourNonceCounter += 1
}

CurveCPClient.prototype.__validNonce = function (message, offset) {
  var remoteNonce = new Uint64BE(new Buffer(message.subarray(offset, 8).reverse())).toNumber()
  if (remoteNonce > this.__remoteNonceCounter || (this.__remoteNonceCounter === 0 && remoteNonce === 0)) {
    this.__remoteNonceCounter = remoteNonce
    return true
  } else {
    return false
  }
}

CurveCPClient.prototype._createVouch = function () {
  var nonce = util.createRandomNonce('CurveCPV')
  return util.encrypt(this.clientConnectionPublicKey, nonce, 8, this.clientPrivateKey, this.serverPublicKey)
}

CurveCPClient.prototype._setExtensions = function (array) {
  array.set(this.serverExtension, 8)
  array.set(this.clientExtension, 24)
  return array
}

CurveCPClient.prototype._validExtensions = function (array) {
  return util.isEqual(array.subarray(8, 8 + 16), this.clientExtension) &&
    util.isEqual(array.subarray(8 + 16, 8 + 16 + 16), this.serverExtension)
}

CurveCPClient.prototype._createNonceFromCounter = function (prefix) {
  this._increaseCounter()
  var nonce = new Uint8Array(24)
  nonce.set(nacl.util.decodeUTF8(prefix))
  var counter = new Uint8Array(new Uint64BE(this.__ourNonceCounter).toBuffer()).reverse()
  nonce.set(counter, 16)
  return nonce
}

CurveCPClient.prototype._sendHello = function (socket, attempt) {
  this._log.debug('sendHello')
  var self = this
  var result = new Uint8Array(224)
  result.set(util.HELLO_MSG, 0)
  result.set(this.clientConnectionPublicKey, 40)
  var nonce = this._createNonceFromCounter('CurveCP-client-H')
  var box = util.encrypt(new Uint8Array(64), nonce, 16, this.clientConnectionPrivateKey, this.serverPublicKey)
  result.set(box, 136)
  result = this._setExtensions(result)
  socket.write(new Buffer(result))
  if (attempt >= HELLO_WAIT.length) {
    socket.emit('error', new Error('No response received'))
    return
  }
  var wait = HELLO_WAIT[attempt]
  setTimeout(function () {
    if (!self._connected) {
      self._sendHello(socket, attempt + 1)
    }
  }, (wait + util.randommod(wait)) / 1000000)
}

CurveCPClient.prototype._onCookie = function (cookieMessage, socket) {
  var self = this
  this._log.debug('onCookie')
  if (cookieMessage.length !== 200) {
    this._log.warn('Cookie message has incorrect length')
    return
  }
  if (!this._validExtensions(cookieMessage)) {
    this._log.warn('Invalid extensions')
    return
  }
  var boxData = util.decrypt(cookieMessage.subarray(40, 200), 'CurveCPK', this.serverPublicKey, this.clientConnectionPrivateKey)
  if (boxData === undefined || !boxData) {
    this._log.warn('Not able to decrypt cookie box data')
    return
  }
  this.serverConnectionPublicKey = boxData.subarray(0, 32)
  this.sharedKey = nacl.box.before(this.serverConnectionPublicKey, this.clientConnectionPrivateKey)
  this.serverCookie = boxData.subarray(32)
  if (this.serverCookie.length !== 96) {
    this._log.warn('Server cookie invalid')
    return
  }
  this.socket = socket
  this.socket.on('data', function (data) {
    self._onMessage(data)
  })
  this.socket.on('error', function (err) {
    self.emit('error', err)
  })
  this._sendInitiate(new Message().toBuffer())
}

CurveCPClient.prototype._sendInitiate = function (message) {
  var self = this
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
  this.socket.write(new Buffer(result), function (err) {
    if (err) {
      self.emit('error', new Error('CurveCP handshake failed - can not send INITIATE'))
    } else {
      self._initiateTimeout = setTimeout(function () {
        self.emit('error', new Error('CurveCP handshake failed - no reply to INITIATE'))
      }, INITIATE_WAIT)
    }
  })
}

CurveCPClient.prototype._sendClientMessage = function (message, done) {
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

CurveCPClient.prototype._onServerMessage = function (message) {
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
  var buffer = new Buffer(boxData)
  assert(isBuffer(buffer))
  this.emit('data', buffer)
}

CurveCPClient.prototype.write = function (chunk, done) {
  this._sendClientMessage(chunk, done)
}

Object.defineProperty(CurveCPClient.prototype, 'remoteAddress', {
  get: function () {
    return nacl.util.encodeBase64(this.serverPublicKey)
  }
})

module.exports = CurveCPClient
