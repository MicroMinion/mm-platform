'use strict'

var debug = require('debug')('flunky-platform:directory')
var Q = require('q')
var _ = require('lodash')
var expect = require('chai').expect

var DIRECTORY_LOOKUP_TIMEOUT = 10000

var CACHE_REFRESH_INTERVAL = 1000 * 60 * 5

var Directory = function (options) {
  /**
   * Connection information from previously used public keys
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.directoryCache = {}
  this.directoryLookup = {}
  this.storage = options.storage
  this.messaging = options.messaging
  var self = this
  this.messaging.on('self.transports.connectionInfo', this._processConnectionInfo)
  setInterval(function () {
    if (self._connectionInfo) {
      var connectionInfo = self._connectionInfo
      connectionInfo.publicKey = self.publicKey
      self.messaging.send('transports.myConnectionInfo', connectionInfo)
    }
  }, CACHE_REFRESH_INTERVAL)
}

Directory.prototype.setPublicKey = function (publicKey) {
  this.publicKey = publicKey
}

Directory.prototype.setMyConnectionInfo = function (connectionInfo) {
  this._connectionInfo = connectionInfo
}

Directory.prototype.getConnectionInfo = function (publicKey, callback) {
  debug('_findKey')
  if (_.has(this.directoryCache, publicKey)) {
    var cacheResult = this.directoryCache[publicKey]
    process.nextTick(function () {
      callback(null, cacheResult)
    })
    if (!this.directoryCache[publicKey].lastUpdate || Math.abs(new Date() - new Date(this.directoryCache[publicKey].lastUpdate)) > CACHE_REFRESH_INTERVAL) {
      if (!_.has(this.directoryLookup, publicKey)) {
        this._lookupKey(publicKey)
      }
    }
  } else if (_.has(this.directoryLookup, publicKey)) {
    this.directoryLookup[publicKey].push(callback)
  } else {
    this._lookupKey(publicKey)
    this.directoryLookup[publicKey] = [callback]
  }
}

/**
 * @private
 */
Directory.prototype._loadDirectoryCache = function () {
  debug('loadDirectoryCache')
  var manager = this
  var options = {
    success: function (value) {
      value = JSON.parse(value)
      expect(value).to.be.an('object')
      _.forEach(value, function (n, key) {
        if (!_.has(manager.directoryCache, key)) {
          manager.directoryCache[key] = n
        }
      })
    }
  }
  Q.nfcall(this.storage.get.bind(this.storage), 'flunky-platform-directoryCache').then(options.success)
}

/**
 * @private
 */
Directory.prototype._saveDirectoryCache = function () {
  debug('saveDirectoryCache')
  this.storage.put('flunky-platform-directoryCache', JSON.stringify(this.directoryCache))
}

/**
 * @private
 */
Directory.prototype._lookupKey = function (publicKey) {
  debug('_lookupKey')
  var manager = this
  this.messaging.send('transports.requestConnectionInfo', 'local', publicKey)
  setTimeout(function () {
    if (_.has(manager.directoryLookup, publicKey)) {
      _.forEach(manager.directoryLookup[publicKey], function (callback) {
        callback(new Error('key lookup timeout'), null)
      })
      delete manager.directoryLookup[publicKey]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
}

/**
 * @private
 */
Directory.prototype._processConnectionInfo = function (topic, publicKey, data) {
  debug('connectionInfo event')
  if (!_.has(this.directoryCache, data.publicKey)) {
    this.directoryCache[data.publicKey] = {}
  }
  this.directoryCache[data.publicKey] = data
  this.directoryCache[data.publicKey].lastUpdate = new Date().toJSON()
  this._saveDirectoryCache()
  if (_.has(this.directoryLookup, data.publicKey)) {
    _.forEach(this.directoryLookup[data.publicKey], function (callback) {
      callback(null, data)
    })
    delete this.directoryLookup[data.publicKey]
  }
}

module.exports = Directory
