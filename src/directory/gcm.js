var Backoff = require("backoff");
var uuid = require("node-uuid");
var _ = require("lodash");


var SENDER_ID = "559190877287";
var registrationId;
var backoff = Backoff.fibonacci({
    initialDelay: 1,
    maxDelay: 10000,
    randomisationFactor: 0
});

var pendingMessages = {};

backoff.on("ready", function() {
    chrome.gcm.register([SENDER_ID], function(id) {
        if(chrome.runtime.lastError) {
            console.log("GCM registration failed");
            console.log(chrome.runtime.lastError);
            backoff.backoff();
        } else {
            console.log("registration succeeded");
            registrationId = id;
            backoff.reset();
        }
    });
});

var onMessage = function(message) {
    if(message.data.type === "GET_REPLY") {
        if(pendingMessages[message.data.id].success) {
            var values = JSON.parse(message.data.values);
            _.forEach(values, function(value) {
                pendingMessages[message.data.id].success(message.data.key, value);
            });
        };
        delete pendingMessages[message.data.id]
    }
};


var onSendError = function(error) {
    console.log("GCM: Send error");
    console.log(error.errorMessage);
    console.log(error.messageId);
    console.log(error.details);
};

chrome.gcm.onMessage.addListener(onMessage);
chrome.gcm.onSendError.addListener(onSendError);

var get = function(key, options) {
    _send({type: "GET", key: key}, options);
};


var put = function(key, value, options) {
    _send({type: "PUT", key: key, value: value}, options);
};


var _send = function(data, options) {
    var id = uuid.v4();
    pendingMessages[id] = options;
    if(data.type === "GET") {
    setTimeout(function() {
        if(pendingMessages[id] && pendingMessages[id].error) {
            pendingMessages[id].error("operation timed out");
        };
        delete pendingMessages[id];
    }, 1000);
    };
    data.id = id;
    chrome.gcm.send({
        destinationId: SENDER_ID + "@gcm.googleapis.com",
        messageId: id,
        timeToLive: 0,
        data: data 
    }, function(messageId) {
        if(chrome.runtime.lastError) {
            console.log("GCM: problem with sending messages to app server");
            console.log(chrome.runtime.lastError);
            if(pendingMessages[messageId] && pendingMessages[messageId].error) {
                pendingMessages[messageId].error("GCM: problem with sending messages to app server");
            };
            delete pendingMessages[messageId];
        } else {
            if(data.type === "PUT") {
                if(pendingMessages[messageId] && pendingMessages[messageId].success) {
                    pendingMessages[messageId].success();
                };
                delete pendingMessages[messageId];
            };
        };
    });
};

module.exports = {
    get: get,
    put: put
}
