'use strict'
var Duplex = require('stream').Duplex
var inherits = require('inherits')
var extend = require('extend.js')
var chai = require('chai')
var debug = require('debug')('curve-protocol')

var nacl = require('tweetnacl')

var crypto = require('crypto')

nacl.setPRNG(function (x, n) {
  var i
  var v = crypto.randomBytes(n)
  for (i = 0; i < n; i++) x[i] = v[i]
  for (i = 0; i < v.length; i++) v[i] = 0
})

var expect = chai.expect

var CurveCPStream = function (opts) {
  debug('initialize')
  if (!opts) opts = {}
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
  extend(this, {
    stream: null,
    is_server: false,
    serverPublicKey: null,
    serverPrivateKey: null,
    serverConnectionPublicKey: null,
    serverConnectionPrivateKey: null,
    clientPublicKey: null,
    clientPrivateKey: null,
    clientConnectionPublicKey: null,
    clientConnectionPrivateKey: null,
    serverCookie: null,
    clientAuthenticated: function (clientPublicKey) { return true }
  }, opts)
  if (!this.is_server) {
    this.sendHello()
    this.nextMessage = this.onWelcome
  } else {
    this.nextMessage = this.onHello
  }
  var curveStream = this
  this.stream.on('data', function (data) {
    expect(Buffer.isBuffer(data)).to.be.true
    expect(data.length).to.be.at.least(30)
    curveStream.nextMessage(new Uint8Array(data))
  })
  this.stream.on('error', function (err) {
    curveStream.connectionFail(err)
  })
  this.connected = false
}

inherits(CurveCPStream, Duplex)

CurveCPStream.prototype._read = function (size) {
  debug('_read')
}

CurveCPStream.prototype._write = function (chunk, encoding, done) {
  debug('_write')
  if (this.nextMessage === this.onMessage) {
    this.sendMessage(chunk)
    done()
  } else {
    done(new Error('Stream not ready for writing'))
  }
}

// utility functions

CurveCPStream.prototype.connectionFail = function (message) {
  debug('connectionFail')
  debug(message)
  // this.emit('error', new Error(message))
  this.emit('end')
  this.emit('close')
}

