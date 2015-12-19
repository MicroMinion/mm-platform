/*
 * Note, this is a frustration attempt. Incomplete and not working! I started this because the behavior of TCP sockets became unpredictable
 */

var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var _ = require('lodash')
var storagejs = require('storagejs')
var debug = require('debug')('flunky-platform:messaging:transport-udp')
var Duplex = require('stream').Duplex
var dgram

if (_.isUndefined(window.chrome)) {
  dgram = require('dgram')
} else {
  dgram = require('chrome-dgram')
}

var UDPTransport = function (publicKey, privateKey) {
  AbstractTransport.call(this, publicKey, privateKey)
  this.enabled = false
  var transport = this
  this.socket = dgram.createSocket('udp4')
  this.udpConnections = {}
  this.socket.on('message', this._onMessage.bind(this))
  this.socket.on('listening', this._onListening.bind(this))
  this.socket.on('close', function () {})
  this.socket.on('error', function (errorMessage) {
    debug(errorMessage)
    transport._listen(0)
  })
  storagejs.get('flunky-messaging-transport-udp').then(this._listen.bind(this), function (err) {
    debug(err)
    transport._listen(0)
  })
}

inherits(UDPTransport, AbstractTransport)

UDPTransport.prototype._listen = function (port) {
  this.socket.bind(port)
}

UDPTransport.prototype._onListening = function () {
  this.enabled = true
  storagejs.put('flunky-messaging-transport-udp', this.socket.address().port)
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

UDPTransport.prototype._onMessage = function (message, rinfo) {
  var key = rinfo.address + ':' + rinfo.port
  if (!_.has(this.udpConnections, key)) {
    this._createConnection(key)
    this._wrapIncomingConnection(this.udpConnections[key])
  }
  this.udpConnections[key].emit('data', message)
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

UDPTransport.prototype._connect = function (connectionInfo) {
  var deferred = Q.defer()
  if (this._hasConnectionInfo(connectionInfo)) {
  } else {
    process.nextTick(function () {
      deferred.reject()
    })
  }
  return deferred.promise
}

UDPTransport.prototype._createConnection = function (key) {
  if (!_.has(this.udpConnections, key)) {
    var manager = this
    var udpConnection = new UDPConnection({
      key: key
    })
    this.udpConnections[key] = udpConnection
    udpConnection.on('close', function () {
      delete manager.udpConnections[key]
    })
  }
}

UDPTransport.prototype._hasConnectionInfo = function (connectionInfo) {
  return _.isObject(connectionInfo) &&
  _.has(connectionInfo, 'udp')
}

var UDPConnection = function () {
  var opts = {}
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
}

inherits(UDPConnection, Duplex)

module.exports = UDPTransport
