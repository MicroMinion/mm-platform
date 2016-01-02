var ProtocolDispatcher = require('./protocol-dispatcher.js')
var Messaging = require('./messaging.js')
var Torrenting = require('./torrenting.js')
var assert = require('assert')

var TCPTransport = require('./transports/transport-tcp.js')
// var GCMTransport = require('./transports/transport-gcm.js')
// var UDPTurnTransport = require('./transports/transport-udp-turn.js')
// var UDPTransport = require('./transports/transport-udp.js')

var Platform = function (options) {
  assert(options.storage)
  this.__dispatcher = new ProtocolDispatcher(options)
  if (!options) {
    options = {}
  }
  options.dispatcher = this.__dispatcher
  this.messaging = new Messaging(options)
  this.torrenting = new Torrenting(this.__dispatcher)
  this.__dispatcher.setMessaging(this.messaging)
  this.addTransport(TCPTransport)
}

/**
 * Manually disable transports
 *
 * @public
 */
Platform.prototype.disable = function () {
  this.__dispatcher.transportManager.disable()
}

/**
 * Manually enable transports
 *
 * @public
 */
Platform.prototype.enable = function () {
  this.__dispatcher.transportManager.enable()
}

Platform.prototype.addTransport = function (TransportClass) {
  this.__dispatcher.transportManager.addTransport(TransportClass)
}

module.exports = Platform
