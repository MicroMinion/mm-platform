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
  this.platform = options.platform
  this.identity = options.identity
  this.ready = this.identity.loaded()
  var self = this
  this.identity.on('ready', function () {
    self.ready = true
  })
  this.platform.messaging.on('self.transports.connectionInfo', this._processConnectionInfo)
  setInterval(function () {
    debug('_cacheRefreshInterval')
    self._sendMyConnectionInfo()
  }, CACHE_REFRESH_INTERVAL)
}

Directory.prototype._sendMyConnectionInfo = function () {
  debug('_sendMyConnectionInfo')
  if (this._connectionInfo) {
    var connectionInfo = {}
    if (this.ready) {
      connectionInfo.boxId = this.identity.getBoxId()
      connectionInfo.signId = this.identity.getSignId()
      connectionInfo.udp = this._connectionInfo
      this.platform.messaging.send('transports.myConnectionInfo', 'local', connectionInfo)
    }
  }
}

Directory.prototype.setMyConnectionInfo = function (connectionInfo) {
  debug('setMyConnectionInfo')
  this._connectionInfo = connectionInfo
  this._sendMyConnectionInfo()
}

Directory.prototype.getConnectionInfo = function (signId, callback) {
  debug('_findKey')
  if (_.has(this.directoryCache, signId)) {
    var cacheResult = this.directoryCache[signId]
    process.nextTick(function () {
      callback(null, cacheResult)
    })
    if (!this.directoryCache[signId].lastUpdate || Math.abs(new Date() - new Date(this.directoryCache[signId].lastUpdate)) > CACHE_REFRESH_INTERVAL) {
      if (!_.has(this.directoryLookup, signId)) {
        this._lookupKey(signId)
      }
    }
  } else if (_.has(this.directoryLookup, signId)) {
    this.directoryLookup[signId].push(callback)
  } else {
    this._lookupKey(signId)
    this.directoryLookup[signId] = [callback]
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
Directory.prototype._lookupKey = function (signId) {
  debug('_lookupKey')
  var manager = this
  this.platform.messaging.send('transports.requestConnectionInfo', 'local', signId)
  setTimeout(function () {
    if (_.has(manager.directoryLookup, signId)) {
      _.forEach(manager.directoryLookup[signId], function (callback) {
        callback(new Error('key lookup timeout'), null)
      })
      delete manager.directoryLookup[signId]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
}

/**
 * @private
 */
Directory.prototype._processConnectionInfo = function (topic, senderBoxId, data) {
  debug('connectionInfo event')
  if (!_.has(this.directoryCache, data.signId)) {
    this.directoryCache[data.signId] = {}
  }
  this.directoryCache[data.signId] = data
  this.directoryCache[data.signId].lastUpdate = new Date().toJSON()
  this._saveDirectoryCache()
  if (_.has(this.directoryLookup, data.signId)) {
    _.forEach(this.directoryLookup[data.signId], function (callback) {
      callback(null, data)
    })
    delete this.directoryLookup[data.signId]
  }
}

module.exports = Directory
