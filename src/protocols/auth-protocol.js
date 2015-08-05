var inherits = require("inherits");
var events = require("events");
var _ = require("lodash");

var _generateCode = function() {
    var text = "";
    var possible = "abcdefghijklmnopqrstuvwxyz0123456789";
    for( var i=0; i < 6; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
};

var AuthProtocol = function(options) {
    events.EventEmitter.call(this)
    this.contacts = options.contacts;
    this.profile = options.profile;
    this.messaging = options.messaging;
};

inherits(AuthProtocol, events.EventEmitter);


AuthProtocol.prototype.setContacts = function(contacts) {
    this.contacts = contacts;
};


AuthProtocol.prototype.sendVerificationRequest = function(contact) {
    var options = {
        realtime: true,
        expireAfter: 60 * 60 * 24
    };
    contact.verificationCode = _generateCode();
    var data = {
        name: this.profile.name,
        accounts: this.profile.accounts
    };
    _.forEach(contact.instances, function(instance) {
        this.messaging.send(instance.key, "auth.verificationRequest", data, options);   
    }, this);
};


AuthProtocol.prototype.sendVerificationCode = function() {
};

module.exports = AuthProtocol;
