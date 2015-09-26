'use strict'

var mosca = require('mosca')
var ProtocolDispatcher = require('../messaging/protocol-dispatcher.js')
var Messaging = require('../messaging/messaging.js')
var Torrenting = require('../messaging/torrenting.js')

var Server = function () {
  this.dispatcher = new ProtocolDispatcher()
  this.protocols = {}
  this.protocols['MS'] = new Messaging(this.dispatcher)
  this.protocols['BT'] = new Torrenting(this.dispatcher)
  this.messaging = this.protocols['MS']
  this.messaging.on('*', this.dispatchMessage.bind(this))
  this.torrenting = this.protocols['BT']
  this.torrenting.on('*', this.dispatchTorrent.bind(this))
  this.dispatcher.setMessaging(this.messaging)
  this._setupMosca()
}

Server.prototype._setupMosca = function () {
  var moscaSettings = {
    port: 65432,
    backend: {}
  }
  this.server = new mosca.Server(moscaSettings)
  this.server.on('published', this.onPublish.bind(this))
}

Server.prototype.onPublish = function (packet, client) {
  var topicSplit = packet.topic.split('/')
  var protocol = topicSplit[1]
  var topic = topicSplit[2]
  var publicKey = topicSplit[3]
  this.protocols[protocol].send(topic, publicKey, packet.payload)
}

Server.prototype.dispatchTorrent = function (topic, publicKey, data) {
  this._dispatch('BT', topic, publicKey, data)
}

Server.prototype.dispatchMessage = function (topic, publicKey, data) {
  this._dispatch('MS', topic, publicKey, data)
}

Server.prototype._dispatch = function (protocol, topic, publicKey, data) {
  var message = {
    topic: '/' + protocol + '/' + topic + '/' + publicKey,
    payload: data,
    qos: 0,
    retain: false
  }
  this.server.publish(message)
}

module.exports = Server
