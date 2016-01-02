var inherits = require('inherits')
var _ = require('lodash')
var chai = require('chai')
var Q = require('q')
var extend = require('extend.js')
var AbstractTransport = require('./transports/transport-abstract.js')
var debug = require('debug')('flunky-platform:messaging:transport-manager')

var TCPTransport = require('./transports/transport-tcp.js')
var GCMTransport = require('./transports/transport-gcm.js')
var UDPTurnTransport = require('./transports/transport-udp-turn.js')

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
var PUBLISH_CONNECTION_INFO_INTERVAL = 1000 * 60

var DIRECTORY_LOOKUP_TIMEOUT = 10000

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
}

inherits(TransportManager, AbstractTransport)

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
  this.messaging.on('self.messaging.connectionInfo', this._processConnectionInfo.bind(this))
  this.messaging.on('self.messaging.requestMyConnectionInfo', function (topic, publicKey, data) {
    manager._publishConnectionInfo()
  })
}

TransportManager.prototype._initializeTransports = function () {
  debug('initializeTransports')
  var transports = [TCPTransport]
  _.forEach(transports, function (transportClass) {
    this._initializeTransport(transportClass)
  }, this)
}

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

TransportManager.prototype.enable = function () {
  debug('enable')
  _.forEach(this.transports, function (transport) {
    transport.enable()
  })
}

TransportManager.prototype.disable = function () {
  debug('disable')
  _.forEach(this.transports, function (transport) {
    transport.disable()
  })
}

TransportManager.prototype.isDisabled = function () {
  debug('isDisabled')
  return _.every(this.transports, function (transport) {
    return transport.isDisabled()
  })
}

/**
 * Send a message to a public keys
 *
 * Connection needs to exist before executing this method
 */
TransportManager.prototype.send = function (publicKey, message) {
  debug('send ' + publicKey)
  var connection = this.getConnection(publicKey)
  if (connection) {
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
 * Send a message using a connection object
 *
 * @access private
 */
TransportManager.prototype._send = function (message, connection) {
  var deferred = Q.defer()
  connection.write(message, function (err) {
    if (err) {
      deferred.reject(err)
    } else {
      deferred.resolve()
    }
  })
  return deferred.promise
}

/**
 * Connect to another host using publicKey identifier
 *
 * If we don't have connectionInfo assocated with publicKey, a lookup is performed first
 */
TransportManager.prototype.connect = function (publicKey) {
  debug('connect ' + publicKey)
  var manager = this
  if (this.isConnected(publicKey)) {
    var deferred = Q.defer()
    process.nextTick(function () {
      deferred.resolve(manager.getConnection(publicKey))
    })
    return deferred.promise
  } else {
    return this._findKey(publicKey)
      .then(this._connect.bind(this))
  }
}

TransportManager.prototype.getConnection = function (publicKey) {
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
 * Try to connect to a host using connectionInfo Object
 *
 * Transports are tried in the order defined in "_initializeTransports" method
 * When connection using one transport fails, the next one is tried
 *
 * @access private
 */
TransportManager.prototype._connect = function (connectionInfo) {
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
 * CONNECTION INFO
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
  this.messaging.send('messaging.myConnectionInfo', 'local', this.connectionInfo)
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

TransportManager.prototype._lookupKey = function (publicKey) {
  debug('_lookupKey')
  expect(this.directoryLookup).to.not.have.ownProperty(publicKey)
  var deferred = Q.defer()
  var manager = this
  this.messaging.send('messaging.requestConnectionInfo', 'local', publicKey)
  this.directoryLookup[publicKey] = deferred
  setTimeout(function () {
    if (_.has(manager.directoryLookup, publicKey)) {
      manager.directoryLookup[publicKey].reject('key lookup timeout')
      delete manager.directoryLookup[publicKey]
    }
  }, DIRECTORY_LOOKUP_TIMEOUT)
  return deferred.promise
}

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
