var storagejs = require('storagejs')
var verificationState = require('../../constants/verificationState.js')
var SyncStream = require('./sync-stream.js')
var Log = require('./collection.js')
var events = require('events')
var inherits = require('inherits')
var _ = require('lodash')
var debug = require('debug')('flunky-platform:util:mmds:syncEngine')

var SYNC_INTERVAL = 1000 * 60

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
  this.messaging.on('self.profile.update', this.updateProfile.bind(this))
  this.messaging.send('self.profile.updateRequest', 'local', {})
  this.messaging.on('self.' + this.service + '.events', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_events(data)
    }
  })
  this.messaging.on('self.' + this.service + '.checkpoint', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_checkpoint(data)
    }
  })
  this.messaging.on('self.' + this.service + '.obsolete', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_obsolete(data)
    }
  })
  this.messaging.on('self.' + this.service + '.lowest_sequence', function (topic, publicKey, data) {
    if (_.has(engine.syncStreams, publicKey)) {
      engine.syncStreams[publicKey].on_lowest_sequence(data)
    }
  })
  this.messaging.send('self.devices.updateRequest', 'local', {})
  this.interval = setInterval(function () {
    _.forEach(_.sample(engine.syncStreams, 2), function (syncStream) {
      syncStream.send_checkpoint()
    }, engine)
  }, SYNC_INTERVAL)
}

inherits(SyncEngine, events.EventEmitter)

SyncEngine.prototype.setCollection = function (collection) {
  this.collection = collection
  this.log.setCollection(collection)
}

/* MESSAGE HANDLERS */

SyncEngine.prototype.updateProfile = function(topic, local, data) {
  this.publicKey = data.publicKey
}

SyncEngine.prototype.updateDevices = function (topic, local, data) {
  debug('updateDevices ' + this.service)
  var engine = this
  var devices = data
  debug(_.keys(engine.syncStreams))
  var toAdd = _.filter(_.keys(devices), function (publicKey) {
    return !_.has(engine.syncStreams, publicKey)
    && devices[publicKey].verificationState === verificationState.CONFIRMED
    && publicKey !== this.publicKey
  }, this)
  debug(toAdd)
  var toDelete = _.filter(_.keys(this.syncStreams), function (publicKey) {
    return !_.has(devices, publicKey) || devices[publicKey].verificationState < verificationState.CONFIRMED
  }, this)
  debug(toDelete)
  _.forEach(toAdd, function (publicKey) {
    engine.syncStreams[publicKey] = new SyncStream(publicKey, this.service, this.log, this.messaging)
    debug('engine.syncStreams after add ' + _.keys(engine.syncStreams))
    if (_.has(this.checkpoints, publicKey)) {
      engine.syncStreams[publicKey].setSequenceCheckpoint(this.checkpoints[publicKey])
    }
    engine.syncStreams[publicKey].on('sequenceCheckpointUpdate', function (sequence) {
      engine.checkpoints[publicKey] = sequence
      storagejs.put(engine.service + '-checkpoints', engine.checkpoints)
    })
    engine.syncStreams[publicKey].send_checkpoint()
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
