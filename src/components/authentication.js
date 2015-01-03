module.exports = AuthenticationComponent;

var debug = require("debug")("flunky-component-authentication");
var FlunkyComponent = require("flunky-component");
var inherits = require("inherits");
var random_port = require("random-port");
var net = require("net");
var CurveCPStream = require("curve-protocol");
var mmds = require("mmds");
var Backbone = require("backbone");

inherits(AuthenticationComponent, FlunkyComponent);

function AuthenticationComponent(opts) {
    debug("initializing authentication component");
    FlunkyComponent.call(this, opts);
    this.localProvides = ["authentication"];
    this._deviceHistory = new mmds.DocumentDatabase({
        db: new Backbone.Collection([], {
            model: mmds.Document
        }),
        eventLog: new Backbone.Collection([])
    });
    var config = this.config;
    var auth = this;
    this._deviceHistory.db.on("add", function(model) {
        if (!_.has(config.getUser().getDevices(), model.get("device"))) {
            config.getUser().addDevice(model.get("device"));
            auth.emit("deviceAdded", model.get("device"));
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
    var port = this.config.getDevice().getAuthPort();
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
    debug("starting to listen on port %s (device %s)", port, this.config.getDevice().getPublicKey());
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
    this.config.getDevice().setAuthPort(port);
    this.config.save();
    this._setupListeningSocket();
};

AuthenticationComponent.prototype._setupServerConnection = function(connection) {
    debug("setting up server connection stream");
    var device = this.config.getDevice();
    var authenticationComponent = this;
    var curveStream = new CurveCPStream({
        stream: connection,
        is_server: true,
        serverPublicKey: this.config.getDevice().getBinaryPublicKey(),
        serverPrivateKey: this.config.getDevice().getBinaryPrivateKey(),
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
            if (this.config.getUser()) {
                this.emit("joinRequest", json.payload.device);
            };
        } else if (json.payload.type == "joinConfirmation") {
            if (!this.config.getUser() && this.joinRequestSend) {
                this.joinRequestSend = false;
                this.emit("joinConfirmation", json.payload.user);
                this.directory.get(user_public_key, "local", function(user) {
                    if (_.has(user.devices, device.getPublicKey())) {
                        var config = authenticationComponent.config;
                        config.addUser(user);
                        authenticationComponent.directory.setUser(config.getUser());
                        authenticationComponent.connectionManager.setUser(config.getUser());
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
    var device = this.config.getDevice().publicJSON();
    this._connectToDevice(device, JSON.stringify({
        'service': 'authentication',
        'payload': {
            'type': 'joinRequest',
            'device': device
        }
    }));
};

AuthenticationComponent.prototype._contactDeviceWithJoinConfirmation = function(device) {
    var user = this.config.getUser().publicJSON();
    this._connectToDevice(device, JSON.stringify({
        'service': 'authentication',
        'payload': {
            'type': 'joinConfirmation',
            'user': user
        }
    }));
};

AuthenticationComponent.prototype._connectToDevice = function(publicKey, message) {
    debug("establishing connection to device %s from device %s", publicKey, this.device.getPublicKey());
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
        clientPublicKey: this.config.getDevice().getBinaryPublicKey(),
        clientPrivateKey: this.config.getDevice().getBinaryPrivateKey()
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
    this.directory.setUser(this.config.getUser());
    this.connectionManager.setUser(this.config.getUser());
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
    this._deviceHistory.db.add({
        "operation": "deviceAdded",
        "device": publicKey
    });
    this._contactDeviceWithJoinConfirmation(publicKey);
};
