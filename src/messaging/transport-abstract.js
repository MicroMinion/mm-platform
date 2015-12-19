/* global chrome */

var events = require('events')
var chai = require('chai')
var PacketStream = require('curvecp').PacketStream
var MessageStream = require('curvecp').MessageStream
var inherits = require('inherits')
var _ = require('lodash')
var Q = require('q')
var debug = require('debug')('flunky-platform:messaging:transport-abstract')
var os = require('os')
var nacl = require('tweetnacl')

var expect = chai.expect

/**
 * Generic Message Transport
 *
 * @constructor
 * @fires AbstractTransport#ready
 * @fires AbstractTransport#disable
 * @fires AbstractTransport#connectionEstablished
 * @fires AbstractTransport#connectionStopped
 * @fires AbstractTransport#data
 * @param {string} publicKey
 * @param {string} privateKey
 */
var AbstractTransport = function (publicKey, privateKey) {
  debug('initialize')
  expect(publicKey).to.be.a('string')
  expect(nacl.decodeBase64(publicKey)).to.have.length(32)
  expect(privateKey).to.be.a('string')
  expect(nacl.decodeBase64(privateKey)).to.have.length(32)
  events.EventEmitter.call(this)
  this.publicKey = publicKey
  this.privateKey = privateKey
  /*
   * Connection objects
   *
   * @type Object.{string, Object}
   */
  this.connections = {}
  this.inProgressConnections = {}
}

inherits(AbstractTransport, events.EventEmitter)

/* TRANSPORT STATUS */

/**
 * ready event
 *
 * @event AbstractTransport#ready
 * @type {object} connectionInfo
 */

/**
 * disable event
 *
 * @event AbstractTransport#disable
 */

/**
 * Manually disable transport. Probably needs to be extended in subclasses
 *
 * @abstract
 */
AbstractTransport.prototype.disable = function () {
  debug('disable')
  _.forEach(this.connections, function (connection) {
    connection.destroy()
  })
}

AbstractTransport.prototype.isDisabled = function () {
  debug('isDisabled')
  throw new Error('must be implemented by subclass')
}

/**
 * Enable transport
 *
 * @abstract
 */
AbstractTransport.prototype.enable = function () {
  debug('enable')
  throw new Error('must be implemented by subclass')
}

AbstractTransport.prototype._listAddresses = function () {
  debug('_listAddresses')
  var deferred = Q.defer()
  var result = []
  if (_.isUndefined(window.chrome) || _.isUndefined(window.chrome.system) || _.isUndefined(window.chrome.system.network)) {
    process.nextTick(function () {
      var interfaces = os.networkInterfaces()
      _.forEach(interfaces, function (interface_) {
        _.forEach(interface_, function (face) {
          if (!face.internal) {
            result.push(face.address)
          }
        })
      })
      debug(result)
      deferred.resolve(result)
    })
  } else {
    chrome.system.network.getNetworkInterfaces(function (networkIfaceArray) {
      for (var i = 0; i < networkIfaceArray.length; i++) {
        var iface = networkIfaceArray[i]
        result.push(iface.address)
      }
      debug(result)
      deferred.resolve(result)
    })
  }
  return deferred.promise
}

/* CONNECTIONS */

/**
 * Connect to a peer
 *
 * @abstract
 * @param {string} publicKey
 * @param {Object} connectionInfo
 * @return {Promise}
 */
AbstractTransport.prototype.connect = function (connectionInfo) {
  debug('connect')
  if (_.has(this.inProgressConnections, connectionInfo.publicKey)) {
    return this.inProgressConnections[connectionInfo.publicKey].promise
  } else {
    return this._connect(connectionInfo)
      .then(this._wrapOutgoingConnection.bind(this, connectionInfo.publicKey))
  }
}

/**
 * Connect to peer
 *
 * @return {Promise}
 */
AbstractTransport.prototype._connect = function (connectionInfo) {
  debug('_connect')
  throw new Error('must be implemented by subclass')
}

AbstractTransport.prototype._wrapIncomingConnection = function (connection) {
  debug('wrapIncomingConnection')
  var packetStream = new PacketStream({
    stream: connection,
    is_server: true,
    serverPublicKey: nacl.decodeBase64(this.publicKey),
    serverPrivateKey: nacl.decodeBase64(this.privateKey)
  })
  var messageStream = new MessageStream(packetStream)
  this._connectEvents(messageStream)
}

AbstractTransport.prototype._wrapOutgoingConnection = function (publicKey, connection) {
  debug('wrapOutgoingConnection')
  var packetStream = new PacketStream({
    stream: connection,
    is_server: false,
    serverPublicKey: nacl.decodeBase64(publicKey),
    clientPublicKey: nacl.decodeBase64(this.publicKey),
    clientPrivateKey: nacl.decodeBase64(this.privateKey)
  })
  var messageStream = new MessageStream(packetStream)
  this.inProgressConnections[publicKey] = Q.defer()
  this._connectEvents(messageStream)
  messageStream.connect()
  return this.inProgressConnections[publicKey].promise
}

AbstractTransport.prototype._connectEvents = function (stream) {
  debug('_connectEvents')
  expect(stream).to.exist
  expect(stream).to.be.an.instanceof(MessageStream)
  var transport = this
  var functions = {
    connect: function () {
      var publicKey = transport._getPeer(stream)
      if (!_.has(transport.connections, publicKey)) {
        transport.connections[publicKey] = []
      }
      var removedStreams = _.filter(transport.connections[publicKey], function (streamInArray) {
        return streamInArray !== stream
      })
      transport.connections[publicKey].push(stream)
      transport.emit('connection', publicKey)
      if (_.has(transport.inProgressConnections, publicKey)) {
        transport.inProgressConnections[publicKey].resolve(stream)
        delete transport.inProgressConnections[publicKey]
      }
      _.forEach(removedStreams, function (stream) {
        stream.destroy()
      })
    },
    data: function (data) {
      debug('data event' + data)
      transport.emit('message', transport._getPeer(stream), data)
    },
    error: function (error) {
      debug('handling error of curve stream')
      debug(error)
    },
    close: function () {
      stream.removeListener('connect', functions.connect)
      stream.removeListener('data', functions.data)
      stream.removeListener('error', functions.error)
      stream.removeListener('close', functions.close)
      transport._deleteStream(stream)
    }
  }
  stream.on('connect', functions.connect)
  stream.on('data', functions.data)
  stream.on('error', functions.error)
  stream.on('close', functions.close)
}

AbstractTransport.prototype._deleteStream = function (stream) {
  var publicKey = this._getPeer(stream)
  if (publicKey) {
    _.remove(this.connections[publicKey], function (streamInArray) {
      return streamInArray === stream
    })
    if (_.size(this.connections[publicKey]) === 0) {
      this.emit('disconnection', publicKey)
    }
  }
  if (publicKey && _.has(this.inProgressConnections, publicKey)) {
    this.inProgressConnections[publicKey].reject()
    delete this.inProgressConnections[publicKey]
  }
}

AbstractTransport.prototype._getPeer = function (stream) {
  debug('getPeer')
  var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey
  if (!publicKey) {
    return
  }
  publicKey = nacl.encodeBase64(publicKey)
  return publicKey
}

AbstractTransport.prototype.getConnection = function (publicKey) {
  debug('getConnection')
  if (_.has(this.connections, publicKey)) {
    return _.last(this.connections[publicKey])
  }
}

AbstractTransport.prototype.isConnected = function (publicKey) {
  debug('isConnected')
  return Boolean(this.getConnection(publicKey))
}

module.exports = AbstractTransport
