var inherits = require('inherits')
var _ = require('lodash')
var storagejs = require('storagejs')
var chai = require('chai')
var Q = require('q')
var extend = require('extend.js')
var AbstractTransport = require('./transport-abstract.js')
var debug = require('debug')('flunky-platform:messaging:transport-manager')

var TCPTransport = require('./transport-tcp.js')
var GCMTransport = require('./transport-gcm.js')
var UDPTurnTransport = require('./transport-udp-turn.js')

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

var TransportManager = function () {
  debug('initialize')
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
    manager._initializeTransports()
  })
  this.messaging.on('self.directory.getReply', this._processGetReply.bind(this))
  this.messaging.on('self.messaging.connectionInfo', function (topic, publicKey, data) {
    debug('connectionInfo event')
    if (!manager.directoryCache[data.publicKey]) {
      manager.directoryCache[data.publicKey] = {}
      manager.directoryCache[data.publicKey].connectionInfo = data.connectionInfo
      manager.directoryCache[data.publicKey].publicKey = data.publicKey
      manager.directoryCache[data.publicKey].lastUpdate = new Date().toJSON()
      manager._saveDirectoryCache()
    }
  })
}

TransportManager.prototype._initializeTransports = function () {
  debug('initializeTransports')
  var transports = [TCPTransport, UDPTurnTransport, GCMTransport]
  _.forEach(transports, function (transportClass) {
    this._initializeTransport(transportClass)
  }, this)
}

TransportManager.prototype._initializeTransport = function (TransportClass) {
  debug('initializeTransport')
  var manager = this
  var transport
  try {
    transport = new TransportClass(this.publicKey, this.privateKey)
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
 * If a connection exists, we'll reuse this. Otherwise connect is executed first
 */
TransportManager.prototype.send = function (publicKey, message) {
  debug('send')
  var connection = this.getConnection(publicKey)
  if (connection) {
    return this._send(message, connection)
  } else {
    var result = this.connect(publicKey)
      .then(this._send.bind(this, message))
    return result
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
  debug('connect')
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
  debug('getConnection')
  var connection
  _.forEach(this.transports, function (transport) {
    if (!connection) {
      connection = transport.getConnection(publicKey)
    }
  })
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
  debug('_connect')
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
  debug('saveDirectoryCache')
  storagejs.put('flunky-transport-directoryCache', this.directoryCache)
}

/**
 * Publish connection info in directory
 *
 * @private
 */
TransportManager.prototype._publishConnectionInfo = function () {
  debug('publishConnectionInfo')
  this.messaging.send('directory.put', 'local', {key: this.publicKey, value: JSON.stringify(this.connectionInfo)})
  this.messaging.send('messaging.myConnectionInfo', 'local', {key: this.publicKey, value: this.connectionInfo})
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
      deferred.resolve(cacheResult.connectionInfo)
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
  debug('_processGetReply')
  if (_.has(this.directoryLookup, data.key)) {
    if (!_.has(this.directoryCache, data.key)) {
      this.directoryCache[data.key] = {}
    }
    this.directoryCache[data.key].lastUpdate = new Date().toJSON()
    this.directoryCache[data.key].connectionInfo = JSON.parse(data.value)
    this.directoryCache[data.key].publicKey = data.key
    this._saveDirectoryCache()
    this.directoryLookup[data.key].resolve(this.directoryCache[data.key].connectionInfo)
    delete this.directoryLookup[data.key]
  }
}

module.exports = TransportManager
