var Backbone = require("backbone");
var Brace = require("backbone-brace");
var nacl_factory = require('js-nacl');
var nacl = nacl_factory.instantiate();
var _ = require('lodash');
var Base64 = require('js-base64').Base64;
var os = require('os');
var random_port = require("random-port");

var Device = Brace.Model.extend({

    idAttribute: "publicKey",

    defaults: {
    },

    namedAttributes: {
        publicKey: "string",
        privateKey: "string",
        ipv4: ["string"],
        ipv6: ["string"],
        public_interface: null,
        private_interface: null
    },

    publicJSON: function() {
        return {
            publicKey: this.getPublicKey(),
            ipv4: this.getIpv4(),
            ipv6: this.getIpv6(),
            public_interface: this.getPublic_interface(),
            private_interface: this.getPrivate_interface()
        };
    },

    initialize: function() {
        this.setIpv4(this.get_ipv4_addresses());
        this.setIpv6(this.get_ipv6_addresses());
        if(!this.has("public_interface") || !this.has("private_interface")) {
            this.generate_ports();
        };
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
        this.generate_ports();
    },

    getRandom: function(length) {
        return Math.floor(Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1));
    },

    clear: function() {
        this.destroy();
    },


    generate_ports: function() {
        random_port({from: 10000, range: 200}, this.public_port_received.bind(this));
        random_port({from: 10200, range: 200}, this.private_port_received.bind(this));
    },

    public_port_received: function(port) {
        this.setPublic_interface({'tcp': port});
    },

    private_port_received: function(port) {
        this.setPrivate_interface({'tcp': port});
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
