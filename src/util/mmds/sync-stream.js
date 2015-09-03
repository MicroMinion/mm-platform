var SyncStream;
var events = require("events");
var inherits = require("inherits");
var _ = require("lodash");

var SYNC_INTERVAL = 30000;

//TODO: Use options available for message sending (expireAfter, realtime)

function SyncStream(publicKey, service, log, messaging) {
    events.EventEmitter.call(this);
    this.publicKey = publicKey;
    this.service = service;
    this.log = log;
    this.messaging = messaging;
    this.sequenceCheckpoint = 0;
    this.afterCheckpointEvents = {};
    this.lastKnownSequence = 0;
    var stream = this;
    this.log.on("newEvent", this.sendEvent.bind(stream));
    this.send_last_sequence_request();
    this.intevalID = setInterval(this.send_last_sequence_request.bind(stream), SYNC_INTERVAL);
};

inherits(SyncStream, events.EventEmitter);

SyncStream.prototype.stop = function() {
    clearInterval(this.intervalID);
    this.intervalID = null;
};

/* LAST SEQUENCE REQUEST */

SyncStream.prototype.send_last_sequence_request = function() {
    this.messaging.send(this.service + ".last_sequence_request", this.publicKey, {});
};

SyncStream.prototype.on_last_sequence_request = function(message) {
    var data = {
        "lastSequence": this.log.getLastSequence()
    };
    this.messaging.send(this.service + ".last_sequence", this.publicKey, data);
};

/* LAST SEQUENCE */

SyncStream.prototype.on_last_sequence = function(data) {
    var lastSequence = data.lastSequence;
    this.lastKnownSequence = lastSequence;
    this.sendEventRequests(this.sequenceCheckpoint);
};

/* EVENTS REQUEST */

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
    this.messaging.send(this.service + ".event_request", this.publicKey, {sequences: sequences});
};

SyncStream.prototype.on_event_request = function(receivedData) {
    var data = [];
    for (var i = 0; i < receivedData.sequences.length; i++) {
        data.push(this.log.getEvent(receivedData.sequences[i]));
    };
    this.messaging.send(this.service + ".events", this.publicKey, data);
};

/* EVENTS */

SyncStream.prototype.sendEvent = function(event) {
    this.messaging.send(this.service + ".events", this.publicKey, [event]);
};


SyncStream.prototype.on_events = function(events) {
    for (var i = 0; i < events.length; i++) {
        this.on_event(events[i]);
    };
};

SyncStream.prototype.on_event = function(event) {
    var document = event.document;
    if (document === null || document === undefined) {
        this.addEvent(event.sequence);
    } else {
        this.log.processEvent(event);
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
            this.emit("sequenceCheckpointUpdate", this.sequenceCheckpoint);
        } else {
            incrementOK = false;
        }
    }
};

SyncStream.prototype.setSequenceCheckpoint = function(checkpoint) {
    this.sequenceCheckpoint = checkpoint;
    var deleteKeys = _.filter(_.keys[this.events], function(sequence) {
        return sequence <= checkpoint;
    }, this);
    _.forEach(deleteKeys, function(key) { delete this.events[key] }, this);
};

module.exports = SyncStream;
