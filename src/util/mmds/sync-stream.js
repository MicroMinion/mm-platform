var SyncStream;

var debug = require("debug")("mmds:stream");
var Duplex = require("stream").Duplex;
var inherits = require("inherits");
var extend = require("extend.js");

function SyncStream(opts) {
    if (!opts) { opts = {}; }
    opts.objectMode = true;
    Duplex.call(this, opts);
    extend(this, {
        own_id: null,
        SYNC_INTERVAL: 30000, //Sync interval in milliseconds
        peer_id: null,
        db: null,
        sequenceCheckpoint: 0,
        afterCheckpointEvents: new Object(),
        lastKnownSequence: 0,
        receivedCount: 0,
        receivedBytes: 0,
        sendCount: 0,
        sendBytes: 0
    }, opts);
    var stream = this;
    this.db.on("newEvent", this.sendEvent.bind(stream));
    this.send_last_sequence_request();
    this.intevalID = setInterval(this.send_last_sequence_request.bind(stream), this.SYNC_INTERVAL);
};

inherits(SyncStream, Duplex);

SyncStream.prototype.stop = function() {
    clearInterval(this.intervalID);
    this.intervalID = null;
};

SyncStream.prototype._read = function(size) {
};

SyncStream.prototype._received_packet = function(packet) {
    this.receivedCount = this.receivedCount + 1;
    this.receivedBytes = this.receivedBytes + JSON.stringify(packet).length;
}

SyncStream.prototype._send_packet = function(packet) {
    this.sendCount = this.sendCount + 1;
    this.sendBytes = this.sendBytes + JSON.stringify(packet).length;
};

SyncStream.prototype._write = function(chunk, encoding, done) {
    debug("%s process incoming packet %s", this.own_id, JSON.stringify(chunk));
    this._received_packet(chunk);
    if (chunk.type == "last_sequence_request") {
        this.on_last_sequence_request(chunk);
        done();
    } else if (chunk.type == "last_sequence") {
        this.on_last_sequence(chunk);
        done();
    } else if (chunk.type == "event_request") {
        this.on_event_request(chunk);
        done();
    } else if (chunk.type == "events") {
        this.on_events(chunk);
        done();
    } else {
        done(new Error("unknown command"));   
    };

};

SyncStream.prototype.send_last_sequence_request = function() {
    debug("%s send last sequence request", this.own_id);
    var message = {};
    message.type = "last_sequence_request";
    message.id = this.own_id;
    message.payload = {};
    this._send_packet(message);
    this.push(message);
};

SyncStream.prototype.on_last_sequence_request = function(message) {
    debug("%s process last sequence request", this.own_id);
    var send_message = {};
    send_message.id = this.own_id;
    this.peer_id = message.id;
    send_message.type = "last_sequence";
    send_message.payload = {
        "lastSequence": this.db.getLastSequence()
    };
    this._send_packet(send_message);
    this.push(send_message);
};

SyncStream.prototype.on_last_sequence = function(message) {
    debug("%s process last sequence packet", this.own_id);
    var lastSequence = message.payload.lastSequence;
    this.lastKnownSequence = lastSequence;
    this.sendEventRequests(this.sequenceCheckpoint);
};

SyncStream.prototype.sendEventRequests = function(startSequence) {
    var sequences = [];
    var events = this.afterCheckpointEvents;
    var i = startSequence + 1;
    for (; i <= this.lastKnownSequence && sequences.length <= 10; i++) {
        if (!events[i]) {
            sequences.push(i);
        };
    };
    if (sequences.length > 0) {
        this.send_event_request(sequences);
    };
    if (i < this.lastKnownSequence) {
        this.sendEventRequests(i - 1);
    };
};

SyncStream.prototype.send_event_request = function(sequences) {
    debug("%s send event request", this.own_id);
    var message = {};
    message.type = "event_request";
    message.payload = {
        sequences: sequences
    };
    this._send_packet(message);
    this.push(message);
};

SyncStream.prototype.sendEvent = function(event) {
    debug("%s push event %s", this.own_id, JSON.stringify(event));
    var message = {};
    message.type = "events";
    message.payload = [];
    message.payload.push(event);
    this._send_packet(message);
    this.push(message);
};

SyncStream.prototype.on_event_request = function(message) {
    debug("%s process event request", this.own_id);
    var send_message = {};
    send_message.type = "events";
    send_message.payload = [];
    for (var i = 0; i < message.payload.sequences.length; i++) {
        send_message.payload.push(this.db.getEvent(message.payload.sequences[i]));
    };
    this._send_packet(send_message);
    this.push(send_message);
};

SyncStream.prototype.on_events = function(message) {
    debug("%s process events", this.own_id);
    var events = message.payload;
    for (var i = 0; i < events.length; i++) {
        this.on_event(events[i]);
    };
};

SyncStream.prototype.on_event = function(event) {
    debug("%s process event %s", this.own_id, JSON.stringify(event));
    var document = event.document;
    if (document === null || document === undefined) {
        this.addEvent(event.sequence);
    } else {
        this.db.processEvent(event);
        this.addEvent(event.sequence);
    }
};

SyncStream.prototype.addEvent = function(sequence) {
    this.afterCheckpointEvents[sequence] = true;
    this.updateCheckpoint();
};

SyncStream.prototype.updateCheckpoint = function() {
    var events = this.afterCheckpointEvents;
    var incrementOK = true;
    while (incrementOK) {
        if (events[this.sequenceCheckpoint + 1]) {
            delete this.afterCheckpointEvents[this.sequenceCheckpoint + 1];
            this.sequenceCheckpoint = this.sequenceCheckpoint + 1;
        } else {
            incrementOK = false;
        }
    }
};

module.exports = SyncStream;
