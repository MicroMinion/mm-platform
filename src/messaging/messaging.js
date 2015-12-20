var uuid = require('node-uuid')
var _ = require('lodash')
var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var chai = require('chai')
var ProtocolDispatcher = require('./protocol-dispatcher.js')
var nacl = require('tweetnacl')
var storagejs = require('storagejs')
var debug = require('debug')('flunky-platform:messaging:messaging')
var debugMessage = require('debug')('flunky-platform:messages')

var expect = chai.expect

var PROTOCOL = 'ms'

/**
 * Interval for triggering send queues in milliseconds
 *
 * @constant
 * @default
 * @type {number}
 * @public
 * @readonly
 */
var SEND_INTERVAL = 1000 * 10

/**
 * Maximum timespan for message delivery
 *
 * @constant
 * @default
 * @type {number}
 * @public
 * @readonly
 */
var MAX_EXPIRE_TIME = 1000 * 60 * 60 * 24 * 7

/**
 * Messaging API that allows to send/receive messages using only a public key as identifier
 * Connection information is fetched from a diectory service.
 *
 * @constructor
 * @public
 */
var Messaging = function (dispatcher) {
  EventEmitter.call(this, {
    delimiter: '.'
  })
  /**
   * Reference to ourselves for use in event handlers below
   * @access private
   * @type {Messaging}
   */
  var messaging = this
  /**
   * A user's profile which includes publicKey and privateKey
   *
   * @access private
   * @type {Object}
   */
  this.profile = undefined
  this.on('self.profile.update', function (topic, publicKey, data) {
    messaging.setProfile(data)
  })

  /**
   * Queue of messages that still need to be send, key is publicKey of destination
   * Per destination, messages are indexed by message id
   *
   * @access private
   * @type {Object.<string, Object.<string, Object>>}
   */
  this.sendQueues = {}
  this._sendQueuesRetrieved = false
  this._loadSendQueues()
  this.on('self.transport.connection', function (topic, local, publicKey) {
    messaging._flushQueue(publicKey)
  })
  /**
   * Interface for actually sending/receiving messages
   *
   * @access private
   * @type {ProtocolDispatcher}
   *
   */
  this.dispatcher = dispatcher
  this._setupDispatcher()
  setInterval(function () {
    debug('trigger send queues periodically')
    _.forEach(_.keys(messaging.sendQueues), function (publicKey) {
      messaging._trigger(publicKey)
    })
  }, SEND_INTERVAL)
}

inherits(Messaging, EventEmitter)

/**
 * PERSISTENCE
 */

Messaging.prototype._loadSendQueues = function () {
  debug('loadSendQueues')
  var messaging = this
  var options = {
    success: function (value) {
      expect(value).to.be.an('object')
      _.foreach(value, function (publicKey) {
        expect(publicKey).to.be.a('string')
        expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
        if (!_.has(messaging.sendQueues, publicKey)) {
          messaging.sendQueues[publicKey] = {}
        }
        _.forEach(value, function (message, uuid) {
          if (!_.has(messaging.sendQueues[publicKey][uuid])) {
            messaging.sendQueues[publicKey][uuid] = message
          }
        })
      })
      messaging._sendQueuesRetrieved = true
    },
    error: function (errorMessage) {
      messaging._sendQueuesRetrieved = true
    }
  }
  storagejs.get('flunky-messaging-sendQueues').then(options.success, options.error)
}

Messaging.prototype._saveSendQueues = function (publicKeys) {
  debug('saveSendQueues')
  expect(publicKeys).to.be.an('array')
  if (!this._sendQueuesRetrieved) {
    return
  }
  storagejs.put('flunky-messaging-sendQueues', this.sendQueues)
}

/**
 * DISPATCHER
 */

/**
 * Manually disable dispatcher
 *
 * @public
 */
Messaging.prototype.disable = function () {
  this.dispatcher.disable()
}

/**
 * Manually enable dispatcher
 *
 * @public
 */
Messaging.prototype.enable = function () {
  this.dispatcher.enable()
}

Messaging.prototype._setupDispatcher = function () {
  var messaging = this
  if (_.isUndefined(this.dispatcher)) {
    this.dispatcher = new ProtocolDispatcher(this)
  }
  this.dispatcher.on(PROTOCOL, function (scope, publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
    try {
      message = JSON.parse(message.toString())
    } catch (e) {
      debug(e)
      return
    }
    debugMessage('RECEIVED ' + scope + '.' + message.topic + ' from ' + publicKey + ' (' + JSON.stringify(message) + ')')
    messaging.emit(scope + '.' + message.topic, publicKey, message.data)
  })
}

