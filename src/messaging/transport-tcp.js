var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var net = require('net')
var os = require('os')
var _ = require('lodash')
var storagejs = require('storagejs')
var debug = require('debug')('flunky-platform:messaging:transport-tcp')

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
    if (err.code === 'EADDRINUSE') {
      transport._server.close()
      transport._listen(0)
    } else {
      debug(err)
    }
  })
  storagejs.get('flunky-messaging-transport-tcp').then(this._listen.bind(this), function (err) {
    transport._listen(0)
  })
}

inherits(TCPTransport, AbstractTransport)

TCPTransport.prototype._listen = function (port) {
  debug('_listen')
  this._server.listen(port)
}

TCPTransport.prototype._listAddresses = function () {
  debug('_listAddresses')
  var result = []
  var interfaces = os.networkInterfaces()
  _.forEach(interfaces, function (interface_) {
    _.forEach(interface_, function (face) {
      if (!face.internal) {
        result.push(face.address)
      }
    })
  })
  return result
}

TCPTransport.prototype._onListening = function () {
  debug('_onListening')
  this.enabled = true
  storagejs.put('flunky-messaging-transport-tcp', this._server.address().port)
  this.emit('ready', {
    'tcp': {
      'addresses': this._listAddresses(),
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
  this._server.close()
}

TCPTransport.prototype.isDisabled = function () {
  debug('isDisabled')
  return !this.enabled
}

TCPTransport.prototype._connect = function (connectionInfo) {
  debug('_connect')
  var transport = this
  var deferred = Q.defer()
  var promise = deferred.promise
  if (this._hasConnectionInfo(connectionInfo)) {
    _.forEach(connectionInfo.tcp.addresses, function (address) {
      promise = promise.then(undefined, transport._connectToAddress.bind(transport, address, connectionInfo.tcp.port))
    })
  }
  process.nextTick(function () {
    deferred.reject()
  })
  return promise
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
    deferred.reject(err)
  }
  connection.on('connect', function () {
    connection.removeListener('error', err)
    deferred.resolve(connection)
  })
  connection.once('error', err)
  return deferred.promise
}

module.exports = TCPTransport
