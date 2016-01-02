var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var TransportManager = require('./transport-manager.js')
var debug = require('debug')('flunky-platform:protocol-dispatcher')
var isBuffer = require('is-buffer')
var ns = require('.util/ns.js')
var nacl = require('tweetnacl')

// TODO: Filter out only trusted keys when receicing devices or contacts so that receive logic becomes simpeler

var expect = require('chai').expect

/**
 * Enum for potential verification states of users or keys
 *
 * @readonly
 * @enum {number}
 * @constant
 * @default
 * @public
 */
var verificationState = require('../constants/verificationState.js')

var ProtocolDispatcher = function (options) {
  debug('initialize')
  this.options = options
  EventEmitter.call(this)
  this.transportManager
  this._setupTransportManager()
  this.buffers = {}
  /**
   * List of devices that belong to the current user
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.devices = {}
  /**
   * List of trusted contacts
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.contacts = {}
}

inherits(ProtocolDispatcher, EventEmitter)

ProtocolDispatcher.prototype.setMessaging = function (messaging) {
  var dispatcher = this
  messaging.on('self.devices.update', function (topic, publicKey, data) {
    dispatcher._setDevices(data)
  })
  messaging.on('self.contacts.update', function (topic, publicKey, data) {
    dispatcher._setContacts(data)
  })
  this.transportManager.setMessaging(messaging)
}

ProtocolDispatcher.prototype._setupTransportManager = function () {
  var dispatcher = this
  this.transportManager = new TransportManager(this.options)
  this.transportManager.on('message', function (publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(isBuffer(message)).to.be.true
    debug('message event')
    debug('message length: ' + message.length)
    if (_.has(dispatcher.buffers, publicKey)) {
      dispatcher.buffers[publicKey] = Buffer.concat([dispatcher.buffers[publicKey], message])
    } else {
      dispatcher.buffers[publicKey] = message
    }
    try {
      dispatcher._processBuffer(publicKey)
    } catch (e) {
      debug(e)
      delete dispatcher.buffers[publicKey]
    }
  })
}

ProtocolDispatcher.prototype._processBuffer = function (publicKey) {
  expect(publicKey).to.be.a('string')
  debug('_processBuffer')
  var buffer = this.buffers[publicKey]
  if (buffer.length === 0) {
    return
  }
  var messageLength = ns.nsLength(buffer)
  debug('message length: ' + messageLength)
  debug('buffer length: ' + buffer.length)
  if (buffer.length >= messageLength) {
    this._processMessage(publicKey, ns.nsPayload(buffer))
    this.buffers[publicKey] = new Buffer(buffer.length - messageLength)
    buffer.copy(this.buffers[publicKey], 0, messageLength)
    debug('buffer length after processing: ' + this.buffers[publicKey].length)
    this._processBuffer(publicKey)
  }
}

ProtocolDispatcher.prototype._processMessage = function (publicKey, message) {
  expect(publicKey).to.be.a('string')
  expect(isBuffer(message)).to.be.true
  debug('_processMessage')
  var protocol = message.toString('utf-8', 0, 2)
  debug(protocol)
  var scope = this._getScope(publicKey)
  this.emit(protocol, scope, publicKey, message.slice(2))
}

ProtocolDispatcher.prototype.send = function (protocol, publicKey, message) {
  debug('send')
  expect(protocol).to.be.a('string')
  expect(protocol.length).to.equal(2)
  expect(publicKey).to.be.a('string')
  expect(isBuffer(message)).to.be.true
  expect(message.length).to.be.greaterThan(0)
  var buffer = Buffer.concat([new Buffer(protocol), message])
  return this.transportManager.send(publicKey, ns.nsWrite(buffer))
}

/**
 * Set contacts that we consider to be trusted.
 * Messages from these contacts will be triggered in the "Friends" namespace
 *
 * @param {Object.<string, Object>} contacts
 * @public
 */
ProtocolDispatcher.prototype._setContacts = function (contacts) {
  debug('setContacts')
  this.contacts = contacts
}

/**
 * Set devices that we consider to be trusted
 * Messages from these devices will be triggered in the 'Self' namespace
 *
 * @param {Object.<string, Object>} devices
 * @public
 */
ProtocolDispatcher.prototype._setDevices = function (devices) {
  debug('setDevices')
  this.devices = devices
}

/**
 * SCOPING LOGIC
 */

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
ProtocolDispatcher.prototype._getScope = function (publicKey) {
  debug('getScope')
  expect(publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
  if (this._inScope(publicKey, this.devices)) {
    return 'self'
  } else {
    var friends = _.any(_.values(this.contacts), function (value, index, collection) {
      return this._inScope(publicKey, value.keys)
    }, this)
    if (friends) {
      return 'friends'
    } else {
      return 'public'
    }
  }
}

/**
 * @private
 * @param {string} publicKey
 * @param {Object} searchObject
 * @return {boolean} true or false if the publicKey is a property of searchObject and it's verificationState is verified
 */
ProtocolDispatcher.prototype._inScope = function (publicKey, searchObject) {
  debug('inScope')
  return _.any(searchObject, function (value, index, collection) {
    return index === publicKey && value.verificationState >= verificationState.VERIFIED
  })
}

module.exports = ProtocolDispatcher
