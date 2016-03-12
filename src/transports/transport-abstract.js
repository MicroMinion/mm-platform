/* global chrome */

var events = require('events')
var chai = require('chai')
var PacketStream = require('curvecp').PacketStream
var MessageStream = require('curvecp').MessageStream
var inherits = require('inherits')
var _ = require('lodash')
var Q = require('q')
var debug = require('debug')('flunky-platform:transports:transport-abstract')
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
var AbstractTransport = function (options) {
  debug('initialize')
  expect(options.publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(options.publicKey)).to.have.length(32)
  expect(options.privateKey).to.be.a('string')
  expect(nacl.util.decodeBase64(options.privateKey)).to.have.length(32)
  events.EventEmitter.call(this)
  this.publicKey = options.publicKey
  this.privateKey = options.privateKey
  this.options = options
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
 * @type {object}
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
  // debug('_listAddresses')
  var deferred = Q.defer()
  var result = []
  if (_.isUndefined(global.window) || _.isUndefined(window.chrome) || _.isUndefined(window.chrome.system) || _.isUndefined(window.chrome.system.network)) {
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
      // debug(result)
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
  // debug('connect ' + connectionInfo.publicKey)
  var transport = this
  if (_.has(this.inProgressConnections, connectionInfo.publicKey)) {
    return this.inProgressConnections[connectionInfo.publicKey].promise
  } else {
    this._connect(connectionInfo)
      .then(this._wrapOutgoingConnection.bind(this, connectionInfo.publicKey))
      .fail(function (error) {
        debug('Connection to ' + connectionInfo.publicKey + ' failed')
        var deferred = transport.inProgressConnections[connectionInfo.publicKey]
        delete transport.inProgressConnections[connectionInfo.publicKey]
        deferred.reject(error)
      })
    this.inProgressConnections[connectionInfo.publicKey] = Q.defer()
    return this.inProgressConnections[connectionInfo.publicKey].promise
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
    isServer: true,
    serverPublicKey: nacl.util.decodeBase64(this.publicKey),
    serverPrivateKey: nacl.util.decodeBase64(this.privateKey)
  })
  var messageStream = new MessageStream(packetStream)
  this._connectEvents(messageStream, true)
}

AbstractTransport.prototype._wrapOutgoingConnection = function (publicKey, connection) {
  debug('wrapOutgoingConnection')
  var packetStream = new PacketStream({
    stream: connection,
    isServer: false,
    serverPublicKey: nacl.util.decodeBase64(publicKey),
    clientPublicKey: nacl.util.decodeBase64(this.publicKey),
    clientPrivateKey: nacl.util.decodeBase64(this.privateKey)
  })
  var messageStream = new MessageStream(packetStream)
  this._connectEvents(messageStream, false)
  messageStream.connect()
}

AbstractTransport.prototype._connectEvents = function (stream, isServer) {
  debug('_connectEvents')
  expect(stream).to.exist
  expect(stream).to.be.an.instanceof(MessageStream)
  var transport = this
  var functions = {
    connect: function () {
      var publicKey = transport._getPeer(stream)
      if (!_.has(transport.connections, publicKey)) {
        transport.connections[publicKey] = stream
        transport.emit('connection', publicKey)
      }
      if (_.has(transport.inProgressConnections, publicKey)) {
        transport.inProgressConnections[publicKey].resolve(stream)
        delete transport.inProgressConnections[publicKey]
      }
    },
    data: function (data) {
      debug('data event from ' + transport._getPeer(stream) + ' ' + data)
      transport.emit('message', transport._getPeer(stream), data)
    },
    error: function (error) {
      debug('handling error of CurveCP stream')
      debug(error)
    },
    close: function () {
      if (!isServer) {
        stream.removeListener('connect', functions.connect)
      }
      if (isServer) {
        stream.removeListener('data', functions.data)
      }
      stream.removeListener('error', functions.error)
      stream.removeListener('close', functions.close)
      transport._deleteStream(stream)
    }
  }
  if (!isServer) {
    stream.on('connect', functions.connect)
  }
  if (isServer) {
    stream.on('data', functions.data)
  }
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
  stream = stream._stream
  var publicKey = stream.isServer ? stream.clientPublicKey : stream.serverPublicKey
  if (!publicKey) {
    return
  }
  publicKey = nacl.util.encodeBase64(publicKey)
  return publicKey
}

AbstractTransport.prototype.getConnection = function (publicKey) {
  return this.connections[publicKey]
}

AbstractTransport.prototype.isConnected = function (publicKey) {
  return Boolean(this.getConnection(publicKey))
}

module.exports = AbstractTransport
