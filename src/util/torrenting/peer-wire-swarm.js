var fifo = require('fifo')
var once = require('once')
var speedometer = require('speedometer')
var peerWireProtocol = require('peer-wire-protocol')
var EventEmitter = require('events').EventEmitter
var util = require('util')
var Connection = require('./connection.js')
var _ = require('lodash')

var HANDSHAKE_TIMEOUT = 25000
var CONNECTION_TIMEOUT = 3000
var RECONNECT_WAIT = [1000, 5000, 15000]
var DEFAULT_SIZE = 100

var toBuffer = function (str, encoding) {
  return Buffer.isBuffer(str) ? str : new Buffer(str, encoding)
}

var toAddress = function (wire) {
  if (typeof wire === 'string') return wire
  return wire.peerAddress
}

var Swarm = function (infoHash, peerId, torrenting, options) {
  EventEmitter.call(this)

  this.torrenting = torrenting

  options = options || {}
  /**
   *  maximum number of connections
   */
  this.size = options.size || DEFAULT_SIZE
  this.handshakeTimeout = options.handshakeTimeout || HANDSHAKE_TIMEOUT
  this.connectTimeout = options.connectTimeout || CONNECTION_TIMEOUT

  this.infoHash = toBuffer(infoHash, 'hex')
  this.peerId = toBuffer(peerId, 'utf-8')

  this.downloaded = 0
  this.uploaded = 0
  /**
   * List of raw connections (in our case adapter for flunky-platform)
   */
  this.connections = {}
  /**
   * List of peer-wire-protocol instances to which connections pipe data
   */
  this.wires = []
  this.paused = false

  this.uploaded = 0
  this.downloaded = 0

  this.downloadSpeed = speedometer()
  this.uploadSpeed = speedometer()

  this._destroyed = false
  this._queues = [fifo()]
  this._peers = {}
  this._pwp = {speed: options.speed}
}

util.inherits(Swarm, EventEmitter)

Swarm.prototype.__defineGetter__('queued', function () {
  return this._queues.reduce(function (prev, queue) {
    return prev + queue.length
  }, 0)
})

Swarm.prototype.pause = function () {
  this.paused = true
}

Swarm.prototype.resume = function () {
  this.paused = false
  this._drain()
}

Swarm.prototype.priority = function (publicKey, level) {
  publicKey = toAddress(publicKey)
  var peer = this._peers[publicKey]

  if (!peer) return 0
  if (typeof level !== 'number' || peer.priority === level) return level

  if (!this._queues[level]) this._queues[level] = fifo()

  if (peer.node) {
    this._queues[peer.priority].remove(peer.node)
    peer.node = this._queues[level].push(publicKey)
  }
  peer.priority = level
  return
}

Swarm.prototype.add = function (publicKey) {
  if (this._destroyed || this._peers[publicKey]) return

  this._peers[publicKey] = {
    node: this._queues[0].push(publicKey),
    wire: null,
    timeout: null,
    reconnect: false,
    priority: 0,
    retries: 0
  }
  this._drain()
}

Swarm.prototype.remove = function (publicKey) {
  this._remove(toAddress(publicKey))
  this._drain()
}

Swarm.prototype.listen = function () {
  this.torrenting.on('self.' + this.infoHash, this._onMessage.bind(this))
  this.torrenting.on('friends.' + this.infoHash, this._onMessage.bind(this))
  this.torrenting.on('public.' + this.infoHash, this._onMessage.bind(this))
}

Swarm.prototype._onMessage = function (scope, publicKey, message) {
  if (!_.has(this.connections, publicKey)) {
    this._onincoming(publicKey)
  }
  this.connections[publicKey].emit('data', message)
}

Swarm.prototype.destroy = function () {
  this._destroyed = true

  var self = this
  Object.keys(this._peers).forEach(function (publicKey) {
    self._remove(publicKey)
  })

  this.wires.forEach(function (wire) {
    wire.destroy()
  })

  process.nextTick(function () {
    self.emit('close')
  })
}

