'use strict'

var mosca = require('mosca')
var ProtocolDispatcher = require('../messaging/protocol-dispatcher.js')
var Messaging = require('../messaging/messaging.js')
var Torrenting = require('../messaging/torrenting.js')
var _ = require('lodash')
var debug = require('debug')('flunky-platform:proxy:server')

var MQTT_PORT = 65432

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
    port: MQTT_PORT,
    backend: {}
  }
  this.server = new mosca.Server(moscaSettings)
  this.server.on('published', this.onPublish.bind(this))
}

Server.prototype.onPublish = function (packet, client) {
  if (!_.isUndefined(client) && client.id === 'server') {
    return
  }
  var topicSplit = packet.topic.split('/')
  var protocol = topicSplit[1]
  if (protocol === 'MS') {
    packet.payload = JSON.parse(packet.payload)
  }
  var topic = topicSplit[2]
  var publicKey = topicSplit[3]
  if (_.has(this.protocols, protocol)) {
    this.protocols[protocol].send(topic, publicKey, packet.payload)
  }
}

Server.prototype.dispatchTorrent = function (topic, publicKey, data) {
  this._dispatch('BT', topic, publicKey, data)
}

Server.prototype.dispatchMessage = function (topic, publicKey, data) {
  debug('dispatchMessage' + topic)
  this._dispatch('MS', topic, publicKey, JSON.stringify(data))
}

var logger = {
  debug: debug
}

var fakeClient = {
  id: 'server',
  logger: logger
}

Server.prototype._dispatch = function (protocol, topic, publicKey, data) {
  var message = {
    topic: '/' + protocol + '/' + topic + '/' + publicKey,
    payload: data,
    qos: 0,
    retain: false
  }
  debug('_dispatch ' + message.topic + ' ' + message.payload)
  this.server.publish(message, fakeClient)
}

module.exports = Server
