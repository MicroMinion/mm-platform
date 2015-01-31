
var ComponentManager;
module.exports = ComponentManager;

var debug = require("debug")("flunky-platform:component-manager");
var Duplex = require("stream").Duplex;
var inherits = require("inherits");
var extend = require("extend.js");
var _ = require("lodash");

var AuthenticationComponent = require("./components/authentication.js");
var DiscoveryComponent = require("./components/discovery.js");
var MetadataComponent = require("flunky-component-metadata");


function ComponentManager(opts) {
    if(!opts) opts = {};
    opts.objectMode = true;
    Duplex.call(this, opts);
    extend(this, {
        components: [],
    }, opts);
    this._setupAuthenticationComponent();
    this._setupDiscoveryComponent();
    this._setupMetadataComponent();
    this._collectServiceDefinitions();
    var componentManager = this;
    _.each(this.components, function(component) {
        component.on("data",  componentManager.sendMessage.bind(this));
    }, this);
};

inherits(ComponentManager, Duplex); 

ComponentManager.prototype.setConnectionManager = function(connectionManager) {
    this.authenticationComponent.setConnectionManager(connectionManager);
};

ComponentManager.prototype._read = function(size) {
};

ComponentManager.prototype.sendMessage = function(destination, service, payload) {
    this.push({
        to: destination,
        service: service,
        payload: payload
    });
};

//Accept message from connectionManager and dispatch to services
ComponentManager.prototype._write = function(chunk, encoding, done) {
    var service = chunk.service;
    _.each(this.components, function(component) {
        if(_.has(component.getProvidedServices(), service)) {
           component.write(chunk); 
        };
    });
};

ComponentManager.prototype.addPeer = function(peerID) {
    this.authenticationComponent.setup(peerID);
    this.discoveryComponent.setup(peerID);
};

ComponentManager.prototype.setupPeer = function(peerID, services) {
    _.each(services, function(service) {
        _.each(this.components, function(component) {
            if(_.has(component.getProvidedServices(),service)) {
                component.setup(peerID);
            };
        }, this);
    }, this);
};

ComponentManager.prototype.removePeer = function(peerID) {
    _.each(this.components, function(component) { component.tearDown(peerID); }, this); 
};

ComponentManager.prototype._setupAuthenticationComponent = function() {
    this.authenticationComponent = new AuthenticationComponent({
        config: this.config,
        directory: this.directory,
    });
    this.components.push(this.authenticationComponent);
};

ComponentManager.prototype._setupDiscoveryComponent = function() {
    this.discoveryComponent = new DiscoveryComponent({
        componentManager: this
    });
    this.components.push(this.discoveryComponent);
};

ComponentManager.prototype._setupMetadataComponent = function() {
    this.videoDB = new MetadataComponent({
        name: "homevideos"
    });
    this.components.push(this.videoDB);
};

ComponentManager.prototype._collectServiceDefinitions = function() {
    this.providedServices = _.uniq(_.map(this.components, function(component) { component.getProvidedServices(); }, this));
    this.neededServices = _.uniq(_.map(this.components, function(component) { component.getNeededServices(); }, this));
    this._connectLocalServices();
};

ComponentManager.prototype._connectLocalServices = function() {
    //FIXME: Implement
};

