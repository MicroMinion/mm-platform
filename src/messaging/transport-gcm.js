var uuid = require("node-uuid");
var inherits = require("inherits");
var curve = require("curve-protocol");
var _ = require("lodash");
var Duplex = require("stream").Duplex;
var extend = require("extend.js");
var chai = require("chai");
var AbstractTransport = require("./transport-abstract");

var expect = chai.expect;

var SENDER_ID = "559190877287";

function GCMTransport(publicKey, privateKey) {
    AbstractTransport.call(this, publicKey, privateKey);
    this.registrationId = undefined;
    // publicKey => registrationId
    this.directoryCache = {};
    // registrationId => CurveCPStream
    this.connections = {};

    var gcm = this;

    chrome.gcm.onMessage.addListener(gcm.onMessage.bind(this));
    chrome.gcm.onMessagesDeleted.addListener(gcm.onMessagesDeleted.bind(this));
    chrome.gcm.onSendError.addListener(gcm.onSendError.bind(this));

    this.enable();
};


inherits(GCMTransport, AbstractTransport);

GCMTransport.prototype.enable = function() {
    expect(chrome.gcm).to.exist;
    var gcm = this;
    chrome.gcm.register([SENDER_ID], function(registrationId) {
        if(chrome.runtime.lastError) {
            console.log("GCM Registration failed");
            console.log(chrome.runtime.lastError);
            gcm.emit("disable");
        } else {
            gcm.registrationId = registrationId;
            gcm.emit("ready",{"gcm": gcm.registrationId});
        };
    });
};

GCMTransport.prototype.disable = function() {
    this.registrationId = undefined;
    _.forEach(this.connections, function(stream, key) {
        this._end(key);
    }, this);
};


GCMTransport.prototype.connect = function(publicKey, connectionInfo) {
    expect(publicKey).to.be.a("string");
    expect(curve.fromBase64(publicKey)).to.have.length(32);
    expect(connectionInfo).to.be.an("object");
    expect(connectionInfo).to.have.property("gcm");
    expect(connectionInfo.gcm).to.be.a("string");
    expect(this.registrationId).to.be.a("string");
    expect(this.registrationId).to.have.length.of.at.least(1);
    this.directoryCache[publicKey] = connectionInfo.gcm;
    if(connectionInfo.gcm in this.connections) {
        return;
    };
    var gcmStream = new GCMStream({
        source: this.registrationId,
        destination: connectionInfo.gcm
    });
    this.connections[connectionInfo.gcm] = new curve.CurveCPStream({
        stream: gcmStream,
        is_server: false,
        serverPublicKey: curve.fromBase64(publicKey),
        clientPublicKey: curve.fromBase64(this.publicKey),
        clientPrivateKey: curve.fromBase64(this.privateKey)
    });
    this.connectStream(this.connections[connectionInfo.gcm]);
};

GCMTransport.prototype.connectStream = function(stream) {
    expect(stream).to.exist;
    expect(stream).to.be.an.instanceof(curve.CurveCPStream);
    expect(stream.stream).to.exist;
    expect(stream.stream).to.be.an.instanceof(GCMStream);
    expect(stream.stream.destination).to.be.a("string");
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
        var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey;
        var publicKey = curve.toBase64(publicKey)
        gcm.emit("connectionEstablished", publicKey);
    });
    stream.on("data", function(data) {
        var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey;
        var publicKey = curve.toBase64(publicKey)
        data = JSON.parse(data);
        gcm.emit("message", publicKey, data);
    });
};

GCMTransport.prototype.disconnect = function(publicKey) {
    expect(publicKey).to.be.a("string");
    expect(curve.fromBase64(publicKey)).to.have.length(32);
    publicKey = curve.fromBase64(publicKey);
    _.forEach(this.connections, function(connection, index, collection) {
        if(publicKey === connection.clientPublicKey || publicKey === connection.serverPublicKey) {
            this._end(index);
        };
    }, this);
};

GCMTransport.prototype._end = function(destination) {
    expect(destination).to.be.a("string");
    expect(this.connections[destination]).to.exist;
    expect(this.connections[destination]).to.be.an.instanceof(curve.CurveCPStream);
    var stream = this.connections[destination];
    var publicKey = stream.is_server ? stream.clientPublicKey : stream.serverPublicKey;
    publicKey = curve.toBase64(publicKey);
    stream.removeAllListeners("end");
    stream.removeAllListeners("drain");
    stream.removeAllListeners("data");
    stream.removeAllListeners("error");
    delete this.connections[destination];
    gcm.emit("connectionStopped", publicKey);
};

