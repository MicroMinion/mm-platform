'use strict'

var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var debug = require('debug')('flunky-platform:offline-buffer')
var _ = require('lodash')
var uuid = require('node-uuid')
var assert = require('assert')
var validation = require('./validation.js')

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
var MAX_EXPIRE_TIME = 1000 * 60 * 60 * 24 * 7

var OfflineBuffer = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'platform'))
  assert(_.has(options, 'storage'))
  this.platform = options.platform
  this.storage = options.storage
  EventEmitter.call(this)
  var self = this
  if (options.name) {
    this.name = options.name
  } else {
    this.name = 'offline'
  }
  this.platform.on('message', function (message) {
    assert(validation.validReceivedMessage(message))
    self.emit('message', message)
  })
  this.platform.on('connection', function (publicKey) {
    assert(validation.validKeyString(publicKey))
    self._flushQueue(publicKey)
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
  setInterval(function () {
    debug('trigger send queues periodically')
    _.forEach(_.keys(self.sendQueues), function (publicKey) {
      assert(validation.validKeyString(publicKey))
      self._trigger(publicKey)
    })
  }, SEND_INTERVAL)
}

inherits(OfflineBuffer, EventEmitter)

/**
 * Trigger sending of messages
 *
 * @private
 * @param {string} publicKey - publicKey of destination for which messages need to be send
 */
OfflineBuffer.prototype._trigger = function (publicKey) {
  debug('trigger')
  assert(validation.validKeyString(publicKey))
  if (this.sendQueues[publicKey] && _.size(this.sendQueues[publicKey]) > 0) {
    this._flushQueue(publicKey)
  }
}

OfflineBuffer.prototype.send = function (message, options) {
  console.log(message)
  assert(validation.validSendMessage(message))
  assert(validation.validOptions(options))
  var publicKey = message.destination
  if (!options) {
    options = {}
  }
  if (!options.realtime) {
    options.realtime = true
  }
  if (!options.expireAfter) {
    options.expireAfter = MAX_EXPIRE_TIME
  }
  if (!this.sendQueues[publicKey]) {
    this.sendQueues[publicKey] = {}
  }
  if (options.realtime) {
    this.platform.send(message, options)
  } else {
    var id = uuid.v4()
    options.timestamp = new Date().toJSON()
    this.sendQueues[publicKey][id] = {
      message: message,
      options: options
    }
    this._saveSendQueues()
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
  assert(validation.validKeyString(publicKey))
  var self = this
  _.forEach(this.sendQueues[publicKey], function (queueItem, id) {
    var options = queueItem.options
    var message = queueItem.message
    if (Math.abs(new Date() - new Date(options.timestamp)) < options.expireAfter) {
      debug('SEND: ' + JSON.stringify(message))
      var callback = function (err) {
        if (!err) {
          if (options.callback) {
            options.callback()
          }
          delete self.sendQueues[publicKey][id]
          self._saveSendQueues()
        }
      }
      self.platform.send(message, {
        callback: callback
      })
    } else {
      if (options.callback) {
        options.callback(new Error('Timeout'))
      }
      delete self.sendQueues[publicKey][id]
      self._saveSendQueues()
    }
  }, this)
}

/**
 * @private
 */
OfflineBuffer.prototype._loadSendQueues = function () {
  debug('loadSendQueues')
  var self = this
  var success = function (value) {
    debug('success in loading sendqueue')
    assert(validation.validString(value))
    value = JSON.parse(value)
    assert(_.isObject(value))
    _.foreach(value, function (publicKey) {
      assert(validation.validKeyString(publicKey))
      if (!_.has(self.sendQueues, publicKey)) {
        self.sendQueues[publicKey] = {}
      }
      _.forEach(value, function (message, uuid) {
        if (!_.has(self.sendQueues[publicKey], uuid)) {
          self.sendQueues[publicKey][uuid] = message
        }
      })
    })
    self._sendQueuesRetrieved = true
  }
  var error = function (errorMessage) {
    assert(_.isError(errorMessage))
    debug('error in loading sendqueue')
    debug(errorMessage)
    self._sendQueuesRetrieved = true
  }
  this.storage.get(this.name + 'Buffer', function (err, result) {
    if (err) {
      error(err)
    } else {
      success(result)
    }
  })
}

/**
 * @private
 */
OfflineBuffer.prototype._saveSendQueues = function () {
  debug('saveSendQueues')
  if (!this._sendQueuesRetrieved) {
    return
  }
  this.storage.put(this.name + 'Buffer', JSON.stringify(this.sendQueues))
}

module.exports = OfflineBuffer
