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

var verificationState = {
    UNKNOWN: 1,
    NOT_VERIFIED: 2,
    PENDING_VERIFICATION: 3,
    VERIFIED: 4
};

var AuthProtocol = function(options) {
    events.EventEmitter.call(this)
    this.contacts = options.contacts;
    this.profile = options.profile;
    this.messaging = options.messaging;
    this.messaging.on("public.auth.verificationRequest", function(message) {
        console.log("verification Request received");
    }, this);
    this.messaging.on("public.auth.verificationCode", function(message) {
        console.log("code verification received");
    }, this);
    this.messaging.on("friends.auth.contactVerification", function(message) {
        console.log("contact verification received");
    }, this);
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
    contact.verificationCodeForContact = _generateCode();
    var data = {
        name: this.profile.name,
        accounts: this.profile.accounts
    };
    _.forEach(_.keys(contact.keys), function(instance) {
        this.messaging.send(instance, "auth.verificationRequest", data, options);   
        contact.keys[instance].verificationState = verificationState.PENDING_VERIFICATION; 
    }, this);
};


AuthProtocol.prototype.sendVerificationCode = function() {
};

AuthProtocol.prototype.sendContactVerification = function() {
};

module.exports = AuthProtocol;
