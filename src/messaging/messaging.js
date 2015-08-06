var uuid = require("node-uuid");
var _ = require("lodash");
var EventEmitter = require("ak-eventemitter");
var inherits = require("inherits");
var directory = require("../directory/directory.js");
var chai = require("chai");

var expect = chai.expect;

var TransportManager = require("./gcm.js");

var SEND_TIMEOUT = 10000;

var verificationState = {
    UNKNOWN: 1,
    NOT_VERIFIED: 2,
    PENDING_VERIFICATION: 3,
    VERIFIED: 4
};

var Messaging = function(profile) {
    EventEmitter.call(this, {
        delimiter: '.'
    });
    this.profile = profile;
    this.devices = {};
    this.contacts = {};
    this.directoryCache = {};
    this.connectionStats = {};
    this.connectionInfo = {};
    this.transportAvailable = false;
    //Queue of messages that still need to be send, key is publicKey of destination
    this.sendQueues = {};
    //Callbacks, ordered by message id, value is dictionary which can contain the following keys: success, error, warning
    this.options = {};
    this.transportManager = new TransportManager(profile.publicKey, profile.privateKey);
    var messaging = this;
    this.transportManager.on("ready", function(connectionInfo) {
        messaging.connectionInfo = connectionInfo;
        messaging.transportAvailable = true;
        messaging.publishConnectionInfo();
    });
    this.transportManager.on("disable", function() {
        directory.put(messaging.profile.publicKey, JSON.stringify({}));
        messaging.transportAvailable = false;
    });
    this.transportManager.on("connection", function(publicKey) {
        console.log("Messaging: connection event received from transportManager");
        messaging.connectionStats[publicKey].connectInProgress = false;
        messaging.connectionStats[publicKey].connected = true;
        messaging._flushQueue(publicKey);
    });
    this.transportManager.on("connectionStopped", function(publicKey) {
        console.log("Messaging: connectionStopped event received from transportManager");
        messaging.connectionStats[publicKey].connectInProgress = false;
        messaging.connectionStats[publicKey].connected = false;
        console.log("impossible to connect to " + publicKey);
    });
    this.transportManager.on("message", function(publicKey, message) {
        console.log("message received");
        console.log(message);
        var scope = messaging.getScope(message.publicKey);
        messaging.emit(scope + "." + message.topic, message);
    });
    setInterval(function() {
        _.forEach(_.keys(messaging.sendQueues), function(publicKey) {
            messaging._trigger(publicKey);
        });
    }, SEND_TIMEOUT);
    setInterval(function() {
        _.forEach(_.keys(messaging.connectionStats), function(publicKey) {
            var lastUpdate = messaging.connectionStats[publicKey].lastUpdate;
            if(!messaging.connectionStats[publicKey].lookupInProgress && (lastUpdate + (1000*60*10)) < new Date()) {
                messaging._lookupKey(publicKey);
            };
        });
    }, SEND_TIMEOUT * 5);
    setInterval(function() {
        messaging.publishConnectionInfo();
    }, 1000 * 60 * 5);
};

inherits(Messaging, EventEmitter);

Messaging.prototype.publishConnectionInfo = function() {
    //TODO: Implement signature so that we can discard bogus info immediatly from DHT
    directory.put(this.profile.publicKey, JSON.stringify(this.connectionInfo));
};

Messaging.prototype.getScope = function(publicKey) {
    if(this._getScope(publicKey, this.devices)) {
        return "self";
    } else {
        var friends = _.any(_.values(this.contacts), function(value, index, collection) {
            return this._getScope(publicKey, value.keys);
        }, this);
        if(friends) {
            return "friends";
        } else {
            return "public";
        };
    };
};

Messaging.prototype._getScope = function(publicKey, searchObject) {
    return _.any(searchObject, function(value, index, collection) {
        return index === publicKey && value.verificationState === verificationState.NOT_VERIFIED; 
    });
};

Messaging.prototype.setContacts = function(contacts) {
    this.contacts = contacts;
};


Messaging.prototype._flushQueue = function(publicKey) {
        _.forEach(this.sendQueues[publicKey], function(message) {
            this.transportManager.send(message);
            //TODO: Execute callback on options if present
            delete this.options[message.id];
        }, this);
        this.sendQueues[publicKey] = {};
};

Messaging.prototype.send = function(publicKey, topic, data, options) {
    console.log("Messaging.send");
    expect(publicKey).to.be.a("string");
    expect(topic).to.be.a("string");
    expect(data).to.be.an("object");
    expect(options).to.be.an("object");
    expect(JSON.stringify(data)).to.have.length.below(1200);
    //TODO: Support options.expireAfter;
    var message = {
        source: this.profile.publicKey,
        destination: publicKey,
        id: options.id ? options.id : uuid.v4(), 
        topic: topic,
        data: data
    };
    this.options[message.id] = options;
    if(!this.sendQueues[message.destination]) {
        this.sendQueues[message.destination] = {};
    };
    this.sendQueues[message.destination][message.id] = message;
    if(options.realtime) {
        process.nextTick(this._trigger.bind(this, message.destination));
    };

};

Messaging.prototype._trigger = function(publicKey) {
    console.log("Messaging._trigger");
    if(!this.connectionStats[publicKey]) {
        this.connectionStats[publicKey] = {};
    };
    if(this.sendQueues[publicKey] && this.transportAvailable) {
        if(!this.directoryCache[publicKey] && !this.connectionStats[publicKey].lookupInProgress) {
            this._lookupKey(publicKey);
        };
        if(this.directoryCache[publicKey] && !this.connectionStats[publicKey].connected && !this.connectionStats[publicKey].connectInProgress) {
            this.connectionStats[publicKey].connectInProgress = true;
            this.transportManager.connect(publicKey, this.directoryCache[publicKey])
        };
        if(this.connectionStats[publicKey].connected) {
            this._flushQueue(publicKey);
        };
    };
};

Messaging.prototype._lookupKey = function(publicKey) {
    console.log("Messaging._lookupKey");
    if(this.connectionStats[publicKey].lookupInProgress) {
        return;
    };
    var messaging = this;
    messaging.connectionStats[publicKey].lookupInProgress = true;
    var options = {
        error: function(key, err) {
            console.log("lookup error for " + key + " " + err);
            messaging.connectionStats[publicKey].lookupInProgress = false;
        },
        success: function(key, value) {
            console.log("lookup success for " + key);
            messaging.connectionStats[publicKey].lookupInProgress = false;
            messaging.connectionStats[publicKey].lastUpdate = new Date();
            messaging.directoryCache[publicKey] = JSON.parse(value);
        },
    };
    directory.get(publicKey, options);
};

module.exports = Messaging;

