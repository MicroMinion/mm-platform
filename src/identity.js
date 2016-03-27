'use strict'

var Q = require('q')
var debug = require('debug')('flunky-platform:identity')
var nacl = require('tweetnacl')
nacl.util = require('tweetnacl-util')
var ed2curve = require('ed2curve')
var crypto = require('crypto')
var events = require('events')
var inherits = require('inherits')

nacl.setPRNG(function (x, n) {
  var i
  var v = crypto.randomBytes(n)
  for (i = 0; i < n; i++) x[i] = v[i]
  for (i = 0; i < v.length; i++) v[i] = 0
})

var Identity = function (options) {
  this.platform = options.platform
  this.storage = options.storage
  this._loadIdentity()
  events.EventEmitter.call(this)
}

inherits(Identity, events.EventEmitter)

Identity.prototype._loadIdentity = function () {
  var self = this
  var options = {
    success: function (value) {
      if (value) {
        var secretKey = nacl.util.decodeBase64(value)
        self.sign = nacl.sign.keyPair.fromSecretKey(secretKey)
      } else {
        self._generateIdentity()
      }
      self.emit('ready')
    },
    error: function (error) {
      debug(error)
      self._generateIdentity()
      self.emit('ready')
    }
  }
  Q.nfcall(this.storage.get.bind(this.storage), 'identity').then(options.success, options.error)
}

Identity.prototype._generateIdentity = function () {
  debug('_generateIdentity')
  if (!this.sign || !this.sign.secretKey) {
    this.sign = nacl.sign.keyPair()
    this._saveIdentity()
  }
}

Identity.prototype._saveIdentity = function () {
  debug('_saveIdentity')
  this.storage.put('identity', nacl.util.encodeBase64(this.sign.secretKey), function (err) {
    if (err) {
      debug('unable to save identity')
      debug(err)
    } else {
      debug('saved identity')
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
  return nacl.util.encodeBase64(ed2curve.convertPublicKey(this.sign.publicKey))
}

Object.defineProperty(Identity.prototype, 'box', {
  get: function () {
    return ed2curve.convertKeyPair(this.sign)
  }
})

module.exports = Identity
