'use strict'
var _ = require('lodash')

global.directoryDatabase = {}

var Directory = function () {}

Directory.prototype.setPlatform = function (platform) {
  this.platform = platform
  if (this.platform.identity.loaded()) {
    if (this._connectionInfo) {
      this.setMyConnectionInfo(this._connectionInfo)
    }
  }
}

Directory.prototype.setMyConnectionInfo = function (connectionInfo) {
  this._connectionInfo = connectionInfo
  if (this.platform.identity.loaded()) {
    global.directoryDatabase[this.platform.identity.getBoxId()] = {
      boxId: this.platform.identity.getBoxId(),
      signId: this.platform.identity.getSignId(),
      connectionInfo: connectionInfo
    }
  }
}

Directory.prototype.getNodeInfo = function (boxId, callback) {
  if (_.has(global.directoryDatabase, boxId)) {
    callback(null, global.directoryDatabase[boxId])
  } else {
    callback(new Error('destination nodeInfo not found'), null)
  }
}

module.exports = Directory
