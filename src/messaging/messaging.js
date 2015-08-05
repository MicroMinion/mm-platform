var uuid = require("node-uuid");
var _ = require("lodash");
var events = require("events");
var inherits = require("inherits");
var directory = require("../directory/directory.js");

var TransportManager = require("./gcm.js");

var SEND_TIMEOUT = 10000;


var Messaging = function(profile) {
    this.profile = profile;
    this.contacts = {};
    this.directoryCache = {};
    this.connectionStats = {};
    this.transportAvailable = false;
    //Queue of messages that still need to be send, key is publicKey of destination
    this.sendQueues = {};
    //Callbacks, ordered by message id, value is dictionary which can contain the following keys: succes, error, warning
    this.callBacks = {};
    this.transportManager = new TransportManager(profile.publicKey, profile.privateKey);
    var messaging = this;
    this.transportManager.on("ready", function(connectionInfo) {
        //TODO: Implement signature so that we can discard bogus info immediatly from DHT
        console.log("ready received");
        console.log(messaging.profile.publicKey);
        console.log(connectionInfo);
        directory.put(messaging.profile.publicKey, JSON.stringify(connectionInfo));
        this.transportAvailable = true;
    });
    this.transportManager.on("disable", function() {
        directory.put(messaging.profile.publicKey, JSON.stringify({}));
        this.transportAvailable = false;
    });
    this.transportManager.on("connection", function(publicKey) {
        messaging.connectionStats[publicKey].connectInProgress = false;
        messaging.connectionStats[publicKey].connected = true;
        messaging._flushQueue(publicKey);

    });
    this.transportManager.on("connectionError", function(publicKey) {
        messaging.connectionStats[publicKey].connectInProgress = false;
        messaging.connectionStats[publicKey].connected = false;
        console.log("impossible to connect to " + publicKey);
    });
    this.transportManager.on("message", function(message) {
        console.log("message received");
        console.log(message);
    });
    setInterval(function() {
        _.forEach(_.keys(messaging.sendQueues), function(publicKey) {
            messaging._trigger(publicKey);
        });
    }, SEND_TIMEOUT);
    setInterval(function() {
        _.forEach(_.keys(messaging.directoryCache), function(publicKey) {
            var lastUpdate = messaging.connectionStats[publicKey].lastUpdate;
            if(!messaging.connectionStats[publicKey].lookupInProgress && (lastUpdate + (1000*60*10)) < new Date()) {
                messaging._lookupKey(publicKey);
            };
        });
    }, SEND_TIMEOUT * 5);
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
    //TODO: Support options.expireAfter;
    var message = {
        source: this.profile.device.publicKey,
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
    if(this._sendQueues[publicKey] && this.transportAvailable) {
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
    if(this.connectionStats[publicKey].lookupInProgress) {
        return;
    };
    var messaging = this;
    var options = {
        error: function(key, err) {
            console.log("lookup error for " + key + " " + err);
            messaging.connectionStats[publicKey].connectInProgress = false;
        },
        succes: function(key, value) {
            messaging.connectionStats[publicKey].connectInProgress = false;
            messaging.connectionStats[publicKey].lastUpdate = new Date();
            messaging.directoryCache[publicKey] = JSON.parse(value);
        },
    };
    directory.get(publicKey, options);
};

module.exports = Messaging;

