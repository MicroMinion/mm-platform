'use strict'

var nacl = require('tweetnacl')
var _ = require('lodash')
nacl.util = require('tweetnacl-util')
var EventEmitter = require('events').EventEmitter
var winston = require('winston')
var inherits = require('inherits')
var util = require('./curvecp-util.js')
var extend = require('extend.js')
var winstonWrapper = require('winston-meta-wrapper')
var CurveCPServerStream = require('./curvecp-server-stream.js')
var validation = require('./validation.js')
var assert = require('assert')

var MINUTE_KEY_TIMEOUT = 1000 * 60 * 2

var CurveCPServer = function (options) {
  assert(validation.validOptions(options))
  EventEmitter.call(this)
  if (!options) {
    options = {}
  }
  if (!options.logger) {
    options.logger = winston
  }
  this._log = winstonWrapper(options.logger)
  this._log.addMeta({
    module: 'curvecp-server'
  })
  extend(this, {
    serverName: new Uint8Array(256),
    serverExtension: new Uint8Array(16),
    serverPublicKey: null,
    serverPrivateKey: null
  }, options)
  this.serverName = util.codifyServerName(this.serverName)
  this._connections = {}
  this._setCookieKey()
  this._startCookieKeyTimeout()
}

inherits(CurveCPServer, EventEmitter)

CurveCPServer.prototype._startCookieKeyTimeout = function () {
  setInterval(this._setCookieKey.bind(this), MINUTE_KEY_TIMEOUT)
}

CurveCPServer.prototype._setCookieKey = function () {
  this.__cookieKey = nacl.randomBytes(nacl.secretbox.keyLength)
}

CurveCPServer.prototype._isValidCookie = function (cookie) {
  var cookieData = util.decryptSymmetric(cookie, 'minute-k', this.__cookieKey)
  if (!cookieData) {
    return {
      result: false
    }
  }
  return {
    result: true,
    clientConnectionPublicKey: cookieData.subarray(0, 32),
    serverConnectionPrivateKey: cookieData.subarray(32)
  }
}

CurveCPServer.prototype._setExtensions = function (clientExtension, message) {
  message.set(clientExtension, 8)
  message.set(this.serverExtension, 24)
  return message
}

CurveCPServer.prototype.process = function (message, socket) {
  this._log.debug('_onMessage@Server')
  if (message.length < 96 || message.length > 1184) {
    return
  }
  var messageType = message.subarray(0, 8)
  if (util.isEqual(messageType, util.HELLO_MSG)) {
    this._onHello(message, socket)
  } else if (util.isEqual(messageType, util.INITIATE_MSG)) {
    this._onInitiate(message, socket)
  } else if (util.isEqual(messageType, util.CLIENT_MSG)) {
    this._onClientMessage(message, socket)
  } else {
    this._log.warn('invalid packet received')
  }
}

CurveCPServer.prototype._onHello = function (helloMessage, socket) {
  this._log.debug('onHello')
  if (helloMessage.length !== 224) {
    this._log.warn('Hello message has incorrect length')
    return
  }
  var clientExtension = helloMessage.subarray(8 + 16, 8 + 16 + 16)
  if (!util.isEqual(helloMessage.subarray(8, 8 + 16), this.serverExtension)) {
    this._log.warn('Invalid server extension in hello message')
    return
  }
  var clientConnectionPublicKey = helloMessage.subarray(40, 40 + 32)
  var boxData = util.decrypt(helloMessage.subarray(40 + 32 + 64, 224), 'CurveCP-client-H', clientConnectionPublicKey, this.serverPrivateKey)
  if (boxData === undefined) {
    this._log.warn('Hello: not able to decrypt box data')
    return
  }
  if (!util.isEqual(boxData, new Uint8Array(64))) {
    this._log.warn('Hello: invalid data in signature box')
    return
  }
  this._sendCookie(clientConnectionPublicKey, clientExtension, socket)
}

