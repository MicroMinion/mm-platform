var events = require("events");
var chai = require("chai");
var curve = require("curve-protocol");
var inherits = require("inherits");

var expect = chai.expect;


/**
 * Generic Message Transport
 *
 * @constructor
 * @fires AbstractTransport#ready
 * @fires AbstractTransport#disable
 * @fires AbstractTransport#connectionEstablished
 * @fires AbstractTransport#connectionStopped
 * @fires AbstractTransport#message
 * @param {string} publicKey
 * @param {string} privateKey
 */
var AbstractTransport = function(publicKey, privateKey) {
    expect(publicKey).to.be.a("string");
    expect(curve.fromBase64(publicKey)).to.have.length(32);
    expect(privateKey).to.be.a("string");
    expect(curve.fromBase64(privateKey)).to.have.length(32);
    events.EventEmitter.call(this);
    this.publicKey = publicKey;
    this.privateKey = privateKey;
};

inherits(AbstractTransport, events.EventEmitter);

/**
 * ready event
 *
 * @event AbstractTransport#ready
 * @type {object} connectionInfo
 */

/**
 * disable event
 *
 * @event AbstractTransport#disable
 */

/**
 * connectionEstablished event
 *
 * @event AbstractTransport#connectionEstablished
 * @type {string} publicKey
 */

/**
 * connectionStopped event
 *
 * @event AbstractTransport#connectionStopped
 * @type {string} publicKey
 */

/**
 * message event
 *
 * @event AbstractTransport#message
 * @type {string} publicKey
 * @type {object} message
 */


/**
 * Manually disable transport
 *
 * @abstract
 */
AbstractTransport.prototype.disable = function() {
    throw new Error("must be implemented by subclass");
};

/**
 * Enable transport
 *
 * @abstract
 */
AbstractTransport.prototype.enable = function() {
    throw new Error("must be implemented by subclass");
};

/**
 * Send a message
 * 
 * @abstract
 * @param {Object} message
 */

AbstractTransport.prototype.send = function(message) {
    throw new Error("must be implemented by subclass");
};


/**
 * Connect to a peer
 *
 * @abstract
 * @param {string} publicKey
 * @param {Object} connectionInfo
 */
AbstractTransport.prototype.connect = function(publicKey, connectionInfo) {
    throw new Error("must be implemented by subclass");
};

module.exports = AbstractTransport;

