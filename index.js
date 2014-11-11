module.exports = FlunkyPaaS;

var debug = require('debug')('paas');
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var Settings = require('./src/settings.js');
var Directory = require('paas-directory');

inherits(FlunkyPaaS, EventEmitter);

function FlunkyPaaS() {
    EventEmitter.call(this);
    this._loadConfig();
};

FlunkyPaaS.prototype._loadConfig = function() {
    this._config = new Settings();
    this._config.createNewConfig();
    //TODO: Implement
};

FlunkyPaaS.prototype._configLoaded = function() {
    this._setupDirectory();
};

FlunkyPaaS.prototype._setupDirectory = function() {
    //TODO: Modiy directory to accept config object
    this._directory = new Directory(this._config);
};
