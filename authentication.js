module.exports = AuthenticationComponent;

var debug = require("debug")("flunky-component:authentication");
var FlunkyComponent = require("flunky-component");
var inherits = require("inherits");
var random_port = require("random-port");
var net = require("net");
var CurveCPStream = require("curve-protocol");
var mmds = require("mmds");
var crypto = require("flunky-utils").crypto;

inherits(AuthenticationComponent, FlunkyComponent);

function AuthenticationComponent(opts) {
    debug("initializing authentication component");
    FlunkyComponent.call(this, opts);
    this.localProvides = ["authentication"];
    this.provides = ["authentication"];
    this._deviceHistory = new mmds.Collection({resource: "deviceHistory"});
    var config = this.config;
    var auth = this;
    this._deviceHistory.on("newEvent", function(event) {
        if (!_.has(config.user.devices, event.document.device)) {
            config.user.addDevice(event.document.device);
            auth.emit("deviceAdded", event.document.device);
        };
    });
    this._setupListeningSocket();
    this._devicesContacted = {};
};

AuthenticationComponent.prototype.setConnectionManager = function(connectionManager) {
    this.connectionManager = connectionManager;
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
        serverPublicKey: crypto.fromBase64(this.config.device.publicKey),
        serverPrivateKey: crypto.fromBase64(this.config.device.privateKey)
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
            if (this.config.user) {
                this.emit("joinRequest", json.payload.device);
            };
        } else if (json.payload.type == "joinConfirmation") {
            if (!this.config.user.publicKey && this.joinRequestSend) {
                this.joinRequestSend = false;
                this.emit("joinConfirmation", json.payload.user);
                this.directory.get(user_public_key, "local", function(user) {
                    if (_.has(user.devices, device.publicKey)) {
                        var config = authenticationComponent.config;
                        config.addUser(user);
                        authenticationComponent.directory.setUser(config.user);
                        authenticationComponent.connectionManager.setUser(config.user);
                    };
                });
            };
        };
    });
};

/*
 * Client logic - sending messages to other devices' public interface
 */

AuthenticationComponent.prototype._contactDeviceWithJoinRequest = function(device) {
    this.joinRequestSend = true;
    var device = this.config.device.publicJSON();
    this._connectToDevice(device, JSON.stringify({
        'service': 'authentication',
        'payload': {
            'type': 'joinRequest',
            'device': device
        }
    }));
};

AuthenticationComponent.prototype._contactDeviceWithJoinConfirmation = function(device) {
    var user = this.config.user.publicJSON();
    this._connectToDevice(device, JSON.stringify({
        'service': 'authentication',
        'payload': {
            'type': 'joinConfirmation',
            'user': user
        }
    }));
};

AuthenticationComponent.prototype._connectToDevice = function(publicKey, message) {
    debug("establishing connection to device %s from device %s", publicKey, this.device.publicKey);
    var authenticationComponent = this;
    _.each(this._contactedDevices[publicKey].ipv4, function(address) {
        var connection = net.connect(this._contactedDevices[publicKey].authPort, address, function() {
            authenticationComponent._setupClientConnection(connection, publicKey, message);
        });
    });
};

AuthenticationComponent.prototype._setupClientConnection = function(connection, publicKey, message) {
    debug("setting up client stream for connection to %s", publicKey);
    var connectionManager = this;
    var curveStream = new CurveCPStream({
        stream: connection,
        is_server: false,
        serverPublicKey: nacl.encode_latin1(Base64.fromBase64(publicKey)),
        clientPublicKey: crypto.fromBase64(this.config.device.publicKey),
        clientPrivateKey: crypto.fromBase64(this.config.device.privateKey)
    });
    curveStream.on("close", function() {
        curveStream.stream.end();
    });
    curveStream.on("drain", function() {
        var publicKey = Base64.toBase64(nacl.decode_latin1(curveStream.serverPublicKey));
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
    this.directory.setUser(this.config.user);
    this.connectionManager.setUser(this.config.user);
};

//Put out a request to discover users on the local network
AuthenticationComponent.prototype.discoverUsersOnLocalNetwork = function(callback) {
    this.directory.get("users", "local", callback);
};

// Sends out a request to join a user instance
AuthenticationComponent.prototype.sendRequestToJoinUser = function(user_public_key) {
    var authenticationComponent = this;
    this.directory.get(user_public_key, "local", function(user) {
        _.each(user.devices, function(device) {
            if (!_.has(authenticationComponent._contactedDevices, device)) {
                authenticationComponent._contactedDevices[device] = {};
                authenticationComponent.directory.get(device, "local", function(device, deviceInfo) {
                    if (Object.keys(authenticationComponent._contactedDevices[device].length == 0)) {
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
    this._deviceHistory.create({
        "operation": "deviceAdded",
        "device": publicKey
    });
    this._contactDeviceWithJoinConfirmation(publicKey);
};

/*
 * Synchronization logic
 */

AuthenticationComponent.prototype.setup = function(peerID) {
    this.peers[peerID] = mmds.SyncStream({
        own_id: "authentication",
        db: this._deviceHistory});
    this.peers[peerID].on("data", function(chunk) {
        this.push({
            to: peerID,
            service: "authentication",
            payload: chunk
        });
    });
};

AuthenticationComponent.prototype.tearDown = function(peerID) {
    if(_.has(this.peers, peerID)) {
        delete this.peers[peerID];
    };
};

AuthenticationComponent.prototype._write = function(chunk, encoding, done) {
    this.peers[chunk.from].write(chunk.payload);
    done();
};
