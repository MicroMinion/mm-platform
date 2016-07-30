'use strict'

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
  assert(_.has(options, 'logger'))
  /**
   * Node information from previously used public keys
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
  this.logger = options.logger
  var self = this
  this.identity.on('ready', function () {
    self.ready = true
    self._sendMyNodeInfo()
  })
  this.messaging.on('self.transports.nodeInfo', this._processNodeInfo.bind(this))
  this.messaging.on('self.directory.getReply', this._processGetReply.bind(this))
  setInterval(function () {
    self._sendMyNodeInfo()
  }, CACHE_REFRESH_INTERVAL)
}

inherits(Directory, events.EventEmitter)

Directory.prototype._sendMyNodeInfo = function () {
  if (this._connectionInfo) {
    assert(_.isArray(this._connectionInfo))
    var nodeInfo = {}
    if (this.ready) {
      nodeInfo.connectionInfo = this._connectionInfo
      nodeInfo.boxId = this.identity.getBoxId()
      nodeInfo.signId = this.identity.getSignId()
      this.logger.info('_sendMyNodeInfo', {
        nodeInfo: nodeInfo
      })
      this.platform.messaging.send('transports.myNodeInfo', 'local', nodeInfo)
    }
  }
}

Directory.prototype.setMyConnectionInfo = function (connectionInfo) {
  this.logger.debug('setMyConnectionInfo', {
    connectionInfo: connectionInfo
  })
  assert(_.isObject(connectionInfo))
  this._connectionInfo = connectionInfo
  this._sendMyNodeInfo()
}

Directory.prototype.getNodeInfo = function (boxId, callback) {
  this.logger.debug('get nodeInfo', {
    boxId: boxId
  })
  assert(_.isFunction(callback))
  assert(validation.validKeyString(boxId))
  if (_.has(this.directoryCache, boxId)) {
    var cacheResult = this.directoryCache[boxId]
    process.nextTick(function () {
      callback(null, cacheResult)
    })
    if (this._hasStaleCache(boxId)) {
      if (!_.has(this.directoryLookup, boxId)) {
        this._lookupKey(boxId)
      }
    }
  } else if (_.has(this.directoryLookup, boxId)) {
    this.directoryLookup[boxId].push(callback)
  } else {
    this._lookupKey(boxId)
    this.directoryLookup[boxId] = [callback]
  }
}

Directory.prototype._hasStaleCache = function (boxId) {
  assert(validation.validKeyString(boxId))
  if (!this.directoryCache[boxId].lastUpdate) {
    return true
  }
  var diff = Math.abs(new Date() - new Date(this.directoryCache[boxId].lastUpdate))
  return diff > CACHE_REFRESH_INTERVAL
}

/**
 * @private
 */
Directory.prototype._loadDirectoryCache = function () {
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
  this.storage.put('directoryCache', JSON.stringify(this.directoryCache))
}

/**
 * @private
 */
Directory.prototype._lookupKey = function (boxId) {
  this.logger.debug('lookup node Info', {
    boxId: boxId
  })
  assert(validation.validKeyString(boxId))
  var self = this
  this.platform.messaging.send('transports.requestNodeInfo', 'local', boxId)
  setTimeout(function () {
    if (_.has(self.directoryLookup, boxId)) {
      _.forEach(self.directoryLookup[boxId], function (callback) {
        callback(new Error('key lookup timeout'), null)
      })
      delete self.directoryLookup[boxId]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
}

/**
 * @private
 */
Directory.prototype._processNodeInfo = function (topic, local, data) {
  assert(topic === 'self.transports.nodeInfo')
  assert(local === 'local')
  assert(_.isPlainObject(data))
  if (!_.has(this.directoryCache, data.boxId)) {
    this.directoryCache[data.boxId] = {}
  }
  this.directoryCache[data.boxId] = data
  this.directoryCache[data.boxId].lastUpdate = new Date().toJSON()
  this._saveDirectoryCache()
  if (_.has(this.directoryLookup, data.boxId)) {
    _.forEach(this.directoryLookup[data.boxId], function (callback) {
      callback(null, data)
    })
    delete this.directoryLookup[data.boxId]
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
