'use strict'
var _ = require('lodash')
var debug = require('debug')('flunky-platform:services:events')

var SUBSCRIPTION_TIMEOUT = 1000 * 60 * 5

var Events = function (messaging) {
  var events = this
  this.messaging = messaging
  this.subscribers = {}
  this.messaging.on('self.*', this.processEvent.bind(this))
  this.messaging.on('self.events.subscribe', this.subscribe.bind(this))
  setInterval(function () {
    _.forEach(events.subscribers, function (subscribers, topic) {
      _.forEach(subscribers, function (date, subscriberKey) {
        if (Math.abs(new Date() - date) > SUBSCRIPTION_TIMEOUT) {
          delete events.subscribers[topic][subscriberKey]
        }
      })
      if (_.size(_.keys(events.subscribers[topic])) === 0) {
        delete events.subscribers[topic]
      }
    })
  }, SUBSCRIPTION_TIMEOUT)
}

Events.prototype.processEvent = function (topic, publicKey, data) {
  // debug('processEvent')
  topic = topic.replace('self.', '')
  if (publicKey !== 'local') { return }
  if (_.has(this.subscribers, topic)) {
    debug('processEvent - has subscribers')
    _.forEach(this.subscribers[topic], function (date, subscriberKey) {
      debug('send message to subscriber ' + subscriberKey)
      this.messaging.send(topic, subscriberKey, data, {realtime: true, expireAfter: 2000})
    }, this)
  }
}

Events.prototype.subscribe = function (topic, publicKey, data) {
  debug('subscribe')
  debug(publicKey)
  debug(data)
  if (topic !== 'self.events.subscribe') { return }
  if (!_.has(this.subscribers, data.topic)) {
    this.subscribers[data.topic] = {}
  }
  if (!_.has(this.subscribers[data.topic], publicKey)) {
    this.subscribers[data.topic][publicKey] = {}
  }
  this.subscribers[data.topic][publicKey] = new Date()
}

module.exports = Events
