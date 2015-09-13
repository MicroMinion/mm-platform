var storagejs = require('storagejs')
var verificationState = require('../../constants/verificationState.js')
var SyncStream = require('./sync-stream.js')
var Log = require('./collection.js')
var events = require('events')
var inherits = require('inherits')
var _ = require('lodash')
var debug = require('debug')('flunky-platform:util:mmds:syncEngine')

var SyncEngine = function (messaging, service, idAttribute, collection) {
  var engine = this
  events.EventEmitter.call(this)
  this.messaging = messaging
  this.log = new Log(service, idAttribute, collection)
  this.log.on('processEvent', function (action, document) {
    engine.emit('processEvent', action, document)
  })
  this.service = service
  this.syncStreams = {}
  this.checkpoints = {}
  storagejs.get(this.service + '-checkpoints').then(
    function (value) {
      engine.checkpoints = value
      _.forEach(engine.syncStreams, function (stream, key) {
        if (_.has(this.checkpoints, key)) {
          stream.setSequenceCheckpoint(this.checkpoints[key])
        }
      }, engine)
    }
  )
  this.messaging.on('self.devices.update', this.updateDevices.bind(this))
  this.messaging.on('self.' + this.service + '.last_sequence_request', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_last_sequence_request(data)
    }
  })
  this.messaging.on('self.' + this.service + '.last_sequence', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_last_sequence(data)
    }
  })
  this.messaging.on('self.' + this.service + '.event_request', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_event_request(data)
    }
  })
  this.messaging.on('self.' + this.service + '.events', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_events(data)
    }
  })
  this.messaging.send('self.devices.updateRequest', 'local', {})
}

inherits(SyncEngine, events.EventEmitter)

SyncEngine.prototype.setCollection = function (collection) {
  this.collection = collection
  this.log.setCollection(collection)
}

/* MESSAGE HANDLERS */

SyncEngine.prototype.updateDevices = function (topic, local, data) {
  debug('updateDevices ' + this.service)
  var engine = this
  var devices = data
  debug(_.keys(engine.syncStreams))
  var toAdd = _.filter(_.keys(devices), function (publicKey) {
    return !_.has(engine.syncStreams, publicKey) && devices[publicKey].verificationState === verificationState.CONFIRMED
  }, this)
  debug(toAdd)
  var toDelete = _.filter(_.keys(this.syncStreams), function (publicKey) {
    return !_.has(devices, publicKey) || devices[publicKey].verificationState < verificationState.CONFIRMED
  }, this)
  debug(toDelete)
  _.forEach(toAdd, function (publicKey) {
    engine.syncStreams[publicKey] = new SyncStream(publicKey, this.service, this.log, this.messaging)
    debug("engine.syncStreams after add " + _.keys(engine.syncStreams))
    if (_.has(this.checkpoints, publicKey)) {
      engine.syncStreams[publicKey].setSequenceCheckpoint(this.checkpoints[publicKey])
    }
    engine.syncStreams[publicKey].on('sequenceCheckpointUpdate', function (sequence) {
      engine.checkpoints[publicKey] = sequence
      storagejs.put(engine.service + '-checkpoints', engine.checkpoints)
    })
  }, this)
  _.forEach(toDelete, function (publicKey) {
    debug('deleting ' + publicKey)
    engine.syncStreams[publicKey].stop()
    delete engine.syncStreams[publicKey]
  }, this)
}

/* API */

SyncEngine.prototype.add = function (id) {
  this.log.add(id)
}

SyncEngine.prototype.remove = function (id) {
  this.log.remove(id)
}

SyncEngine.prototype.update = function (id) {
  this.log.update(id)
}

module.exports = SyncEngine
