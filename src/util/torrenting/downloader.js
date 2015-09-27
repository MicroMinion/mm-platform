'use strict'

var Downloader = function (infoHash, torrenting) {
  this.torrenting = torrenting
  this.infoHash = infoHash
}

Downloader.prototype.onMessage = function (scope, publicKey, message) {}

module.exports = Downloader
