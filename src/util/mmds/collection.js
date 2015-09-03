"use strict";

var Log;

var uuid = require("node-uuid");
var _ = require("lodash");
var EventEmitter = require("events").EventEmitter;
var inherits = require("inherits");
var storagejs = require("storagejs");

Log = function(name, idAttribute, collection) {
    EventEmitter.call(this);
    this.events = {};
    this.name = name + "-log";
    this.idAttribute = idAttribute;
    this.collection = collection;
    this._loadLog();
};


inherits(Log, EventEmitter);


Log.prototype.setCollection = function(collection) {
    this.collection = collection;
};

Log.prototype._loadLog = function() {
    var log = this;
    var options = {
        success: function(value) {
            log.events = value;
        }
    };
    storagejs.get(log.name, options);
};

/* LOCAL LOG MODIFICATION */

Log.prototype.add = function(id) {
    if(!_.has(this.collection[id][this.idAttribute])) {
        this.collection[id][this.idAttribute] = id;
    };
    this.collection[id].lastModified = new Date().toJSON();
    this._createNewEvent("add", this.collection[id]);
};

Log.prototype.remove = function(id) {
    var data = {};
    data[this.idAttribute] = id;
    data.lastModified = new Date().toJSON();
    this._createNewEvent("remove", data);
};

Log.prototype.update = function(id) {
    if(!_.has(this.collection[id][this.idAttribute])) {
        this.collection[id][this.idAttribute] = id;
    };
    this.collection[id].lastModified = new Date().toJSON();
    this._createNewEvent("update", this.collection[id]);
};

Log.prototype._createNewEvent = function(action, document) {
    var sequence = this.getLastSequence() + 1;
    var event = {};
    event.action = action;
    event.sequence = sequence;
    event[this.idAttribute] = document[this.idAttribute];
    event.document = JSON.parse(JSON.stringify(document));
    this.events[event[this.idAttribute]] = event;
    storagejs.put(this.name, this.events);
    this.emit("newEvent", event);
};

/* HELPER METHODS FOR SYNC STREAMS */

Log.prototype.getLastSequence = function() {
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


Log.prototype.getEvent = function(sequence) {
    var result = _.find(this.events, function(event) {
        return event.sequence === sequence;
    }, this);
    if (result === undefined) {
        result = {
            action: "update",
            sequence: sequence,
            document: {}
        };
    };
    return result;
};

Log.prototype.processEvent = function(event) {
    var document = event.document;
    var lastModified = event.document.lastModified;
    var lastEvent = this.getLastEvent(document[this.idAttribute]);
    var lastModifiedInCollection = new Date("1900/01/01").toJSON();
    if (lastEvent !== null && lastEvent !== undefined) {
        lastModifiedInCollection = lastEvent.document.lastModified;
    };
    if (lastModified > lastModifiedInCollection) {
        this.emit("processEvent", event.action, document);
        this._createNewEvent(event.action, document);
    }
};

Log.prototype.getLastEvent = function(id) {
    return this.events[id];
};

module.exports = Log;
