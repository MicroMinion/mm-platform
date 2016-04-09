'use strict'

var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var _ = require('lodash')

var validKeyString = function (publicKey) {
  return _.isString(publicKey) &&
  nacl.util.decodeBase64(publicKey).length === nacl.sign.publicKeyLength
}

var validLocalKeyString = function (publicKey) {
  return validKeyString(publicKey) || publicKey === 'local'
}

var validConnectionInfo = function (connectionInfo) {
  return _.isObject(connectionInfo) &&
  _.has(connectionInfo.signId) &&
  _.has(connectionInfo.boxId) &&
  validKeyString(connectionInfo.signId) &&
  validKeyString(connectionInfo.boxId)
}

var validString = function (string) {
  return _.isString(string) && _.size(string) > 0
}

var validOptions = function (options) {
  return _.isNil(options) || _.isObject(options)
}

var validError = function (err) {
  return _.isNil(err) || _.isError(err)
}

var validStream = function (stream) {
  return _.isObject(stream) && _.isFunction(stream.pipe)
}

var validProtocolObject = function (message) {
  return _.isObject(message) &&
  _.has(message.payload) &&
  _.has(message.protocol) &&
  _.has(message.topic) &&
  _.isString(message.protocol) &&
  _.isString(message.topic) &&
  _.isBuffer(message.payload)
}

var validSendMessage = function (message) {
  return validProtocolObject(message) &&
  _.has(message.destination) &&
  validKeyString(message.destination)
}

var validReceivedMessage = function (message) {
  return validProtocolObject(message) &&
  _.has(message.sender) &&
  validKeyString(message.sender) &&
  _.has(message.scope) &&
  validString(message.scope)
}

var validCallback = function (callback) {
  return _.isNil(callback) || _.isFunction(callback)
}

module.exports = {
  validKeyString: validKeyString,
  validLocalKeyString: validLocalKeyString,
  validConnectionInfo: validConnectionInfo,
  validProtocolObject: validProtocolObject,
  validCallback: validCallback,
  validError: validError,
  validString: validString,
  validOptions: validOptions,
  validStream: validStream,
  validSendMessage: validSendMessage,
  validReceivedMessage: validReceivedMessage
}
