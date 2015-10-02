'use strict'
var Server = require('./server.js')
var createTorrent = require('create-torrent')
var parseTorrent = require('parse-torrent')
var mkdirp = require('mkdirp')
var fs = require('fs')
var Downloader = require('./downloader.js')
var _ = require('lodash')
var Q = require('q')

var TorrentingEngine = function (torrenting, storageRoot) {
  this.torrenting = torrenting
  this.storageRoot = storageRoot + '/torrents'
  this.downloaders = {}
  this.server = new Server(this.torrenting)
  this._subscribeToFiles()
  mkdirp.sync(this.storageRoot)
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

TorrentingEngine.prototype.put = function (storageLocation) {
  var options = {
    name: '',
    comment: '',
    createdBy: 'FlunkyPlatform v1',
    private: true,
    urlList: [[]]
  }
  return Q.nfcall(createTorrent, storageLocation, options)
    .then(parseTorrent)
    .then(this._writeFiles.bind(this, storageLocation))
}

TorrentingEngine.prototype._writeFiles = function (storageLocation, torrentData) {
  return Q.all([
    this._renameFile(storageLocation, torrentData),
    this._writeTorrent(torrentData)
  ])
    .then(function () {
      return torrentData.infoHash
    })
}

TorrentingEngine.prototype._writeTorrent = function (torrentData) {
  var torrentLocation = this.storageRoot + '/' + torrentData.infoHash + '.torrent'
  torrentData = parseTorrent.toTorrentFile(torrentData)
  return Q.nfcall(fs.writeFile, torrentLocation, torrentData)
}

TorrentingEngine.prototype._renameFile = function (storageLocation, torrentData) {
  var dataLocation = this.storageRoot + '/' + torrentData.infoHash
  console.log(dataLocation)
  return Q.nfcall(fs.rename, storageLocation, dataLocation)
}

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
