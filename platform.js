module.exports = FlunkyPlatform;

var debug = require('debug')('flunky-platform');
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var Settings = require('./src/settings.js');
var Directory = require('flunky-directory').Client;
var ConnectionManager = require('flunky-connectivity');
var ComponentManager = require('./src/component-manager.js');
var createStore = require("flunky-utils").createStore;


function FlunkyPlatform() {
    EventEmitter.call(this);
    this._loadConfig();
};

inherits(FlunkyPlatform, EventEmitter);

FlunkyPlatform.prototype._loadConfig = function() {
    this._config = new Settings();
    var platform = this;
    createStore(this._config, "Settings");
    this._config.fetch();
    var publicKey = this._config.getDeviceID();
    if (publicKey == undefined || publicKey == "") {
        this._config.createNewConfig();
        this._config.save();
    };
    this._configLoaded();
};

FlunkyPlatform.prototype._configLoaded = function() {
    this._setupDirectory();
    this._setupComponents();
    this._setupConnectivity();
};

FlunkyPlatform.prototype._setupDirectory = function() {
    this._directory = new Directory({
        user: this._config.getUser(),
        device: this._config.getDevice()
    });
};

FlunkyPlatform.prototype._setupComponents = function() {
    this._componentManager = new ComponentManager({
        config: this._config,
        directory: this._directory,
    });
};

FlunkyPlatform.prototype._setupConnectivity = function() {
    this._connectionManager = new ConnectionManager({
        directory: this._directory,
        user: this._config.getUser(),
        device: this._config.getDevice()
    });
    this._componentManager.setConnectionManager(this._connectionManager);
    this._connectionManager.on("addPeer", this._componentManager.addPeer.bind(this._componentManager));
    this._connectionManager.on("removePeer", this._componentManager.removePeer.bind(this._componentManager));
    this._componentManager.pipe(this._connectionManager);
    this._connectionManager.pipe(this._componentManager);
};
