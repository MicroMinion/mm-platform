'use strict'
var TorrentStream = require('./torrent-stream.js')
var debug = require('debug')('flunky-platform:util:torrenting:Downloader')
var _ = require('lodash')
var path = require('path')

var Downloader = function (infoHash, engine) {
  debug('initialize')
  var downloader = this
  this.torrenting = engine.torrenting
  this.requests = []
  this.isReady = false
  this.storageLocation = path.join(engine.storageRoot, infoHash)
  this.torrentStream = new TorrentStream(infoHash, engine.storageRoot + '/' + infoHash, this.torrenting)
  this.torrentStream.on('ready', function () {
    downloader.isReady = true
    downloader._returnStreams()
    downloader._selectFiles()
  })
  this.torrentStream.on('idle', function () {
    downloader._returnPaths()
  })
  this.torrentStream.listen()
}

Downloader.prototype.addRequest = function (fileName, startIncomplete, defer) {
  var downloader = this
  if (!this.isReady) {
    this._addRequest(fileName, startIncomplete, defer)
  } else {
    if (startIncomplete) {
      process.nextTick(function () {
        defer.resolve(downloader._returnStream(fileName))
      })
    } else {
      _.forEach(downloader.torrentStream.files, function (file) {
        if (file.name === fileName) {
          file.select()
          var downloaded = downloader.isDownloaded(fileName)
          if (downloaded) {
            process.nextTick(function () {
              defer.resolve(path.join(downloader.storageLocation, fileName))
            })
          } else {
            downloader._addRequest(fileName, startIncomplete, defer)
          }
        }
      })
    }
  }
}

Downloader.prototype.isDownloaded = function (fileName) {
  var torrent = this.torrentStream.torrent
  var file = this._getFile(fileName)
  var offsetPiece = (file.offset / torrent.pieceLength) | 0
  var endPiece = ((file.offset + file.length - 1) / torrent.pieceLength) | 0
  var result = true
  for (; offsetPiece <= endPiece; offsetPiece++) {
    result = result && this.torrentStream.bitfield.get(offsetPiece)
  }
  return result
}

Downloader.prototype._getFile = function (fileName) {
  _.forEach(this.torrentStream.files, function (file) {
    if (file.name === fileName) {
      return file
    }
  })
}

Downloader.prototype._addRequest = function (fileName, startIncomplete, defer) {
  this.requests.push([fileName, startIncomplete, defer])
}

Downloader.prototype._selectFiles = function () {
  var files = []
  _.forEach(this.requests, function (request) {
    if (!request[1]) {
      files.push(request[0])
    }
  })
  files = _.uniq(files)
  _.forEach(files, function (fileName) {
    this._selectFile(fileName)
  }, this)
}

Downloader.prototype._selectFile = function (fileName) {
  var downloader = this
  _.forEach(downloader.torrentStream.files, function (file) {
    if (file.name === fileName) {
      file.select()
    }
  })
}

Downloader.prototype._returnStreams = function () {
  this.requests = _.filter(this.requests, function (request) {
    if (request[1]) {
      request[2].resolve(this._returnStream(request[0]))
      return false
    }
  }, this)
}

Downloader.prototype._returnPaths = function () {
  var downloader = this
  this.requests = _.filter(this.requests, function (request) {
    if (!request[1]) {
      request[2].resolve(path.join(downloader.storageLocation, request[0]))
      return false
    }
  }, this)
}

Downloader.prototype._returnStream = function (fileName) {
  var downloader = this
  _.forEach(downloader.torrentStream.files, function (file) {
    if (file.name === fileName) {
      return file.createReadStream()
    }
  })
}

module.exports = Downloader
