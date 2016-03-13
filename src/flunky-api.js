var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')

var FlunkyAPI = function (options) {
  this.platform = options.platform
  this.protocol = options.protocol
  this.identity = options.identity
  var self = this
  EventEmitter.call(this, {
    delimiter: '.'
  })
  this.platform.on('message', function (message) {
    if (message.protocol === self.protocol) {
      self.emit(message.scope + '.' + message.topic, message.sender, message.payload)
    }
  })
}

inherits(FlunkyAPI, EventEmitter)

FlunkyAPI.prototype.send = function (topic, destination, payload, options) {
  var self = this
  if (this._isLocal(destination)) {
    process.nextTick(function () {
      self.emit('self.' + topic, destination, payload)
    })
    return
  }
  this.platform.send({
    topic: topic,
    protocol: this.protocol,
    destination: destination,
    payload: payload
  }, options)
}

/**
 * @private
 */
FlunkyAPI.prototype._isLocal = function (publicKey) {
  debug('isLocal')
  if (publicKey === 'local') {
    return true
  }
  if (this.profile) {
    return this.identity.publicKey === publicKey
  }
  return false
}

module.exports = FlunkyAPI
