'use strict'
var mqtt = require('mqtt')
var EventEmitter = require('ak-eventemitter')
var extend = require('extend.js')
var inherits = require('inherits')
var debug = require('debug')('flunky-platform:proxy:client')

var MQTT_PORT = 65432

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (searchString, position) {
    var subjectString = this.toString()
    if (position === undefined || position > subjectString.length) {
      position = subjectString.length
    }
    position -= searchString.length
    var lastIndex = subjectString.indexOf(searchString, position)
    return lastIndex !== -1 && lastIndex === position
  }
}
var Messaging = function (client) {
  EventEmitter.call(this, {
    delimiter: '.'
  })
  this.client = client
}

inherits(Messaging, EventEmitter)

Messaging.prototype.send = function (topic, publicKey, data, options) {
  extend(data, options)
  this.client.client.publish('/' + 'MS' + '/' + topic + '/' + publicKey, JSON.stringify(data))
}

Messaging.prototype.on = function (ns, callback) {
  EventEmitter.prototype.on.call(this, ns, callback)
  if (ns.endsWith('*')) {
    ns = ns.replace('*', '/#')
  } else {
    ns = ns + '/#'
  }
  this.client.client.subscribe('/' + 'MS' + '/' + ns)
}

Messaging.prototype.handleMessage = function (topic, publicKey, message) {
  this.emit(topic, publicKey, JSON.parse(message))
}

var Torrenting = function (client) {
  EventEmitter.call(this, {
    delimiter: '.'
  })
  this.client = client
}

inherits(Torrenting, EventEmitter)

Torrenting.prototype.send = function (infoHash, publicKey, data) {
  this.client.client.publish('/' + 'BT' + '/' + infoHash + '/' + publicKey, data)
}

Torrenting.prototype.on = function (ns, callback) {
  EventEmitter.prototype.on.call(this, ns, callback)
  this.client.client.subscribe('/BT/' + ns + '/#')
}

Torrenting.prototype.handleMessage = function (topic, publicKey, message) {
  this.emit(topic, publicKey, message)
}

var Client = function () {
  this.client = mqtt.connect('mqtt://127.0.0.1:' + MQTT_PORT)
  this.client.on('connect', function () {
    debug('connected')
  })
  this.client.on('message', this.handleMessage.bind(this))
  this.messaging = new Messaging(this)
  this.torrenting = new Torrenting(this)
  this.protocols = {
    'MS': this.messaging,
    'BT': this.torrenting
  }
}

Client.prototype.handleMessage = function (topic, message) {
  debug('handleMessage ' + topic + ' ' + message)
  var topicSplit = topic.split('/')
  var protocol = topicSplit[1]
  topic = topicSplit[2]
  var publicKey = topicSplit[3]
  this.protocols[protocol].handleMessage(topic, publicKey, message)
}

module.exports = Client
