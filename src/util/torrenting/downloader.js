'use strict'
var TorrentStream = require('./torrent-stream.js')
var debug = require('debug')('flunky-platform:util:torrenting:Downloader')
var path = require('path')
var events = require('events')
var inherits = require('inherits')

var Downloader = function (infoHash, engine) {
  debug('initialize')
  events.EventEmitter.call(this)
  var downloader = this
  this.torrenting = engine.torrenting
  this.requests = []
  this.isReady = false
  this.storageLocation = path.join(engine.storageRoot, infoHash)
  this.torrentStream = new TorrentStream(infoHash, engine.storageRoot + '/' + infoHash, this.torrenting)
  this.torrentStream.on('ready', function () {
    downloader.torrentStream.files.forEach(function (file) {
      downloader.emit(file.name, file)
      file.select()
    })
    downloader.isReady = true
  })
  this.torrentStream.on('idle', function () {
    downloader.emit('idle')
  })
  this.torrentStream.on('verify', function (index) {})
  this.torrentStream.on('download', function (index, buffer) {})
  this.torrentStream.listen()
}

inherits(Downloader, events.EventEmitter)

Downloader.prototype.addSource = function (publicKey) {
  this.torrentStream.connect(publicKey)
}

module.exports = Downloader
