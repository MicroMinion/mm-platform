'use strict'

var _ = require('lodash')
var events = require('events')
var inherits = require('inherits')
var assert = require('assert')
var validation = require('./validation.js')

var DIRECTORY_LOOKUP_TIMEOUT = 10000

var CACHE_REFRESH_INTERVAL = 1000 * 60 * 5

var Directory = function () {
  var self = this
  /**
   * Node information from previously used public keys
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.directoryLookup = {}
  events.EventEmitter.call(this)
  setInterval(function () {
    self._sendMyNodeInfo()
  }, CACHE_REFRESH_INTERVAL)
}

inherits(Directory, events.EventEmitter)

Directory.prototype.setPlatform = function (platform) {
  this.platform = platform
  this.storage = this.platform.storage
  this.messaging = this.platform.messaging
  this.ready = this.platform.identity.loaded()
  this.logger = this.platform._log
  var self = this
  this.platform.identity.on('ready', function () {
    self.ready = true
    self._sendMyNodeInfo()
  })
  this.messaging.on('self.transports.nodeInfo', this._processNodeInfo.bind(this))
  this.messaging.on('self.transports.requestMyNodeInfo', this._sendMyNodeInfo.bind(this))
}

Directory.prototype._sendMyNodeInfo = function () {
  if (this._connectionInfo) {
    assert(_.isArray(this._connectionInfo))
    var nodeInfo = {}
    if (this.ready) {
      nodeInfo.connectionInfo = this._connectionInfo
      nodeInfo.boxId = this.platform.identity.getBoxId()
      nodeInfo.signId = this.platform.identity.getSignId()
      this.logger.debug('_sendMyNodeInfo', nodeInfo)
      this.platform.messaging.send('transports.myNodeInfo', 'local', nodeInfo)
    }
  }
}

Directory.prototype.setMyConnectionInfo = function (connectionInfo) {
  this.logger.debug('setMyConnectionInfo', connectionInfo)
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
  if (_.has(this.directoryLookup, boxId)) {
    this.directoryLookup[boxId].push(callback)
  } else {
    this.directoryLookup[boxId] = [callback]
    this._lookupKey(boxId)
  }
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
  if (_.has(this.directoryLookup, data.boxId)) {
    _.forEach(this.directoryLookup[data.boxId], function (callback) {
      callback(null, data)
    })
    delete this.directoryLookup[data.boxId]
  }
}

module.exports = Directory
