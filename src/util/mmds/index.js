var storagejs = require("storagejs");
var verificationState = require("../../constants/verificationState.js");
var SyncStream = require('./sync-stream.js');
var Log = require('./collection.js');
var events = require("events");
var inherits = require("inherits");
var _ = require("lodash");

var SyncEngine = function(messaging, service, idAttribute, collection) {
    var engine = this;
    events.EventEmitter.call(this);
    this.messaging = messaging;
    this.log = new Log(service, idAttribute, collection); 
    this.log.on("processEvent", function(action, document) {
        engine.emit("processEvent", action, document);
    });
    this.service = service;
    this.syncStreams = {};
    this.devices = {};
    this.checkpoints = {};
    storagejs.get(this.service + "-checkpoints", {
        success: function(value) {
            engine.checkpoints = value;
            _.forEach(engine.syncStreams, function(stream, key) {
                if(_.has(this.checkpoints, key)) {
                    stream.setSequenceCheckpoint(this.checkpoints[key]);
                }
            }, engine);
        }
    });
    this.messaging.on("self.devices.update", this.updateDevices.bind(this));
    this.messaging.on("self." + this.service + ".last_sequence_request", function(topic, publicKey, data) {
        if(_.has(engine.syncStreams, publicKey)) {
            engine.syncStreams[publicKey].on_last_sequence_request(data);
        };

    });
    this.messaging.on("self." + this.service + ".last_sequence", function(topic, publicKey, data) {
        if(_.has(engine.syncStreams, publicKey)) {
            engine.syncStreams[publicKey].on_last_sequence(data);
        };
    });
    this.messaging.on("self." + this.service + ".event_request", function(topic, publicKey, data) {
        if(_.has(engine.syncStreams, publicKey)) {
            engine.syncStreams[publicKey].on_event_request(data);
        };

    });
    this.messaging.on("self." + this.service + ".events", function(topic, publicKey, data) {
        if(_.has(engine.syncStreams, publicKey)) {
            engine.syncStreams[publicKey].on_events(data);
        };
    });
    this.messaging.send("self.devices.updateRequest", "local", {});
};

inherits(SyncEngine, events.EventEmitter);

/* MESSAGE HANDLERS */

SyncEngine.prototype.updateDevices = function(topic, publicKey, data) {
    var engine = this;
    this.devices = data;
    var toAdd = _.filter(_.keys(this.devices), function(publicKey) {
        return !_.has(this.syncStreams, publicKey) && this.devices[publicKey].verificationState == verificationState.CONFIRMED;
    }, this);
    var toDelete = _.filter(_.keys(this.syncStreams), function(publicKey) {
        return !_.has(this.devices, publicKey) || this.devices[publicKey].verificationState < verificationState.CONFIRMED;
    }, this);
    _.forEach(toAdd, function(publicKey) {
        this.syncStreams[publicKey] = new SyncStream(publicKey, this.service, this.log, this.messaging);
        if(_.has(this.checkpoints, publicKey)) {
            this.syncStreams[publicKey].setSequenceCheckpoint(this.checkpoints[publicKey]);
        };
        this.syncStreams[publicKey].on("sequenceCheckpointUpdate", function(sequence) {
            engine.checkpoints[publicKey] = sequence;
            storagejs.put(engine.service + "-checkpoints", engine.checkpoints);
        });
    }, this);
    _.forEach(toDelete, function(publicKey) {
        this.syncStreams[publicKey].stop();
        delete this.syncStreams[publicKey];
    }, this);
};

/* API */

SyncEngine.prototype.add = function(id) {
    this.log.add(id);
};

SyncEngine.prototype.remove = function(id) {
    this.log.remove(id);
};

SyncEngine.prototype.update = function(id) {
    this.log.update(id);
};


module.exports = SyncEngine;
