'use strict'

var TorrentEngine = require('../../src/util/torrenting/engine.js')
var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var fs = require('fs')
var crypto = require('crypto')
var _ = require('lodash')

var Torrenting = function () {
  EventEmitter.call(this, {
    delimiter: '.'
  })
}

inherits(Torrenting, EventEmitter)

Torrenting.prototype.send = function (infoHash, publicKey, message) {
  var engine = this
  // process.nextTick(function () {
  console.log('send ' + infoHash + ' ' + publicKey)
  console.log(message)
  engines[publicKey].emit('self.' + infoHash, engine.sender, message)
// })
}

var engines = {
  engineA: new Torrenting(),
  engineB: new Torrenting()
}

engines.engineA.sender = 'engineA'
engines.engineB.sender = 'engineB'

var engineA = new TorrentEngine(engines.engineA, './engineA')
var engineB = new TorrentEngine(engines.engineB, './engineB')

var data = crypto.randomBytes(1024 * 1024 * 10)

var hash

fs.writeFileSync('./video.mp4', data)

engineA.put('./video.mp4')
  .then(function (infoHash) {
    console.log('put result')
    console.log(infoHash)
    hash = infoHash
  })
  .fail(function (error) {
    console.log('put result error')
    console.log(_.keys(error))
    console.log(error)
  })

setTimeout(function () {
  engineB.get(hash)
  engineB.addSource(hash, 'engineA')
}, 2000)
