module.exports = ServiceManager;

var debug = require("debug")("flunky-platform:service-manager");
var EventEmitter = require('events').EventEmitter;
var inherits = require("inherits");
var extend = require("extend.js");
var _ = require("lodash");

var AuthenticationService = require("./services/authentication.js");
var DiscoveryService = require("./services/discovery.js");

inherits(ServiceManager, EventEmitter);

function ServiceManager(opts) {
    if(!opts) opts = {};
    EventEmitter.call(this, opts);
    extend(this, {
        services: {},
    }, opts);
    this.setupAuthenticationService();
    this.setupDiscoveryService();
};

ServiceManager.prototype.setupAuthenticationService = function() {

};

ServiceManager.prototype.setupDiscoveryService = function() {

};

ServiceManager.prototype.setupPeer = function(peerID, services) {
    _.each(services, function(service) {
        this.services[service].setup(peerID);
    }, this);
};

ServiceManager.prototype.tearDownPeer = function(peerID) {
    _.each(this.services, function(service) {
        service.tearDown(peerID);
    }, this);
};

ServiceManager.prototype._collect_definitions = function() {

};
