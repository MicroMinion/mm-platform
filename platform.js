module.exports = FlunkyPlatform;

var utils = require("flunky-utils");

var debug = require('debug')('flunky-platform');
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var Directory = require('flunky-directory').Client;
var ConnectionManager = require('flunky-connectivity');
var ComponentManager = require('./component-manager.js');
var store = utils.store;
var Settings = utils.Settings;

function FlunkyPlatform() {
    EventEmitter.call(this);
    this._loadConfig();
};

inherits(FlunkyPlatform, EventEmitter);

FlunkyPlatform.prototype._loadConfig = function() {
    var platform = this;
    this._config = new Settings();
    this._config.on("change", function() {
        store.put("settings", platform._config.dump(), {
            success: function() {},
            error: function(msg) {
                console.log("ERROR: %s", msg);
            }
        });
    });
    store.get("settings", {
        success: function(value) {
            platform._config.load(value);
            platform._configLoaded();
        },
        error: function(msg) {
            console.log("error while loading settings: %s", msg);
            platform._config.createNewConfig();
            platform._configLoaded();
        }
    });
};

FlunkyPlatform.prototype._configLoaded = function() {
    console.log("config loaded");
    this._setupDirectory();
    this._setupComponents();
    this._setupConnectivity();
    this.emit("ready");
};

FlunkyPlatform.prototype._setupDirectory = function() {
    this._directory = new Directory({
        config: this._config
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
        config: this._config
    });
    this._connectionManager.on("addPeer", this._componentManager.addPeer.bind(this._componentManager));
    this._connectionManager.on("removePeer", this._componentManager.removePeer.bind(this._componentManager));
    this._componentManager.pipe(this._connectionManager);
    this._connectionManager.pipe(this._componentManager);
};

FlunkyPlatform.prototype.getComponent = function(name) {
    return this._componentManager.components[name];
};

FlunkyPlatform.prototype.createDatabase = function(name) {
    this._componentManager.createMetadataComponent(name);
};
