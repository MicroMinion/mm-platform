var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var expect = require('chai').expect
var debug = require('debug')('flunky-platform:offline-buffer')
var _ = require('lodash')
var Q = require('q')
var nacl = require('tweetnacl')

/**
 * Interval for triggering send queues in milliseconds
 *
 * @constant
 * @default
 * @type {number}
 * @private
 * @readonly
 */
var SEND_INTERVAL = 1000 * 10

/**
 * Maximum timespan for message delivery
 *
 * @constant
 * @default
 * @type {number}
 * @private
 * @readonly
 */
// var MAX_EXPIRE_TIME = 1000 * 60 * 60 * 24 * 7

var OfflineBuffer = function (options) {
  this.platform = options.platform
  this.storage = options.storage
  EventEmitter.call(this)
  var self = this
  this.platform.on('message', function (message) {
    self.emit('message', message)
  })

  /**
   * Queue of messages that still need to be send, key is publicKey of destination
   * Per destination, messages are indexed by message id
   *
   * @access private
   * @type {Object.<string, Object.<string, Object>>}
   */
  this.storage = options.storage
  this.sendQueues = {}
  this._sendQueuesRetrieved = false
  this._loadSendQueues()
  this.on('self.transport.connection', function (topic, local, publicKey) {
    self._flushQueue(publicKey)
  })
  setInterval(function () {
    debug('trigger send queues periodically')
    _.forEach(_.keys(self.sendQueues), function (publicKey) {
      self._trigger(publicKey)
    })
  }, SEND_INTERVAL)
}

inherits(OfflineBuffer, EventEmitter)

OfflineBuffer.prototype.send = function (message, options) {
  // TODO: Implement offline behavior
  var self = this
  var publicKey = message.destination
  if (!options.realtime) {
    options.realtime = true
  }
  if (!this.sendQueues[publicKey]) {
    this.sendQueues[publicKey] = {}
  }
  this.sendQueues[publicKey][message.id] = message
  setTimeout(function () {
    if (_.has(self.sendQueues[publicKey], message.id)) {
      delete self.sendQueues[publicKey][message.id]
    }
  }, message.expireAfter)
  this._saveSendQueues([publicKey])
  if (options.realtime) {
    process.nextTick(this._trigger.bind(this, publicKey))
  }
  this.platform.send(message, options)
}

/**
 * @private
 */
OfflineBuffer.prototype._loadSendQueues = function () {
  debug('loadSendQueues')
  var messaging = this
  var options = {
    success: function (value) {
      debug('success in loading sendqueue')
      value = JSON.parse(value)
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
      debug('error in loading sendqueue')
      debug(errorMessage)
      messaging._sendQueuesRetrieved = true
    }
  }
  Q.nfcall(this.storage.get.bind(this.storage), 'flunky-messaging-sendQueues').then(options.success, options.error)
}

/**
 * @private
 */
OfflineBuffer.prototype._saveSendQueues = function (publicKeys) {
  debug('saveSendQueues')
  expect(publicKeys).to.be.an('array')
  if (!this._sendQueuesRetrieved) {
    return
  }
  this.storage.put('flunky-messaging-sendQueues', JSON.stringify(this.sendQueues))
}

/**
 * Trigger sending of messages
 *
 * @private
 * @param {string} publicKey - publicKey of destination for which messages need to be send
 */
OfflineBuffer.prototype._trigger = function (publicKey) {
  debug('trigger')
  expect(publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
  if (this.sendQueues[publicKey] && _.size(this.sendQueues[publicKey]) > 0) {
    this._flushQueue(publicKey)
  }
}

/**
 * Flush message queue: send all messages which have not expired
 *
 * @param {string} publicKey - destination
 * @private
 */
OfflineBuffer.prototype._flushQueue = function (publicKey) {
  debug('flushQueue')
  expect(publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
  var messaging = this
  _.forEach(this.sendQueues[publicKey], function (message) {
    if (Math.abs(new Date() - new Date(message.timestamp)) < message.expireAfter) {
      debug('SEND: ' + JSON.stringify(message))
      this.dispatcher.send(publicKey, new Buffer(JSON.stringify(message)))
        .then(function () {
          delete messaging.sendQueues[publicKey][message.id]
          messaging._saveSendQueues([publicKey])
        })
        .fail(function (error) {
          debug('message sending failed')
          debug(error)
        })
        .done()
    }
  }, this)
}

module.exports = OfflineBuffer
