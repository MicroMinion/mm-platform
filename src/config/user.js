var Backbone = require("backbone");
var Brace = require("backbone-brace");
var nacl_factory = require('js-nacl');
var nacl = nacl_factory.instantiate();
var _ = require('lodash');
var Base64 = require('js-base64').Base64;

var User = Brace.Model.extend({

    idAttribute: "publicKey",

    initialize: function() {},

    namedAttributes: {
        publicKey: "string",
        privateKey: "string",
        name: "string",
        description: "string",
        email: "string",
        devices: ["string"],
    },

    publicJSON: function() {
        return {
            publicKey: this.getPublicKey(),
            name: this.getName(),
            description: this.getDescription(),
            email: this.getOwnerEmail(),
            devices: this.getDevices()
        };
    },

    generate: function(userName, description, email) {
        var keypair = nacl.crypto_box_keypair();
        this.publicKey = Base64.toBase64(nacl.decode_latin1(keypair.boxPk));
        this.privateKey = Base64.toBase64(nacl.decode_latin1(keypair.boxSk));
        this.name = userName;
        this.description = description;
        this.email = email;
    },

    clear: function() {
        this.destroy();
    }
});

module.exports = User;
