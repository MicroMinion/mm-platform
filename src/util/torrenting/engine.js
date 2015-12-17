'use strict'
var Server = require('./server.js')
var createTorrent = require('create-torrent')
var parseTorrent = require('parse-torrent')
var mkdirp = require('mkdirp')
var fs = require('fs')
var path = require('path')
var Downloader = require('./downloader.js')
var _ = require('lodash')
var Q = require('q')
var debug = require('debug')('flunky-platform:util:torrenting:TorrentingEngine')

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (searchString, position) {
    var subjectString = this.toString()
    if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
      position = subjectString.length
    }
    position -= searchString.length
    var lastIndex = subjectString.indexOf(searchString, position)
    return lastIndex !== -1 && lastIndex === position
  }
}

var TorrentingEngine = function (torrenting, storageRoot) {
  this.torrenting = torrenting
  this.storageRoot = storageRoot + '/torrents'
  mkdirp.sync(this.storageRoot)
  this.downloaders = {}
  this.server = new Server(this.torrenting, this.storageRoot)
  this._subscribeToFiles()
}

/**
 * Retrieve a file
 * @param startIncomplete {boolean}: return stream as soon as we downloaded part of file
 */
TorrentingEngine.prototype.get = function (infoHash, fileName, startIncomplete) {
  debug('get ' + infoHash)
  if (this.has(infoHash) && !_.has(this.downloaders, infoHash)) {
    var defer = Q.defer()
    process.nextTick(function () {
      var filePath = path.join(this._getLocation(infoHash), fileName)
      if (startIncomplete) {
        defer.resolve(fs.createReadStream(filePath))
      } else {
        defer.resolve(filePath)
      }
    })
    return defer.promise
  } else {
    return this._download(infoHash, fileName, startIncomplete)
  }
}

TorrentingEngine.prototype.addSource = function (infoHash, publicKey) {
  if (_.has(this.downloaders, infoHash)) {
    this.downloaders[infoHash].addSource(publicKey)
  }
}

TorrentingEngine.prototype._getLocation = function (infoHash, torrent) {
  var location = path.join(this.storageRoot, infoHash)
  if (torrent) {
    location = location + '.torrent'
  } else {
    mkdirp.sync(location)
  }
  return location
}

TorrentingEngine.prototype._download = function (infoHash, fileName, startIncomplete) {
  var engine = this
  if (!_.has(this.downloaders, infoHash)) {
    this.downloaders[infoHash] = new Downloader(infoHash, this)
    this.downloaders[infoHash].once('idle', function () {
      debug('deleting downloader since we are done')
      engine.downloaders[infoHash].torrentStream.destroy()
      delete engine.downloaders[infoHash]
      engine._subscribeToFile(infoHash)
    })
  }
  var defer = Q.defer()
  if (startIncomplete) {
    this.downloaders[infoHash].once(fileName, function (file) {
      defer.resolve(file.createReadStream())
    })
  } else {
    this.downloaders[infoHash].once('idle', function () {
      defer.resolve(path.join(engine._getLocation(infoHash), fileName))
    })
  }
  return defer.promise
}

TorrentingEngine.prototype.put = function (storageLocation) {
  var options = {
    comment: '',
    createdby: 'FlunkyPlatform v1',
    private: true,
    urlList: [[]],
    announceList: [['dht://flunkyPlatform']]
  }
  return Q.nfcall(createTorrent, storageLocation, options)
    .then(parseTorrent)
    .then(this._writeFiles.bind(this, storageLocation))
}

TorrentingEngine.prototype._writeFiles = function (storageLocation, torrentData) {
  return Q.all([
    this._renameFile(storageLocation, torrentData),
    this._writeTorrent(torrentData),
    this._subscribeToFile(torrentData.infoHash)
  ])
    .then(function () {
      return torrentData.infoHash
    })
}

TorrentingEngine.prototype._writeTorrent = function (torrentData) {
  var torrentBuffer = parseTorrent.toTorrentFile(torrentData)
  return Q.nfcall(fs.writeFile, this._getLocation(torrentData.infoHash, true), torrentBuffer)
}

TorrentingEngine.prototype._renameFile = function (storageLocation, torrentData) {
  return Q.nfcall(fs.rename, storageLocation, path.join(this._getLocation(torrentData.infoHash), torrentData.name))
}

TorrentingEngine.prototype.has = function (infoHash) {
  try {
    return fs.statSync(this._getLocation(infoHash, true)).isFile()
  } catch (e) {
    return false
  }
}

/**
 * Initial subscription of files we have access to so that we get messages
 * for these files
 */
TorrentingEngine.prototype._subscribeToFiles = function () {
  var server = this
  Q.nfcall(fs.readdir, this.storageRoot)
    .then(function (files) {
      _.forEach(files, function (file) {
        if (file.endsWith('.torrent')) {
          var infoHash = file.split('.')[0]
          server._subscribeToFile(infoHash)
        }
      })
    })
}

TorrentingEngine.prototype._subscribeToFile = function (infoHash) {
  debug('_subscribeToFile')
  this.torrenting.on('self.' + infoHash, this._onMessage.bind(this))
  this.torrenting.on('friends.' + infoHash, this._onMessage.bind(this))
}

TorrentingEngine.prototype._onMessage = function (topic, publicKey, message) {
  var scope = topic.split('.')[0]
  var infoHash = topic.split('.')[1]
  if (!_.has(this.downloaders, infoHash)) {
    this.server.onMessage(scope, infoHash, publicKey, message)
  }
}

module.exports = TorrentingEngine