CurveCPStream.prototype.isEqual = function (a, b) {
  debug('isEqual')
  if (a.length !== b.length) {
    return false
  }
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

CurveCPStream.prototype.decrypt = function (source, prefix, from, to) {
  debug('decrypt')
  try {
    prefix = nacl.util.decodeUTF8(prefix)
    var nonce_length = 24 - prefix.length
    var short_nonce = source.subarray(0, nonce_length)
    var nonce = new Uint8Array(24)
    nonce.set(prefix)
    nonce.set(short_nonce, prefix.length)
    var result = nacl.box.open(source.subarray(nonce_length), nonce, from, to)
  } catch (err) {
    this.connectionFail('Decrypt failed with error ' + err)
  }
  return result
}

CurveCPStream.prototype.encrypt = function (data, prefix, from, to) {
  debug('encrypt')
  prefix = nacl.util.decodeUTF8(prefix)
  var nonce_length = 24 - prefix.length
  var random_nonce = new Uint8Array(nacl.randomBytes(nacl.box.nonceLength))
  var short_nonce = random_nonce.subarray(0, nonce_length)
  var nonce = new Uint8Array(24)
  nonce.set(prefix)
  nonce.set(short_nonce, prefix.length)
  var box = nacl.box(data, nonce, to, from)
  var result = new Uint8Array(nonce_length + box.length)
  result.set(short_nonce)
  result.set(box, nonce_length)
  return result
}

CurveCPStream.prototype.encrypt_symmetric = function (data, prefix, key) {
  debug('encrypt_symmetric')
  prefix = nacl.util.decodeUTF8(prefix)
  var nonce_length = 24 - prefix.length
  var random_nonce = new Uint8Array(nacl.randomBytes(nacl.secretbox.nonceLength))
  var short_nonce = random_nonce.subarray(0, nonce_length)
  var nonce = new Uint8Array(24)
  nonce.set(prefix)
  nonce.set(short_nonce, prefix.length)
  var box = nacl.secretbox(data, nonce, key)
  var result = new Uint8Array(nonce_length + box.length)
  result.set(nonce)
  result.set(box, nonce_length)
  return result
}

CurveCPStream.prototype.create_vouch = function () {
  debug('create_vouch')
  return this.encrypt(this.clientConnectionPublicKey, 'VOUCH---', this.clientPrivateKey, this.serverPublicKey)
}

// Hello command

CurveCPStream.prototype.sendHello = function () {
  debug('sendHello')
  var keypair = nacl.box.keyPair()
  this.clientConnectionPublicKey = keypair.publicKey
  this.clientConnectionPrivateKey = keypair.secretKey
  var result = new Uint8Array(200)
  result.set(nacl.util.decodeUTF8('HELLO   '), 0)
  result.set([1, 0], 8)
  result.set(this.clientConnectionPublicKey, 80)
  var box = this.encrypt(new Uint8Array(64), 'CurveZMQHELLO---', this.clientConnectionPrivateKey, this.serverPublicKey)
  result.set(box, 112)
  this.stream.write(new Buffer(result))
}

CurveCPStream.prototype.onHello = function (hello_message) {
  debug('onHello')
  if (hello_message.length !== 200) {
    this.connectionFail('Hello message has incorrect length')
    return
  }
  if (!this.isEqual(hello_message.subarray(0, 8), nacl.util.decodeUTF8('HELLO   '))) {
    this.connectionFail('Hello command not recognized')
    return
  }
  if (!this.isEqual(hello_message.subarray(8, 10), [1, 0])) {
    this.connectionFail('Hello: version number not recognized')
    return
  }
  if (!this.isEqual(hello_message.subarray(10, 80), new Uint8Array(70))) {
    this.connectionFail('Hello: padding not recognized')
    return
  }
  this.clientConnectionPublicKey = hello_message.subarray(80, 80 + 32)
  var box_data = this.decrypt(hello_message.subarray(80 + 32, 200), 'CurveZMQHELLO---', this.clientConnectionPublicKey, this.serverPrivateKey)
  if (box_data === undefined) {
    this.connectionFail('Hello: not able to decrypt box data')
    return
  }
  if (!this.isEqual(box_data, new Uint8Array(64))) {
    this.connectionFail('Hello: invalid data in signature box')
    return
  }
  this.nextMessage = this.onInitiate
  this.sendWelcome()
}

// Welcome command

CurveCPStream.prototype.sendWelcome = function () {
  debug('sendWelcome')
  var keypair = nacl.box.keyPair()
  this.serverConnectionPublicKey = keypair.publicKey
  this.serverConnectionPrivateKey = keypair.secretKey
  var result = new Uint8Array(168)
  result.set(nacl.util.decodeUTF8('WELCOME '))
  var welcome_box = new Uint8Array(128)
  welcome_box.set(this.serverConnectionPublicKey)
  var cookie_data = new Uint8Array(64)
  cookie_data.set(this.clientConnectionPublicKey)
  cookie_data.set(this.serverConnectionPrivateKey, 32)
  var cookie_key = nacl.randomBytes(nacl.box.publicKeyLength)
  var server_cookie = this.encrypt_symmetric(cookie_data, 'COOKIE--', cookie_key)
  this.serverCookie = server_cookie
  welcome_box.set(server_cookie, 32)
  result.set(this.encrypt(welcome_box, 'WELCOME-', this.serverPrivateKey, this.clientConnectionPublicKey), 8)
  this.stream.write(new Buffer(result))
}

CurveCPStream.prototype.onWelcome = function (welcome_message) {
  debug('onWelcome')
  if (welcome_message.length !== 168) {
    this.connectionFail('Welcome message has incorrect length')
    return
  }
  if (!this.isEqual(welcome_message.subarray(0, 8), nacl.util.decodeUTF8('WELCOME '))) {
    this.connectionFail('Welcome command not recognized')
    return
  }
  var welcome_box_data = this.decrypt(welcome_message.subarray(8, 168), 'WELCOME-', this.serverPublicKey, this.clientConnectionPrivateKey)
  if (welcome_box_data === undefined) {
    this.connectionFail('Not able to decrypt welcome box data')
    return
  }
  this.serverConnectionPublicKey = welcome_box_data.subarray(0, 32)
  this.serverCookie = welcome_box_data.subarray(32)
  if (this.serverCookie.length !== 96) {
    this.connectionFail('Welcome command server cookie invalid')
    return
  }
  this.nextMessage = this.onReady
  this.sendInitiate()
}

// Initiate command

CurveCPStream.prototype.sendInitiate = function () {
  debug('sendInitiate')
  var result = new Uint8Array(224)
  result.set(nacl.util.decodeUTF8('INITIATE'))
  result.set(this.serverCookie, 8)
  var initiate_box_data = new Uint8Array(96)
  initiate_box_data.set(this.clientPublicKey)
  initiate_box_data.set(this.create_vouch(), 32)
  result.set(this.encrypt(initiate_box_data, 'CurveZMQINITIATE', this.clientConnectionPrivateKey, this.serverConnectionPublicKey), 104)
  this.stream.write(new Buffer(result))
}

CurveCPStream.prototype.onInitiate = function (initiate_message) {
  debug('onInitiate')
  if (initiate_message.length !== 224) {
    this.connectionFail('Initiate command has incorrect length')
    return
  }
  if (!this.isEqual(initiate_message.subarray(0, 8), nacl.util.decodeUTF8('INITIATE'))) {
    this.connectionFail('Initiate command not recognized')
    return
  }
  if (!this.isEqual(initiate_message.subarray(8, 104), this.serverCookie)) {
    this.connectionFail('Initiate command server cookie not recognized')
    return
  }
  var initiate_box_data = this.decrypt(initiate_message.subarray(104), 'CurveZMQINITIATE', this.clientConnectionPublicKey, this.serverConnectionPrivateKey)
  if (initiate_box_data === undefined) {
    this.connectionFail('Not able to decrypt initiate box data')
    return
  }
  this.clientPublicKey = initiate_box_data.subarray(0, 32)
  var vouch = this.decrypt(initiate_box_data.subarray(32, 96), 'VOUCH---', this.clientPublicKey, this.serverPrivateKey)
  if (vouch === undefined) {
    this.connectionFail('not able to decrypt vouch data')
    return
  }
  if (!this.isEqual(vouch, this.clientConnectionPublicKey)) {
    this.connectionFail('Initiate command vouch contains different client connection public key than previously received')
    return
  }
  if (this.clientAuthenticated(this.clientPublicKey)) {
    this.nextMessage = this.onMessage
    this.connected = true
    this.sendReady()
  } else {
    this.connectionFail('Initiate command unable to authenticate client')
  }
}

// Ready command

CurveCPStream.prototype.sendReady = function () {
  debug('sendReady')
  var result = new Uint8Array(32)
  result.set(nacl.util.decodeUTF8('READY   '))
  result.set(this.encrypt(new Uint8Array(0), 'CurveZMQREADY---', this.serverConnectionPrivateKey, this.clientConnectionPublicKey), 8)
  this.stream.write(new Buffer(result))
  this.emit('drain')
}

CurveCPStream.prototype.onReady = function (ready_message) {
  debug('onReady')
  if (ready_message.length !== 32) {
    this.connectionFail('Ready command has incorrect length')
    return
  }
  if (!this.isEqual(ready_message.subarray(0, 8), nacl.util.decodeUTF8('READY   '))) {
    this.connectionFail('Ready command not recognized')
    return
  }
  var box_data = this.decrypt(ready_message.subarray(8), 'CurveZMQREADY---', this.serverConnectionPublicKey, this.clientConnectionPrivateKey)
  if (box_data === undefined) {
    this.connectionFail('Not able to decrypt box data')
    return
  }
  if (box_data.length !== 0) {
    this.connectionFail('Ready command contains incorrect box data')
    return
  }
  this.nextMessage = this.onMessage
  this.connected = true
  this.emit('drain')
}

// Message command

CurveCPStream.prototype.sendMessage = function (message) {
  debug('sendMessage')
  var from = null
  var to = null
  if (this.is_server) {
    from = this.serverConnectionPrivateKey
    to = this.clientConnectionPublicKey
  } else {
    from = this.clientConnectionPrivateKey
    to = this.serverConnectionPublicKey
  }
  var message_box = this.encrypt(nacl.util.decodeUTF8(message), 'CurveZMQMESSAGES', from, to)
  var result = new Uint8Array(8 + message_box.length)
  result.set(nacl.util.decodeUTF8('MESSAGE '))
  result.set(message_box, 8)
  this.stream.write(new Buffer(result))
}

CurveCPStream.prototype.onMessage = function (message) {
  debug('onMessage')
  if (message.length < 32) {
    this.connectionFail('Message command has incorrect length')
    return
  }
  if (!this.isEqual(message.subarray(0, 8), nacl.util.decodeUTF8('MESSAGE '))) {
    this.connectionFail('Message command not recognized')
    return
  }
  var from = null
  var to = null
  if (this.is_server) {
    from = this.clientConnectionPublicKey
    to = this.serverConnectionPrivateKey
  } else {
    from = this.serverConnectionPublicKey
    to = this.clientConnectionPrivateKey
  }
  var box_data = this.decrypt(message.subarray(8), 'CurveZMQMESSAGES', from, to)
  if (box_data === undefined || !box_data) {
    this.connectionFail('not able to decrypt box data')
    return
  }
  var buffer = new Buffer(box_data)
  this.emit('data', buffer)
}

module.exports = {
  CurveCPStream: CurveCPStream,
  generateKeypair: function () {
    return nacl.box.keyPair()
  },

  toBase64: function (key) {
    return nacl.util.encodeBase64(key)
  },

  fromBase64: function (key) {
    return nacl.util.decodeBase64(key)
  },

  randomBytes: function (length) {
    return nacl.randomBytes(length)
  }
}