GCMTransport.prototype.send = function(message) {
    expect(message).to.exist;
    expect(message).to.be.an("object");
    expect(message.destination).to.be.a("string");
    expect(curve.fromBase64(message.destination)).to.have.length(32);
    expect(message.source).to.be.a("string");
    expect(message.source).to.be.equal(this.publicKey);
    expect(this.directoryCache[message.destination]).to.exist;
    expect(this.directoryCache[message.destination]).to.be.a("string");
    expect(this.connections[this.directoryCache[message.destination]]).to.exist;
    expect(this.connections[this.directoryCache[message.destination]]).to.be.an.instanceof(curve.CurveCPStream);
    this.connections[this.directoryCache[message.destination]].write(JSON.stringify(message));
};

GCMTransport.prototype.onMessage = function(message) {
    expect(message.data.type).to.be.a("string");
    expect(this.connections).to.be.an("object");
    expect(this.registrationId).to.be.a("string");
    if(message.data.type === "MESSAGE") {
        expect(message.data.source).to.be.a("string");
        expect(message.data.destination).to.be.a("string");
        expect(message.data.data).to.be.a("string");
        if(message.data.destination !== this.registrationId) {
            console.log("message received which does not have our registrationId as destination");
        } else {
            var source = message.data.source;
            var stream;
            if(!this.connections[source]) {
                var stream = new GCMStream({
                    source: this.registrationId,
                    destination: source
                });
                this.connections[source] = new curve.CurveCPStream({
                    stream: stream,
                    is_server: true,
                    serverPublicKey: curve.fromBase64(this.publicKey),
                    serverPrivateKey: curve.fromBase64(this.privateKey)
                });
                this.connectStream(this.connections[source]);
            };
            stream = this.connections[source].stream;
            stream.emit('data', new Buffer(curve.fromBase64(message.data.data)));
        };
    } else if(message.data.type === "MESSAGE_DELIVERED") {
    } else if(message.data.type === "MESSAGE_NOT_DELIVERED") {
        expect(message.data.source).to.be.a("string");
        expect(message.data.destination).to.be.a("string");
        if(message.data.source !== this.registrationId) {
            console.log("message received that was not for us");
        } else {
            if(this.connections[message.data.destination]) {
                expect(this.connections[message.data.destination]).to.be.an.instanceof(curve.CurveCPStream);
                this.connections[message.data.destination].stream.error("Could not deliver message");
            };
        };
    } else if(message.data.type === "GET_REPLY") {
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
    expect(opts).to.be.an("object");
    expect(opts.source).to.be.a("string");
    expect(opts.destination).to.be.a("string");
    opts.objectMode = false;
    opts.decodeStrings = true;
    Duplex.call(this, opts);
    extend(this, opts);
};

inherits(GCMStream, Duplex);


/*
 * This method should not be called since we are using emit('data') to signal when new data is available
 */
GCMStream.prototype._read = function(size) {
    throw new Error("Method not implemented. Listen to emit('data') events");
};

GCMStream.prototype._write = function(chunk, encoding, done) {
    expect(Buffer.isBuffer(chunk)).to.be.true;
    expect(chunk).to.have.length.of.at.least(1);
    expect(done).to.be.an.instanceof(Function);
    expect(this.source).to.be.a("string");
    expect(this.destination).to.be.a("string");
    var stream = this;
    chrome.gcm.send({
        destinationId: SENDER_ID + "@gcm.googleapis.com",
        messageId: uuid.v4(),
        timeToLive: 0,
        data: {
            type: "MESSAGE",
            destination: stream.destination,
            source: stream.source, 
            data: curve.toBase64(new Uint8Array(chunk)) 
        }
    }, function(messageId) {
        if(chrome.runtime.lastError) {
            var message = "GCM: problem with sending message to app server (" + chrome.runtime.lastError.message + ")";
            done(new Error(message));
            stream.error(message);
        } else {
            done();
        };
    });
};

GCMStream.prototype.error = function(errorMessage) {
    expect(errorMessage).to.be.a("string");
    expect(errorMessage).to.have.length.of.at.least(1);
    this.emit("error", new Error(errorMessage));
    this.emit("end");
    this.emit("close");
};

module.exports = GCMTransport;
