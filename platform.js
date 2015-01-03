module.exports = FlunkyPlatform;

var debug = require('debug')('flunky-platform');
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var os = require("os");
var path = require("path");

if (typeof localStorage == "undefined" || localStorage == null) {
    GLOBAL.window = GLOBAL;
    var LocalStorage = require("node-localstorage").LocalStorage;
    var directory;
    if(process.env.FLUNKY_DATA) {
        directory = process.env.FLUNKY_DATA;
    } else {
        directory = path.join(os.tmpdir(),"flunkyPlatform"); 
    };
    localStorage = new LocalStorage(directory);
};

var Settings = require('./src/settings.js');
var Directory = require('flunky-directory').Client;
var ConnectionManager = require('flunky-connectivity');
var ComponentManager = require('./src/component-manager.js');

inherits(FlunkyPlatform, EventEmitter);

function FlunkyPlatform() {
    EventEmitter.call(this);
    this._loadConfig();
};

FlunkyPlatform.prototype._loadConfig = function() {
    this._config = new Settings();
    this._config.fetch();
    var publicKey = this._config.getDeviceID();
    if(publicKey == undefined || publicKey == "") {
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

