var Backbone = require("backbone");
var Brace = require("backbone-brace");
var nacl_factory = require('js-nacl');
var nacl = nacl_factory.instantiate();
var _ = require('lodash');
var Base64 = require('js-base64').Base64;
var os = require('os');

var Device = Brace.Model.extend({

    idAttribute: "publicKey",

    defaults: {
    },

    namedAttributes: {
        publicKey: "string",
        privateKey: "string",
        ipv4: ["string"],
        ipv6: ["string"]
    },

    initialize: function() {
        this.setIpv4(this.get_ipv4_addresses());
        this.setIpv6(this.get_ipv6_addresses());
    },

    getBinaryPrivateKey: function() {
        var key = Base64.fromBase64(this.getPrivateKey());
        return nacl.encode_latin1(key);
    },
    getBinaryPublicKey: function() {
        var key = Base64.fromBase64(this.getPublicKey());
        return nacl.encode_latin1(key);
    },

    generateIdentity: function() {
        var keypair = nacl.crypto_box_keypair();
        this.setPublicKey(Base64.toBase64(nacl.decode_latin1(keypair.boxPk)));
        this.setPrivateKey(Base64.toBase64(nacl.decode_latin1(keypair.boxSk)));
    },

    getRandom: function(length) {
        return Math.floor(Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1));
    },

    clear: function() {
        this.destroy();
    },

    get_ipv4_addresses: function() {
        var result = [];
        _.forEach(os.networkInterfaces(), function(addresses) {
            _.forEach(addresses, function(address) {
                if (address['family'] == 'IPv4' && !address['internal']) {
                    result.push(address['address']);
                };
            }, this);
        }, this);
        return result;
    },

    get_ipv6_addresses: function() {
        var result = [];
        _.forEach(os.networkInterfaces(), function(addresses) {
            _.forEach(addresses, function(address) {
                var ip = address['address'];
                if (address['family'] == 'IPv6' && !address['internal']) {
                    result.push(address['address']);
                };
            }, this);
        }, this);
        return result;
    }
});

module.exports = Device;
