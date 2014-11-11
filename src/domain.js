var Backbone = require("backbone");
var Brace = require("backbone-brace");
var nacl_factory = require('js-nacl');
var nacl = nacl_factory.instantiate();
var _ = require('lodash');
var Base64 = require('js-base64').Base64;

var Domain = Brace.Model.extend({

    idAttribute: "publicKey",

    initialize: function() {},

    namedAttributes: {
        publicKey: "string",
        privateKey: "string",
        name: "string",
        description: "string",
        ownerEmail: "string",
        devices: ["string"],
    },


    generate: function(domainName, description, ownerEmail) {
        var keypair = nacl.crypto_box_keypair();
        this.publicKey = Base64.toBase64(nacl.decode_latin1(keypair.boxPk));
        this.privateKey = Base64.toBase64(nacl.decode_latin1(keypair.boxSk));
        this.domainName = domainName;
        this.description = description;
        this.ownerEmail = ownerEmail;
    },

    clear: function() {
        this.destroy();
    }
});

module.exports = Domain;