Swarm.prototype._remove = function (publicKey) {
  var peer = this._peers[publicKey]
  if (!peer) return
  delete this._peers[publicKey]
  if (peer.node) this._queues[peer.priority].remove(peer.node)
  if (peer.timeout) clearTimeout(peer.timeout)
  if (peer.wire) peer.wire.destroy()
}

Swarm.prototype._drain = function () {
  if (_.size(this.connections) >= this.size || this.paused) return

  var self = this
  var publicKey = this._shift()
  if (!publicKey) return

  var peer = this._peers[publicKey]
  if (!peer) return

  var repush = function () {
    peer.node = self._queues[peer.priority].push(publicKey)
    self._drain()
  }

  var connection = new Connection(this.infoHash.toString('hex'), publicKey, this.torrenting)

  if (peer.timeout) clearTimeout(peer.timeout)

  peer.node = null
  peer.timeout = null

  var wire = this._create_wire_protocol(connection)
  wire.once('handshake', function (infoHash, peerId) {
    if (infoHash.toString('hex') !== self.infoHash.toString('hex')) {
      connection.destroy()
      return
    }
    peer.reconnect = true
    peer.retries = 0
    self._onhandshake(connection, wire)
  })

  wire.on('end', function () {
    peer.wire = null
    if (!peer.reconnect || self._destroyed || peer.retries >= RECONNECT_WAIT.length) {
      self._remove(publicKey)
      return
    }
    peer.timeout = setTimeout(repush, RECONNECT_WAIT[peer.retries++])
  })

  peer.wire = wire
  this._onconnection(publicKey, connection)

  wire.peerAddress = publicKey
  wire.handshake(this.infoHash, this.peerId, this.handshake)
}

Swarm.prototype._shift = function () {
  for (var i = this._queues.length - 1; i >= 0; i--) {
    if (this._queues[i] && this._queues[i].length) return this._queues[i].shift()
  }
  return null
}

Swarm.prototype._onincoming = function (publicKey) {
  var connection = new Connection(this.infoHash.toString('hex'), publicKey, this.torrenting)
  var swarm = this
  var wire = this._create_wire_protocol(connection)
  wire.once('handshake', function (infoHash, peerId) {
    wire.peerAddress = connection.publicKey
    wire.handshake(swarm.infoHash, swarm.peerId, swarm.handshake)
    swarm._onconnection(publicKey, connection)
    swarm._onhandshake(connection, wire)
  })
}

Swarm.prototype._onconnection = function (publicKey, connection) {
  var self = this
  connection.once('close', function () {
    delete self.connections[publicKey]
    self._drain()
  })
  this.connections[publicKey] = connection
}

Swarm.prototype._onhandshake = function (connection, wire) {
  var self = this

  wire.on('download', function (downloaded) {
    self.downloaded += downloaded
    self.downloadSpeed(downloaded)
    self.emit('download', downloaded)
  })

  wire.on('upload', function (uploaded) {
    self.uploaded += uploaded
    self.uploadSpeed(uploaded)
    self.emit('upload', uploaded)
  })

  var cleanup = once(function () {
    self.emit('wire-disconnect', wire, connection)
    self.wires.splice(self.wires.indexOf(wire), 1)
    connection.destroy()
  })

  connection.on('close', cleanup)
  connection.on('error', cleanup)
  connection.on('end', cleanup)
  wire.on('end', cleanup)
  wire.on('close', cleanup)
  wire.on('finish', cleanup)

  this.wires.push(wire)
  this.emit('wire', wire, connection)
}

Swarm.prototype._create_wire_protocol = function (connection) {
  var wire = peerWireProtocol(this._pwp)

  var destroy = function () {
    connection.destroy()
    connection.emit('timeout')
  }

  var handshakeTimeout = setTimeout(destroy, this.handshakeTimeout)

  if (handshakeTimeout.unref) handshakeTimeout.unref()

  wire.once('handshake', function (infoHash, peerId) {
    clearTimeout(handshakeTimeout)
  })

  connection.on('end', function () {
    connection.destroy()
  })

  connection.on('error', function () {
    connection.destroy()
  })

  connection.on('close', function () {
    clearTimeout(handshakeTimeout)
    wire.destroy()
  })

  connection.pipe(wire).pipe(connection)
  return wire
}

module.exports = Swarm
