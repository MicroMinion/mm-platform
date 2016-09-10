'use strict'

var Identity = require('./identity')
var inherits = require('inherits')
var OfflineBuffer = require('./offline-buffer.js')
var API = require('./api.js')
var EventEmitter = require('events').EventEmitter
var NetstringStream = require('./netstring.js')
var MMProtocol = require('./mm-protocol.js')
var Circle = require('./circle.js')
var Directory = require('./directory.js')
var _ = require('lodash')
var MemStore = require('kad-memstore-thomas')
var assert = require('assert')
var validation = require('./validation.js')
var winston = require('winston')
var winstonWrapper = require('winston-meta-wrapper')
var setImmediate = require('async.util.setimmediate')
var TransportManager = require('./transport.js')

var CONNECT_RANDOMIZATION = 100

var getRandomInt = function (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * MicroMinion Platform
 *
 * @constructor
 * @param {Object} options - Options that will be passed down to transport
 * @param {Object} options.storage - KAD-FS compatible storage interface
 * @param {Object} options.directory - Directory lookup object
 * @param {Object} options.identity - Public/Private keypair
 * @param {Circle} options.friends - Circle object with list of trusted keys
 * @param {Circle} options.devices - Circle object with list of trusted keys
 */
var Platform = function (options) {
  assert(validation.validOptions(options))
  EventEmitter.call(this)
  if (!options) {
    options = {}
  }
  // LOGGING
  if (!options.logger) {
    options.logger = winston
  }
  this._log = winstonWrapper(options.logger)
  this._log.addMeta({
    module: 'mm-platform'
  })
  // STORAGE
  if (!options.storage) {
    options.storage = new MemStore()
  }
  this.storage = options.storage
  // IDENTITY
  this._identityReady = false
  if (!options.identity) {
    options.identity = new Identity({
      platform: this,
      storage: this.storage,
      logger: this._log
    })
  }
  this.identity = options.identity
  var self = this
  this.identity.on('ready', function () {
    self._log.info('platform initialized')
    self._setupTransport(options.connectionInfo)
    self._identityReady = true
    if (self._transportReady) {
      self.emit('ready')
    }
  })
  // TRANSPORT
  this._transportReady = false
  this._connections = []
  this._sendQueue = {}
  // API
  this._setupAPI()
  // CIRCLES
  if (!options.friends) {
    options.friends = new Circle('friends.update', this)
  }
  this.friends = options.friends
  if (!options.devices) {
    options.devices = new Circle('devices.update', this)
  }
  this.devices = options.devices
  // DIRECTORY
  if (!options.directory) {
    options.directory = new Directory()
  }
  options.directory.setPlatform(this)
  this.directory = options.directory
}

inherits(Platform, EventEmitter)

Platform.prototype.isReady = function () {
  return this._identityReady && this._transportReady
}

Platform.prototype._setupTransport = function (connectionInfo) {
  this._log.debug('_setupTransport')
  var self = this
  this._transport = new TransportManager({
    logger: this._log,
    identity: this.identity
  })
  this._transport.on('close', function () {
    self._log.warn('transport closed')
    self._transport.removeAllListeners()
    self._setupTransport()
  })
  this._transport.on('connection', function (socket) {
    assert(validation.validStream(socket))
    self._log.info('new connection ' + socket.remoteAddress)
    socket = self._wrapConnection(socket)
    self.messaging.send('transports.online', 'local', socket.remoteAddress)
    self._flushQueue(socket.remoteAddress)
  })
  this._transport.on('connectionFailed', function (destination) {
    self._clearQueue(destination)
  })
  this._transport.on('error', function (err) {
    assert(_.isError(err))
    self._log.error('error in transport', {
      error: err
    })
  })
  this._transport.on('listening', function () {
    self._log.info('transport opened')
    var connectionInfo = self._transport.address()
    self.storage.put('myConnectionInfo', JSON.stringify(connectionInfo))
    self.directory.setMyConnectionInfo(connectionInfo)
    self._transportReady = true
    if (self._identityReady) {
      self.emit('ready')
    }
  })
  this._listen(connectionInfo)
}

Platform.prototype._listen = function (connectionInfo) {
  var self = this
  if (connectionInfo) {
    setImmediate(function () {
      self._transport.listen(connectionInfo)
    })
    return
  }
  var success = function (value) {
    assert(_.isString(value) || value === null || value === undefined)
    if (value === null || value === undefined || value.length === 0) {
      self._transport.listen()
    } else {
      value = JSON.parse(value)
      assert(_.isArray(value))
      self._transport.listen(value)
    }
  }
  var error = function (errorMessage) {
    self._log.debug('connectionInfo not stored yet', {
      error: errorMessage
    })
    assert(_.isError(errorMessage))
    self._transport.listen()
  }
  this.storage.get('myConnectionInfo', function (err, result) {
    if (err) {
      error(err)
    } else {
      success(result)
    }
  })
}

Platform.prototype._getConnection = function (publicKey) {
  assert(validation.validKeyString(publicKey))
  var connections = _.filter(this._connections, function (connection) {
    return connection.remoteAddress === publicKey
  })
  if (_.size(connections) > 0) {
    return connections[connections.length - 1]
  }
}

Platform.prototype._wrapConnection = function (socket) {
  assert(validation.validStream(socket))
  var netstrings = new NetstringStream({
    stream: socket,
    logger: this._log
  })
  var messages = new MMProtocol({
    stream: netstrings,
    platform: this,
    logger: this._log
  })
  this._connectEvents(messages)
  return messages
}

Platform.prototype._connectEvents = function (stream) {
  assert(validation.validStream(stream))
  var self = this
  stream.setMaxListeners(0)
  this._connections.push(stream)
  stream.on('data', function (message) {
    self._log.info('MicroMinion message received', {
      sender: message.sender,
      protocol: message.protocol,
      topic: message.topic,
      scope: message.scope
    })
    assert(validation.validProtocolObject(message))
    assert(_.has(message, 'sender'))
    assert(validation.validKeyString(message.sender))
    self.emit('message', message)
  })
  stream.on('close', function () {
    self._log.info('MicroMinion connection destroyed', {
      remote: stream.remoteAddress
    })
    self._connections.splice(self._connections.indexOf(stream), 1)
    stream.removeAllListeners()
    stream.on('error', function (error) {
      self._log.warn(error.message)
    })
    if (stream.remoteAddress) {
      self.messaging.send('transports.offline', 'local', stream.remoteAddress)
    }
  })
  stream.on('end', function () {
    self._log.debug('MicroMinion connection ended', {
      remote: stream.remoteAddress
    })
    stream.destroy()
  })
  stream.on('finish', function () {
    self._log.debug('MicroMinion connection end of stream reached', {
      remote: stream.remoteAddress
    })
    stream.destroy()
  })
  stream.on('error', function (err) {
    assert(_.isError(err))
    self._log.warn('MicroMinion connection error', {
      remote: stream.remoteAddress,
      errorName: err.name,
      errorMessage: err.message
    })
    stream.destroy()
  })
  stream.on('timeout', function () {
    self._log.info('MicroMinion stream timeout', {
      remote: stream.remoteAddress
    })
    stream.destroy()
  })
}

/**
 * send message: message is an object with the following properties
 *  topic: string that contains message type/topic
 *  protocol: message protocol (determines encoding of data)
 *  destination: publicKey of destination host
 *  payload: message blob (buffer)
 */
Platform.prototype.send = function (message, options) {
  assert(validation.validSendMessage(message))
  assert(validation.validOptions(options))
  var self = this
  self._log.debug('MicroMinion trying to send message', {
    destination: message.destination,
    protocol: message.protocol,
    topic: message.topic
  })
  if (!options) {
    options = {}
  }
  if (!options.callback) {
    options.callback = function (err) {
      assert(validation.validError(err))
      if (err) {
        self._log.warn('MicroMinion message failed to send', {
          destination: message.destination,
          protocol: message.protocol,
          topic: message.topic,
          error: err
        })
        self.messaging.send('transports.failed', 'local', message.destination)
      }
    }
  }
  var connection = this._getConnection(message.destination)
  if (connection) {
    this._send(message, connection, options.callback)
  } else {
    this._queueMessage(message, options.callback)
    var randomization = getRandomInt(0, CONNECT_RANDOMIZATION)
    setTimeout(this._connect.bind(this, message.destination), randomization)
  }
}

Platform.prototype._connect = function (destination) {
  var self = this
  this.directory.getNodeInfo(destination, function (err, result) {
    if (err) {
      assert(_.isError(err))
      assert(_.isNil(result))
      self._clearQueue(destination)
    } else {
      assert(_.isNil(err))
      assert(validation.validNodeInfo(result))
      self._transport.connect(result.boxId, result.connectionInfo)
    }
  })
}

Platform.prototype._queueMessage = function (message, callback) {
  assert(validation.validSendMessage(message))
  assert(_.isNil(callback) || _.isFunction(callback))
  var self = this
  self._log.debug('MicroMinion queuing message', {
    destination: message.destination,
    protocol: message.protocol,
    topic: message.topic
  })
  var errorCallback = function (err) {
    assert(_.isError(err))
    callback(err)
  }
  if (!_.has(this._sendQueue, message.destination)) {
    this._sendQueue[message.destination] = []
  }
  this._sendQueue[message.destination].push({
    message: message,
    callback: callback,
    errorCallback: errorCallback
  })
}

Platform.prototype._flushQueue = function (destination) {
  var self = this
  if (_.has(this._sendQueue, destination)) {
    var queue = this._sendQueue[destination]
    this._sendQueue[destination] = []
    _.forEach(queue, function (queueItem) {
      self.send(queueItem.message, {
        callback: queueItem.callback
      })
    })
  }
}

Platform.prototype._clearQueue = function (destination) {
  if (_.has(this._sendQueue, destination)) {
    var queue = this._sendQueue[destination]
    this._sendQueue[destination] = []
    _.forEach(queue, function (queueItem) {
      queueItem.errorCallback(new Error('Connection could not be established. Message sending failed.'))
    })
  }
}

/**
 * Send a message using a connection object
 *
 * @private
 */
Platform.prototype._send = function (message, connection, callback) {
  assert(validation.validSendMessage(message))
  assert(validation.validStream(connection))
  assert(_.isNil(callback) || _.isFunction(callback))
  connection.write(message, callback)
  this._log.info('MicroMinion message send', {
    destination: message.destination,
    protocol: message.protocol,
    topic: message.topic
  })
}

Platform.prototype._setupAPI = function () {
  assert(_.has(this, 'storage'))
  assert(_.has(this, 'identity'))
  var offlineBuffer = new OfflineBuffer({
    platform: this,
    storage: this.storage
  })
  this.messaging = new API({
    protocol: 'ms',
    platform: offlineBuffer,
    identity: this.identity,
    serialize: JSON.stringify,
    deserialize: JSON.parse
  })
  this.torrenting = new API({
    protocol: 'bt',
    platform: this,
    identity: this.identity
  })
}

module.exports = Platform
