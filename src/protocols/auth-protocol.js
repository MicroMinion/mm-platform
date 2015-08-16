var inherits = require("inherits");
var events = require("events");
var _ = require("lodash");
var uuid = require("node-uuid");

var _generateCode = function() {
    var text = "";
    var possible = "0123456789";
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
    events.EventEmitter.call(this);
    var authProtocol = this;
    this.contacts = options.contacts;
    this.profile = options.profile;
    this.messaging = options.messaging;
    this.messaging.on("public.auth.verificationRequest", function(topic, message) {
        console.log("verification Request received");
        var accountsReceived = _.map(message.data.accounts, function(account) {
            return account.type + ":" + account.id;
        }, this);
        var contact = _.find(this.contacts, function(contact, uuid, contacts) {
            var accountsStored = _.map(contact.accounts, function(account) {
                return account.type + ":" + account.id;
            }, authProtocol);
            return _.has(contact.keys, message.source) || _.size(_.intersection(accountsStored, accountsReceived)); 
        }, this);
        if(!contact) {
            var contact = {
                uuid: uuid.v4(),
                name: message.data.name,
                accounts: message.data.accounts,
                keys: {}
            };
            this.contacts[contact.uuid] = contact;
        };
        if(!contact.keys[message.source]) {
            contact.keys[message.source] = {
            };
        };
        contact.keys[message.source].publicKey = message.source;
        contact.keys[message.source].verificationState = verificationState.PENDING_VERIFICATION;
        contact.keys[message.source].verificationRequestReceived = true;
        if(!contact.verificationState || contact.verificationState < verificationState.PENDING_VERIFICATION) {
           contact.verificationState = verificationState.PENDING_VERIFICATION;
        };
        if(!contact.verificationCodeForContact) {
            contact.verificationCodeForContact = _generateCode();
        };
        this.messaging.send(message.source, "auth.verificationRequestConfirmation", {}, {realtime: true, expireAfter: 1000 * 60});
        this.emit("contactsUpdate");
    }, this);
    this.messaging.on("public.auth.verificationRequestConfirmation", function(topic, message) {
        var contact = _.find(this.contacts, function(contact, uuid, contacts) {
            return _.has(contact.keys, message.source);
        }, this);
        if(contact) {
            contact.keys[message.source].verificationRequestConfirmationReceived = true;
        };
        this.emit("contactsUpdate");
    }, this);
    this.messaging.on("public.auth.verificationCode", function(topic, message) {
        var contact = _.find(this.contacts, function(contact, uuid, contacts) {
            return _.has(contact.keys, message.source);
        }, this);
        console.log("code verification received");
        if(message.data.code === contact.verificationCodeForContact) {
            contact.keys[message.source].verificationState = verificationState.VERIFIED;
            this.emit("contactsUpdate");
            if(contact.verificationCodeFromContact) {
                this.sendContactVerification(message.source, true);
            };
        } else {
            //TODO: Send verification error
        };
    }, this);
    this.messaging.on("friends.auth.contactVerification", function(topic, message) {
        console.log("contact verification received");
        var contact = _.find(this.contacts, function(contact, uuid, contacts) {
            return _.has(contact.keys, message.source);
        }, this);
        contact.verificationState = verificationState.VERIFIED;
        if(message.data.requestReply) {
            this.sendContactVerification(message.source, false);
        };
        this.emit("contactsUpdate");
    }, this);
    setInterval(function() {
        _.forEach(authProtocol.contacts, function(contact) {
            if(contact.verificationState === verificationState.PENDING_VERIFICATION) {
                //No key where we have received a confirmation for verification request
                if(_.every(contact.keys, function(key) { 
                    return !key.verificationRequestConfirmationReceived && !key.verificationRequestReceived;
                })) {
                    this._sendVerificationRequest(contact);
                };
            };
        }, authProtocol);
    }, 1000 * 60);
};

inherits(AuthProtocol, events.EventEmitter);


AuthProtocol.prototype.setContacts = function(contacts) {
    this.contacts = contacts;
};

AuthProtocol.prototype.sendVerificationRequest = function(contact) {
    if(!contact.verificationCodeForContact) {
        contact.verificationCodeForContact = _generateCode();
    };
    this._sendVerificationRequest(contact);
};


AuthProtocol.prototype._sendVerificationRequest = function(contact) {
    //Check if there is a key we haven't tried sending yet
    var value = _.find(contact.keys, function(value, key, keys) {
        return value.verificationState < verificationState.PENDING_VERIFICATION;
    }, this);
    if(value) {
        this._sendVerificationRequestToInstance(value.publicKey, contact);
    } else {
        this._sendVerificationRequestToInstance(_.sample(_.keys(contact.keys)), contact);
    };
    this.emit("contactsUpdate");
};

AuthProtocol.prototype._sendVerificationRequestToInstance = function(publicKey, contact) {
    var options = {
        realtime: true,
        expireAfter: 1000 * 60,
    };
    var data = {
        name: this.profile.name,
        accounts: this.profile.accounts
    };
    if(contact.keys[publicKey].verificationState < verificationState.PENDING_VERIFICATION) {
        contact.keys[publicKey].verificationState = verificationState.PENDING_VERIFICATION;
    };
    this.messaging.send(publicKey, "auth.verificationRequest", data, options);
    this.emit("contactsUpdate");
};

AuthProtocol.prototype.sendVerificationCode = function(contact) {
    var options = {
        realtime: true,
        expireAfter: 1000 * 60 * 60
    };
    var data = {
        code: contact.verificationCodeFromContact
    };
    _.forEach(_.keys(contact.keys), function(instance) {
        if(contact.keys[instance].verificationRequestReceived || contact.keys[instance].verificationRequestConfirmationReceived) {
            this.messaging.send(instance, "auth.verificationCode", data, options);
        };
    }, this);
};

AuthProtocol.prototype.sendContactVerification = function(publicKey, requestReply) {
    this.messaging.send(publicKey, "auth.contactVerification", {requestReply: requestReply}, {realtime: true});
};

module.exports = AuthProtocol;
