'use strict'

var expect = require('chai').expect
var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var _ = require('lodash')

var validKeyString = function (publicKey) {
  expect(publicKey).to.be.a('string')
  return nacl.util.decodeBase64(publicKey).length === nacl.sign.publicKeyLength
}

var validLocalKeyString = function (publicKey) {
  return validKeyString(publicKey) || publicKey === 'local'
}

var validConnectionInfo = function (connectionInfo) {
  expect(connectionInfo).to.be.an('object')
  return _.has(connectionInfo.signId) &&
  _.has(connectionInfo.boxId) &&
  validKeyString(connectionInfo.signId) &&
  validKeyString(connectionInfo.boxId)
}

var validError = function (err) {
  return _.isNil(err) || _.isError(err)
}

var validProtocolObject = function (message) {
  expect(message).to.be.an('object')
  return _.has(message.payload) &&
  _.has(message.protocol) &&
  _.has(message.topic) &&
  _.isString(message.protocol) &&
  _.isString(message.topic) &&
  _.isBuffer(message.payload)
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
  validError: validError
}
