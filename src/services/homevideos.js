'use strict'
var SyncEngine = require('../util/mmds/index.js')
var TorrentingEngine = require('../util/torrenting/engine.js')
var storagejs = require('storagejs')

var HomeVideos = function (options) {
  var homevideos = this
  this.messaging = options.messaging
  this.torrenting = options.torrenting
  this.videos = {}
  this.loadVideos()
  this.syncEngine = new SyncEngine(options.messaging, 'homevideos', 'uuid', this.videos)
  this.syncEngine.on('processEvent', function (action, document) {
    if (action === 'update' || action === 'add') {
      homevideos.videos[document.uuid] = document
    } else if (action === 'remove') {
      delete homevideos.videos[document.uuid]
    }
    homevideos.update()
  })
  this.torrentEngine = new TorrentingEngine(options.torrenting)
}

HomeVideos.prototype.loadVideos = function () {
  var homevideos = this
  var success = function (value) {
    homevideos.videos = value
    homevideos.syncEngine.setCollection(homevideos.videos)
    homevideos.update()
  }
  storagejs.get('homevideos').then(success)
}

HomeVideos.prototype.update = function () {
  this.messaging.send('homevideos.update', 'local', this.videos)
  storagejs.put('homevideos', this.videos)
}

module.exports = HomeVideos
