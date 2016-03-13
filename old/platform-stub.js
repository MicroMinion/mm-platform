var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')

var MAX_EXPIRE_TIME = 1000 * 60 * 60 * 24 * 7

var Platform = {
  messaging = new Messaging()
}

Platform.prototype.enable = function() {}
Platform.prototype.disable = function() {}

var messagers = {}

inherits(Dispatcher, EventEmitter)

var Messaging = {
  var messaging = this
  this.profile = undefined
  this.on('self.profile.update', function(topic, publicKey, data) {
    messaging.profile = data
    messagers[messaging.profile.publicKey] = messaging
  })
}

inherits(Messaging, EventEmitter)

Messaging.prototype.send = function(topic, publicKey, data, options) {
  var messaging = this
  if(!options) { options = {}}
  if(!options.realtime) {
    options.realtime = true
  }
  var message = {
    id: options.id ? options.id : uuid.v4(),
    topic: topic,
    data: data,
    timestamp: new Date().toJSON(),
    expireAfter: options.expireAfter ? options.expireAfter : MAX_EXPIRE_TIME
  }
  if(this._isLocal(publicKey)) {
    process.nextTick(function() {
      messaging.emit('self.' + topic, publicKey, data)
    })
    return
  }
  process.nextTick(function() {
      messagers[publicKey].emit('public.' + topic, publicKey, data)
  })
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

module.exports = Platform
