var _ = require('lodash')
var debug = require('debug')('flunky-platform:services:directory')

var DirectoryClient = function (messaging, serverKey, serverConnectionInfo) {
  this.messaging = messaging
  this.serverKey = serverKey
  this.messaging.on('self.directory.get', this.get.bind(this))
  this.messaging.on('self.directory.put', this.put.bind(this))
  this.messaging.on('self.directoryServer.getReply', this.getReply.bind(this))
  this.messaging.on('friends.directoryServer.getReply', this.getReply.bind(this))
  this.messaging.on('public.directoryServer.getReply', this.getReply.bind(this))
  serverConnectionInfo.publicKey = serverKey
  this.messaging.send('messaging.connectionInfo', 'local', {publicKey: serverKey, connectionInfo: serverConnectionInfo})
}

DirectoryClient.prototype.put = function (topic, publicKey, data) {
  this.messaging.send('directoryServer.put', this.serverKey, data)
}

DirectoryClient.prototype.get = function (topic, publicKey, data) {
  this.messaging.send('directoryServer.get', this.serverKey, data)
}

DirectoryClient.prototype.getReply = function (topic, publicKey, data) {
  if (publicKey === this.serverKey) {
    this.messaging.send('directory.getReply', 'local', data)
  }
}

var DirectoryServer = function (messaging) {
  this.messaging = messaging
  this.state = {}
  this.messaging.on('self.directoryServer.get', this.processGet.bind(this))
  this.messaging.on('friends.directoryServer.get', this.processGet.bind(this))
  this.messaging.on('public.directoryServer.get', this.processGet.bind(this))
  this.messaging.on('self.directoryServer.put', this.processPut.bind(this))
  this.messaging.on('friends.directoryServer.put', this.processPut.bind(this))
  this.messaging.on('public.directoryServer.put', this.processPut.bind(this))
}

DirectoryServer.prototype.processGet = function (topic, publicKey, data) {
  if (_.has(this.state, data.key)) {
    this.messaging.send('directoryServer.getReply', publicKey, {key: data.key, value: this.state[data.key]})
  }
}

DirectoryServer.prototype.processPut = function (topic, publicKey, data) {
  debug('processPut ' + data.key + ' ' + data.value)
  this.state[data.key] = data.value
}

module.exports = {
  DirectoryClient: DirectoryClient,
  DirectoryServer: DirectoryServer
}
