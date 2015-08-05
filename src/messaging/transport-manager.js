
//WARNING: THIS CLASS IS OLD CODE, AND NEEDS TO BE REFACTORED BEFORE BEING USED AGAIN

var inherits = require("inherits");
var events = require("events");
var directory = require("../directory.js");
var extend = require("extend.js");
var _ = require("lodash");

var defaultPrioritization = {
    'gcm': 1
};


function TransportManager() {
    events.EventEmitter.call(this);
    this.transports = {};
    this.prioritization = {};
    this.pendingMessages = {};
    this.directoryCache = {};

    this.transports.gcm = require('./transports/gcm.js');
    this.connectEvents("gcm");
};

inherits(TransportManager, events.EventEmitter); 


TransportManager.prototype.connectEvents = function(transportName) {
    var manager = this;
    var transport = this.transports[transportName];
    transport.on("ready", function() {
        manager.prioritization[transportName] = defaultPrioritization[transportName];
    });
    transport.on("disable", function() {
        manager.prioritization[transportName] = 0;
    });
    transport.on("connectionError", function(publicKey) {
        var directoryEntry = manager.directoryCache[publicKey];
        if(directoryEntry.connectInProgress) {
            directoryEntry.prioritization[transportName] = 0;
            manager._connect(publicKey);
        };
    });
    transport.on("connectionConfirmation", function(publicKey) {

    });
    transport.on("sendError", function(messageId, error) {

    });
    transport.on("sendConfirmation", function(messageId) {

    });

};

TransportManager.prototype.connect = function(publicKey) {
    var manager = this;
    if(manager.directoryCache[publicKey].connectInProgress || manager.directoryCache[publicKey].lookupInProgress) {
        return;
    } else {
        manager.directoryCache[publicKey].prioritization = _.clone(manager.prioritization);
    };
    var options = {
        error: function(key, err) {
            if(!manager.directoryCache[key].lookupInProgress) {
                return;
            };
            manager.directoryCache[key].lookupInProgress = false;
            if(!manager.directoryCache[key].access) {
                manager.emit("connectionError", publicKey);
            };
        },
        success: function(key, value) {
            if(!manager.directoryCache[key].lookupInProgress) {
                return;
            };
            delete value.connectInProgress;
            delete value.lookupInProgress;
            delete value.prioritization;
            extend(manager.directoryCache[key], value);
            manager.directoryCache[key].lastUpdate = new Date();
            manager.directoryCache[key].lookupInProgress = false;
            if(!manager.directoryCache[key].connectInProgress) {
                manager._connect(publicKey);
            };
        }
    };
    manager.directoryCache[publicKey].lookupInProgress = true;
    directory.get(publicKey, options);
    if(this.directoryCache[publicKey].access) {
        this._connect(publicKey);
    };

};

TransportManager.prototype._connect = function(publicKey) {
    this.directoryCache[publicKey].connectInProgress = true;
    _.forEach(_.keys(directoryCache[publicKey].prioritization), function(transportName) {
        if(!this.directoryCache[publicKey].access[transportName]) {
            this.directoryCache[publicKey].prioritization[transportName] = 0;
        };
    }, this);
    var max = _.max(_.pairs(directoryCache[publicKey].prioritization), function(pair) {
        return pair[1];
    }, this);
    if(max === -Infinity || max[1] === 0) {
        this.directoryCache[publicKey].connectInProgress = false;
        if(!this.directoryCache[publicKey].lookupInProgress) {
            this.emit("connectionError", publicKey);
        };
    } else {
        var transportName = max[0];
        this.transports[transportName].connect(publicKey, this.directoryCache[publicKey].access[transportName]);
    };

};

TransportManager.prototype.send = function(message) {
};



module.exports = TransportManager;
