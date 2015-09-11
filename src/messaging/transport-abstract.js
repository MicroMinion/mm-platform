var events = require('events')
var chai = require('chai')
var curve = require('curve-protocol')
var inherits = require('inherits')
var _ = require('lodash')
var Q = require('q')
var debug = require('debug')('flunky-platform:messaging:transport-abstract')

var expect = chai.expect

/**
 * Generic Message Transport
 *
 * @constructor
 * @fires AbstractTransport#ready
 * @fires AbstractTransport#disable
 * @fires AbstractTransport#connectionEstablished
 * @fires AbstractTransport#connectionStopped
 * @fires AbstractTransport#message
 * @param {string} publicKey
 * @param {string} privateKey
 */
var AbstractTransport = function (publicKey, privateKey) {
  debug('initialize')
  expect(publicKey).to.be.a('string')
  expect(curve.fromBase64(publicKey)).to.have.length(32)
  expect(privateKey).to.be.a('string')
  expect(curve.fromBase64(privateKey)).to.have.length(32)
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
    connection.end()
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
  var curveConnection = new curve.CurveCPStream({
    stream: connection,
    is_server: true,
    serverPublicKey: curve.fromBase64(this.publicKey),
    serverPrivateKey: curve.fromBase64(this.privateKey)
  })
  this._connectEvents(curveConnection)
}

AbstractTransport.prototype._wrapOutgoingConnection = function (publicKey, connection) {
  debug('wrapOutgoingConnection')
  var curveConnection = new curve.CurveCPStream({
    stream: connection,
    is_server: false,
    serverPublicKey: curve.fromBase64(publicKey),
    clientPublicKey: curve.fromBase64(this.publicKey),
    clientPrivateKey: curve.fromBase64(this.privateKey)
  })
  this.inProgressConnections[publicKey] = Q.defer()
  this._connectEvents(curveConnection)
  return this.inProgressConnections[publicKey].promise
}

AbstractTransport.prototype._connectEvents = function (stream) {
  debug('_connectEvents')
  expect(stream).to.exist
  expect(stream).to.be.an.instanceof(curve.CurveCPStream)
  var transport = this
  stream.on('error', function (error) {
    debug(error)
  })
  stream.on('end', function () {
    delete transport.connections[transport._getPeer(stream)]
    stream.removeAllListeners()
    if (_.has(transport.inProgressConnections, transport._getPeer(stream))) {
      transport.inProgressConnections[transport._getPeer(stream)].reject()
      delete transport.inProgressConnections[transport._getPeer(stream)]
    }
  })
  stream.on('drain', function () {
    expect(transport.connections).to.not.have.ownProperty(transport._getPeer(stream))
    transport.connections[transport._getPeer(stream)] = stream
    if (_.has(transport.inProgressConnections, transport._getPeer(stream))) {
      transport.inProgressConnections[transport._getPeer(stream)].resolve(stream)
      delete transport.inProgressConnections[transport._getPeer(stream)]
    }
  })
  stream.on('data', function (data) {
    transport.emit('message', transport._getPeer(stream), data)
  })
}

AbstractTransport.prototype._getPeer = function (stream) {
  debug('getPeer')
  var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey
  publicKey = curve.toBase64(publicKey)
  return publicKey
}

AbstractTransport.prototype.getConnection = function (publicKey) {
  debug('getConnection')
  if (_.has(this.connections, publicKey)) {
    return this.connections[publicKey]
  }
}

AbstractTransport.prototype.isConnected = function (publicKey) {
  debug('isConnected')
  return Boolean(this.getConnection(publicKey))
}

/* RECEIVING MESSAGES */

/**
 * message event
 *
 * @event AbstractTransport#message
 * @type {string} publicKey
 * @type {object} message
 */

/* SENDING MESSAGES */

/**
 * Send a message
 *
 * @abstract
 * @param {string} publicKey
 * @param {Object} message
 * @return {Promise}
 */

AbstractTransport.prototype.send = function (publicKey, message) {
  debug('send')
  expect(message).to.exist
  expect(publicKey).to.be.a('string')
  expect(curve.fromBase64(publicKey)).to.have.length(32)
  expect(this.connections[publicKey]).to.exist
  expect(this.connections[publicKey]).to.be.an.instanceof(curve.CurveCPStream)
  this.connections[publicKey].write(message)
}

module.exports = AbstractTransport
