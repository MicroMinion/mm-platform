'use strict'

var Identity = require('./identity')
var inherits = require('inherits')
var OfflineBuffer = require('./offline-buffer.js')
var API = require('./api.js')
var EventEmitter = require('events').EventEmitter
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
var ns = require('./ns.js')
var ProtoBuf = require('protobufjs')

var definition = {
  'name': 'Message',
  'fields': [{
    'rule': 'required',
    'type': 'string',
    'name': 'topic',
    'id': 1
  }, {
    'rule': 'required',
    'type': 'string',
    'name': 'protocol',
    'id': 2
  }, {
    'rule': 'required',
    'type': 'string',
    'name': 'payload',
    'id': 3
  }]
}

var builder = ProtoBuf.newBuilder()
builder.create(definition)
var Message = builder.build('Message')

var CONNECT_RANDOMIZATION = 100
var MAX_CONNECTION_ATTEMPTS = 5

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
  this._sendQueue = {}
  this._receiveBuffer = {}
  this._connectionAttempts = {}
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

// TRANSPORT SETUP LOGIC

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
  this._transport.on('connected', function (destination) {
    assert(validation.validKeyString(destination))
    self._log.info('CONNECTION RECEIVED IN PLATFORM ' + destination)
    self.messaging.send('transports.online', 'local', destination)
    self._connectionAttempts[destination] = 0
    self._flushQueue(destination)
  })
  this._transport.on('disconnected', function (destination) {
    assert(validation.validKeyString(destination))
    self._log.info('disconnected ' + destination)
    self._connectionAttempts[destination] += 1
    if (self._connectionAttempts[destination] > MAX_CONNECTION_ATTEMPTS) {
      self._clearQueue(destination)
    } else {
      self._connect(destination)
    }
    self.messaging.send('transports.offline', 'local', destination)
  })
  this._transport.on('error', function (err) {
    assert(_.isError(err))
    self._log.error('error in transport', {
      error: err
    })
  })
  this._transport.on('data', function (origin, message) {
    assert(validation.validKeyString(origin))
    assert(_.isBuffer(message))
    self._processData(origin, message)
  })
  this._transport.on('listening', function () {
    var connectionInfo = self._transport.address()
    self._log.info('transport opened, connection-info = ' + JSON.stringify(connectionInfo))
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

// MESSAGE RECEIVE LOGIC

Platform.prototype._processData = function (origin, message) {
  assert(validation.validKeyString(origin))
  assert(_.isBuffer(message))
  if (!_.has(this._receiveBuffer, origin)) {
    this._receiveBuffer[origin] = message
  } else {
    this._receiveBuffer[origin] = Buffer.concat([this._receiveBuffer[origin], message])
  }
  try {
    this._processBuffer(origin)
  } catch (e) {
    assert(_.isError(e))
    this._log.warn('failed to process netstring buffer')
    delete this._receiveBuffer[origin]
  }
}

Platform.prototype._processBuffer = function (origin) {
  assert(_.has(this._receiveBuffer, origin))
  assert(_.isBuffer(this._receiveBuffer[origin]))
  assert(validation.validKeyString(origin))
  var self = this
  if (this._receiveBuffer[origin].length === 0) {
    return
  }
  var messageLength = ns.nsLength(this._receiveBuffer[origin])
  if (messageLength > 0 && this._receiveBuffer[origin].length >= messageLength) {
    var payload = ns.nsPayload(this._receiveBuffer[origin])
    this._receiveBuffer[origin] = this._receiveBuffer[origin].slice(messageLength)
    this._processMessage(origin, payload)
    process.nextTick(function () {
      self._processBuffer(origin)
    })
  }
}

Platform.prototype._processMessage = function (origin, data) {
  assert(_.isBuffer(data))
  assert(validation.validKeyString(origin))
  var self = this
  try {
    var _message = Message.decode(data)
    var message = {
      topic: _message.topic,
      protocol: _message.protocol,
      payload: _message.payload
    }
    message.sender = origin
    message.scope = self._getScope(origin)
    assert(validation.validReceivedMessage(message))
    self._log.info('MicroMinion message received', {
      sender: message.sender,
      protocol: message.protocol,
      topic: message.topic,
      scope: message.scope
    })
    self.emit('message', message)
  } catch (e) {
    self._log.warn('invalid message received - dropped', {
      error: e,
      remote: origin
    })
  }
}

Platform.prototype._getScope = function (publicKey) {
  assert(validation.validKeyString(publicKey))
  this._log.debug('_getScope', {
    publicKey: publicKey
  })
  if (this.devices.inScope(publicKey)) {
    return 'self'
  } else if (this.friends.inScope(publicKey)) {
    return 'friends'
  } else {
    return 'public'
  }
}

// MESSAGE SEND LOGIC

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
  this._queueMessage(message, options.callback)
  var randomization = getRandomInt(0, CONNECT_RANDOMIZATION)
  setTimeout(this._connect.bind(this, message.destination), randomization)
}

Platform.prototype._connect = function (destination) {
  assert(validation.validKeyString(destination))
  var self = this
  this.directory.getNodeInfo(destination, function (err, result) {
    if (err) {
      assert(_.isError(err))
      assert(_.isNil(result))
      self._clearQueue(destination)
    } else {
      assert(_.isNil(err))
      assert(validation.validNodeInfo(result))
      assert(destination === result.boxId)
      self._transport.connect(result.boxId, result.connectionInfo)
    }
  })
}

Platform.prototype._queueMessage = function (message, callback) {
  assert(validation.validSendMessage(message))
  assert(_.isNil(callback) || _.isFunction(callback))
  if (!_.has(this._sendQueue, message.destination)) {
    this._sendQueue[message.destination] = []
  }
  this._sendQueue[message.destination].push({
    message: message,
    callback: callback
  })
}

Platform.prototype._flushQueue = function (destination) {
  assert(validation.validKeyString(destination))
  var canSend = true
  if (_.has(this._sendQueue, destination)) {
    while (canSend && this._sendQueue[destination].length > 0) {
      var queueItem = this._sendQueue[destination].shift()
      canSend = this._send(queueItem.message, queueItem.callback)
    }
  }
}

Platform.prototype._clearQueue = function (destination) {
  assert(validation.validKeyString(destination))
  if (_.has(this._sendQueue, destination)) {
    while (this._sendQueue[destination].length > 0) {
      var queueItem = this._sendQueue[destination].shift()
      queueItem.callback(new Error('Connection could not be established. Message sending failed.'))
    }
  }
}

/**
 * Send a message using a connection object
 *
 * @private
 */
Platform.prototype._send = function (chunk, callback) {
  assert(validation.validSendMessage(chunk))
  assert(_.isNil(callback) || _.isFunction(callback))
  var destination = chunk.destination
  var message = new Message({
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  })
  this._log.info('MicroMinion message send', {
    destination: message.destination,
    protocol: message.protocol,
    topic: message.topic
  })
  return this._transport.send(ns.nsWrite(new Buffer(message.toBuffer())), destination, callback)
}

// API SYNTACTIC SUGAR

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
