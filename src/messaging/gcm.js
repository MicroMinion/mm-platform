var uuid = require("node-uuid");
var inherits = require("inherits");
var events = require("events");
var backoff = require("backoff");
var curveProtocol = require("curve-protocol");

var SENDER_ID = "559190877287";
var SENDER_PUBLIC_KEY = "453W1OR7HYcUsDHkFtAMcm7Vll4WTU2r/FFlbjtEzHI=";

function GCMTransport(publicKey, privateKey) {
    console.log("initializing gcm");
    events.EventEmitter.call(this);
    this.registrationId = undefined;
    this.registrationOngoing = true;
    this.registrationMessageId = "";
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    
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
            gcm.registrationMessageId = uuid.v4();
            chrome.gcm.send({
                destinationId: SENDER_ID + "@gcm.googleapis.com",
                messageId: gcm.registrationMessageId,
                timeToLive: 0,
                data: {
                    type: "register",
                    publicKey: gcm.publicKey,
                    signature: curveProtocol.sign(gcm.registrationId, gcm.registrationMessageId, SENDER_PUBLIC_KEY, gcm.privateKey)
                }
            }, function(messageId) {
                console.log("message send");
                if(chrome.runtime.lastError) {
                    console.log("GCM: problem with sending registration message to app server");
                    console.log(chrome.runtime.lastError);
                    gcm.backoff.backoff();
                };
            });
        };
    });
};

GCMTransport.prototype.onMessage = function(message) {
    console.log("gcm: onMessage");
    console.log(message);
    if(message.data.type === "delivered") {
    } else if(message.data.type === "message") {

    } else if(message.data.type === "notDelivered") {

    } else if(message.data.type === "registrationOK") {
        this.backoff.reset();
        this.registrationOngoing = false;
        this.registrationMessageId = "";
        this.emit("ready", {});
    } else if(message.data.type === "registrationFailed") {
        this.registrationMessageId = "";
        this.backoff.backoff();
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

    };
    this.emit("disable");
    this.backoff.backoff();
};


module.exports = GCMTransport;
