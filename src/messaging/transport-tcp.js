var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var _ = require('lodash')
var storagejs = require('storagejs')
var debug = require('debug')('flunky-platform:messaging:transport-tcp')

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
    deferred.resolve(connection)
  })
  connection.on('error', err)
  return deferred.promise
}

module.exports = TCPTransport
