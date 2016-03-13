var inherits = require('inherits')
var _ = require('lodash')
var chai = require('chai')
var Q = require('q')
var extend = require('extend.js')
var debug = require('debug')('flunky-platform:transport-manager')
var events = require('events')

var expect = chai.expect

var DIRECTORY_LOOKUP_TIMEOUT = 10000

/**
 * Interval for publishing connection info in directory
 *
 * @constant
 * @default
 * @type {number}
 * @private
 * @readonly
 */
var PUBLISH_CONNECTION_INFO_INTERVAL = 1000 * 60

/**
 * @constructor
 * @public
 * @param {Object} options
 * @param {Object} options.storage - KAD-FS storage interface
 */
var TransportManager = function (options) {
  debug('initialize')
  this.options = options
  this.storage = this.options.storage
  var manager = this
  this.messaging
  /**
   * Connection information from previously used public keys
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.directoryCache = {}
  this.directoryLookup = {}
  this._loadDirectoryCache()
  setInterval(function () {
    manager._publishConnectionInfo()
  }, PUBLISH_CONNECTION_INFO_INTERVAL)
}

inherits(TransportManager, events.EventEmitter)

/* MESSAGING INTERACTION */

/**
 * Set messaging objects
 *
 * @public
 */
TransportManager.prototype.setMessaging = function (messaging) {
  this.messaging = messaging
  var manager = this
  this.messaging.once('self.profile.update', function (topic, publicKey, data) {
    debug('profile update event')
    manager.publicKey = data.publicKey
    manager.privateKey = data.privateKey
    manager.connectionInfo.publicKey = data.publicKey
    manager._initializeTransports()
  })
  this.messaging.on('self.transports.connectionInfo', this._processConnectionInfo.bind(this))
  this.messaging.on('self.transports.requestMyConnectionInfo', function (topic, publicKey, data) {
    manager._publishConnectionInfo()
  })
}

/* TRANSPORT MANAGEMENT */

/**
 * Add Transport class
 *
 * @param {AbstractTransport} TransportClass
 * @public
 */
TransportManager.prototype.addTransport = function (TransportClass) {
  this.transportClasses.push(TransportClass)
}

/**
 * @public
 */
TransportManager.prototype.enable = function () {
  debug('enable')
  _.forEach(this.transports, function (transport) {
    transport.enable()
  })
}

/**
 * @public
 */
TransportManager.prototype.disable = function () {
  debug('disable')
  _.forEach(this.transports, function (transport) {
    transport.disable()
  })
}

/**
 * @public
 */
TransportManager.prototype.isDisabled = function () {
  debug('isDisabled')
  return _.every(this.transports, function (transport) {
    return transport.isDisabled()
  })
}

/**
 * @private
 */
TransportManager.prototype._initializeTransports = function () {
  debug('initializeTransports')
  _.forEach(this.transportClasses, function (transportClass) {
    this._initializeTransport(transportClass)
  }, this)
}

/**
 * @private
 */
TransportManager.prototype._initializeTransport = function (TransportClass) {
  debug('initializeTransport')
  var manager = this
  var transport
  var options = this.options
  options.publicKey = this.publicKey
  options.privateKey = this.privateKey
  try {
    transport = new TransportClass(options)
  } catch(e) {
    debug('disabling transport ' + TransportClass)
    debug(e)
  }
  if (transport) {
    this.transports.push(transport)
    transport.on('ready', function (connectionInfo) {
      debug('ready event')
      extend(manager.connectionInfo, connectionInfo)
      manager.connectionInfo.publicKey = manager.publicKey
      manager._publishConnectionInfo()
    })
    transport.on('message', function (publicKey, message) {
      debug('message event ' + message)
      manager.emit('message', publicKey, message)
    })
    transport.on('connection', function (publicKey) {
      manager.messaging.send('transport.connection', 'local', publicKey)
    })
    transport.on('disconnection', function (publicKey) {
      manager.messaging.send('transport.disconnection', 'local', publicKey)
    })
  }
}

/* SEND LOGIC */

/**
 * Send a message to a public keys
 *
 * Connection needs to exist before executing this method
 * @public
 * @param {string} publicKey 32 byte Base64 encoded publicKey
 * @param {Buffer} message
 */
TransportManager.prototype.send = function (publicKey, message) {
  debug('send ' + publicKey)
  var connection = this._getConnection(publicKey)
  if (connection) {
    // TODO: Execute connect first if not connected (use promises) !!!!!!!!!!!!!!!
    return this._send(message, connection)
  } else {
    var deferred = Q.defer()
    process.nextTick(function () {
      deferred.reject(new Error('Connection does not exist'))
    })
    return deferred.promise
  }
}

/**
 * Connect to another host using publicKey identifier
 *
 * If we don't have connectionInfo assocated with publicKey, a lookup is performed first
 *
 * @private
 */
TransportManager.prototype._connect = function (publicKey) {
  debug('connect ' + publicKey)
  var manager = this
  if (this.isConnected(publicKey)) {
    var deferred = Q.defer()
    process.nextTick(function () {
      deferred.resolve(manager._getConnection(publicKey))
    })
    return deferred.promise
  } else {
    return this._findKey(publicKey)
      .then(this._connectTransports.bind(this))
  }
}

/**
 * Try to connect to a host using connectionInfo Object
 *
 * Transports are tried in the order defined in "_initializeTransports" method
 * When connection using one transport fails, the next one is tried
 *
 * @private
 */
TransportManager.prototype._connectTransports = function (connectionInfo) {
  // debug('_connect ' + connectionInfo.publicKey)
  var deferred = Q.defer()
  var promise = deferred.promise
  _.forEach(this.transports, function (transport) {
    if (!transport.isDisabled()) {
      promise = promise.then(undefined, transport.connect.bind(transport, connectionInfo))
    }
  }, this)
  deferred.reject()
  return promise
}

/**
 * @private
 */
TransportManager.prototype._getConnection = function (publicKey) {
  debug('getConnection ' + publicKey)
  var connection
  _.forEach(this.transports, function (transport) {
    if (!connection) {
      connection = transport.getConnection(publicKey)
    }
  })
  if (connection === null) {
    debug('Connection is null')
  }
  return connection
}

/**
 * CONNECTION INFO
 */

/**
 * @private
 */
TransportManager.prototype._loadDirectoryCache = function () {
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
  Q.nfcall(this.storage.get.bind(this.storage), 'flunky-transport-directoryCache').then(options.success)
}

/**
 * @private
 */
TransportManager.prototype._saveDirectoryCache = function () {
  debug('saveDirectoryCache')
  this.storage.put('flunky-transport-directoryCache', JSON.stringify(this.directoryCache))
}

/**
 * Publish connection info in directory
 *
 * @private
 */
TransportManager.prototype._publishConnectionInfo = function () {
  debug('publishConnectionInfo')
  debug(this.connectionInfo)
  this.messaging.send('transports.myConnectionInfo', 'local', this.connectionInfo)
}

/**
 * Lookup connectivity information in directory
 *
 * @private
 * @param {string} publicKey - publicKey of destination
 * @return {Promise}
 */
TransportManager.prototype._findKey = function (publicKey) {
  debug('_findKey')
  if (_.has(this.directoryCache, publicKey)) {
    var deferred = Q.defer()
    var cacheResult = this.directoryCache[publicKey]
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

/**
 * @private
 */
TransportManager.prototype._lookupKey = function (publicKey) {
  debug('_lookupKey')
  expect(this.directoryLookup).to.not.have.ownProperty(publicKey)
  var deferred = Q.defer()
  var manager = this
  this.messaging.send('transports.requestConnectionInfo', 'local', publicKey)
  this.directoryLookup[publicKey] = deferred
  setTimeout(function () {
    if (_.has(manager.directoryLookup, publicKey)) {
      manager.directoryLookup[publicKey].reject('key lookup timeout')
      delete manager.directoryLookup[publicKey]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
  return deferred.promise
}

/**
 * @private
 */
TransportManager.prototype._processConnectionInfo = function (topic, publicKey, data) {
  debug('connectionInfo event')
  if (!_.has(this.directoryCache, data.publicKey)) {
    this.directoryCache[data.publicKey] = {}
  }
  this.directoryCache[data.publicKey] = data
  this.directoryCache[data.publicKey].lastUpdate = new Date().toJSON()
  this._saveDirectoryCache()
  if (_.has(this.directoryLookup, data.publicKey)) {
    this.directoryLookup[data.publicKey].resolve(data)
    delete this.directoryLookup[data.publicKey]
  }
}

module.exports = TransportManager