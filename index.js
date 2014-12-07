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
    this._config.createNewDomain(name, description, owner);
};

/*
 * Put out a request to discover domains on the local network
 */
FlunkyPaas.prototype.discover_local_domains = function(callback) {
    this._directory.get("domain", "local", callback);
};

/*
 * Request to be notified whenever somebody wants to join our domain so that we can add the instance to the domain if we want to
 */
FlunkyPaaS.prototype.subscribe_to_domain_requests = function(callback) {

};

/*
 * Subscribe to domain confirmation request
 */
FlunkyPaaS.prototype.subscribe_to_domain_confirmation = function(callback) {

};

/*
 * Sends out a request to join a domain
 */
FlunkyPaaS.prototype.send_domain_request = function(domain) {
    
};

/*
 * Confirm adding a new instance to the domain
 */
FlunkyPaaS.prototype.add_instance_to_domain = function(publicKey, callback) {

};
