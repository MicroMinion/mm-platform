/* global chrome */
var uuid = require('node-uuid')
var inherits = require('inherits')
var _ = require('lodash')
var Duplex = require('stream').Duplex
var extend = require('extend.js')
var chai = require('chai')
var AbstractTransport = require('./transport-abstract')
var Q = require('q')
var debug = require('debug')('flunky-platform:messaging:transport-gcm')
var nacl = require('tweetnacl')

var expect = chai.expect

var SENDER_ID = '559190877287'

function GCMTransport (publicKey, privateKey) {
  debug('initialize')
  AbstractTransport.call(this, publicKey, privateKey)
  this.registrationId = undefined
  this.gcmConnections = {}
  if (typeof chrome !== 'undefined' && typeof chrome.gcm !== 'undefined') {
    chrome.gcm.onMessage.addListener(this._onMessage.bind(this))
    chrome.gcm.onSendError.addListener(this._onSendError.bind(this))
    process.nextTick(this.enable.bind(this))
  } else {
    process.nextTick(this.disable.bind(this))
  }
}

inherits(GCMTransport, AbstractTransport)

/*
 * CALLBACK HANDLERS FROM CHROME.GCM
 */

GCMTransport.prototype._onSendError = function (error) {
  debug('_onSendError')
  debug(error.errorMessage)
  debug(error.details)
  this.disable()
}

GCMTransport.prototype._validMessage = function (message) {
  return _.isObject(message) &&
  _.isObject(message.data) &&
  _.isString(message.data.type) &&
  _.isString(this.registrationId) &&
  _.isObject(this.connections) &&
  _.isEqual(message.data.type, 'MESSAGE') &&
  _.isString(message.data.data) &&
  _.isString(message.data.destination) &&
  _.isString(message.data.source) &&
  _.isEqual(message.data.destination, this.registrationId)
}

GCMTransport.prototype._onMessage = function (message) {
  debug('_onMessage')
  if (!this._validMessage(message)) {
    return
  }
  var source = message.data.source
  if (!_.has(this.gcmConnections, source)) {
    this._createConnection(source)
    this._wrapIncomingConnection(this.gcmConnections[source])
  }
  this.gcmConnections[source].emit('data', new Buffer(nacl.util.decodeBase64(message.data.data)))
}

/* API IMPLEMENTATION: TRANSPORT STATUS */

GCMTransport.prototype.enable = function () {
  debug('enable')
  if (_.isUndefined(chrome.gcm)) {
    return
  }
  var gcm = this
  chrome.gcm.register([SENDER_ID], function (registrationId) {
    if (chrome.runtime.lastError) {
      debug('GCM Registration failed')
      debug(chrome.runtime.lastError)
      gcm.emit('disable')
    } else {
      gcm.registrationId = registrationId
      gcm.emit('ready', {'gcm': gcm.registrationId})
    }
  })
}

GCMTransport.prototype.disable = function () {
  debug('disable')
  this.registrationId = undefined
  AbstractTransport.prototype.disable.call(this)
  _.forEach(this.gcmConnections, function (connection) {
    connection.error('send error, disabling connection')
  }, this)
}

GCMTransport.prototype.isDisabled = function () {
  debug('isDisabled')
  return _.isUndefined(this.registrationId)
}

/* API IMPLEMENTATION: CONNECTIONS */

GCMTransport.prototype._connect = function (connectionInfo) {
  debug('_connect')
  expect(this.registrationId).to.be.a('string')
  expect(this.registrationId).to.have.length.of.at.least(1)
  expect(connectionInfo.publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(connectionInfo.publicKey)).to.have.length(32)
  expect(connectionInfo).to.be.an('object')
  expect(this.isDisabled()).to.be.false
  var transport = this
  var deferred = Q.defer()
  if (this._hasConnectionInfo(connectionInfo)) {
    this._createConnection(connectionInfo.gcm)
    process.nextTick(function () {
      deferred.resolve(transport.gcmConnections[connectionInfo.gcm])
    })
  } else {
    process.nextTick(function () {
      deferred.reject()
    })
  }
  return deferred.promise
}

GCMTransport.prototype._createConnection = function (destination) {
  if (!_.has(this.gcmConnections, destination)) {
    var manager = this
    var gcmConnection = new GCMConnection({
      source: this.registrationId,
      destination: destination
    })
    this.gcmConnections[destination] = gcmConnection
    gcmConnection.on('close', function () {
      delete manager.gcmConnections[destination]
    })
  }
}

GCMTransport.prototype._hasConnectionInfo = function (connectionInfo) {
  return _.isObject(connectionInfo) &&
  _.has(connectionInfo, 'gcm') &&
  _.isString(connectionInfo.gcm)
}

var GCMConnection = function (opts) {
  debug('initialize connection')
  expect(opts).to.be.an('object')
  expect(opts.source).to.be.a('string')
  expect(opts.destination).to.be.a('string')
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
  extend(this, opts)
}

inherits(GCMConnection, Duplex)

GCMConnection.prototype._read = function (size) {
  debug('_read')
}

GCMConnection.prototype._write = function (chunk, encoding, done) {
  debug('_write')
  expect(Buffer.isBuffer(chunk)).to.be.true
  expect(chunk).to.have.length.of.at.least(1)
  expect(done).to.be.an.instanceof(Function)
  expect(this.source).to.be.a('string')
  expect(this.destination).to.be.a('string')
  var stream = this
  chrome.gcm.send({
    destinationId: SENDER_ID + '@gcm.googleapis.com',
    messageId: uuid.v4(),
    timeToLive: 0,
    data: {
      type: 'MESSAGE',
      destination: stream.destination,
      source: stream.source,
      data: nacl.util.encodeBase64(new Uint8Array(chunk))
    }
  }, function (messageId) {
    if (chrome.runtime.lastError) {
      var message = 'GCM: problem with sending message to app server (' + chrome.runtime.lastError.message + ')'
      done(new Error(message))
      stream.error(message)
    } else {
      done()
    }
  })
}

GCMConnection.prototype.error = function (errorMessage) {
  debug('error')
  expect(errorMessage).to.be.a('string')
  expect(errorMessage).to.have.length.of.at.least(1)
  this.emit('error', new Error(errorMessage))
  this.emit('end')
  this.emit('close')
}

module.exports = GCMTransport
