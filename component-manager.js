
var ComponentManager;
module.exports = ComponentManager;

var debug = require("debug")("flunky-platform:component-manager");
var Duplex = require("stream").Duplex;
var inherits = require("inherits");
var extend = require("extend.js");
var _ = require("lodash");

var AuthenticationComponent = require("./authentication.js");
var DiscoveryComponent = require("./discovery.js");
var MetadataComponent = require("flunky-component-metadata");

function ComponentManager(opts) {
    if(!opts) opts = {};
    opts.objectMode = true;
    Duplex.call(this, opts);
    extend(this, {
        components: {},
    }, opts);
    this._setupAuthenticationComponent();
    this._setupDiscoveryComponent();
    this._collectServiceDefinitions();
    var componentManager = this;
    _.each(this.components, function(component) {
        component.on("data",  componentManager.sendMessage.bind(this));
    }, this);
};

inherits(ComponentManager, Duplex); 

ComponentManager.prototype._read = function(size) {
};

ComponentManager.prototype.sendMessage = function(message) {
    debug("sendMessage %s", JSON.stringify(message));
    this.push(message);
};

//Accept message from connectionManager and dispatch to services
ComponentManager.prototype._write = function(chunk, encoding, done) {
    debug("receive message %s", JSON.stringify(chunk));
    var service = chunk.service;
    _.each(this.components, function(component) {
        if(_.includes(component.getProvidedServices(), service)) {
           component.write(chunk); 
        };
    });
    done();
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
    this.components["authentication"] = this.authenticationComponent;
};

ComponentManager.prototype._setupDiscoveryComponent = function() {
    this.discoveryComponent = new DiscoveryComponent({
        componentManager: this
    });
    this.components["discovery"] = this.discoveryComponent;
};

ComponentManager.prototype.createMetadataComponent = function(resource) {
    this.components[resource] = new MetadataComponent({
        name: resource
    });
};

ComponentManager.prototype._collectServiceDefinitions = function() {
    this.providedServices = _.uniq(_.map(this.components, function(component) { component.getProvidedServices(); }, this));
    this.neededServices = _.uniq(_.map(this.components, function(component) { component.getNeededServices(); }, this));
    this._connectLocalServices();
};

ComponentManager.prototype._connectLocalServices = function() {
    //FIXME: Implement
};

