'use strict'

var debug = require('debug')('flunky-platform:directory')
var _ = require('lodash')
var events = require('events')
var inherits = require('inherits')
var assert = require('assert')
var validation = require('./validation.js')

var DIRECTORY_LOOKUP_TIMEOUT = 10000

var CACHE_REFRESH_INTERVAL = 1000 * 60 * 5

var Directory = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'storage'))
  assert(_.has(options, 'platform'))
  assert(_.has(options, 'identity'))
  /**
   * Connection information from previously used public keys
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.directoryCache = {}
  this.directoryLookup = {}
  this.mapping = {}
  events.EventEmitter.call(this)
  this.storage = options.storage
  this.platform = options.platform
  this.messaging = this.platform.messaging
  this.identity = options.identity
  this.ready = this.identity.loaded()
  var self = this
  this.identity.on('ready', function () {
    self.ready = true
  })
  this.messaging.on('self.transports.connectionInfo', this._processConnectionInfo.bind(this))
  this.messaging.on('self.directory.getReply', this._processGetReply.bind(this))
  setInterval(function () {
    debug('_cacheRefreshInterval')
    self._sendMyConnectionInfo()
  }, CACHE_REFRESH_INTERVAL)
}

inherits(Directory, events.EventEmitter)

Directory.prototype._sendMyConnectionInfo = function () {
  debug('_sendMyConnectionInfo')
  if (this._connectionInfo) {
    assert(_.isObject(this._connectionInfo))
    var connectionInfo = {}
    if (this.ready) {
      connectionInfo.boxId = this.identity.getBoxId()
      connectionInfo.signId = this.identity.getSignId()
      // FIXME: When integrating flunky-transports
      connectionInfo.udp = this._connectionInfo
      this.platform.messaging.send('transports.myConnectionInfo', 'local', connectionInfo)
    }
  }
}

Directory.prototype.setMyConnectionInfo = function (connectionInfo) {
  debug('setMyConnectionInfo')
  assert(_.isObject(connectionInfo))
  this._connectionInfo = connectionInfo
  this._sendMyConnectionInfo()
}

Directory.prototype.getConnectionInfo = function (signId, callback) {
  debug('_findKey')
  assert(_.isFunction(callback))
  assert(validation.validKeyString(signId))
  if (_.has(this.directoryCache, signId)) {
    var cacheResult = this.directoryCache[signId]
    process.nextTick(function () {
      callback(null, cacheResult)
    })
    if (this._hasStaleCache(signId)) {
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

Directory.prototype._hasStaleCache = function (signId) {
  assert(validation.validKeyString(signId))
  if (!this.directoryCache[signId].lastUpdate) {
    return true
  }
  var diff = Math.abs(new Date() - new Date(this.directoryCache[signId].lastUpdate))
  return diff > CACHE_REFRESH_INTERVAL
}

/**
 * @private
 */
Directory.prototype._loadDirectoryCache = function () {
  debug('loadDirectoryCache')
  var self = this
  var success = function (value) {
    assert(validation.validString(value))
    value = JSON.parse(value)
    assert(_.isObject(value))
    _.forEach(value, function (n, key) {
      if (!_.has(self.directoryCache, key)) {
        self.directoryCache[key] = n
      }
    })
  }
  this.storage.get('directoryCache', function (err, result) {
    if (!err) {
      success(result)
    }
  })
}

/**
 * @private
 */
Directory.prototype._saveDirectoryCache = function () {
  debug('saveDirectoryCache')
  this.storage.put('directoryCache', JSON.stringify(this.directoryCache))
}

/**
 * @private
 */
Directory.prototype._lookupKey = function (signId) {
  debug('_lookupKey')
  assert(validation.validKeyString(signId))
  var self = this
  this.platform.messaging.send('transports.requestConnectionInfo', 'local', signId)
  setTimeout(function () {
    if (_.has(self.directoryLookup, signId)) {
      _.forEach(self.directoryLookup[signId], function (callback) {
        callback(new Error('key lookup timeout'), null)
      })
      delete self.directoryLookup[signId]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
}

/**
 * @private
 */
Directory.prototype._processConnectionInfo = function (topic, local, data) {
  debug('connectionInfo event')
  assert(topic === 'self.transports.connectionInfo')
  assert(local === 'local')
  assert(_.isPlainObject(data))
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

Directory.prototype.getSignId = function (boxId) {
  debug('getSignId')
  assert(validation.validKeyString(boxId))
  var result
  if (_.has(this.mapping, boxId)) {
    result = this.mapping[boxId]
  } else {
    _.forEach(this.directoryCache, function (connectionInfo) {
      assert(validation.validConnectionInfo(connectionInfo))
      if (connectionInfo.boxId === boxId) {
        result = connectionInfo.signId
      }
    })
  }
  if (result) {
    this.mapping[boxId] = result
    this.emit('lookup', boxId, result)
  } else {
    this.platform.messaging.send('directory.get', 'local', boxId)
  }
}

Directory.prototype._processGetReply = function (topic, sender, data) {
  assert(_.isObject(data))
  assert(_.has(data, 'key'))
  assert(validation.validString(data.key))
  assert(_.has(data, 'value'))
  assert(validation.validString(data.value))
  assert(topic === 'self.directory.getReply')
  assert(sender === 'local')
  if (_.has(this.mapping, data.key)) {
    this.mapping[data.key] = data.value
    this.emit('lookup', data.key, data.value)
  }
}

module.exports = Directory
