var assert = require('assert')
var inherits = require('inherits')
var transports = require('flunky-transports')
var OfflineBuffer = require('./offline-buffer.js')
var FlunkyAPI = require('./flunky-api.js')
var EventEmitter = require('events').EventEmitter
var curvecp = require('curvecp')
var ns = require('netstring-streams')
var FlunkyProtocol = require('./flunky-protocol.js')
var Circle = require('./empty-circle.js')
var Directory = require('./directory.js')
var debug = require('debug')('flunky-platform')
var _ = require('lodash')
var nacl_util = require('tweetnacl-util')

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
  assert(options.storage)
  assert(options.identity)
  this._setupAPI()
  if (!options.friends) {
    options.friends = new Circle()
  }
  if (!options.devices) {
    options.devices = new Circle()
  }
  if (!options.directory) {
    options.directory = new Directory({
      storage: options.storage,
      messaging: this.messaging
    })
  }
  if (options.identity) {
    options.directory.setPublicKey(options.identity.publicKey)
  }
  this._options = options
  this._connections = []
  this._setupTransport()
}

inherits(Platform, EventEmitter)

Platform.prototype.setIdentity = function (identity) {
  this._options.identity = identity
  this._options.directory.setPublicKey(identity.publicKey)
}

Platform.prototype._setupTransport = function () {
  var platform = this
  this._transport = transports.createServer(this._options)
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
  this._transport.on('listening', function () {
    platform._options.directory.setMyConnectionInfo(platform._transport.address())
  })
  this._transport.listen()
}

Platform.prototype.getConnectionInfo = function () {
  return this._transport.address()
}

Platform.prototype._getConnection = function (publicKey) {
  var connections = _.filter(this._connections, function (connection) {
    return connection.remoteAddress === publicKey
  }, this)
  _.sortBy(connections, function (connection) {
    if (connection.connected) { return 1 } else { return 0 }
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
  var publicKey = nacl_util.decodeBase64(this._options.identity.publicKey)
  var privateKey = nacl_util.decodeBase64(this._options.identity.privateKey)
  if (server) {
    packetStreamOptions.serverPublicKey = publicKey
    packetStreamOptions.serverPrivateKey = privateKey
  } else {
    packetStreamOptions.clientPublicKey = publicKey
    packetStreamOptions.clientPrivateKey = privateKey
  }
  var curvePackets = new curvecp.PacketStream(packetStreamOptions)
  var curveMessages = new curvecp.MessageStream({
    stream: curvePackets
  })
  var netstrings = new ns.NetStringStream({
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
  stream.on('data', function (message) {
    platform.emit('message', message)
  })
  stream.on('close', function () {
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
    var socket = new transports.Socket()
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

Platform.prototype._setupAPI = function () {
  var offlineBuffer = new OfflineBuffer({
    platform: this
  })
  this.messaging = new FlunkyAPI({
    protocol: 'ms',
    platform: offlineBuffer
  })
  this.torrenting = new FlunkyAPI({
    protocol: 'bt',
    platform: this
  })
}

module.exports = Platform
