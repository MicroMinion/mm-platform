var inherits = require("inherits");
var events = require("events");
var _ = require("lodash");
var uuid = require("node-uuid");
var chai = require("chai");
var storagejs = require("storagejs");
var extend = require('extend.js');

var expect = chai.expect;

var _generateCode = function() {
    var text = "";
    var possible = "0123456789";
    for( var i=0; i < 6; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
};

var AuthenticationManager = function(options) {
    events.EventEmitter.call(this);
    var manager = this;
    this.profile = options.profile;
    this.name = options.name;
    this.scope = options.scope;
    this.messaging = options.messaging;
    this.ongoingVerifications = {};
    this.messaging.on("public." + this.name + ".initiate", this.onInitiate.bind(this));
    this.messaging.on("public." + this.name + ".code", this.onCode.bind(this));
    this.messaging.on(this.scope + "." + this.name + ".confirmation", this.onConfirmation.bind(this));
    var options = {
        success: function(value) {
            _.forEach(value, function(protocol, publicKey) {
                manager.connectProtocol(publicKey, protocol);
                manager.startVerification(publicKey);
            });
        },
    };
    storagejs.get(this.name, options);
};

inherits(AuthenticationManager, events.EventEmitter);

AuthenticationManager.prototype.connectProtocol = function(publicKey, protocolState) {
    expect(publicKey).to.be.a("string");
    var manager = this;
    if(!protocolState) {
        protocolState = {};
    };
    var protocol = new PublicKeyVerificationProtocol(publicKey, this.profile, protocolState);
    protocol.name = this.name;
    protocol.scope = this.scope;
    protocol.on("message", function(publicKey, topic, data, options) {
        manager.messaging.send(topic, publicKey, data, options);           
    });
    protocol.on("newCodeNeeded", function() {
        manager.emit("newCodeNeeded");
    });
    protocol.on("verified", function(publicKey) {
        manager.emit("verified", publicKey);
    });
    protocol.on("confirmed", function(publicKey) {
        manager.emit("confirmed", publicKey);
        delete manager.ongoingVerifications[publicKey];
        manager.save();
    });
    protocol.on('stateUpdate', this.save.bind(manager));
    protocol.on("codeChanged", function(publicKey, code) {
        manager.emit("codeChanged", publicKey, code);
    });
    this.ongoingVerifications[publicKey] = protocol;
    this.emit("codeChanged", publicKey, protocol.ourCode);
};

AuthenticationManager.prototype.save = function() {
    var state = {};
    _.forEach(this.ongoingVerifications, function(protocol, publicKey) {
        state[publicKey] = protocol.getState();
    }, this);
    storagejs.put(this.name, state);
};

AuthenticationManager.prototype.onInitiate = function(topic, publicKey, data) {
    this.emit("newInstance", publicKey, data);
    if(!_.has(this.ongoingVerifications, publicKey)) {
        this.connectProtocol(publicKey, {});
    };
    this.ongoingVerifications[publicKey].onInitiate(data);
};

AuthenticationManager.prototype.onCode = function(topic, publicKey, data) {
    if(_.has(this.ongoingVerifications, publicKey)) {
        this.ongoingVerifications[publicKey].onCode(data);
    };
};

AuthenticationManager.prototype.onConfirmation = function(topic, publicKey, data) {
    if(_.has(this.ongoingVerifications, publicKey)) {
        this.ongoingVerifications[publicKey].onConfirmation(data);       
    };
};

AuthenticationManager.prototype.startVerification = function(publicKey) {
    if(!_.has(this.ongoingVerifications, publicKey)) {
        this.connectProtocol(publicKey, {});
    };
    this.ongoingVerifications[publicKey].start();

};

AuthenticationManager.prototype.setCode = function(publicKey, codeType, code) {
    expect(this.ongoingVerifications).to.have.property(publicKey);
    this.ongoingVerifications[publicKey].setCode(codeType, code);
};

AuthenticationManager.prototype.changeOurCode = function(publicKey, code) {
    expect(this.ongoingVerifications).to.have.property(publicKey);
    this.ongoingVerifications[publicKey].setOurCode(code);
};

var PublicKeyVerificationProtocol = function(publicKey, profile, protocolState) {
    events.EventEmitter.call(this);
    this.publicKey = publicKey;
    this.profile = profile;
    this.initiateSend = false;
    this.initiateReceived = false;
    this.codeSend = false;
    this.codeReceived = false;
    this.confirmationSend = false;
    this.confirmationReceived = false;
    extend(this, protocolState);
    if(!this.ourCode) {
        this.generateOurCode();
    };
};

inherits(PublicKeyVerificationProtocol, events.EventEmitter);

PublicKeyVerificationProtocol.prototype.generateOurCode = function() {
    this.setOurCode(_generateCode());
    this.emit("codeChanged", this.publicKey, this.ourCode);
};

PublicKeyVerificationProtocol.prototype.setOurCode = function(code) {
    this.ourCode = code;
    this.emit('stateUpdate');
};

PublicKeyVerificationProtocol.prototype.getState = function() {
    return {
        initiateSend: this.initiateSend,
        initiateReceived: this.initiateReceived,
        codeSend: this.codeSend,
        codeReceived: this.codeReceived,
        confirmationSend: this.confirmationSend,
        confirmationReceived: this.confirmationReceived,
        ourCode: this.ourCode,
        otherCode: this.otherCode,
        otherCodeType: this.otherCodeType
    };
};

/* INITIATE LOGIC */

PublicKeyVerificationProtocol.prototype.start = function() {
    if(!this.initiateReceived) {
        this.sendInitiate();
    } else if(!this.codeReceived && this.otherCode) {
        this.sendCode();
    } else if(this.codeReceived && this.codeSend && !this.confirmationReceived) {
        this.sendConfirmation();
    };
};


PublicKeyVerificationProtocol.prototype.sendInitiate = function(reply) {
    var options = {
        realtime: true,
        expireAfter: 1000 * 60
    };
    if(!reply) {
        reply = false;
    };
    this.initiateSend = true;
    var data = {
        info: this.profile.info,
        reply: reply
    }
    this.emit("message", this.publicKey, this.name + ".initiate", data, options);
    this.emit('stateUpdate');
};


PublicKeyVerificationProtocol.prototype.onInitiate = function(data) {
    this.initiateReceived = true;
    this.emit('stateUpdate');
    if(!data.reply) {
        this.sendInitiate(true);
    };
    if(this.initiateSend && this.initiateReceived && this.otherCode) {
        this.sendCode();
    };
};

/* CODE LOGIC */

PublicKeyVerificationProtocol.prototype.setCode = function(codeType, code) {
    this.otherCodeType = codeType;
    this.otherCode = code;
    this.emit('stateUpdate');
    if(this.initiateSend && this.initiateReceived) {
        this.sendCode();
    };
};

PublicKeyVerificationProtocol.prototype.sendCode = function() {
    expect(this.initiateSend).to.be.true;
    expect(this.initiateReceived).to.be.true;
    expect(this.otherCode).to.exist;
    expect(this.otherCodeType).to.exist;
    var options = {
        realtime: true,
        expireAfter: 1000 * 60
    };
    var data = {
        codeType: this.otherCodeType,
        code: this.otherCode
    };
    this.emit("message", this.publicKey, this.name + ".code", data, options);
    this.codeSend = true;
    this.emit('stateUpdate');
};

PublicKeyVerificationProtocol.prototype.onCode = function(data) {
    if(this.initiateSend && this.initiateReceived && !this.codeReceived) {
        var codeValid = false;
        if(data.codeType === "qr") {
            codeValid = (data.code === this.profile.code);
            if(codeValid) {
                this.emit("newCodeNeeded");
            };
        } else if(data.codeType === "sixdots") {
            codeValid = (data.code === this.ourCode);
            if(!codeValid) {
                this.generateOurCode();
            };
        };
        if(codeValid) {
            this.codeReceived = true;
            this.emit("verified", this.publicKey);
            this.emit('stateUpdate');
            if(this.codeSend) {
                this.sendConfirmation();
            } else if(this.otherCode) {
                this.sendCode();
            };
        };
    };
};

/* CONFIRMATION LOGIC */

PublicKeyVerificationProtocol.prototype.sendConfirmation = function(reply) {
    var options = {
        realtime: true,
        expireAfter: 1000 * 60
    };
    if(!reply) {
        reply = false;
    };
    var data = {
        reply: reply
    };
    this.emit("message", this.publicKey, this.name + ".confirmation", data, options);
    this.confirmationSend = true;
    this.emit('stateUpdate');
};

PublicKeyVerificationProtocol.prototype.onConfirmation = function(data) {
    expect(this.initiateSend).to.be.true;
    expect(this.initiateReceived).to.be.true;
    expect(this.codeReceived).to.be.true;
    expect(this.codeSend).to.be.true;
    if(!data.reply) {
        this.sendConfirmation();
    };
    if(this.sendConfirmation) {
        this.emit("confirmed", this.publicKey);
    };
    this.confirmationReceived = true;
    this.emit('stateUpdate');
};

module.exports = AuthenticationManager;
