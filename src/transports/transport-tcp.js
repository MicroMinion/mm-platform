var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var _ = require('lodash')
var debug = require('debug')('flunky-platform:transports:transport-tcp')
var Duplex = require('stream').Duplex
var ns = require('../util/ns.js')
var expect = require('chai').expect

var net

if (_.isUndefined(global.window) || _.isUndefined(global.window.chrome)) {
  net = require('net')
} else {
  net = require('chrome-net')
}

/**
 * @constructor
 */
var TCPTransport = function (options) {
  debug('initialize')
  AbstractTransport.call(this, options)
  this.storage = options.storage
  this.enabled = false
  var transport = this
  this.tcpConnections = {}
  this.tcpInProgress = {}
  this._server = net.createServer()
  this._server.on('listening', this._onListening.bind(this))
  this._server.on('close', this._onClose.bind(this))
  this._server.on('connection', this._onConnection.bind(this))
  this._server.on('error', function (err) {
    debug(err)
    transport._listen(0)
  })
  Q.nfcall(this.storage.get.bind(this.storage), 'flunky-messaging-transport-tcp').then(
    function (port) {
      debug('retrieved old port')
      debug(port)
      transport._listen(JSON.parse(port).port)
    },
    function (err) {
      debug(err)
      transport._listen(0)
    }
  )
}

inherits(TCPTransport, AbstractTransport)

TCPTransport.prototype._listen = function (port) {
  debug('_listen')
  this._server.listen(port)
}

TCPTransport.prototype._onListening = function () {
  debug('_onListening')
  this.enabled = true
  this.storage.put('flunky-messaging-transport-tcp', JSON.stringify({port: this._server.address().port}))
  var addresses = this._listAddresses()
  addresses.then(this._emitReady.bind(this)).done()
}

TCPTransport.prototype._emitReady = function (addresses) {
  debug('_emitReady')
  this.emit('ready', {
    'tcp': {
      'addresses': addresses,
      'port': this._server.address().port
    }
  })
}

TCPTransport.prototype._onClose = function () {
  debug('_onClose')
  this.enabled = false
  this.emit('disable')
}

TCPTransport.prototype._onConnection = function (connection) {
  debug('_onConnection')
  connection = new TCPConnection(connection)
  this.tcpConnections[connection.toString()] = connection
  this._wrapIncomingConnection(connection)
}

TCPTransport.prototype.enable = function () {
  debug('enable')
  if (!this.enabled) {
    this._server.listen()
  }
}

TCPTransport.prototype.disable = function () {
  debug('disable')
  this.enabled = false
  this._server.close()
  AbstractTransport.prototype.disable.call(this)
}

TCPTransport.prototype.isDisabled = function () {
  debug('isDisabled')
  return !this.enabled
}

TCPTransport.prototype._connect = function (connectionInfo) {
  debug('_connect')
  debug(connectionInfo)
  var transport = this
  if (this._hasConnectionInfo(connectionInfo)) {
    var promises = []
    _.forEach(connectionInfo.tcp.addresses, function (address) {
      promises.push(transport._connectToAddress(address, connectionInfo.tcp.port))
    }, transport)
    return Q.any(promises)
  } else {
    var deferred = Q.defer()
    process.nextTick(function () {
      deferred.reject()
    })
    return deferred.promise
  }
}

TCPTransport.prototype._hasConnectionInfo = function (connectionInfo) {
  return _.isObject(connectionInfo) && _.has(connectionInfo, 'tcp') && _.isObject(connectionInfo.tcp) &&
  _.has(connectionInfo.tcp, 'addresses') && _.has(connectionInfo.tcp, 'port')
}

TCPTransport.prototype._connectToAddress = function (address, port) {
  debug('_connectToAddress ' + address + ' ' + port)
  var transport = this
  var deferred = Q.defer()
  if (_.has(this.tcpInProgress, address + ':' + port)) {
    debug('connection already in progress to ' + address + ':' + port)
    return
  }
  if (_.has(this.tcpConnections, address + ':' + port)) {
    debug('already connected to ' + address + ':' + port)
  }
  this.tcpInProgress[address + ':' + port] = true
  var connection = net.createConnection(port, address)
  var err = function (err) {
    if (!deferred.promise.isFulfilled()) {
      delete transport.tcpInProgress[address + ':' + port]
      deferred.reject(err)
    }
  }
  connection.once('connect', function () {
    connection.removeListener('error', err)
    var stream = new TCPConnection(connection)
    transport.tcpConnections[stream.toString()] = stream
    delete transport.tcpInProgress[stream.toString()]
    deferred.resolve(stream)
  })
  connection.on('error', err)
  return deferred.promise
}

var TCPConnection = function (tcpStream) {
  var opts = {}
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
  this.stream = tcpStream
  var connection = this
  this.stream.on('data', this.processMessage.bind(this))
  this.stream.on('error', function (err) {
    connection.emit('error', err)
  })
  this.stream.on('close', function () {
    connection.emit('close')
  })
  this.stream.on('connect', function () {
    connection.emit('connect')
  })
  this.stream.on('drain', function () {
    connection.emit('drain')
  })
  this.stream.on('end', function () {
    connection.emit('end')
  })
  this.stream.on('timeout', function () {
    connection.destroy()
  })
}

inherits(TCPConnection, Duplex)

TCPConnection.prototype.toString = function () {
  return this.stream.remoteAddress + ':' + this.stream.remotePort
}

TCPConnection.prototype.processMessage = function (data) {
  debug('processMessage')
  var messageLength = ns.nsLength(data)
  debug(messageLength)
  var payload = ns.nsPayload(data)
  debug(payload.length)
  this.emit('data', payload)
  if (messageLength < data.length) {
    var buffer = new Buffer(data.length - messageLength)
    data.copy(buffer, 0, messageLength)
    this.processMessage(buffer)
  }
}

TCPConnection.prototype._read = function (size) {}

TCPConnection.prototype._write = function (chunk, encoding, done) {
  debug('_write')
  debug(chunk.length)
  expect(Buffer.isBuffer(chunk)).to.be.true
  expect(chunk).to.have.length.of.at.least(1)
  expect(done).to.be.an.instanceof(Function)
  var result = this.stream.write(ns.nsWrite(chunk), encoding, done)
  if (result) {
    debug('data flushed successfully')
  } else {
    debug('part of data queued in memory')
  }
}

TCPConnection.prototype.destroy = function () {
  debug('TCPConnection.destroy')
  this.stream.destroy()
}

TCPConnection.prototype.end = function () {
  debug('TCPConnection.end')
  this.stream.end()
}

module.exports = TCPTransport
