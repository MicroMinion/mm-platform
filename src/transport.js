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
var assert = require('assert')
var validation = require('./validation.js')

var MAX_ONGOING_CONNECTIONS = 2

var TransportManager = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'identity'))
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
  // CONNECTIONS
  this._connections = []
  this._clientConnectionsInProgress = {}
  this._clientConnectQueue = {}
  // TRANSPORT-SERVER
  this._transportServer = new transport.Server()
  this._transportServer.setLogger(this._log)
  this._transportServer.on('close', function () {
    self.emit('close')
  })
  this._transportServer.on('connection', function (socket) {
    socket.setLogger(self._log)
    socket.on('data', function (data) {
      assert(_.isBuffer(data))
      self._curveCPServer.process(data, socket)
    })
  })
  this._transportServer.on('error', function (err) {
    assert(_.isError(err))
    self.emit('error', err)
  })
  this._transportServer.on('listening', function () {
    self.emit('listening')
  })
  // CURVECP-SERVER
  this._curveCPServer = new CurveCPServer({
    serverPublicKey: this._identity.box.publicKey,
    serverPrivateKey: this._identity.box.secretKey,
    logger: this._log
  })
  this._curveCPServer.on('connection', function (socket) {
    self._log.info('NEW SERVER CONNECTION')
    self._addConnection(socket, true)
  })
}

inherits(TransportManager, EventEmitter)

// CONNECTION METHODS

TransportManager.prototype._addConnection = function (connection, server) {
  assert(validation.validKeyString(connection.remoteAddress))
  var self = this
  var messageStream = new curvecp.SimpleMessageStream({
    logger: this._log,
    stream: connection
  })
  this._connections.push(messageStream)
  messageStream.on('error', function (err) {
    self._log.warn(err.message)
    messageStream.destroy()
  })
  messageStream.on('close', function () {
    messageStream.removeAllListeners()
    messageStream.on('error', function (error) {
      self._log.warn(error.message)
    })
    self._removeConnection(messageStream)
  })
  messageStream.on('drain', function () {
    self.emit('connected', connection.remoteAddress)
  })
  messageStream.on('data', function (data) {
    self.emit('data', connection.remoteAddress, data)
  })
  if (server) {
    this._writeEmptyMessage(messageStream)
  } else {
    this.emit('connected', connection.remoteAddress)
  }
}

TransportManager.prototype._writeEmptyMessage = function (connection) {
  var self = this
  connection._stream.write(new curvecp.Message().toBuffer(), function (err) {
    if (err) {
      connection.emit('error', err)
    } else {
      self.emit('connected', connection.remoteAddress)
    }
  })
}

TransportManager.prototype._removeConnection = function (connection) {
  var self = this
  self._connections.splice(self._connections.indexOf(connection), 1)
  this._connectionRemoved(connection.remoteAddress)
}

TransportManager.prototype._connectionRemoved = function (remoteAddress) {
  if (!this._hasConnection(remoteAddress)) {
    this.emit('disconnected', remoteAddress)
  }
}

TransportManager.prototype._getConnection = function (publicKey) {
  assert(validation.validKeyString(publicKey))
  var connections = _.filter(this._connections, function (connection) {
    return connection.remoteAddress === publicKey
  })
  if (_.size(connections) > 0) {
    return connections[connections.length - 1]
  }
}

TransportManager.prototype._hasConnection = function (destination) {
  return this._getConnection(destination) !== undefined
}

// SERVER METHODS

TransportManager.prototype.address = function () {
  return this._transportServer.address()
}

TransportManager.prototype.listen = function (connectionInfo) {
  this._transportServer.listen(connectionInfo)
}

TransportManager.prototype.send = function (message, destination, callback) {
  assert(validation.validKeyString(destination))
  assert(this._hasConnection(destination))
  return this._getConnection(destination).write(message, callback)
}

// CLIENT METHODS

TransportManager.prototype.connect = function (destination, connectionInfo) {
  var self = this
  if (this._hasConnection(destination)) {
    setImmediate(function () {
      self.emit('connected', destination)
      self._shiftConnectQueue()
    })
    return
  }
  if (_.has(this._clientConnectionsInProgress, destination)) {
    return
  }
  if (_.size(this._clientConnectionsInProgress) > MAX_ONGOING_CONNECTIONS) {
    this._addToConnectQueue(destination, connectionInfo)
    return
  }
  var client = new CurveCPClient({
    clientPublicKey: this._identity.box.publicKey,
    clientPrivateKey: this._identity.box.secretKey,
    logger: this._log
  })
  this._clientConnectionsInProgress[destination] = client
  var error = function (err) {
    self._log.warn(err)
    self._removeInProgress(destination)
    self._connectionRemoved(destination)
    client.destroy()
  }
  client.once('error', error)
  client.once('connect', function () {
    self._log.info('NEW CLIENT CONNECTION')
    self._addConnection(client)
    client.removeListener('error', error)
    self._removeInProgress(destination)
  })
  client.connect(destination, connectionInfo)
}

TransportManager.prototype._removeInProgress = function (destination) {
  if (_.has(this._clientConnectionsInProgress, destination)) {
    delete this._clientConnectionsInProgress[destination]
  }
  this._shiftConnectQueue()
}

TransportManager.prototype._addToConnectQueue = function (destination, connectionInfo) {
  this._clientConnectQueue[destination] = connectionInfo
}

TransportManager.prototype._shiftConnectQueue = function () {
  if (_.size(this._clientConnectQueue) > 0) {
    var destination = _.sample(_.keys(this._clientConnectQueue))
    var connectionInfo = this._clientConnectQueue[destination]
    delete this._clientConnectQueue[destination]
    this.connect(destination, connectionInfo)
  }
}

module.exports = TransportManager
