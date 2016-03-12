var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')

var FlunkyAPI = function (options) {
  this.platform = options.platform
  this.protocol = options.protocol
  var self = this
  EventEmitter.call(this, {
    delimiter: '.'
  })
  this.platform.on('message', function (message) {
    if (message.protocol === self.protocol) {
      self.emit(message.scope + '.' + message.topic, message.publicKey, message.payload)
    }
  })
}

inherits(FlunkyAPI, EventEmitter)

FlunkyAPI.prototype.send = function (topic, destination, payload, options) {
  this.platform.send({
    topic: topic,
    protocol: this.protocol,
    destination: destination,
    payload: payload
  }, options)
}

module.exports = FlunkyAPI
