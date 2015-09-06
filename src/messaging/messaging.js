var uuid = require('node-uuid')
var _ = require('lodash')
var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var chai = require('chai')
var curve = require('curve-protocol')
var TransportManager = require('./transport-manager.js')
var storagejs = require('storagejs')
var parallel = require('run-parallel')

var expect = chai.expect

// TODO: Filter out only trusted keys when receicing devices or contacts so that receive logic becomes simpeler

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
 * Enum for potential verification states of users or keys
 *
 * @readonly
 * @enum {number}
 * @constant
 * @default
 * @public
 */
var verificationState = require('../constants/verificationState.js')

/**
 * Messaging API that allows to send/receive messages using only a public key as identifier
 * Connection information is fetched from a diectory service.
 *
 * @constructor
 * @public
 */
var Messaging = function () {
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
   * List of devices that belong to the current user
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.devices = {}
  this.on('self.devices.update', function (topic, publicKey, data) {
    messaging.setDevices(data)
  })
  /**
   * List of trusted contacts
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.contacts = {}
  this.on('self.contacts.update', function (topic, publicKey, data) {
    messaging.setContacts(data)
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
  /**
   * Flag to indicate whether the transport for sending messages is available or not
   *
   * @access private
   * @type {boolean}
   */
  this.transportAvailable = false
  /**
   * Interface for actually sending/receiving messages. This can be either an aggregator object that dispaches between
   * different transport mechanisms or one transport mechanism (as long as they use the same interface / generate the same
   * events
   *
   * @access private
   * @type {TransportManager}
   *
   */
  this.transportManager = undefined
  setInterval(function () {
    if (messaging.transportAvailable) {
      _.forEach(_.keys(messaging.sendQueues), function (publicKey) {
        messaging._trigger(publicKey)
      })
    }
  }, SEND_INTERVAL)
}

inherits(Messaging, EventEmitter)

/**
 * PERSISTENCE
 */

Messaging.prototype._loadSendQueues = function () {
  var messaging = this
  var options = {
    success: function (value) {
      expect(value).to.be.a('string')
      value = JSON.parse(value)
      expect(value).to.be.an('array')
      var parallelFunctions = []
      _.forEach(value, function (publicKey) {
        expect(publicKey).to.be.a('string')
        expect(curve.fromBase64(publicKey)).to.have.length(32)
        if (!_.has(messaging.sendQueues, publicKey)) {
          messaging.sendQueues[publicKey] = {}
        }
        var callBackfunction = function (callback) {
          var publicKeyoptions = {
            success: function (value) {
              expect(value).to.be.an('object')
              _.forEach(value, function (message, uuid) {
                if (!_.has(messaging.sendQueues[publicKey][uuid])) {
                  messaging.sendQueues[publicKey][uuid] = message
                }
              })
              callback(null, publicKey)
            },
            error: function (errorMessage) {
              console.log('unable to retrieve sendQueue for ' + publicKey)
              console.log(errorMessage)
              callback(errorMessage, null)
            }
          }
          storagejs.get('flunky-messaging-sendQueues-' + publicKey, publicKeyoptions)
        }
        parallelFunctions.push(callBackfunction)
      })
      parallel(parallelFunctions, function (err, results) {
        messaging._sendQueuesRetrieved = true
        messaging._saveSendQueues(_.keys(messaging.sendQueues))
      })
    },
    error: function (errorMessage) {
      console.log('unable to retrieve flunky-messaging-sendQueues')
      console.log(errorMessage)
      messaging._sendQueuesRetrieved = true
    }
  }
  storagejs.get('flunky-messaging-sendQueues', options)
}

Messaging.prototype._saveSendQueues = function (publicKeys) {
  expect(publicKeys).to.be.an('array')
  if (!this._sendQueuesRetrieved) {
    return
  }
  storagejs.put('flunky-messaging-sendQueues', JSON.stringify(_.keys(this.sendQueues)))
  _.forEach(publicKeys, function (publicKey) {
    expect(publicKey).to.be.a('string')
    expect(curve.fromBase64(publicKey)).to.have.length(32)
    if (_.has(this.sendQueues, publicKey)) {
      storagejs.put('flunky-messaging-sendQueues-' + publicKey, this.sendQueues[publicKey])
    } else {
      storagejs.delete('flunky-messaging-sendQueues-' + publicKey)
    }
  }, this)
}

/**
 * TRANSPORT MANAGER
 */

/**
 * Manually disable transportManager
 *
 * @public
 */
Messaging.prototype.disable = function () {
  if (this.transportManager) {
    this.transportManager.disable()
  }
}

/**
 * Manually enable transportManager
 *
 * @public
 */
Messaging.prototype.enable = function () {
  if (this.transportManager) {
    this.transportManager.enable()
  }
}

