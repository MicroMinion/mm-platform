var uuid = require("node-uuid");
var inherits = require("inherits");
var events = require("events");
var backoff = require("backoff");
var curve = require("curve-protocol");
var _ = require("lodash");
var Duplex = require("stream").Duplex;
var extend = require("extend.js");

var SENDER_ID = "559190877287";

function GCMTransport(publicKey, privateKey) {
    events.EventEmitter.call(this);
    this.registrationId = undefined;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    // publicKey => registrationId
    this.directoryCache = {};
    // registrationId => CurveCPStream
    this.connections = {};

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
            console.log(registrationId);
            gcm.backoff.reset();
            gcm.emit("ready",{"gcm": gcm.registrationId});
        };
    });
};


GCMTransport.prototype.connect = function(publicKey, connectionInfo) {
    console.log("GCMTransport.connect");
    this.directoryCache[publicKey] = connectionInfo.gcm;
    if(connectionInfo.gcm in this.connections) {
        return;
    };
    var gcmStream = new GCMStream({
        source: this.registrationId,
        destination: connectionInfo
    });
    this.connections[connectionInfo] = new curve.CurveCPStream({
        stream: gcmStream,
        is_server: false,
        serverPublicKey: curve.fromBase64(publicKey),
        clientPublicKey: curve.fromBase64(this.publicKey),
        clientPrivateKey: curve.fromBase64(this.privateKey)
    });
    this.connectStream(this.connections[connectionInfo]);
};

GCMTransport.prototype.connectStream = function(stream) {
    var gcm = this;
    stream.on("error", function(error) {
        console.log("GCMTransport: stream error");
        console.log(error);
    });
    stream.on("end", function() {
        console.log("GCMTransport: end stream event");
        gcm._end(stream.stream.destination);
    });
    stream.on("drain", function() {
        console.log("GCMTransport: stream drain event");
        var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey;
        var publicKey = curve.toBase64(publicKey)
        gcm.emit("connection", publicKey);
    });
    stream.on("data", function(data) {
        console.log("GCMTransport: stream data event");
        var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey;
        var publicKey = curve.toBase64(publicKey)
        data = JSON.parse(data);
        gcm.emit("message", publicKey, data);
    });
};

GCMTransport.prototype.disconnect = function(publicKey) {
    _.forEach(this.connections, function(connection, index, collection) {
        var publicKey = curve.fromBase64(publicKey);
        if(publicKey === connection.clientPublicKey || publicKey === connection.serverPublicKey) {
            this._end(index);
        };
    }, this);
};

GCMTransport.prototype._end = function(destination) {
    var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey;
    var publicKey = curve.toBase64(publicKey);
    var stream = this.connections[destination];
    stream.removeAllListeners("end");
    stream.removeAllListeners("drain");
    stream.removeAllListeners("data");
    stream.removeAllListeners("error");
    delete this.connections[destination];
    gcm.emit("connectionStopped", publicKey);
};

GCMTransport.prototype.send = function(message) {
    console.log("sending ...");
    var publicKey = message.destination;
    if(!this.directoryCache[publicKey]) {
        console.log("Send error");
        this.emit("connectionStopped", publicKey);
    } else {
        this.connections[this.directoryCache[publicKey]].write(JSON.stringify(message));
    };
};

GCMTransport.prototype.onMessage = function(message) {
    console.log("gcm: onMessage");
    console.log(message);
    if(message.data.type === "MESSAGE") {
        if(message.data.destination !== this.registrationId) {
            console.log("message received which does not have our registrationId as destination");
        } else {
            var source = message.data.source;
            var stream = new GCMStream({
                source: this.registrationId,
                destination: source
            });
            this.connections[source] = new CurveCPStream({
                stream: stream,
                is_server: true,
                serverPublicKey: curve.fromBase64(this.publicKey),
                serverPrivateKey: curve.fromase64(this.privateKey)
            });
            this.connectStream(this.connections[source]);
            stream.emit('data', curve.fromBase64(message.data.data));
        };
    } else if(message.data.type === "MESSAGE_DELIVERED") {
    } else if(message.data.type === "MESSAGE_NOT_DELIVERED") {
        this.connections[message.data.destination].stream.error("Could not deliver message");
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
    this.disable();
};

GCMTransport.prototype.disable = function() {
    this.registrationId = undefined;
    this.emit("disable");
    this.backoff.backoff();
};

var GCMStream = function(opts) {
    console.log("initializing GCM stream");
    if(!opts) opts = {};
    opts.objectMode = false;
    Duplex.call(this, opts);
    extend(this, {
        source: null,
        destination: null
    }, opts);
};

GCMStream.prototype._read = function(size) {
};

GCMStream.prototype._write = function(chunk, encoding, done) {
    var stream = this;
    chrome.gcm.send({
        destinationId: SENDER_ID + "@gcm.googleapis.com",
        messageId: uuid.v4(),
        timeToLive: 0,
        data: {
            type: "MESSAGE",
            destination: stream.destination,
            source: stream.source, 
            data: curve.toBase64(chunk) 
        }
    }, function(messageId) {
        if(chrome.runtime.lastError) {
            console.log("GCM: problem with sending message to app server");
            console.log(chrome.runtime.lastError);
            stream.error("Problem with sending message to GCM server");
        };
    });
};

GCMStream.prototype.error = function(errorMessage) {
    this.emit("error", new Error(errorMessage));
    this.emit("end");
    this.emit("close");
};

module.exports = GCMTransport;
