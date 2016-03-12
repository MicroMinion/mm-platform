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
  this._connectionInfo = {}
}

Platform.prototype._wrapConnection = function (socket, server) {
  // TODO: Add constructor arguments
  var curveMessages = new curvecp.MessageProtocol()
  var curvePackets = new curvecp.PacketProtocol()
  var netstrings = new ns.NetStringProtocol()
  var flunkyMessages = new FlunkyProtocol()
  /* Connect chain for incoming packets */
  socket.pipe(curvePackets.in)
  curvePackets.in.pipe(curveMessages.in)
  curveMessages.in.pipe(netstrings.in)
  netstrings.in.pipe(flunkyMessages.in)
  /* Connect chain for outgoing packets */
  flunkyMessages.out.pipe(netstrings.out)
  netstrings.out.pipe(curveMessages.out)
  curveMessages.out.pipe(curvePackets.out)
  curvePackets.out.pipe(socket)
// TODO: Add stream to connections to that it can be used for writing
}

/**
 * _write message: message is an object with the following properties
 *  topic: string that contains message type/topic
 *  protocol: message protocol (determines encoding of data)
 *  destination: publicKey of destination host
 *  payload: message blob (buffer)
 */
Platform.prototype.send = function (message, options) {
  // TODO: Search for existing connections

  // TODO: Connect if no connection exists (first lookup Directory info)

  // TODO: Write to outgoing FlunkyMessages stream
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
