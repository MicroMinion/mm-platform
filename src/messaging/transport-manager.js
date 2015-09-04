var inherits = require("inherits");
var _ = require("lodash");
var AbstractTransport = require("./transport-abstract.js");

//TODO: Adapt GCM and AbstractTransport to forsee "transportKey" property

var TransportManager = function(publicKey, privateKey) {
    AbstractTransport.call(publicKey, privateKey);
    this.transports = {};
    this.connectionInfo;
    this.connections = {};
    this._initializeTransports();
};

inherits(TransportManager, AbstractTransport);

TransportManager.prototype._initializeTransports = function() {
    var transports = ["gcm"];
    _.forEach(transports, function(transportName) {
        this._initializeTransport(transportName);
    }, this);
};

TransportManager.prototype._initializeTransport = function(name) {
    var loaded = false;
    var manager = this;
    var Transport;
    var transport;
    var transportKey;
    try {
        Transport = require("./transport-" + name + ".js");
        transport = new Transport(this.publicKey, this.privateKey);
        transportKey = transport.transportKey;
        manager.transports[transportKey] = transport;
        loaded = true;
    } catch(e) {};
    if(loaded) {
        transport.on("ready", function(connectionInfo) {
            manager.connectionInfo[transportKey] = connectionInfo[transportKey];
            manager.emit("ready", manager.connectionInfo);
        });
        transport.on("disable", function() {
            var isDisabled = _.every(manager.transports, function(transport) {
                return transport.isDisabled;
            });
            if(isDisabled) {
                manager.emit("disable");
            };
        });
        transport.on("connectionEstablished", function(publicKey) {
            if(!_.has(manager.connections, publicKey)) {
                manager.connections[publicKey] = {};
            };
            manager.connections[publicKey][transportKey] = true;
        });
        transport.on("connectionStopped", function(publicKey) {
            if(_.has(manager.connections, publicKey)) {
                delete manager.connections[publicKey][transportKey];
            };
        });
        transport.on("message", function(publicKey, message) {
            manager.emit("message", publicKey, message);
        });
    };
};

TransportManager.prototype.enable = function() {
    this._initializeTransports();
};

TransportManager.prototype.disable = function() {
    _.forEach(this.transports, function(transport, key) {
        transport.disable();
    });
};

TransportManager.prototype.send = function(publicKey, message) {
    //TODO: This is the harder one since we want to use some kind of prioritization within the ocnnected protocols
};

TransportManager.prototype.connect = function(publicKey, connectionInfo) {
    //TODO: This is the hradest since we want to implement prioritization amongst all available transports
    //TODO: do we want to take into account if there are already exists connections to this publicKey?
};
