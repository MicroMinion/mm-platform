'use strict'
var _ = require('lodash')

var Circle = function (messageName, platform) {
  this._keys = []
  platform.messaging.on('self.' + messageName, this._update.bind(this))
  platform.messaging.send(messageName + 'Request', 'local', {})
}

Circle.prototype._update = function (topic, publicKey, data) {
  this._keys = data
}

Circle.prototype.inScope = function (publicKey) {
  return _.includes(this._keys, publicKey)
}

module.exports = Circle
