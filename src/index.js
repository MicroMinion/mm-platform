'use strict'

var Identity = require('./identity')
var inherits = require('inherits')
// var TCPTransport = require('flunky-transports').TcpTransport
var transport = require('net-udp')
var OfflineBuffer = require('./offline-buffer.js')
var FlunkyAPI = require('./flunky-api.js')
var EventEmitter = require('events').EventEmitter
var curvecp = require('curvecp')
var NetstringStream = require('./netstring.js')
var FlunkyProtocol = require('./flunky-protocol.js')
var Circle = require('./circle-empty.js')
var Directory = require('./directory.js')
var debug = require('debug')('flunky-platform')
var _ = require('lodash')
var kadfs = require('kad-fs')
var path = require('path')
var assert = require('assert')
var validation = require('./validation.js')

var DEFAULT_STORAGE_DIR = './data'

/**
 * Flunky Platform
 *
 * @constructor
 * @param {Object} options - Options that will be passed down to transport
 * @param {Object} options.storage - KAD-FS compatible storage interface
 * @param {Object} options.directory - Directory lookup object
 * @param {Object} options.identity - Public/Private keypair
 * @param {Circle} options.friends - Circle object with list of trusted keys
 * @param {Circle} options.devices - Circle object with list of trusted keys
 */
var Platform = function (options) {
  assert(validation.validOptions(options))
  EventEmitter.call(this)
  if (!options.storage) {
    options.storage = kadfs(path.join(DEFAULT_STORAGE_DIR, 'platform'))
  }
  this.storage = options.storage
  if (!options.friends) {
    options.friends = new Circle()
  }
  this.friends = options.friends
  if (!options.devices) {
    options.devices = new Circle()
  }
  this.devices = options.devices
  if (!options.identity) {
    options.identity = new Identity({
      platform: this,
      storage: this.storage
    })
  }
  this.identity = options.identity
  var self = this
  this.identity.on('ready', function () {
    self.emit('ready')
  })
  this._setupAPI()
  if (!options.directory) {
    options.directory = new Directory({
      storage: this.storage,
      platform: this,
      identity: this.identity
    })
  }
  this.directory = options.directory
  this._connections = []
  this._setupTransport()
}

inherits(Platform, EventEmitter)

Platform.prototype._setupTransport = function () {
  debug('_setupTransport')
  var self = this
  // this._transport = new TCPTransport(options)
  this._transport = transport.createServer()
  this._transport.on('close', function () {
    self._setupTransport()
  })
  this._transport.on('connection', function (socket) {
    assert(validation.validStream(socket))
    self._wrapConnection(socket, true)
  })
  this._transport.on('error', function (err) {
    assert(_.isError(err))
    debug('ERROR in transport component')
    debug(err)
  })
  // this._transport.on('active', function (connectionInfo) {
  //  platform.directory.setMyConnectionInfo(connectionInfo)
  // })
  this._transport.on('listening', function () {
    debug('listening')
    self.storage.put('myConnectionInfo', JSON.stringify(self._transport.address()))
    self.directory.setMyConnectionInfo(self._transport.address())
  })
  this._listen()
}

Platform.prototype._listen = function () {
  var self = this
  var success = function (value) {
    assert(_.isString(value))
    if (value.length === 0) {
      self._transport.listen()
    } else {
      value = JSON.parse(value)
      assert(_.isPlainObject(value))
      self._transport.listen(value)
    }
  }
  var error = function (errorMessage) {
    assert(_.isError(errorMessage))
    debug('error in loading connectionInfo from storage')
    debug(errorMessage)
    self._transport.listen()
  }
  this.storage.get('myConnectionInfo', function (err, result) {
    if (err) {
      error(err)
    } else {
      success(result)
    }
  })
}

Platform.prototype._getConnection = function (publicKey) {
  assert(validation.validKeyString(publicKey))
  var connections = _.filter(this._connections, function (connection) {
    return connection.remoteAddress === publicKey
  }, this)
  _.sortBy(connections, function (connection) {
    if (connection.connected) {
      return 1
    } else {
      return 0
    }
  })
  if (_.size(connections) > 0) {
    return connections[0]
  }
}

