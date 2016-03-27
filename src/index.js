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
var Q = require('q')
var kadfs = require('kad-fs')
var path = require('path')

var storageDir = './data'

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
  EventEmitter.call(this)
  if (!options.storage) {
    options.storage = kadfs(path.join(storageDir, 'platform'))
  }
  if (!options.friends) {
    options.friends = new Circle()
  }
  if (!options.devices) {
    options.devices = new Circle()
  }
  if (!options.identity) {
    options.identity = new Identity({
      platform: this,
      storage: options.storage
    })
  }
  this.identity = options.identity
  var self = this
  this.identity.on('ready', function () {
    self.emit('ready')
  })
  this._setupAPI(options)
  if (!options.directory) {
    options.directory = new Directory({
      storage: options.storage,
      platform: this,
      identity: options.identity
    })
  }
  this._options = options
  this._connections = []
  this._setupTransport()
}

inherits(Platform, EventEmitter)

Platform.prototype._setupTransport = function () {
  debug('_setupTransport')
  var platform = this
  // this._transport = new TCPTransport(this._options)
  this._transport = transport.createServer()
  this._transport.on('close', function () {
    platform._setupTransport()
  })
  this._transport.on('connection', function (socket) {
    platform._wrapConnection(socket, true)
  })
  this._transport.on('error', function (err) {
    debug('ERROR in transport component')
    debug(err)
  })
  // this._transport.on('active', function (connectionInfo) {
  //  platform._options.directory.setMyConnectionInfo(connectionInfo)
  // })
  this._transport.on('listening', function () {
    debug('listening')
    platform._options.storage.put('myConnectionInfo', JSON.stringify(platform._transport.address()))
    platform._options.directory.setMyConnectionInfo(platform._transport.address())
  })
  this._listen()
}

Platform.prototype._listen = function () {
  var self = this
  var options = {
    success: function (value) {
      if (value.length === 0) {
        self._transport.listen()
      } else {
        value = JSON.parse(value)
        self._transport.listen(value)
      }
    },
    error: function (errorMessage) {
      debug('error in loading connectionInfo from storage')
      debug(errorMessage)
      self._transport.listen()
    }
  }
  Q.nfcall(this._options.storage.get.bind(this._options.storage), 'myConnectionInfo').then(options.success, options.error)
}

Platform.prototype._getConnection = function (publicKey) {
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
    friends: this._options.friends,
    devices: this._options.devices,
    directory: this._options.directory
  })
  this._connectEvents(flunkyMessages)
  return flunkyMessages
}

Platform.prototype._connectEvents = function (stream) {
  var platform = this
  this._connections.push(stream)
  stream.on('connect', function () {
    platform.emit('connection', stream.remoteAddress)
  })
  stream.on('data', function (message) {
    platform.emit('message', message)
  })
  stream.on('close', function () {
    platform.emit('disconnected', stream.remoteAddress)
    platform._connections.splice(platform._connections.indexOf(stream), 1)
    stream.destroy()
  })
  stream.on('end', function () {
    debug('other end has closed connection')
  })
  stream.on('error', function (err) {
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
  if (!options) {
    options = {}
  }
  if (!options.callback) {
    options.callback = function (err) {
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
  var platform = this
  connection.once('connect', function () {
    platform._send(message, connection, callback)
  })
  connection.once('error', function (err) {
    callback(err)
  })
}

/**
 * Send a message using a connection object
 *
 * @private
 */
Platform.prototype._send = function (message, connection, callback) {
  connection.write(message, callback)
}

Platform.prototype._setupAPI = function (options) {
  var offlineBuffer = new OfflineBuffer({
    platform: this,
    storage: options.storage
  })
  this.messaging = new FlunkyAPI({
    protocol: 'ms',
    platform: offlineBuffer,
    identity: this.identity
  })
  this.torrenting = new FlunkyAPI({
    protocol: 'bt',
    platform: this,
    identity: this.identity
  })
}

module.exports = Platform
