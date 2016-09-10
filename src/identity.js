'use strict'

var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var ed2curve = require('ed2curve')
var crypto = require('crypto')
var events = require('events')
var inherits = require('inherits')
var assert = require('assert')
var validation = require('./validation.js')
var _ = require('lodash')

nacl.setPRNG(function (x, n) {
  var i
  var v = crypto.randomBytes(n)
  for (i = 0; i < n; i++) x[i] = v[i]
  for (i = 0; i < v.length; i++) v[i] = 0
})

var Identity = function (options) {
  assert(validation.validOptions(options))
  assert(_.has(options, 'platform'))
  assert(_.has(options, 'storage'))
  assert(_.has(options, 'logger'))
  this._log = options.logger
  this.platform = options.platform
  this.storage = options.storage
  this._loadIdentity()
  events.EventEmitter.call(this)
}

inherits(Identity, events.EventEmitter)

Identity.prototype._loadIdentity = function () {
  var self = this
  var success = function (value) {
    if (value) {
      assert(validation.validSecretKeyString(value))
      var secretKey = nacl.util.decodeBase64(value)
      self.sign = nacl.sign.keyPair.fromSecretKey(secretKey)
    } else {
      self._generateIdentity()
    }
  }
  var error = function (error) {
    assert(_.isError(error))
    self._log.debug(error.message)
    self._generateIdentity()
  }
  this.storage.get('identity', function (err, result) {
    if (err) {
      error(err)
    } else {
      success(result)
    }
    self.box = ed2curve.convertKeyPair(self.sign)
    self.emit('ready')
  })
}

Identity.prototype._generateIdentity = function () {
  if (!this.sign || !this.sign.secretKey) {
    this.sign = nacl.sign.keyPair()
    this._saveIdentity()
  }
}

Identity.prototype._saveIdentity = function () {
  var self = this
  this.storage.put('identity', nacl.util.encodeBase64(this.sign.secretKey), function (err) {
    if (err) {
      self._log.warn('unable to save identity', {
        error: err
      })
    } else {
      self._log.debug('saved identity')
    }
  })
}

Identity.prototype.loaded = function () {
  return Boolean(this.sign)
}

Identity.prototype.getSignId = function () {
  return nacl.util.encodeBase64(this.sign.publicKey)
}

Identity.prototype.getBoxId = function () {
  return nacl.util.encodeBase64(this.box.publicKey)
}

Identity.prototype.toMetadata = function () {
  return {
    signId: this.getSignId(),
    boxId: this.getBoxId()
  }
}

module.exports = Identity
