var inherits = require("inherits");
var _ = require("lodash");
var storagejs = require("storagejs");
var extend = require("extend.js");
var chai = require("chai");
var curve = require("curve-protocol");
var useragent = require("useragent");
var qrImage = require("qr-image");
var directory = require("../directory/directory.js");

var PUBLISH_INTERVAL = 1000 * 60 * 5;

var Profile = function(messaging) {
    var profile = this;
    this.messaging = messaging;
    this.profile = {
            info: {
                name: "",
                device: "",
                accounts: [],
                canScan: false
            },
            publicKey: null,
            privateKey: null,
            authenticated: false,
    };
    this.loadProfile();
    this.messaging.on("self.profile.newCodeNeeded", function(topic, publicKey, data) {
        profile.setCode();
    });
    this.messaging.on("self.profile.updateRequest", function(topic, publicKey, data) {
        profile.update(false);
    });
    this.messaging.on("self.profile.updateInfo", function(topic, publicKey, data) {
        profile.profile.info = data.info;
        profile.updateAuthenticationState();
        profile.update(true);
    });
    this.messaging.on("self.profile.updateType", function(topic, publicKey, data) {
        profile.setType(data.type, data.application);
    });
    this.messaging.on("self.profile.publish", function(topic, publicKey, data) {
        profile.publishUser();
    });
    setInterval(function() {
        if(profile.profile.authenticated) {
            profile.publishUser();
        };
    }, PUBLISH_INTERVAL);
};

Profile.prototype.update = function(regenerateQr) {
    if(regenerateQr) {
        this.updateQrCodeText();
    };
    if(this.profile.privateKey) {
        this.messaging.send("profile.update", "local", this.profile);
    };
    storagejs.put("profile", this.profile);
};

Profile.prototype.setCode = function() {
    this.profile.code = curve.toBase64(curve.randomBytes(20));
    this.update(true);
};

Profile.prototype.loadProfile = function() {
    var profile = this;
    var options = {
        success: function(state) {
            profile.profile = state;
            profile.setDefaults();
            profile.update(false);
            profile.messaging.send("profile.ready", "local", {});
            profile.publishUser();
        },

        error: function(error) {
            profile.setDefaults();
            profile.messaging.send("profile.ready", "local", {});
        }
    };
    storagejs.get("profile", options);
};


Profile.prototype.setDefaults = function() {
    if(!this.profile.info) {
        this.profile.info = {};
    };
    this.setKeys();
    this.setDeviceName();
    this.setScan();
    if(!this.profile.code) {
        this.setCode();
    };
};

Profile.prototype.publishUser = function() {
    _.forEach(this.profile.info.accounts, function(account) {
        var key = account.type + ":" + account.id;
        directory.put(key, this.profile.publicKey);
    }, this);
};

Profile.prototype.setKeys = function() {
    if(!this.profile.privateKey) {
        var keypair = curve.generateKeypair();
        this.profile.publicKey = curve.toBase64(keypair.publicKey);
        this.profile.privateKey = curve.toBase64(keypair.secretKey);
        this.update(true);
    };
};

Profile.prototype.setScan = function() {
    var canScan = false;
    try {
        if(!_.isUndefined(cloudSky.zBar.scan)) {
            canScan = true;
        } else {
            canScan = false;
        };
    } catch (e) {
        canScan = false;
    };
    if(canScan !== this.profile.info.canScan) {
        this.profile.info.canScan = canScan;
        this.update(true);
    };
};


Profile.prototype.setType = function(type, application) {
    if(type !== this.profile.info.type) {
        this.profile.info.type = type;
        this.update(true);
    };
    if(application !== this.profile.info.application) {
        this.profile.info.application = application;
        this.update(true);
    };
};


Profile.prototype.setDeviceName = function() {
    if(!this.profile.info.device || this.profile.info.device === "") {
        if(!_.isUndefined(window.cordova) && !_.isUndefined(window.device)) {
            this.profile.info.device = device.platform + " " + device.version + " on " + device.model;
            this.update(true);
        } else if(!_.isUndefined(window.navigator.userAgent)) {
            var agent = useragent.parse(window.navigator.userAgent);
            this.profile.info.device = agent.os.toString().replace(" 0.0.0","");
            if(agent.device.toString() !== "Other 0.0.0") {
                this.profile.info.device += " on " + agent.device.toString();
            }
            this.profile.info.device += " (" + agent.toAgent() + ")";
            this.update(true);
        };
    };
};

Profile.prototype.updateAuthenticationState = function() {
    var authenticated = (this.profile.privateKey !== null) && (this.profile.info.accounts.length > 0);
    if(authenticated !== this.profile.authenticated) {
        this.profile.authenticated = authenticated;
        this.update(false);
    };
};

Profile.prototype.updateQrCodeText = function() {
    var qrCodeText = JSON.stringify({
        code: this.profile.code,
        publicKey: this.profile.publicKey,
        info: this.profile.info
    });
    var pngBuffer = qrImage.imageSync(qrCodeText, {type: 'png', margin: 1});
    var dataURI = 'data:image/png;base64,' + pngBuffer.toString('base64');
    this.profile.qrCodeText = dataURI;
};

module.exports = Profile;