Platform.prototype._wrapConnection = function (socket, server) {
  assert(validation.validStream(socket))
  assert(_.isBoolean(server))
  var packetStreamOptions = {
    isServer: server,
    stream: socket
  }
  if (server) {
    packetStreamOptions.serverPublicKey = this.identity.box.publicKey
    packetStreamOptions.serverPrivateKey = this.identity.box.secretKey
  } else {
    packetStreamOptions.clientPublicKey = this.identity.box.publicKey
    packetStreamOptions.clientPrivateKey = this.identity.box.secretKey
  }
  var curvePackets = new curvecp.PacketStream(packetStreamOptions)
  var curveMessages = new curvecp.MessageStream({
    stream: curvePackets
  })
  var netstrings = new NetstringStream({
    stream: curveMessages
  })
  var flunkyMessages = new FlunkyProtocol({
    stream: netstrings,
    friends: this.friends,
    devices: this.devices,
    directory: this.directory
  })
  this._connectEvents(flunkyMessages)
  return flunkyMessages
}

Platform.prototype._connectEvents = function (stream) {
  assert(validation.validStream(stream))
  var self = this
  this._connections.push(stream)
  stream.on('connect', function () {
    self.emit('connection', stream.remoteAddress)
  })
  stream.on('data', function (message) {
    assert(validation.validProtocolObject(message))
    assert(_.has(message, 'sender'))
    assert(validation.validKeyString(message.sender))
    self.emit('message', message)
  })
  stream.on('close', function () {
    self.emit('disconnected', stream.remoteAddress)
    self._connections.splice(self._connections.indexOf(stream), 1)
    stream.destroy()
  })
  stream.on('end', function () {
    debug('other end has closed connection')
  })
  stream.on('error', function (err) {
    assert(_.isError(err))
    debug('ERROR in socket')
    debug(err)
  })
}

/**
 * send message: message is an object with the following properties
 *  topic: string that contains message type/topic
 *  protocol: message protocol (determines encoding of data)
 *  destination: publicKey of destination host
 *  payload: message blob (buffer)
 */
Platform.prototype.send = function (message, options) {
  debug('send')
  assert(validation.validProtocolObject(message))
  assert(_.has(message, 'destination'))
  assert(validation.validKeyString(message.destination))
  assert(validation.validOptions(options))
  if (!options) {
    options = {}
  }
  if (!options.callback) {
    options.callback = function (err) {
      assert(validation.validError(err))
      if (err) {
        debug('ERROR in socket')
        debug(err)
      }
    }
  }
  var connection = this._getConnection(message.destination)
  if (connection && connection.isConnected()) {
    this._send(message, connection, options.callback)
  } else if (connection) {
    this._queueMessage(message, connection, options.callback)
  } else {
    var socket = new transport.Socket()
    connection = this._wrapConnection(socket, false)
    this._queueMessage(message, connection, options.callback)
    connection.connect(message.destination)
  }
}

Platform.prototype._queueMessage = function (message, connection, callback) {
  assert(validation.validSendMessage(message))
  assert(validation.validStream(connection))
  assert(_.isNil(callback) || _.isFunction(callback))
  var self = this
  connection.once('connect', function () {
    self._send(message, connection, callback)
  })
  connection.once('error', function (err) {
    assert(_.isError(err))
    callback(err)
  })
}

/**
 * Send a message using a connection object
 *
 * @private
 */
Platform.prototype._send = function (message, connection, callback) {
  assert(validation.validSendMessage(message))
  assert(validation.validStream(connection))
  assert(_.isNil(callback) || _.isFunction(callback))
  connection.write(message, callback)
}

Platform.prototype._setupAPI = function () {
  assert(_.has(this, 'storage'))
  assert(_.has(this, 'identity'))
  var offlineBuffer = new OfflineBuffer({
    platform: this,
    storage: this.storage
  })
  this.messaging = new FlunkyAPI({
    protocol: 'ms',
    platform: offlineBuffer,
    identity: this.identity,
    serialize: JSON.stringify,
    deserialize: JSON.parse
  })
  this.torrenting = new FlunkyAPI({
    protocol: 'bt',
    platform: this,
    identity: this.identity
  })
}

module.exports = Platform
