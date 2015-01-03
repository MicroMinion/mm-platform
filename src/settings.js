var Backbone = require("backbone");
var Brace = require("backbone-brace");
var Device = require("flunky-utils").Device;
var User = require("flunky-utils").User;
Backbone.LocalStorage = require("backbone.localstorage");

var Settings = Brace.Model.extend({

    localStorage: new Store("Settings"),

    defaults: {
        id: 1,
    },

    namedAttributes: {
        device: Device,
        user: User
    },

    createNewConfig: function() {
        var device = new Device();
        device.generateIdentity();
        this.setDevice(device);
    },

    createNewUser: function(name, description, email) {
        var user = new User();
        user.generate(name, description, email);
        this.setUser(user);
    },

    addUser: function(user) {
        var user = new User();
        user.set(user);
        this.setUser(user);
    },

    initialize: function() {
        this.listenTo(this, "change: user", function() {
            this.listenTo(this.getUser(), "change", function() {
                this.trigger("change");
                this.save();
            });
        });
        this.listenTo(this, "change: device", function() {
            this.listenTo(this.getDevice(), "change", function() {
                this.trigger("change");
                this.save();
            });
        });
    },

    getDeviceID: function() {
        var result = "";
        try {
            result = this.getDevice().getPublicKey();
        } catch (err) {};
        return result;
    },

});

module.exports = Settings;
