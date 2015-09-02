"use strict";

var Collection;

var debug = require("debug")("mmds:db");
var uuid = require("node-uuid");
var _ = require("lodash");
var EventEmitter = require("events").EventEmitter;
var inherits = require("inherits");

Collection = function(opts) {
    if (!opts) {
        opts = {};
    };
    EventEmitter.call(this, opts);
    this.events = {};
    this.documents = {};
    var collection = this;
    this.resourceName = opts.resource;
};

inherits(Collection, EventEmitter);

Collection.prototype.uuid = uuid.v4;

Collection.prototype.add = function(dictionary) {
    debug("add model to collection: %s", JSON.stringify(dictionary));
    if (!_.has(dictionary, "uuid")) {
        dictionary.uuid = uuid.v4();
    };
    if (!_.has(dictionary, "lastModified")) {
        dictionary.lastModified = new Date().toJSON();
    };
    this.documents[dictionary.uuid] = dictionary;
    this.createNewEvent("create", this.documents[dictionary.uuid]);
    return dictionary.uuid;
};

Collection.prototype.delete = function(uuid) {
    debug("remove model from collection %s", uuid);
    delete this.documents[uuid];
    this.createNewEvent("delete", {uuid:
        uuid,
        lastModified: new Date().toJSON()
    });
};

Collection.prototype.update = function(uuid, changedAttributes) {
    debug("change model in collection: %s", JSON.stringify(changedAttributes));
    this.documents[uuid].lastModified = new Date().toJSON();
    _.forEach(changedAttributes, function(value, key) {
            this.documents[uuid][key] = value;        
    }, this);
    this.createNewEvent("change", this.documents[uuid]);
};

Collection.prototype.getAll = function() {
    return _.values(this.documents);
};

Collection.prototype.getLastSequence = function() {
    var lastSequence = _.max(this.events, function(event) {
        return event.sequence;
    });
    if (lastSequence === -Infinity) {
        lastSequence = 0;
    } else {
        lastSequence = lastSequence.sequence;
    };
    return lastSequence;
};

Collection.prototype.getEvent = function(sequence) {
    debug("lookup event sequence in log %s", sequence);
    var result = _.find(this.events, function(event) {
        return event.sequence === sequence;
    }, this);
    if (result === undefined) {
        result[0] = {
            action: "change",
            sequence: sequence,
            document: {}
        };
    };
    return result[0];
};

Collection.prototype.processEvent = function(event) {
    debug("process incoming event %s", JSON.stringify(event));
    var document = event.document;
    var lastModified = event.document.lastModified;
    var lastEvent = this.getLastEvent(document.uuid);
    var lastModifiedInCollection = new Date("1900/01/01").toJSON();
    if (lastEvent !== null && lastEvent !== undefined) {
        lastModifiedInCollection = lastEvent.document.lastModified;
    };
    if (lastModified > lastModifiedInCollection) {
        if (event.action === "delete") {
            delete this.documents[document.uuid];
            this.createNewEvent("delete", document);
        } else {
            this.documents[document.uuid] = document;
            this.createNewEvent(event.action, document);
        }
    }

};

Collection.prototype.getLastEvent = function(uuid) {
    debug("lookup last event for doc %s", uuid);
    return this.events[uuid];
};

Collection.prototype.createNewEvent = function(action, document) {
    debug("create new %s event for %s", action, JSON.stringify(document));
    var sequence = this.getLastSequence() + 1;
    var event = {};
    event.action = action;
    event.sequence = sequence;
    event.uuid = document.uuid;
    event.document = JSON.parse(JSON.stringify(document));
    this.events[event.uuid] = event;
    this.emit("newEvent", event);
};

module.exports = Collection;
