'use strict'

var _ = require('lodash')
var transport = require('1tp').net
var util = require('./curvecp-util.js')
var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var extend = require('extend.js')
var EventEmitter = require('events').EventEmitter
var Uint64BE = require('int64-buffer').Uint64BE
var CurveCPClientStream = require('./curvecp-client-stream.js')
var inherits = require('inherits')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')

var HELLO_WAIT = [1000000000, 1500000000, 2250000000, 3375000000, 5062500000, 7593750000, 11390625000, 17085937500]

var CurveCPClient = function (options) {
  this.__ourNonceCounter = 0
  var keyPair = nacl.box.keyPair()
  this.clientConnectionPublicKey = keyPair.publicKey
  this.clientConnectionPrivateKey = keyPair.secretKey
  this.connected = false
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
  if (this.serverName.length !== 256) {
    var buffer = new Buffer(256)
    buffer.fill(0)
    buffer.write('0A', 'hex')
    buffer.write(this.serverName, 1)
    this.serverName = new Uint8Array(buffer)
  }
}

inherits(CurveCPClient, EventEmitter)

CurveCPClient.prototype.connect = function (destination, connectionInfo) {
  this._log.info('connect ' + destination)
  var errors = 0
  var self = this
  this.serverPublicKey = nacl.util.decodeBase64(destination)
  if (connectionInfo.length === 0) {
    this.emit('error', new Error('No connectionInfo specified'))
    return
  }
  _.forEach(connectionInfo, function (connectionInfoItem) {
    var socket = new transport.Socket()
    socket.once('error', function (err) {
      errors += 1
      self._log.debug(err)
      if (errors === connectionInfo.length) {
        self.emit('error', new Error('All connections failed'))
      }
    })
    socket.setLogger(self._log)
    socket.once('connect', function () {
      self._sendHello(socket, 0)
    })
    socket.once('data', function (data) {
      self._onCookie(socket, data)
    })
    socket.connect([connectionInfoItem])
  })
}

CurveCPClient.prototype._increaseCounter = function () {
  this.__ourNonceCounter += 1
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
    if (!self.connected) {
      self._sendHello(socket, attempt + 1)
    }
  }, (wait + util.randommod(wait)) / 1000000)
}

CurveCPClient.prototype._onCookie = function (socket, cookieMessage) {
  this._log.debug('onCookie')
  if (this.connected) {
    return
  }
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
  var sharedKey = nacl.box.before(this.serverConnectionPublicKey, this.clientConnectionPrivateKey)
  var serverCookie = boxData.subarray(32)
  if (serverCookie.length !== 96) {
    this._log.warn('Server cookie invalid')
    return
  }
  this.connected = true
  var stream = new CurveCPClientStream({
    clientPublicKey: this.clientPublicKey,
    clientPrivateKey: this.clientPrivateKey,
    serverPublicKey: this.serverPublicKey,
    clientConnectionPublicKey: this.clientConnectionPublicKey,
    clientConnectionPrivateKey: this.clientConnectionPrivateKey,
    sharedKey: sharedKey,
    serverExtension: this.serverExtension,
    clientExtension: this.clientExtension,
    socket: socket,
    serverCookie: serverCookie,
    serverName: this.serverName,
    logger: this._log
  })
  this.emit('connection', stream)
}

module.exports = CurveCPClient
