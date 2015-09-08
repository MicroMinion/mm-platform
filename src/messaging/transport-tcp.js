var AbstractTransport = require('./transport-abstract.js')
var Q = require('q')
var inherits = require('inherits')
var net = require('net')
var os = require('os')
var _ = require('lodash')
var expect = require('chai').expect

var TCPTransport = function (publicKey, privateKey) {
  console.log('initializing TCPTransport')
  AbstractTransport.call(this, publicKey, privateKey)
  this.enabled = false
  this._server = net.createServer()
  this._server.on('listening', this._onListening.bind(this))
  this._server.on('close', this._onClose.bind(this))
  this._server.on('connection', this._onConnection.bind(this))
  this._server.on('error', function (err) {
    console.log(err)
  })
  this._server.listen()
}

inherits(TCPTransport, AbstractTransport)

TCPTransport.prototype._listAddresses = function () {
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
  this.enabled = true
  this.emit('ready', {
    'tcp': {
      'addresses': this._listAddresses(),
      'port': this._server.address().port
    }
  })
}

TCPTransport.prototype._onClose = function () {
  this.enabled = false
  this.emit('disable')
}

TCPTransport.prototype._onConnection = function (connection) {
  this._wrapIncomingConnection(connection)
}

TCPTransport.prototype.enable = function () {
  if (!this.enabled) {
    this._server.listen()
  }
}

TCPTransport.prototype.disable = function () {
  this._server.close()
}

TCPTransport.prototype.isDisabled = function () {
  return !this.enabled
}

TCPTransport.prototype._connect = function (publicKey, connectionInfo) {
  var deferred = Q.defer()
  try {
    console.log('connect')
    expect(connectionInfo).to.have.property('tcp')
    expect(connectionInfo.tcp).to.be.an('Object')
    expect(connectionInfo.tcp).to.have.property('addresses')
    expect(connectionInfo.tcp).to.have.property('port')
  } catch (e) {
    process.nextTick(function () {
      deferred.reject(e)
    })
    return deferred.promise
  }
  _.forEach(connectionInfo.tcp.addresses, function (address) {
    deferred = deferred.then(undefined, this._connectToAddress.bind(this, address, connectionInfo.tcp.port))
  }, this)
  process.nextTick(function () {
    deferred.reject()
  })
  return deferred.promise
}

TCPTransport.prototype._connectToAddress = function (address, port) {
  var deferred = Q.defer()
  var connection = net.createConnection(port, address)
  var err = function (err) {
    console.log(err)
    deferred.reject()
  }
  connection.on('connect', function () {
    connection.removeListener('error', err)
    deferred.resolve()
  })
  connection.once('error', err)
  return deferred.promise
}

module.exports = TCPTransport
