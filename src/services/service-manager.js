'use strict'

var ServiceManager = function (messaging) {
  this.messaging = messaging
  this.messaging.on('self.profile.updateRequest', function (topic, publicKey, data) {
    console.log('updaterequest received!!!!')
  })
  this.messaging.send('system.readyRequest', 'local', {})
  this.messaging.send('profile.updateRequest', 'local', {})
  this.messaging.on('self.system.ready', this.onSystemReady.bind(this))
}

ServiceManager.prototype.onSystemReady = function (topic, publicKey, data) {
  this.sendActivate('flunky-platform')
  this.sendActivate('profile')
  this.sendActivate('service-manager')
  this.sendActivate('system')
}

ServiceManager.prototype.sendActivate = function (service) {
  this.messaging.send('system.activate', 'local', service)
}

module.exports = ServiceManager
