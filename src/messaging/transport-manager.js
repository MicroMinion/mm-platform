var inherits = require('inherits')
var _ = require('lodash')
var storagejs = require('storagejs')
var chai = require('chai')
var Q = require('q')
var extend = require('extend.js')
var AbstractTransport = require('./transport-abstract.js')

var TCPTransport = require('./transport-tcp.js')
var GCMTransport = require('./transport-gcm.js')

var expect = chai.expect

/**
 * Interval for publishing connection info in directory
 *
 * @constant
 * @default
 * @type {number}
 * @public
 * @readonly
 */
var PUBLISH_CONNECTION_INFO_INTERVAL = 1000 * 60 * 5

var DIRECTORY_LOOKUP_TIMEOUT = 1000

var TransportManager = function (messaging, publicKey, privateKey) {
  AbstractTransport.call(this, publicKey, privateKey)
  this.messaging = messaging
  var manager = this
  /**
   * Connection information from previously used public keys
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.directoryCache = {}
  this._loadDirectoryCache()
  this.on('self.directory.getReply', this._processGetReply.bind(this))
  this.on('self.messaging.connectionInfo', function (topic, publicKey, data) {
    this.directoryCache[data.publicKey] = data
  }, this)
  /**
   * Our own connection information, to be published in directory
   *
   * @access private
   * @type {Object}
   */
  this.connectionInfo = {}
  setInterval(function () {
      manager._publishConnectionInfo()
  }, PUBLISH_CONNECTION_INFO_INTERVAL)
  /*
   * Transport objects
   *
   * @access private
   */
  this.transports = []
  this._initializeTransports()
}

inherits(TransportManager, AbstractTransport)

TransportManager.prototype._initializeTransports = function () {
  var transports = [TCPTransport]
  _.forEach(transports, function (transportClass) {
    this._initializeTransport(transportClass)
  }, this)
}

TransportManager.prototype._initializeTransport = function (TransportClass) {
  var manager = this
  var transport
  try {
    transport = new TransportClass(this.publicKey, this.privateKey)
  } catch(e) {
    console.log(e)
  }
  if (transport) {
    this.transports.push(transport)
    transport.on('ready', function (connectionInfo) {
      extend(manager.connectionInfo, connectionInfo)
      manager.connectionInfo.publicKey = manager.publicKey
      manager.emit('ready', manager.connectionInfo)
      manager._publishConnectionInfo()
    })
    transport.on('disable', function () {
      if (this.isDisabled()) {
        manager.emit('disable')
      }
    })
    transport.on('message', function (publicKey, message) {
      manager.emit('message', publicKey, message)
    })
  }
}

TransportManager.prototype.enable = function () {
  _.forEach(this.transports, function (transport) {
    transport.enable()
  })
}

TransportManager.prototype.disable = function () {
  _.forEach(this.transports, function (transport) {
    transport.disable()
  })
}

TransportManager.prototype.isDisabled = function () {
  return _.every(this.transports, function (transport) {
    return transport.isDisabled()
  })
}

TransportManager.prototype.send = function (publicKey, message) {
  expect(this.isConnected(publicKey)).to.be.true
  var connection = this.getConnection(publicKey)
  return connection.send(publicKey, message)
}

TransportManager.prototype.connect = function (publicKey) {
  if (this.isConnected(publicKey)) {
    var deferred = Q.defer()
    process.nextTick(function () {
      deferred.resolve()
    })
    return deferred.promise
  } else {
    return this._findKey(publicKey)
      .then(this._connect)
  }
}

TransportManager.prototype.getConnection = function (publicKey) {
  var connection
  _.forEach(this.transports, function (transport) {
    if (!connection) {
      connection = transport.getConnection()
    }
  })
  return connection
}

TransportManager.prototype._connect = function (connectionInfo) {
  var deferred = Q.defer()
  var promise = deferred.promise
  _.forEach(this.transports, function (transport) {
    promise = promise.then(undefined, transport.connect.bind(connectionInfo))
  }, this)
  deferred.reject()
  return promise
}

/**
 * CONNECTION INFO
 */
TransportManager.prototype._loadDirectoryCache = function () {
  var manager = this
  var options = {
    success: function (value) {
      expect(value).to.be.an('object')
      _.forEach(value, function (n, key) {
        if (!_.has(manager.directoryCache, key)) {
          manager.directoryCache[key] = n
        }
      })
    }
  }
  storagejs.get('flunky-transport-directoryCache').then(options.success)
}

TransportManager.prototype._saveDirectoryCache = function () {
  storagejs.put('flunky-transport-directoryCache', this.directoryCache)
}

/**
 * Publish connection info in directory
 *
 * @private
 */
TransportManager.prototype._publishConnectionInfo = function () {
  this.messaging.send('directory.put', 'local', {key: this.publicKey, value: JSON.stringify(this.connectionInfo)})
}

/**
 * Lookup connectivity information in directory
 *
 * @private
 * @param {string} publicKey - publicKey of destination
 * @return {Promise}
 */
TransportManager.prototype._findKey = function (publicKey) {
  if (_.has(this.directoryCache, publicKey)) {
    var deferred = Q.defer()
    var cacheResult = this.directoryCache[publicKey].connectionInfo
    process.nextTick(function () {
      deferred.resolve(cacheResult)
    })
    if (!this.directoryCache[publicKey].lastUpdate || Math.abs(new Date() - new Date(this.directoryCache[publicKey].lastUpdate)) > PUBLISH_CONNECTION_INFO_INTERVAL) {
      if (!_.has(this.directoryLookup, publicKey)) {
        this._lookupKey(publicKey)
      }
    }
    return deferred.promise
  } else if (_.has(this.directoryLookup, publicKey)) {
    return this.directoryLookup[publicKey].promise
  } else {
    return this._lookupKey(publicKey)
  }
}

TransportManager.prototype._lookupKey = function (publicKey) {
  expect(this.directoryLookup).to.not.have.ownProperty(publicKey)
  var deferred = Q.defer()
  var manager = this
  this.messaging.send('directory.get', 'local', {key: publicKey})
  this.directoryLookup[publicKey] = deferred
  setTimeout(function () {
    if (_.has(manager.directoryLookup, publicKey)) {
      manager.directoryLookup[publicKey].reject('key lookup timeout')
      delete manager.directoryLookup[publicKey]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
  return deferred.promise
}

TransportManager.prototype._processGetReply = function (topic, publicKey, data) {
  if (_.has(this.directoryLookup, data.key)) {
    delete this.directoryLookup[data.key]
    this.directoryCache[data.key].lastUpdate = new Date().toJSON()
    this.directoryCache[data.key].connectionInfo = JSON.parse(data.value)
    this.directoryCache[data.key].publicKey = data.key
    this._saveDirectoryCache()
    this.directoryLookup[data.key].resolve(this.directoryCache[data.key])
  }
}

module.exports = TransportManager
