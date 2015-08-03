var inherits = require("inherits");
var events = require("events");
var directory = require("../directory.js");

//ordered by publicKey, value is connection
var _connectionPool = {};

//ordered by publicKey, value is DHT info
var _destinationInfo = {};

//ordered by publicKey, then method. Keeps attributes: connectionCount, lastConnectionTime, lastconnectionParams, lastDHTUpdate
var _connectionStats = {};


function ConnectionManager() {
    this.transports = {};

};

inherits(ConnectionManager, events.EventEmitter); 

ConnectionManager.prototype.connect = function(publicKey) {
    if(_connnectionPool[publicKey]) {
        this.emit("connection", publicKey);
    } else {
        //connect
    };
};

ConnectionManager.prototype.send = function(message) {

};



module.exports = ConnectionManager;
