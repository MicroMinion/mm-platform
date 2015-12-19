var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var _ = require('lodash')
var storagejs = require('storagejs')
var debug = require('debug')('flunky-platform:messaging:transport-tcp')
var Duplex = require('stream').Duplex
var ns = require('../util/ns.js')
var expect = require('chai').expect

var net

if (_.isUndefined(window.chrome)) {
  net = require('net')
} else {
  net = require('chrome-net')
}

var TCPTransport = function (publicKey, privateKey) {
  debug('initialize')
  AbstractTransport.call(this, publicKey, privateKey)
  this.enabled = false
  var transport = this
  this._server = net.createServer()
  this._server.on('listening', this._onListening.bind(this))
  this._server.on('close', this._onClose.bind(this))
  this._server.on('connection', this._onConnection.bind(this))
  this._server.on('error', function (err) {
    debug(err)
    transport._listen(0)
  })
  storagejs.get('flunky-messaging-transport-tcp').then(this._listen.bind(this), function (err) {
    debug(err)
    transport._listen(0)
  })
}

inherits(TCPTransport, AbstractTransport)

TCPTransport.prototype._listen = function (port) {
  debug('_listen')
  this._server.listen(port)
}

TCPTransport.prototype._onListening = function () {
  debug('_onListening')
  this.enabled = true
  storagejs.put('flunky-messaging-transport-tcp', this._server.address().port)
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
  this._wrapIncomingConnection(new TCPConnection(connection))
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

TCPTransport.prototype._pickConnection = function (stateSnapshots) {
  var connection
  var deferred = Q.defer()
  _.forEach(stateSnapshots, function (snapshot) {
    if (snapshot.state === 'fulfilled') {
      if (connection) {
        connection.destroy()
      } else {
        connection = snapshot.value
      }
    }
  }, this)
  if (connection) {
    return connection
  } else {
    process.nextTick(function () {
      deferred.reject()
    })
  }
  return deferred.promise
}

TCPTransport.prototype._hasConnectionInfo = function (connectionInfo) {
  return _.isObject(connectionInfo) && _.has(connectionInfo, 'tcp') && _.isObject(connectionInfo.tcp) &&
  _.has(connectionInfo.tcp, 'addresses') && _.has(connectionInfo.tcp, 'port')
}

TCPTransport.prototype._connectToAddress = function (address, port) {
  debug('_connectToAddress')
  var deferred = Q.defer()
  var connection = net.createConnection(port, address)
  var err = function (err) {
    if (!deferred.promise.isFulfilled()) {
      deferred.reject(err)
    }
  }
  connection.once('connect', function () {
    connection.removeListener('error', err)
    deferred.resolve(new TCPConnection(connection))
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
  this.stream.on('data', this.processMessage.bind(this))
}

inherits(TCPConnection, Duplex)

TCPConnection.prototype.processMessage = function (data) {
  var messageLength = ns.nsLength(data)
  this.emit('data', ns.nsPayload(data))
  if (messageLength < data.length) {
    var buffer = new Buffer(data.length - messageLength)
    data.copy(buffer, 0, messageLength)
    this.processMessage(buffer)
  }
}

TCPConnection.prototype._read = function (size) {}

TCPConnection.prototype._write = function (chunk, encoding, done) {
  debug('_write')
  expect(Buffer.isBuffer(chunk)).to.be.true
  expect(chunk).to.have.length.of.at.least(1)
  expect(done).to.be.an.instanceof(Function)
  this.stream.write(ns.nsWrite(chunk), encoding, done)
}

TCPConnection.prototype.error = function (errorMessage) {
  debug('error')
  expect(errorMessage).to.be.a('string')
  expect(errorMessage).to.have.length.of.at.least(1)
  this.stream.error(errorMessage)
  this.emit('error', new Error(errorMessage))
  this.emit('end')
  this.emit('close')
}

module.exports = TCPTransport
