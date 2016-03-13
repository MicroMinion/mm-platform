var DIRECTORY_LOOKUP_TIMEOUT = 10000

var Directory = function () {
  /**
   * Connection information from previously used public keys
   *
   * @access private
   * @type {Object.<string, Object>}
   */
  this.directoryCache = {}
  this.directoryLookup = {}
  this._loadDirectoryCache()
}

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
