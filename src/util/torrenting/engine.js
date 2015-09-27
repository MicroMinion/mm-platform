'use strict'
var Server = require('./server.js')
var Downloader = require('./downloader.js')
var _ = require('lodash')

var TorrentingEngine = function (torrenting) {
  this.torrenting = torrenting
  this.downloaders = {}
  this.server = new Server(this.torrenting)
  this._subscribeToFiles()
}

/**
 * Retrieve a file
 * @param stream {boolean}: return stream as soon as we downloaded part of file
 */
TorrentingEngine.prototype.get = function (infoHash, stream) {
  if (this.has(infoHash)) {
    // TODO
  } else {
    this._addDownloader(infoHash)
  }
}

TorrentingEngine.prototype._addDownloader = function (infoHash) {
  if (!_.has(this.downloaders, infoHash)) {
    this.downloaders[infoHash] = new Downloader(infoHash, this.torrenting)
  }
}

TorrentingEngine.prototype.put = function (storageLocation) {}

TorrentingEngine.prototype.has = function (infoHash) {}

TorrentingEngine.prototype.hoard = function (infoHash) {}

/**
 * Initial subscription of files we have access to so that we get messages
 * for these files
 */
TorrentingEngine.prototype._subscribeToFiles = function () {
  // TODO: Implement to get list of infoHashes of files that we have on disk
  var infoHashes = []
  _.forEach(infoHashes, function (infoHash) {
    var permissions = this._getPermissions(infoHash)
    if (_.has(permissions, 'self')) {
      this.torrenting.on('self.' + infoHash, this._onMessage.bind(this))
    }
    if (_.has(permissions, 'friends')) {
      this.torrenting.on('friends.' + infoHash, this._onMessage.bind(this))
    }
    if (_.has(permissions, 'public')) {
      this.torrenting.on('public.' + infoHash, this._onMessage.bind(this))
    }
  }, this)
}

TorrentingEngine.prototype._onMessage = function (topic, publicKey, message) {
  var scope = topic.split('.')[0]
  var infoHash = topic.split('.')[1]
  if (_.has(this.downloaders, infoHash)) {
    this.downloaders[infoHash].onMessage(scope, publicKey, message)
  } else {
    this.server.onMessage(scope, infoHash, publicKey, message)
  }
}

TorrentingEngine.prototype._getPermissions = function (infoHash) {}

module.exports = TorrentingEngine
