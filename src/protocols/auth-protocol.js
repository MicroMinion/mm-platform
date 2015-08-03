var messaging = require("../messaging/messaging.js");
var _ = require("lodash");

var contacts = {};

var profile = {};

var init = function(_contacts, _profile) {
    contacts = _contacts;
    profile = _profile;
};


var options = {
    realtime: true,
    success: function(msg) {
        console.log(msg);
    },
    error: function(err) {
        console.log(err);
    },
    warning: function(warning) {
        console.log(warning);
    },
};


var _generateCode = function() {
    var text = "";
    var possible = "abcdefghijklmnopqrstuvwxyz0123456789";
    for( var i=0; i < 6; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
};

var sendVerificationRequest = function(contact) {
    contact.verificationCode = _generateCode();
    data = {
        name: profile.name,
        accounts: profile.accounts
    };
    _.forEach(contact.instances, function(instance) {
        messaging.send(instance.key, "auth.verificationRequest", data, options);   
    });
};


var sendVerificationCode = function() {
};

module.exports = {
    init: init,
    sendVerificationRequest: sendVerificationRequest,
    sendVefificationCode: sendVerificationCode
};
