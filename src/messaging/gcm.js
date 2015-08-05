var uuid = require("node-uuid");
var inherits = require("inherits");
var events = require("events");
var backoff = require("backoff");
var curveProtocol = require("curve-protocol");

var SENDER_ID = "559190877287";

function GCMTransport(publicKey, privateKey) {
    events.EventEmitter.call(this);
    this.registrationId = undefined;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.directoryCache = {};
    this.pendingMessages = {};

    var gcm = this;

    chrome.gcm.onMessage.addListener(gcm.onMessage.bind(this));
    chrome.gcm.onMessagesDeleted.addListener(gcm.onMessagesDeleted.bind(this));
    chrome.gcm.onSendError.addListener(gcm.onSendError.bind(this));

    this.backoff = backoff.fibonacci({
        initialDelay: 1,
        maxDelay: 10000,
        randomisationFactor: 0
    });
    this.backoff.on("ready", function() {
        gcm.register();
    });
    this.backoff.backoff();
};


inherits(GCMTransport, events.EventEmitter);

GCMTransport.prototype.register = function() {
    var gcm = this;
    chrome.gcm.register([SENDER_ID], function(registrationId) {
        if(chrome.runtime.lastError) {
            console.log("GCM Registration failed");
            console.log(chrome.runtime.lastError);
            gcm.backoff.backoff();
        } else {
            console.log("registration succeeded");
            gcm.registrationId = registrationId;
            gcm.backoff.reset();
            gcm.emit("ready",{"gcm": gcm.registrationId});
        };
    });
};

GCMTransport.prototype._send = function(to, id, message) {
    this.pendingMessages[id] = message;
    var gcm = this;
    setTimeout(function() {
        gcm.sendError(id);
    }, 1000);
    chrome.gcm.send({
        destinationId: SENDER_ID + "@gcm.googleapis.com",
        messageId: id,
        timeToLive: 0,
        data: {
            type: "MESSAGE",
            to: to,
            from: this.registrationId, 
            data: message 
        }
    }, function(messageId) {
        if(chrome.runtime.lastError) {
            console.log("GCM: problem with sending message to app server");
            console.log(chrome.runtime.lastError);
            gcm.sendError(messageId);
        } else {
        };
    });
};


GCMTransport.prototype.connect = function(publicKey, connectionInfo) {
    this.directoryCache[publicKey] = connectionInfo;
};

GCMTransport.prototype.send = function(message) {
    if(!this.directoryCache[publicKey]) {
        this.emit("sendError", message.id);
    } else {
        this._send(this.directoryCache[publicKey], message.id, message);
    };
};

GCMTransport.sendError = function(messageId) {
    if(this.pendingMessages[messageId]) {
        this.emit("sendError", messageId);
        delete this.pendingMessages[messageId];
    };
};

GCMTransport.prototype.onMessage = function(message) {
    console.log("gcm: onMessage");
    console.log(message);
    if(message.data.type === "MESSAGE") {

    } else if(message.data.type === "MESSAGE_DELIVERED") {
        var id = message.data.message_id;
        if(id && this.pendingMessages[id]) {
            GCMTransport.sendConfirmation(id);
        };
    } else if(message.data.type === "MESSAGE_NOT_DELIVERED") {
        var id = message.data.message_id;
        if(id && this.pendingMessages[id]) {
            GCMTransport.sendError(id);
        };
    } else {
        console.log("GCM: Unknown message type received");
        console.log(message);
    };
};

GCMTransport.prototype.onMessagesDeleted = function() {
};

GCMTransport.prototype.onSendError = function(error) {
    console.log("GCM: Send error");
    console.log(error.errorMessage);
    console.log(error.messageId);
    console.log(error.details);
    if(error.messageId) {
        this.sendError(error.messageId);
    };
    this.disable();
};

GCMTransport.prototype.disable = function() {
    this.registrationId = undefined;
    this.emit("disable");
    this.backoff.backoff();
};


module.exports = GCMTransport;
