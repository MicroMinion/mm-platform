module.exports = AuthenticationComponent;

var debug = require("debug")("flunky-component:authentication");
var FlunkyComponent = require("flunky-component");
var inherits = require("inherits");
var random_port = require("flunky-utils").network.random_port;
var CurveCPStream = require("curve-protocol");
var mmds = require("mmds");
var keys = require("flunky-utils").keys;
var _ = require("lodash");
var store = require("flunky-utils").store;

inherits(AuthenticationComponent, FlunkyComponent);

function AuthenticationComponent(opts) {
    debug("initializing authentication component");
    FlunkyComponent.call(this, opts);
    this.localProvides = ["authentication"];
    this.provides = ["authentication"];
    this.peers = {};
    var auth = this;
    this._deviceHistory = new mmds.Collection({
        resource: "deviceHistory"
    });
    store.get("deviceHistory", {
        success: function(value) {
            auth._deviceHistory.documents = value;
        },
        error: function(msg) {
            console.log("ERROR: %s", msg);
        }
    });
    store.get("deviceHistory-log", {
        success: function(value) {
            auth._deviceHistory.events = value;
        },
        error: function(msg) {
            console.log("ERROR: %s", msg);
        }
    });
    var config = this.config;
    this._deviceHistory.on("newEvent", function(event) {
        if (!_.has(config.user.devices, event.document.device)) {
            config.user.addDevice(event.document.device);
            auth.emit("deviceAdded", event.document.device);
        };
        store.put("deviceHistory", auth._deviceHistory.documents, {
            success: function() {},
            error: function() {}
        });
        store.put("deviceHistory-log", auth._deviceHistory.events, {
            success: function() {},
            error: function() {}
        });
    });
    this._setupListeningSocket();
    this._contactedDevices = {};
};

/*
 * Server logic - receiving messages from public interface
 */
AuthenticationComponent.prototype._setupListeningSocket = function() {
    debug("setting up listening socket");
    var manager = this;
    var port = this.config.device.authPort;
    if (port == undefined) {
        this.generate_port();
        return;
    };
    this.server = net.createServer(function(connection) {
        manager._setupServerConnection(connection);
    });
    this.server.on("error", function(e) {
        debug("processing error when starting server socket %s", e);
        if (e.code == "EADDRINUSE") {
            manager.generate_port();
        } else {
            manager.server.close();
        };
    });
    debug("starting to listen on port %s (device %s)", port, this.config.device.publicKey);
    this.server.listen(port);
};

AuthenticationComponent.prototype.generate_port = function() {
    debug("generating new random port");
    random_port({
        from: 10000,
        range: 1000
    }, this._port_received.bind(this));
};

AuthenticationComponent.prototype._port_received = function(port) {
    debug("processing result of random port generation");
    this.config.device.authPort = port;
    this._setupListeningSocket();
};

AuthenticationComponent.prototype._setupServerConnection = function(connection) {
    debug("setting up server connection stream");
    var device = this.config.device;
    var authenticationComponent = this;
    var curveStream = new CurveCPStream({
        stream: connection,
        is_server: true,
        serverPublicKey: keys.fromBase64(this.config.device.publicKey),
        serverPrivateKey: keys.fromBase64(this.config.device.privateKey)
    });
    curveStream.on("close", function() {
        curveStream.stream.end();
    });
    curveStream.on("error", function() {
        curveStream.stream.end();
    });
    curveStream.on("data", function(chunk) {
        var json = JSON.parse(chunk);
        if (json.payload.type == "joinRequest") {
            if (authenticationComponent.config.user) {
                authenticationComponent.emit("joinRequest", json.payload.device);
            };
        } else if (json.payload.type == "joinConfirmation") {
            if (!authenticationComponent.config.user.publicKey && authenticationComponent.joinRequestSend) {
                authenticationComponent.joinRequestSend = false;
                authenticationComponent.config.addUser(json.payload.user);
                authenticationComponent.emit("joinConfirmation", json.payload.user);
            };
        };
    });
};

/*
 * Client logic - sending messages to other devices' public interface
 */

AuthenticationComponent.prototype._contactDeviceWithJoinRequest = function(device) {
    this.joinRequestSend = true;
    var myDevice = this.config.device.publicJSON();
    this._connectToDevice(device, JSON.stringify({
        'service': 'authentication',
        'payload': {
            'type': 'joinRequest',
            'device': myDevice
        }
    }));
};

