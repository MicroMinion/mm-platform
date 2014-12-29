var Backbone = require("backbone");
var Brace = require("backbone-brace");
var Device = require("./device.js");
var Domain = require("./domain.js");
Backbone.LocalStorage = require("backbone.localstorage");

var Settings = Brace.Model.extend({

    localStorage: new Store("Settings"),

    defaults: {
        id: 1,
    },

    namedAttributes: {
        device: Device,
        domain: Domain
    },

    createNewConfig: function() {
        var device = new Device();
        device.generateIdentity();
        this.setDevice(device);
    },

    createNewDomain: function(name, description, owner) {
        var domain = new Domain();
        domain.generate(name, description, owner);
        this.setDomain(domain);
    },

    initialize: function() {
        this.listenTo(this, "change: domain", function() {
            this.listenTo(this.getDomain(), "change", function() {
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
