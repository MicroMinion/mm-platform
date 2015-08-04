var uuid = require("node-uuid");
var _ = require("lodash");
var events = require("events");
var inherits = require("inherits");

var TransportManager = require("./gcm.js");

var SEND_TIMEOUT = 10000;

var Messaging = function(profile) {
    this.profile = profile;
    this.contacts = {};
    //Queue of messages that still need to be send, key is publicKey of destination
    this.sendQueues = {};
    //Callbacks, ordered by message id, value is dictionary which can contain the following keys: succes, error, warning
    this.callBacks = {};
    this.transportManager = new TransportManager(profile.publicKey, profile.privateKey);
    var messaging = this;
    this.transportManager.on("ready", function() {
        console.log("READY RECEIVED");
    });
    this.transportManager.on("connection", function(publicKey) {
        _.forEach(messaging.sendQueues[publicKey], function(message) {
            messaging.transportManager.send(message);
        });
    });
    this.transportManager.on("sendConfirmation", function(publicKey, id) {
        var message = messaging.sendQueues[publicKey][id];
        delete messaging.sendQueues[publicKey][id];
        if(messaging.callBacks[id]) {
            if(messaging.callBacks[id].success) {
                messaging.callBacks[id].success(message);
            };
            delete messaging.callBacks[id];
        };
    });
    this.transportManager.on("sendError", function(publicKey, id) {
        //I think we only need this when there is an explicit timeing requirement and timeout has expired (e.g., if a message can not be send within 10 seconds)
    });
    setInterval(function() {
        _.forEach(_.keys(messaging.sendQueues), function(publicKey) {
            messaging._trigger(publicKey);
        });
    }, SEND_TIMEOUT);
};

Messaging.prototype.setContacts = function(contacts) {
    this.contacts = contacts;
};


Messaging.prototype.send = function(publicKey, topic, data, options) {
    var message = {
        sender: this.profile.device.publicKey,
        destination: publicKey,
        id: options.id ? options.id : uuid.v4(), 
        topic: topic,
        data: data
    };
    this.callBacks[message.id] = options;
    if(!this.sendQueues[message.destination]) {
        this.sendQueues[message.destination] = {};
    };
    this.sendQueues[message.destination][message.id] = message;
    if(options.realtime) {
        process.nextTick(this._trigger.bind(this, message.destination));
    };

};

Messaging.prototype._trigger = function(publicKey) {
   if(this._sendQueues[publicKey]) {
        this.transportManager.connect(publicKey);          
    };
};

module.exports = Messaging;
