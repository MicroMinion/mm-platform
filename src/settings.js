var Backbone = require("backbone");
var Brace = require("backbone-brace");
var Device = require("./device.js");
var Domain = require("./domain.js");

var Settings = Brace.Model.extend({

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

    initialize: function() {
        //console.log("Settings.initialize");
    },

    getDeviceID: function() {
        return this.getDevice().getPublicKey();
    },

});

module.exports = Settings;
