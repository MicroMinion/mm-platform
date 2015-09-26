var events = require('events')
var inherits = require('inherits')
var _ = require('lodash')
var debug = require('debug')('flunky-platform:util:mmds:sync-stream')

var SyncStream = function (publicKey, service, log, messaging) {
  debug('initialize ' + publicKey)
  events.EventEmitter.call(this)
  this.publicKey = publicKey
  this.service = service
  this.log = log
  this.messaging = messaging
  this.sequenceCheckpoint = 0
  this.afterCheckpointEvents = {}
  var stream = this
  this.log.on('newEvent', this.sendEvent.bind(stream))
}

inherits(SyncStream, events.EventEmitter)

SyncStream.prototype.stop = function () {
  debug('stop')
}

/* EVENTS */

SyncStream.prototype.sendEvent = function (event) {
  debug(this.service + ' sendEvent ' + this.publicKey)
  this.messaging.send(this.service + '.events', this.publicKey, [event], {expireAfter: 15000, realtime: true})
}

SyncStream.prototype.on_events = function (events) {
  for (var i = 0; i < events.length; i++) {
    this.on_event(events[i])
  }
}

SyncStream.prototype.on_event = function (event) {
  var document = event.document
  if (document === null || document === undefined) {
    this.addEvent(event.sequence)
  } else {
    this.log.processEvent(event)
    this.addEvent(event.sequence)
  }
}

SyncStream.prototype.addEvent = function (sequence) {
  this.afterCheckpointEvents[sequence] = true
  this.updateCheckpoint()
}

SyncStream.prototype.updateCheckpoint = function () {
  var events = this.afterCheckpointEvents
  var incrementOK = true
  while (incrementOK) {
    if (events[this.sequenceCheckpoint + 1]) {
      delete this.afterCheckpointEvents[this.sequenceCheckpoint + 1]
      this.sequenceCheckpoint = this.sequenceCheckpoint + 1
      this.emit('sequenceCheckpointUpdate', this.sequenceCheckpoint)
    } else {
      incrementOK = false
    }
  }
}

SyncStream.prototype.setSequenceCheckpoint = function (checkpoint) {
  this.sequenceCheckpoint = checkpoint
  var deleteKeys = _.filter(_.keys(this.afterCheckpointEvents), function (sequence) {
    return sequence <= checkpoint
  }, this)
  _.forEach(deleteKeys, function (key) {
    delete this.afterCheckpointEvents[key]
  }, this)
}

/** Checkpoint */

SyncStream.prototype.on_checkpoint = function (receivedData) {
  debug(receivedData)
  // For each event that is > checkpoint and not in aftercheckpoint => send event
  var events = this.log.getEvents(receivedData.checkpoint, receivedData.afterCheckpoint)
  if (_.size(events) > 0) {
    this.messaging.send(this.service + '.events', this.publicKey, events, {expireAfter: 15000, realtime: true})
  }
  // If received checkpoint is smaller than the lowest available checkpoint => send lowest checkpoint message
  var lowestSequence = this.log.getLowestSequence()
  if (receivedData.checkpoint < lowestSequence) {
    this.messaging.send(this.service + '.lowest_sequence', this.publicKey, {lowestSequence: lowestSequence}, {expireAfter: 15000, realtime: false})
  }
  // If there are holes for which we do not have an event anymore because it is obsolete => send obsolet message
  var checkpoint = _.max([lowestSequence, receivedData.checkpoint])
  var sequenceArray = []
  var lastSequence = this.log.getLastSequence()

  for (var i = checkpoint + 1; i <= lastSequence; i++) {
    sequenceArray.push(i)
  }
  var obsoleteArray = _.difference(sequenceArray, _.union(receivedData.afterCheckpoint, _.map(events, 'sequence')))
  if (_.size(obsoleteArray) > 0) {
    this.messaging.send(this.service + '.obsolete', this.publicKey, obsoleteArray, {expireAfter: 15000, realtime: false})
  }
}

SyncStream.prototype.send_checkpoint = function () {
  debug(this.service + ' checkpoint ' + this.publicKey)
  var data = {
    checkpoint: this.sequenceCheckpoint,
    afterCheckpoint: _.keys(this.afterCheckpointEvents)
  }
  this.messaging.send(this.service + '.checkpoint', this.publicKey, data, {expireAfter: 15000, realtime: true})
}

/** Lowest Sequence */

SyncStream.prototype.on_lowest_sequence = function (receivedData) {
  if (this.sequenceCheckpoint < receivedData.lowestSequence) {
    this.setSequenceCheckpoint(receivedData.lowestSequence)
  }
}

/** Obsolete */

SyncStream.prototype.on_obsolete = function (receivedData) {
  _.forEach(receivedData, function (sequence) {
    this.addEvent(sequence)
  }, this)
}

module.exports = SyncStream
