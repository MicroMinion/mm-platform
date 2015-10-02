'use strict'

var TorrentEngine = require('../../src/util/torrenting/engine.js')
var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')

var Torrenting = function () {
  EventEmitter.call(this, {
    delimiter: '.'
  })
}

inherits(Torrenting, EventEmitter)

Torrenting.prototype.send = function (infoHash, publicKey, message) {
  engines[publicKey].emit('self.' + infoHash, publicKey, message)
}

var engines = {
  engineA: new Torrenting(),
  engineB: new Torrenting()
}

var engineA = new TorrentEngine(engines.engineA, './engineA')
var engineB = new TorrentEngine(engines.engineB, './engineB')

engineA.put('./video.mp4')
  .then(function (infoHash) {
    console.log(infoHash)
  })
  .fail(function (error) {
    console.log(error)
  })
