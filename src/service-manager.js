module.exports = ComponentManager;

var debug = require("debug")("flunky-platform:component-manager");
var EventEmitter = require('events').EventEmitter;
var inherits = require("inherits");
var extend = require("extend.js");
var _ = require("lodash");

//FIXME: Not yet implemented
var AuthenticationComponent = require("./components/authentication.js");
//var DiscoveryComponent = require("./components/discovery.js");

inherits(ComponentManager, EventEmitter);

function ComponentManager(opts) {
    if(!opts) opts = {};
    EventEmitter.call(this, opts);
    extend(this, {
        components: [],
    }, opts);
    this._setupAuthenticationComponent();
    this._setupDiscoveryComponent();
    this._collectServiceDefinitions();
};

ComponentManager.prototype.setConnectionManager = function(connectionManager) {
    this.authenticationComponent.setConnectionManager(connectionManager);
};

ComponentManager.prototype._setupAuthenticationComponent = function() {
    this.authenticationComponent = new AuthenticationComponent({
        config: this.config,
        directory: this.directory,
    });
    this.components.push(this.authenticationComponent);
};

ComponentManager.prototype._setupDiscoveryComponent = function() {

};

ComponentManager.prototype._collectServiceDefinitions = function() {
    this.providedServices = _.uniq(_.map(this.components, function(component) { component.getProvidedServices(); }, this));
    this.neededServices = _.uniq(_.map(this.components, function(component) { component.getNeededServices(); }, this));
    this._connectLocalServices();
};

ComponentManager.prototype._connectLocalServices = function() {
    //FIXME: Implement
};

ComponentManager.prototype.setupPeer = function(peerID, services) {
    _.each(services, function(service) {
        this.services[service].setup(peerID);
    }, this);
};

ComponentManager.prototype.tearDownPeer = function(peerID) {
    _.each(this.services, function(service) {
        service.tearDown(peerID);
    }, this);
};

