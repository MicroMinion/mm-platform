/* global chrome */
var uuid = require('node-uuid')
var inherits = require('inherits')
var curve = require('curve-protocol')
var _ = require('lodash')
var Duplex = require('stream').Duplex
var extend = require('extend.js')
var chai = require('chai')
var AbstractTransport = require('./transport-abstract')
var Q = require('q')

var expect = chai.expect

var SENDER_ID = '559190877287'

function GCMTransport (publicKey, privateKey) {
  AbstractTransport.call(this, publicKey, privateKey)
  this.registrationId = undefined
  this.gcmConnections = {}
  if (typeof chrome !== 'undefined' && typeof chrome.gcm !== 'undefined') {
    chrome.gcm.onMessage.addListener(this._onMessage.bind(this))
    chrome.gcm.onSendError.addListener(this._onSendError.bind(this))
    process.nextTick(this.enable)
  } else {
    process.nextTick(this.disable)
  }
}

inherits(GCMTransport, AbstractTransport)

/*
 * CALLBACK HANDLERS FROM CHROME.GCM
 */

GCMTransport.prototype._onSendError = function (error) {
  console.log('GCM: Send error')
  console.log(error.errorMessage)
  console.log(error.details)
  this.disable()
  _.forEach(this.gcmConnections, function (connection) {
    connection.error('send error, disabling connection')
  }, this)
}

GCMTransport.prototype._onMessage = function (message) {
  expect(message.data.type).to.be.a('string')
  expect(this.connections).to.be.an('object')
  expect(this.registrationId).to.be.a('string')
  if (message.data.type !== 'MESSAGE') {
    return
  }
  try {
    expect(message.data.data).to.be.a('string')
    expect(message.data.destination).to.be.a('string')
    expect(message.data.source).to.be.a('string')
  } catch (e) {
    console.log(e)
    return
  }
  if (message.data.destination !== this.registrationId) {
    console.log('message received which does not have our registrationId as destination')
    return
  }
  var source = message.data.source
  if (!_.has(this.gcmConnections, source)) {
    var gcmConnection = new GCMConnection({
      source: this.registrationId,
      destination: source
    })
    this.gcmConnections[source] = gcmConnection
  }
  this._wrapOutgoingConnection(gcmConnection)
  this.gcmConnections[source].emit('data', new Buffer(curve.fromBase64(message.data.data)))
}

/* API IMPLEMENTATION: TRANSPORT STATUS */

GCMTransport.prototype.enable = function () {
  expect(chrome.gcm).to.exist
  var gcm = this
  chrome.gcm.register([SENDER_ID], function (registrationId) {
    if (chrome.runtime.lastError) {
      console.log('GCM Registration failed')
      console.log(chrome.runtime.lastError)
      gcm.emit('disable')
    } else {
      gcm.registrationId = registrationId
      gcm.emit('ready', {'gcm': gcm.registrationId})
    }
  })
}

GCMTransport.prototype.disable = function () {
  this.registrationId = undefined
  AbstractTransport.disable.call(this)
}

GCMTransport.prototype.isDisabled = function () {
  return _.isUndefined(this.registrationId)
}

/* API IMPLEMENTATION: CONNECTIONS */

GCMTransport.prototype._connect = function (publicKey, connectionInfo) {
  expect(this.registrationId).to.be.a('string')
  expect(this.registrationId).to.have.length.of.at.least(1)
  expect(publicKey).to.be.a('string')
  expect(curve.fromBase64(publicKey)).to.have.length(32)
  expect(connectionInfo).to.be.an('object')
  expect(this.isDisabled()).to.be.false
  var manager = this
  var deferred = Q.defer()
  try {
    expect(connectionInfo).to.have.property('gcm')
    expect(connectionInfo.gcm).to.be.a('string')
  } catch (e) {
    process.nextTick(function () {
      deferred.reject(e)
    })
  }
  if (!_.has(this.gcmConnections, connectionInfo.gcm)) {
    var gcmConnection = new GCMConnection({
      source: this.registrationId,
      destination: connectionInfo.gcm
    })
    this.gcmConnections[connectionInfo.gcm] = gcmConnection
    gcmConnection.on('close', function () {
      delete manager.gcmConnections[connectionInfo.gcm]
    })
  }
  process.nextTick(function () {
    deferred.resolve(manager.gcmConnections[connectionInfo.gcm])
  })
  return deferred.promise
}

var GCMConnection = function (opts) {
  expect(opts).to.be.an('object')
  expect(opts.source).to.be.a('string')
  expect(opts.destination).to.be.a('string')
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
  extend(this, opts)
}

inherits(GCMConnection, Duplex)

GCMConnection.prototype._read = function (size) {}

GCMConnection.prototype._write = function (chunk, encoding, done) {
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
      data: curve.toBase64(new Uint8Array(chunk))
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
  expect(errorMessage).to.be.a('string')
  expect(errorMessage).to.have.length.of.at.least(1)
  this.emit('error', new Error(errorMessage))
  this.emit('end')
  this.emit('close')
}

module.exports = GCMTransport
