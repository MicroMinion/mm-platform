'use strict'

var Server = function (torrenting) {
  this.torrenting = torrenting
}

Server.prototype.onMessage = function (scope, infoHash, publicKey, message) {}

module.exports = Server
