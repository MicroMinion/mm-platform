var ProtocolDispatcher = require('./protocol-dispatcher.js')
var Messaging = require('./messaging.js')
var Torrenting = require('./torrenting.js')
var assert = require('assert')

var TCPTransport = require('./transports/transport-tcp.js')
// var GCMTransport = require('./transports/transport-gcm.js')
// var UDPTurnTransport = require('./transports/transport-udp-turn.js')
// var UDPTransport = require('./transports/transport-udp.js')

/**
 * Platform API
 *
 * @constructor
 * @param {Object} options
 * @param {Object} options.storage - KAD-FS compatible storage interface
 */
var Platform = function (options) {
  assert(options.storage)
  this.__dispatcher = new ProtocolDispatcher(options)
  if (!options) {
    options = {}
  }
  options.dispatcher = this.__dispatcher
  /**
   * Interface for sending JSON style messages
   *
   * @public
   * @type Messaging
   */
  this.messaging = new Messaging(options)
  /**
   * Interface for sending BitTorrent packets
   *
   * @public
   * @type Torrenting
   */
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

/**
 * Add new Transport Class
 *
 * @param {AbstractTransport} TransportClass - Implementation of AbstractTransport
 * @public
 */
Platform.prototype.addTransport = function (TransportClass) {
  this.__dispatcher.transportManager.addTransport(TransportClass)
}

module.exports = Platform
