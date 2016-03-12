var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')

var OfflineBuffer = function (options) {
  this.platform = options
  EventEmitter.call(this)
  var self = this
  this.platform.on('message', function (message) {
    self.emit('message', message)
  })
}

inherits(OfflineBuffer, EventEmitter)

OfflineBuffer.prototype.send = function (message, options) {
  // TODO: Implement offline behavior
  this.platform.send(message, options)
}

module.exports = OfflineBuffer
