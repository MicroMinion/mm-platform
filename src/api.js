'use strict'

var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var validation = require('./validation.js')
var assert = require('assert')
var _ = require('lodash')

var API = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'platform'))
  assert(_.has(options, 'protocol'))
  assert(_.has(options, 'identity'))
  this.platform = options.platform
  this.protocol = options.protocol
  this.identity = options.identity
  var self = this
  EventEmitter.call(this, {
    delimiter: '.'
  })
  if (!options.serialize) {
    options.serialize = function (string) {
      return string
    }
  }
  this.serialize = options.serialize
  if (!options.deserialize) {
    options.deserialize = function (data) {
      return data
    }
  }
  this.deserialize = options.deserialize
  this.platform.on('message', function (message) {
    assert(validation.validProtocolObject(message))
    assert(_.has(message, 'sender'))
    assert(validation.validKeyString(message.sender))
    if (message.protocol === self.protocol) {
      var topic = message.scope + '.' + message.topic
      self.emit(topic, message.sender, self.deserialize(message.payload))
    }
  })
}

inherits(API, EventEmitter)

API.prototype.send = function (topic, destination, payload, options) {
  assert(validation.validString(topic))
  assert(validation.validLocalKeyString(destination))
//  assert.doesNotThrow(this.serialize.bind(payload))
  this.serialize.bind(payload)
  assert(_.isString(this.serialize(payload)))
  assert(validation.validOptions(options))
  var self = this
  if (this._isLocal(destination)) {
    process.nextTick(function () {
      self.emit('self.' + topic, destination, payload)
      if (options && options.callback) {
        options.callback()
      }
    })
    return
  }
  this.platform.send({
    topic: topic,
    protocol: this.protocol,
    destination: destination,
    payload: this.serialize(payload)
  }, options)
}

/**
 * @private
 */
API.prototype._isLocal = function (publicKey) {
  assert(validation.validLocalKeyString(publicKey))
  if (publicKey === 'local') {
    return true
  }
  if (this.identity) {
    return this.identity.getSignId() === publicKey
  }
  return false
}

module.exports = API
