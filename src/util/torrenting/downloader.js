'use strict'
var Q = require('q')
var TorrentStream = require('./torrent-stream.js')
var debug = require('debug')('flunky-platform:util:torrenting:Downloader')

var Downloader = function (infoHash, startIncomplete, engine) {
  debug('initialize')
  this.defer = Q.defer()
  var downloader = this
  this.torrenting = engine.torrenting
  this.torrentStream = new TorrentStream(infoHash, engine.storageRoot + '/' + infoHash, this.torrenting)
  this.torrentStream.on('ready', function () {
    downloader.torrentStream.files.forEach(function (file) {
      file.select()
    })
  })
  this.torrentStream.on('idle', function () {
    downloader.defer.resolve()
  })
  this.torrentStream.listen()
}

Downloader.prototype.getPromise = function () {
  debug('getPromise')
  return this.defer.promise
}

module.exports = Downloader