/**
 * PROFILE
 */

/**
 * Set profile
 *
 * @param {Object} profile - Profile object of application user
 * @param {string} profile.publicKey - Base64 encoded publicKey for use with Nacl libraries
 * @param {String} profile.privateKey - Base64 encoded privateKey for use with Nacl libraries
 * @public
 */
Messaging.prototype.setProfile = function (profile) {
  debug('setProfile')
  expect(profile).to.exist
  expect(profile).to.be.an('object')
  expect(profile.publicKey).to.be.a('string')
  expect(profile.privateKey).to.be.a('string')
  expect(nacl.util.decodeBase64(profile.publicKey)).to.have.length(32)
  expect(nacl.util.decodeBase64(profile.privateKey)).to.have.length(32)
  this.profile = profile
}

/**
 * SEND LOGIC
 */

/**
 * Deliver a message to another instance defined by its public key
 *
 * @param {string} publicKey - publicKey of destination
 * @param {string} topic - topic of destination "." is used as delimiter
 * @param {Object} data - message data - needs to be json serializable
 * @param {Object} options - delivery options
 * @param {boolean=} [options.realtime=false] - flag to indicate if delivery should be attempted immediatly or on next queue flush
 * @param {number=} [options.expireAfter=MAX_EXPIRE_TIME] - flag to indicate how long message delivery should be tried
 * @public
 */
Messaging.prototype.send = function (topic, publicKey, data, options) {
  debug('send')
  var messaging = this
  expect(publicKey).to.be.a('string')
  expect(publicKey === 'local' || nacl.util.decodeBase64(publicKey).length === 32).to.be.true
  expect(topic).to.be.a('string')
  if (options) { expect(options).to.be.an('object') } else { options = {} }
  if (options.realtime) { expect(options.realtime).to.be.a('boolean') }
  if (options.expireAfter) { expect(options.expireAfter).to.be.a('number') }
  if (!options.realtime) {
    options.realtime = true
  }
  var message = {
    id: options.id ? options.id : uuid.v4(),
    topic: topic,
    data: data,
    timestamp: new Date().toJSON(),
    expireAfter: options.expireAfter ? options.expireAfter : MAX_EXPIRE_TIME
  }
  if (this._isLocal(publicKey)) {
    process.nextTick(function () {
      messaging.emit('self.' + topic, publicKey, data)
    })
    return
  }
  // debugMessage('queuing message ' + topic + ' to ' + publicKey + '(' + JSON.stringify(data) + ')')
  if (!this.sendQueues[publicKey]) {
    this.sendQueues[publicKey] = {}
  }
  this.sendQueues[publicKey][message.id] = message
  setTimeout(function () {
    if (_.has(messaging.sendQueues[publicKey], message.id)) {
      delete messaging.sendQueues[publicKey][message.id]
    }
  }, message.expireAfter)
  this._saveSendQueues([publicKey])
  if (options.realtime) {
    process.nextTick(this._trigger.bind(this, publicKey))
  }
}

Messaging.prototype._isLocal = function (publicKey) {
  debug('isLocal')
  if (publicKey === 'local') {
    return true
  }
  if (this.profile) {
    return this.profile.publicKey === publicKey
  }
  return false
}

/**
 * Trigger sending of messages
 *
 * @private
 * @param {string} publicKey - publicKey of destination for which messages need to be send
 */
Messaging.prototype._trigger = function (publicKey) {
  debug('trigger')
  expect(publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
  if (this.sendQueues[publicKey] && _.size(this.sendQueues[publicKey]) > 0) {
    this.dispatcher.connect(publicKey)
  }
}

/**
 * Flush message queue: send all messages which have not expired
 *
 * @param {string} publicKey - destination
 * @private
 */
Messaging.prototype._flushQueue = function (publicKey) {
  debug('flushQueue')
  expect(publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
  var messaging = this
  _.forEach(this.sendQueues[publicKey], function (message) {
    if (Math.abs(new Date() - new Date(message.timestamp)) < message.expireAfter) {
      debugMessage('SEND: ' + JSON.stringify(message))
      this.dispatcher.send(PROTOCOL, publicKey, new Buffer(JSON.stringify(message)))
        .then(function () {
          delete messaging.sendQueues[publicKey][message.id]
          messaging._saveSendQueues([publicKey])
        })
        .fail(function (error) {
          debugMessage('message sending failed')
          debugMessage(error)
        })
        .done()
    }
  }, this)
}

module.exports = Messaging
