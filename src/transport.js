'use strict'

var transport = require('1tp').net
var EventEmitter = require('events').EventEmitter
var curvecp = require('curvecp')
var winston = require('winston')
var inherits = require('inherits')
var CurveCPServer = require('./curvecp-server.js')
var CurveCPClient = require('./curvecp-client.js')
var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var _ = require('lodash')

var TransportManager = function (options) {
  EventEmitter.call(this)
  var self = this
  if (!options) {
    options = {}
  }
  if (!options.logger) {
    options.logger = winston
  }
  this._identity = options.identity
  this._log = options.logger
  this._transportServer = new transport.Server()
  this._clientConnections = {}
  this._curveCPServer = new CurveCPServer({
    serverPublicKey: nacl.util.decodeBase64(this._identity.box.publicKey),
    serverPrivateKey: nacl.util.decodeBase64(this._identity.box.secretKey),
    logger: this._log
  })
  this._curveCPServer.on('connection', function (socket) {
    self._log.info('NEW SERVER CONNECTION')
    var curveCPMessages = new curvecp.MessageStream({
      stream: socket,
      logger: this._log
    })
    self.emit('connection', curveCPMessages)
  })
  this._transportServer.setLogger(this._log)
  this._transportServer.on('close', function () {
    self.emit('close')
  })
  this._transportServer.on('connection', function (socket) {
    socket.on('data', function (data) {
      self._curveCPServer.process(data, socket)
    })
  })
  this._transportServer.on('error', function (err) {
    self.emit('error', err)
  })
  this._transportServer.on('listening', function () {
    self.emit('listening')
  })
}
inherits(TransportManager, EventEmitter)

TransportManager.prototype.address = function () {
  return this._transportServer.address()
}

TransportManager.prototype.listen = function (connectionInfo) {
  this._transportServer.listen(connectionInfo)
}

TransportManager.prototype.connect = function (destination, connectionInfo) {
  var self = this
  if (_.has(this._clientConnections, destination)) {
    return
  }
  var client = new CurveCPClient({
    clientPublicKey: nacl.util.decodeBase64(this._identity.box.publicKey),
    clientPrivateKey: nacl.util.decodeBase64(this._identity.box.secretKey),
    logger: this._log
  })
  this._clientConnections[destination] = client
  client.once('error', function (err) {
    self._log.warn(err)
    delete self._clientConnections[destination]
    self.emit('connectionFailed', destination)
  })
  client.once('connection', function (connection) {
    self._log.info('NEW CLIENT CONNECTION')
    var curveCPMessages = new curvecp.MessageStream({
      stream: connection,
      logger: this._log
    })
    self.emit('connection', curveCPMessages)
  })
  client.connect(destination, connectionInfo)
}

module.exports = TransportManager
