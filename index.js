module.exports = FlunkyPaaS;

var debug = require('debug')('paas');
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
var Directory = require('paas-directory').Client;

inherits(FlunkyPaaS, EventEmitter);

function FlunkyPaaS() {
    EventEmitter.call(this);
    this._loadConfig();
};

FlunkyPaaS.prototype._loadConfig = function() {
    this._config = new Settings();
    this._config.fetch();
    var publicKey = this._config.getDeviceID();
    if(publicKey == undefined || publicKey == "") {
        this._config.createNewConfig();
        this._config.save();
    };
    this._configLoaded();
};

FlunkyPaaS.prototype._configLoaded = function() {
    this._setupDirectory();
};

FlunkyPaaS.prototype._setupDirectory = function() {
    this._directory = new Directory(this._config);
};

FlunkyPaaS.prototype.create_domain = function(name, description, owner) {

};

FlunkyPaas.prototype.discover_local_domains = function(callback) {

};

FlunkyPaaS.prototype.subscribe_to_domain_requests = function(callback) {

};

FlunkyPaaS.prototype.add_instance_to_domain = function(publicKey, callback) {

};
