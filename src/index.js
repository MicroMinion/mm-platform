var assert = require('assert')
var inherits = require('inherits')
var FlunkyTransport = require('flunky-transports')
var OfflineBuffer = require('./offline-buffer.js')
var FlunkyAPI = require('./flunky-api.js')
var EventEmitter = require('events').EventEmitter
var curvecp = require('curvecp')
var ns = require('netstring-streams')
var FlunkyProtocol = require('./flunky-protocol.js')

/**
 * Flunky Platform
 *
 * @constructor
 * @param {Object} options - Options that will be passed down to ProtocolDispatcher, Messaging, Torrenting, TransportManager and individual Transports
 * @param {Object} options.storage - KAD-FS compatible storage interface
 */
var Platform = function (options) {
  assert(options.storage)
  assert(options.directory)
  assert(options.identity)
  assert(options.friends)
  assert(options.devices)
  this._options = options
  this._setupTransport()
  this._setupAPI()
}

inherits(Platform, EventEmitter)

Platform.prototype._setupTransport = function () {
  var platform = this
  this._transport = new FlunkyTransport()
  this._transport.activate()
  this._transport.on('connection', function (socket) {
    platform._wrapConnection(socket, true)
  })
  this._transport.on('connect', function (socket) {
    platform._wrapConnection(socket, false)
  })
  this._connections = []
  /**
   * Our own connection information, to be published in directory
   *
   * @access private
   * @type {Object}
   */
  this._connectionInfo = {}
  this._transport.on('active', function (connectionInfo) {
    platform._connectionInfo = connectionInfo
  })
}

Platform.prototype.getConnectionInfo = function () {
  return this._connectionInfo
}

Platform.prototype._wrapConnection = function (socket, server) {
  // TODO: Add constructor arguments
  var curvePackets = new curvecp.PacketStream({
    stream: socket,
    isServer: server,
  })
  this._wrapStream(curvePackets, socket)
  var curveMessages = new curvecp.MessageStream({
    stream: curvePackets
  })
  this._wrapStream(curveMessages, curvePackets)
  var netstrings = new ns.NetStringStream({
    stream: curveMessages
  })
  this._wrapStream(netstrings, curveMessages)
  var flunkyMessages = new FlunkyProtocol({
    stream: netstrings,
    friends: this._options.friends,
    devices: this._options.devices
  })
  this._wrapStream(flunkyMessages, netstrings)
  this._connectEvents(flunkyMessages)
}

Platform.prototype._connectEvents = function (stream) {
  var platform = this
  this._connections.append(stream)
  stream.on('data', function (message) {
    platform.emit('message', message)
  })
// TODO: Connect other events
}

Platform.prototype._wrapStream = function (outer, inner) {
  inner.on('close', function () {
    outer.emit('close')
  })
  inner.on('end', function () {
    outer.emit('end')
  })
  inner.on('error', function (err) {
    outer.emit('error', err)
  })
  inner.on('finish', function () {
    outer.emit('finish')
  })
}

/**
 * _write message: message is an object with the following properties
 *  topic: string that contains message type/topic
 *  protocol: message protocol (determines encoding of data)
 *  destination: publicKey of destination host
 *  payload: message blob (buffer)
 */
Platform.prototype.send = function (message, options) {
  var connection = this._getConnection(message.destination)
  if (!options) {
    options = {}
  }
  if (!options.callback) {
    options.callback = function (err) {}
  }
  if (connection) {
    this._send(message, connection, options.callback)
  } else {
    // TODO: Search for existing connections

    // TODO: Connect if no connection exists (first lookup Directory info)

    // TODO: Write to outgoing FlunkyMessages stream
  }
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
