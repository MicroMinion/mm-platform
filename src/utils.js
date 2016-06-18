'use strict'

var _ = require('lodash')
var assert = require('assert')

var connectionToArray = function (connectionInfo) {
  assert(_.isPlainObject(connectionInfo))
  var result = []
  _.forEach(connectionInfo, function (transportInfo, transportType) {
    if (_.isPlainObject(transportInfo)) {
      result.push({
        transportType: transportType,
        transportInfo: transportInfo
      })
    }
  })
  return result
}

var connectionToDictionary = function (connectionInfo) {
  assert(_.isArray(connectionInfo))
  var result = {}
  _.forEach(connectionInfo, function (transport) {
    result[transport.transportType] = transport.transportInfo
  })
  return result
}

module.exports = {
  connectionToArray: connectionToArray,
  connectionToDictionary: connectionToDictionary
}
