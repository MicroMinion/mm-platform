/*
 * Note, this is a frustration attempt. Incomplete and not working! I started this because the behavior of TCP sockets became unpredictable
 */

var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var _ = require('lodash')
var debug = require('debug')('flunky-platform:messaging:transport-udp')
var Duplex = require('stream').Duplex
var dgram
var nacl = require('tweetnacl')

var HELLO_MSG = new Buffer(nacl.util.decodeUTF8('QvnQ5XlH'))
var COOKIE_MSG = new Buffer(nacl.util.decodeUTF8('RL3aNMXK'))
var INITIATE_MSG = new Buffer(nacl.util.decodeUTF8('QvnQ5XlI'))
var SERVER_MSG = new Buffer(nacl.util.decodeUTF8('RL3aNMXM'))
var CLIENT_MSG = new Buffer(nacl.util.decodeUTF8('QvnQ5XlM'))

if (_.isUndefined(window.chrome)) {
  dgram = require('dgram')
} else {
  dgram = require('chrome-dgram')
}

var UDPTransport = function (options) {
  AbstractTransport.call(this, options)
  this.enabled = false
  var transport = this
  this.storage = options.storage
  this.socket = dgram.createSocket('udp4')
  this.incomingConnections = {}
  this.outgoingConnections = {}
  this.socket.on('message', this._onMessage.bind(this))
  this.socket.on('listening', this._onListening.bind(this))
  this.socket.on('close', function () {
    _.forEach(transport.incomingConnections, function (stream) {
      stream.emit('close')
    })
    _.forEach(transport.outgoingConnections, function (stream) {
      stream.emit('close')
    })
    transport.incomingConnections = {}
    transport.outgoingConnections = {}
  })
  this.socket.on('error', function (errorMessage) {
    debug(errorMessage)
    transport._listen(0)
  })
  Q.nfcall(this.storage.get.bind(this.storage), 'flunky-messaging-transport-udp').then(
    function (port) {
      transport._listen(JSON.parse(port).port)
    },
    function (err) {
      debug(err)
      transport._listen(0)
    }
  )
}

inherits(UDPTransport, AbstractTransport)

/* TRANSPORT SETUP */

UDPTransport.prototype._getPort = function () {
  return this.socket.address().port
}

UDPTransport.prototype._listen = function (port) {
  this.socket.bind(port)
}

UDPTransport.prototype._onListening = function () {
  this.enabled = true
  this.storage.put('flunky-messaging-transport-udp', JSON.stringify({port: this.socket.address().port}))
  var addresses = this._listAddresses()
  addresses.then(this._emitReady.bind(this)).done()
}

UDPTransport.prototype._emitReady = function (addresses) {
  this.emit('ready', {
    'udp': {
      'addresses': addresses,
      'port': this.socket.address().port
    }
  })
}

UDPTransport.prototype.enable = function () {
  this.enabled = true
}

UDPTransport.prototype.disable = function () {
  this.enabled = false
}

UDPTransport.prototype.isDisabled = function () {
  return !this.enabled
}

/* STREAM SETUP */

UDPTransport.prototype._onMessage = function (message, rinfo) {
  var key = this._getKey(rinfo)
  var stream
  try {
    if (this.isIncoming(message, rinfo)) {
      if (!_.has(this.incomingConnections, key)) {
        this._createIncomingConnection(rinfo)
      }
      stream = this.incomingConnections[key]
    } else {
      if (!_.has(this.outgoingConnections, key)) {
        throw new Error('Received packet from uninitialized stream')
      }
      stream = this.outgoingConnections[key]
    }
    stream.push(message)
  } catch (e) {
    debug(e)
    this.emit('error', e)
  }
}

UDPTransport.prototype._connect = function (connectionInfo) {
  var deferred = Q.defer()
  if (this._hasConnectionInfo(connectionInfo)) {
    // TODO
  } else {
    process.nextTick(function () {
      deferred.reject()
    })
  }
  return deferred.promise
}

UDPTransport.prototype._createOutgoingConnection = function (rinfo) {
  var transport = this
  var connection = new UDPConnection(rinfo, this)
  connection.on('close', function () {
    delete transport.outgoingConnections[transport._getKey(rinfo)]
  })
  this.outgoingConnections[transport._getKey(rinfo)] = connection
}

UDPTransport.prototype._createIncomingConnection = function (rinfo) {
  var transport = this
  var connection = new UDPConnection(rinfo, this)
  connection.on('close', function () {
    delete transport.incomingConnections[transport._getKey(rinfo)]
  })
  this.incomingConnections[transport._getKey(rinfo)] = connection
  this._wrapIncomingConnection(connection)
}

/* UTILITY METHODS */

UDPTransport.prototype._hasConnectionInfo = function (connectionInfo) {
  return _.isObject(connectionInfo) &&
  _.has(connectionInfo, 'udp')
}

UDPTransport.prototype.isIncoming = function (message) {
  var header = message.slice(0, 8)
  if (header.equals(HELLO_MSG) || header.equals(INITIATE_MSG) || header.equals(CLIENT_MSG)) {
    return true
  }
  if (header.equals(COOKIE_MSG) || header.equals(SERVER_MSG)) {
    return false
  }
  throw new Error('Unrecognized UDP message received')
}

UDPTransport.prototype._getKey = function (rinfo) {
  return rinfo.address + ':' + rinfo.port
}

/* UDP Stream */

var UDPConnection = function (rinfo, server) {
  var opts = {}
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
  this.address = rinfo.address
  this.port = rinfo.port
  this.server = server
}

inherits(UDPConnection, Duplex)

UDPConnection.prototype.destroy = function () {
  this.emit('close')
}

UDPConnection.prototype._read = function (size) {}

UDPConnection.prototype._write = function (chunk, encoding, done) {
  this.server.socket.send(chunk, 0, chunk.length, this.port, this.address, done)
}

module.exports = UDPTransport
