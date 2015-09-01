var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var directory = require("../directory/directory.js");
var Messaging = require("../messaging/messaging.js");
var _ = require("lodash");

var ServiceManager = function() {
    EventEmitter.call(this);
    this.services = {};
    this.availableServices = {};
    this._delayedInitializations = [];
};

inherits(ServiceManager, EventEmitter);

ServiceManager.prototype.setProfile = function(profile) {
    if(!this.profile) {
        this.profile = profile;
        this.messaging = new Messaging(profile);
        _.forEach(this._delayedInitializations, function(serviceInfo) {
            this._initializeService(serviceInfo.className, serviceInfo.name, serviceInfo.options, serviceInfo.callback);
        }, this);
    } else {
        throw Error("Can not set profile twice on ServiceManager");
    };
};

ServiceManager.prototype.setContacts = function(contacts) {
    this.messaging.setContacts(contacts);
};

ServiceManager.prototype.setDevices = function(devices) {
    this.messaging.setDevices(devices);
};

ServiceManager.prototype.registerService = function(name, classObject) {
    this.availableServices[name] = classObject;
};

ServiceManager.prototype.initializeService = function(className, name, options, callback) {
    if(!this.messaging) {
        this._delayedInitializations.push({
            className: className,
            name: name,
            options: options,
            callback: callback
        });
    } else {
        this._initializeService(className, name, options, callback);
    };
};

ServiceManager.prototype._initializeProtocol = function(className, name, options, callback) {
    options.messaging = this.messaging;
    options.profile = this.profile;
    options.name = name;
    this.services[name] = new this.availableServices[className](options);
    callback();
};

ServiceManager.prototype.getService = function(name) {
    return this.services[name];
};


module.exports = ServiceManager;