Messaging.prototype._setupTransportManager = function (profile) {
  var messaging = this
  if (this.transportManager) {
    this.transportAvailable = false
    this.transportManager.disable()
    this.transportManager.removeAllListeners()
  }
  this.transportManager = new TransportManager(this, profile.publicKey, profile.privateKey)
  this.transportManager.on('ready', function (connectionInfo) {
    expect(connectionInfo).to.be.an('object')
    expect(messaging.transportAvailable).to.be.false
    messaging.transportAvailable = true
  })
  this.transportManager.on('disable', function () {
    expect(messaging.transportAvailable).to.be.true
    messaging.transportAvailable = false
  })
  this.transportManager.on('connectionEstablished', function (publicKey) {
    expect(publicKey).to.be.a('string')
    expect(curve.fromBase64(publicKey)).to.have.length(32)
    messaging._flushQueue(publicKey)
  })
  this.transportManager.on('message', function (publicKey, message) {
    expect(publicKey).to.be.a('string')
    expect(curve.fromBase64(publicKey)).to.have.length(32)
    message = JSON.parse(message)
    var scope = messaging._getScope(publicKey)
    console.log('message received')
    console.log(scope + '.' + message.topic)
    console.log(message)
    messaging.emit(scope + '.' + message.topic, publicKey, message.data)
  })
}

/**
 * PROFILE, CONTACTS, DEVICES
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
  expect(profile).to.exist
  expect(profile).to.be.an('object')
  expect(profile.publicKey).to.be.a('string')
  expect(profile.privateKey).to.be.a('string')
  expect(curve.fromBase64(profile.publicKey)).to.have.length(32)
  expect(curve.fromBase64(profile.privateKey)).to.have.length(32)
  if (!this.profile || this.profile.privateKey !== profile.privateKey) {
    this._setupTransportManager(profile)
  }
  this.profile = profile
}

/**
 * Set contacts that we consider to be trusted.
 * Messages from these contacts will be triggered in the "Friends" namespace
 *
 * @param {Object.<string, Object>} contacts
 * @public
 */
Messaging.prototype.setContacts = function (contacts) {
  this.contacts = contacts
}

/**
 * Set devices that we consider to be trusted
 * Messages from these devices will be triggered in the 'Self' namespace
 *
 * @param {Object.<string, Object>} devices
 * @public
 */
Messaging.prototype.setDevices = function (devices) {
  this.devices = devices
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
  var messaging = this
  expect(publicKey).to.be.a('string')
  expect(publicKey === 'local' || curve.fromBase64(publicKey).length === 32).to.be.true
  expect(topic).to.be.a('string')
  if (options) { expect(options).to.be.an('object') } else { options = {} }
  if (options.realtime) { expect(options.realtime).to.be.a('boolean') }
  if (options.expireAfter) { expect(options.expireAfter).to.be.a('number') }
  var message = {
    id: options.id ? options.id : uuid.v4(),
    topic: topic,
    data: data,
    timestamp: new Date().toJSON(),
    expireAfter: options.expireAfter ? options.expireAfter : MAX_EXPIRE_TIME
  }
  if (this._isLocal(publicKey)) {
    this.emit('self.' + topic, publicKey, data)
    return
  }
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
  expect(publicKey).to.be.a('string')
  expect(curve.fromBase64(publicKey)).to.have.length(32)
  if (this.sendQueues[publicKey] && _.size(this.sendQueues[publicKey]) > 0 && this.transportAvailable) {
    if (this.transportManager.isConnected(publicKey)) {
      this._flushQueue(publicKey)
    } else {
      this.transportManager.connect(publicKey)
        .then(this._flushQueue.bind(publicKey))
    }
  }
}

/**
 * Flush message queue: send all messages which have not expired
 *
 * @param {string} publicKey - destination
 * @private
 */
Messaging.prototype._flushQueue = function (publicKey) {
  // TODO: take Promise returned from send into account to make sure that message can actually be deleted
  expect(publicKey).to.be.a('string')
  expect(curve.fromBase64(publicKey)).to.have.length(32)
  expect(this.transportAvailable).to.be.true
  expect(this.transportManager.isConnected(publicKey)).to.be.true
  _.forEach(this.sendQueues[publicKey], function (message) {
    if (Math.abs(new Date() - new Date(message.timestamp)) < message.expireAfter) {
      console.log('send messsage')
      console.log(message.topic)
      console.log(message)
      this.transportManager.send(publicKey, JSON.stringify(message))
    }
  }, this)
  delete this.sendQueues[publicKey]
  this._saveSendQueues([publicKey])
}

/**
 * RECEIVE LOGIC
 */

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
Messaging.prototype._getScope = function (publicKey) {
  expect(publicKey).to.be.a('string')
  expect(curve.fromBase64(publicKey)).to.have.length(32)
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
Messaging.prototype._inScope = function (publicKey, searchObject) {
  return _.any(searchObject, function (value, index, collection) {
    return index === publicKey && value.verificationState >= verificationState.VERIFIED
  })
}

module.exports = Messaging
