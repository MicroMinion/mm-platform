'use strict'
var Q = require('q')

var Downloader = function (infoHash, startIncomplete, engine) {
  var engine = this
  this.defer = Q.defer()
  this.torrenting = torrenting
}

Downloader.prototype.getPromise = function () {
  return this.defer.promise
}

Downloader.prototype.onMessage = function (scope, publicKey, message) {}

module.exports = Downloader
