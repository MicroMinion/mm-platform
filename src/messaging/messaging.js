var uuid = require("node-uuid");
var _ = require("lodash");
var ConnectionManager = require("./connection-manager.js");

var SEND_TIMEOUT = 10000;

var _profile = {};

var _contacts = {};

//Queue of messages that still need to be send, key is publicKey of destination
var _sendQueues = {};

//Callbacks, ordered by message id, value is a dictionary which can contain the following keys: success, error, warning
var _callBacks = {};

var connectionManager = new ConnectionManager();

var init = function(profile, contacts) {
    _profile = profile;
    _contacts = contacts;
    connectionManager.on("connection", function(publicKey) {
        _.forEach(_sendQueues[publicKey], function(message) {
            connectionManager.send(message);
        });
    });
    connectionManager.on("sendConfirmation", function(publicKey, id) {
        var message = _sendQueues[publicKey][id];
        delete _sendQueues[publicKey][id];
        if(_callBacks[id]) {
            if(_callBacks[id].success) {
                _callBacks[id].success(message);
            };
            delete _callBacks[id];
        };
    });
    connectionManager.on("sendError", function(publicKey, id) {
        //I think we only need this when there is an explicit timeing requirement and timeout has expired (e.g., if a message can not be send within 10 seconds)
    });
    setInterval(SEND_TIMEOUT, function() {
        _.forEach(_.keys(_sendQueues), function(publicKey) {
            _trigger(publicKey);
        });
    });
};


var send = function(publicKey, topic, data, options) {
    var message = {
        sender: profile.publicKey,
        destination: publicKey,
        id: options.id ? options.id : uuid.v4(), 
        topic: topic,
        data: data
    };
    _callBacks[message.id] = options;
    if(!_sendQueues[message.destination]) {
        _sendQueues[message.destination] = {};
    };
    _sendQueues[message.destination][message.id] = message;
    if(options.realtime) {
        process.nextTick(_trigger.bind(null, message.destination));
    };

};

var _trigger = function(publicKey) {
   if(_sendQueues[publicKey]) {
        connectionManager.connect(publicKey);          
    };
};


module.exports = {
    init: init,
    send: send
};