AuthenticationComponent.prototype._contactDeviceWithJoinConfirmation = function(device) {
    var user = this.config.user.publicJSON();
    user.privateKey = this.config.user.privateKey;
    this._connectToDevice(device, JSON.stringify({
        'service': 'authentication',
        'payload': {
            'type': 'joinConfirmation',
            'user': user
        }
    }));
};

AuthenticationComponent.prototype._connectToDevice = function(publicKey, message) {
    debug("establishing connection to device %s from device %s", publicKey, this.config.device.publicKey);
    var authenticationComponent = this;
    authenticationComponent.directory.get(publicKey, "local", function(device, deviceInfo) {
        _.each(deviceInfo.ipv4, function(address) {
            var connection = net.connect(deviceInfo.authPort, address, function() {
                authenticationComponent._setupClientConnection(connection, publicKey, message);
            });
        });
    });
};

AuthenticationComponent.prototype._setupClientConnection = function(connection, publicKey, message) {
    debug("setting up client stream for connection to %s", publicKey);
    var curveStream = new CurveCPStream({
        stream: connection,
        is_server: false,
        serverPublicKey: keys.fromBase64(publicKey),
        clientPublicKey: keys.fromBase64(this.config.device.publicKey),
        clientPrivateKey: keys.fromBase64(this.config.device.privateKey)
    });
    curveStream.on("close", function() {
        curveStream.stream.end();
    });
    curveStream.on("drain", function() {
        var publicKey = keys.toBase64(curveStream.serverPublicKey);
        curveStream.write(message);
        curveStream.stream.end();
    });
};


/*
 * API offered to frontend logic
 * Events that can be generated:
 *  - joinRequest: received a request to join our user account
 *  - joinConfirmation: received confirmation that we have been added to a user account
 *  - deviceAdded: a device has been added to our user account
 *  - deviceRemoved: a device has been removed from our user account
 */

AuthenticationComponent.prototype.createUser = function(name, description, email) {
    this.config.createNewUser(name, description, email);
};

//Put out a request to discover users on the local network
AuthenticationComponent.prototype.discoverUsersOnLocalNetwork = function(callback) {
    this.directory.get("users", "local", callback);
};

// Sends out a request to join a user instance
AuthenticationComponent.prototype.sendRequestToJoinUser = function(user_public_key) {
    var authenticationComponent = this;
    this.directory.get(user_public_key, "local", function(key, user) {
        debug("user's devices retrieved %s", user.devices);
        _.each(user.devices, function(device) {
            if (!_.has(authenticationComponent._contactedDevices, device)) {
                authenticationComponent._contactedDevices[device] = {};
                authenticationComponent.directory.get(device, "local", function(device, deviceInfo) {
                    if (Object.keys(authenticationComponent._contactedDevices[device]).length == 0) {
                        authenticationComponent._contactedDevices[device] = deviceInfo;
                        authenticationComponent._contactDeviceWithJoinRequest(device);
                    };
                });
            };
        });
    });
};

//Confirm adding a new instance to the user 
AuthenticationComponent.prototype.addDeviceToUser = function(publicKey) {
    //Add to database which will automatically ensure propagation to 1) other devices and 2) config file
    this._deviceHistory.add({
        "operation": "deviceAdded",
        "device": publicKey
    });
    this._contactDeviceWithJoinConfirmation(publicKey);
};

/*
 * Synchronization logic
 */

AuthenticationComponent.prototype.setup = function(peerID) {
    var authenticationComponent = this;
    this.peers[peerID] = new mmds.SyncStream({
        own_id: "authentication",
        db: this._deviceHistory
    });
    this.peers[peerID].on("data", function(chunk) {
        authenticationComponent.push({
            to: peerID,
            service: "authentication",
            payload: chunk
        });
    });
};

AuthenticationComponent.prototype.tearDown = function(peerID) {
    if (_.has(this.peers, peerID)) {
        delete this.peers[peerID];
    };
};

AuthenticationComponent.prototype._write = function(chunk, encoding, done) {
    debug("receiving message %s", JSON.stringify(chunk));
    this.peers[chunk.from].write(chunk.payload);
    done();
};