CurveCPServer.prototype._sendCookie = function (clientConnectionPublicKey, clientExtension, socket) {
  this._log.debug('sendCookie')
  var connectionKeyPair = nacl.box.keyPair()
  var result = new Uint8Array(200)
  result.set(util.COOKIE_MSG)
  var boxData = new Uint8Array(128)
  boxData.set(connectionKeyPair.publicKey)
  var cookieData = new Uint8Array(64)
  cookieData.set(clientConnectionPublicKey)
  cookieData.set(connectionKeyPair.secretKey, 32)
  var serverCookie = util.encryptSymmetric(cookieData, 'minute-k', this.__cookieKey)
  boxData.set(serverCookie, 32)
  var nonce = util.createRandomNonce('CurveCPK')
  var encryptedBoxData = util.encrypt(boxData, nonce, 8, this.serverPrivateKey, clientConnectionPublicKey)
  result.set(encryptedBoxData, 40)
  result = this._setExtensions(clientExtension, result)
  socket.write(new Buffer(result))
}

CurveCPServer.prototype._onInitiate = function (initiateMessage, socket) {
  var self = this
  this._log.debug('onInitiate')
  if (initiateMessage.length < 544) {
    this._log.warn('Initiate command has incorrect length')
    return
  }
  var clientConnectionPublicKey = initiateMessage.subarray(40, 40 + 32)
  if (!util.isEqual(initiateMessage.subarray(8, 8 + 16), this.serverExtension)) {
    this._log.warn('Invalid server extension')
    return
  }
  var cookieResult = this._isValidCookie(initiateMessage.subarray(72, 72 + 96))
  if (!cookieResult.result) {
    this._log.warn('Initiate command server cookie not recognized')
    return
  }
  var sharedKey = nacl.box.before(cookieResult.clientConnectionPublicKey, cookieResult.serverConnectionPrivateKey)
  var initiateBoxData = util.decryptShared(initiateMessage.subarray(72 + 96), 'CurveCP-client-I', sharedKey)
  if (initiateBoxData === undefined) {
    this._log.warn('Not able to decrypt initiate box data')
    return
  }
  var clientPublicKey = initiateBoxData.subarray(0, 32)
  var vouch = util.decrypt(initiateBoxData.subarray(32, 96), 'CurveCPV', clientPublicKey, this.serverPrivateKey)
  if (vouch === undefined) {
    this._log.warn('not able to decrypt vouch data')
    return
  }
  if (!util.isEqual(vouch, clientConnectionPublicKey) || !util.isEqual(vouch, cookieResult.clientConnectionPublicKey)) {
    this._log.warn('Initiate command vouch contains different client connection public key than previously received')
    return
  }
  if (!util.isEqual(initiateBoxData.subarray(32 + 16 + 48, 32 + 16 + 48 + 256), this.serverName)) {
    this._log.warn('Invalid server name')
    return
  }
  var options = {
    logger: this._log,
    serverExtension: this.serverExtension,
    clientExtension: initiateMessage.subarray(8 + 16, 8 + 16 + 16),
    clientConnectionPublicKey: clientConnectionPublicKey,
    clientPublicKey: clientPublicKey,
    sharedKey: sharedKey,
    stream: socket
  }
  var stream = new CurveCPServerStream(options)
  stream.on('close', function () {
    delete self._connections[nacl.util.encodeBase64(clientConnectionPublicKey)]
  })
  this._connections[nacl.util.encodeBase64(clientConnectionPublicKey)] = stream
  this.emit('connection', stream)
  setImmediate(function () {
    stream.emit('data', new Buffer(initiateBoxData.subarray(32 + 16 + 48 + 256)))
  })
}

CurveCPServer.prototype._onClientMessage = function (message, socket) {
  this._log.debug('onClientMessage@Server')
  if (message.length < 96 || message.length > 1184) {
    this._log.warn('Message command has incorrect length')
    return
  }
  var clientConnectionPublicKey = nacl.util.encodeBase64(message.subarray(40, 40 + 32))
  if (_.has(this._connections, clientConnectionPublicKey)) {
    this._connections[clientConnectionPublicKey].process(message, socket)
  }
}

module.exports = CurveCPServer
