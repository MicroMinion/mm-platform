var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var directory = require("../directory/directory.js");
var Messaging = require("../messaging/messaging.js");
var _ = require("lodash");

var ProtocolManager = function() {
    EventEmitter.call(this);
    this.protocols = {};
    this.availableProtocols = {};
    this._delayedInitializations = [];
};

inherits(ProtocolManager, EventEmitter);

ProtocolManager.prototype.setProfile = function(profile) {
    if(!this.profile) {
        this.profile = profile;
        this.messaging = new Messaging(profile);
        _.forEach(this._delayedInitializations, function(protocolInfo) {
            this._initializeProtocol(protocolInfo.className, protocolInfo.name, protocolInfo.options, protocolInfo.callback);
        }, this);
    } else {
        throw Error("Can not set profile twice on ProtocolManager");
    };
};

ProtocolManager.prototype.setContacts = function(contacts) {
    this.messaging.setContacts(contacts);
};

ProtocolManager.prototype.registerProtocol = function(name, classObject) {
    this.availableProtocols[name] = classObject;
};

ProtocolManager.prototype.initializeProtocol = function(className, name, options, callback) {
    if(!this.messaging) {
        this._delayedInitializations.push({
            className: className,
            name: name,
            options: options,
            callback: callback
        });
    } else {
        this._initializeProtocol(className, name, options, callback);
    };
};

ProtocolManager.prototype._initializeProtocol = function(className, name, options, callback) {
    options.messaging = this.messaging;
    options.profile = this.profile;
    this.protocols[name] = new this.availableProtocols[className](options);
    callback();
};

ProtocolManager.prototype.getProtocol = function(name) {
    return this.protocols[name];
};


module.exports = ProtocolManager;
