var _ = require('lodash')
var chai = require('chai')
var events = require('events')
var inherits = require('inherits')

var expect = chai.expect

var RESEND_INTERVAL = 60 * 1000

var _generateCode = function () {
  var text = ''
  var possible = '0123456789'
  for (var i = 0; i < 6; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

var AuthenticationManager = function (options) {
  events.EventEmitter.call(this)
  this.name = options.name
  this.scope = options.scope
  this.ongoingVerifications = {}
  this.messaging.on('public.' + this.name + '.initiate', this.onInitiate.bind(this))
  this.messaging.on('public.' + this.name + '.code', this.onCode.bind(this))
  this.messaging.on(this.scope + '.' + this.name + '.confirmation', this.onConfirmation.bind(this))
}

inherits(AuthenticationManager, events.EventEmitter)

AuthenticationManager.prototype.connectProtocol = function (publicKey, state) {
  var manager = this
  expect(publicKey).to.be.a('string')
  var protocol = new PublicKeyVerificationProtocol(publicKey, state, this.name, this.messaging)
  protocol.on('newCodeNeeded', function () {
    manager.messaging.send('profile.newCodeNeeded', 'local', {})
  })
  protocol.on('update', function () {
    manager.emit('updateVerificationState', publicKey)
  })
  protocol.on('ourCodeUpdate', function () {
    manager.emit('ourCodeUpdate', publicKey)
  })
  if (this.profile) {
    protocol.profile = this.profile
  }
  this.ongoingVerifications[publicKey] = protocol
}

AuthenticationManager.prototype.onInitiate = function (topic, publicKey, data) {
  this.emit('newInstance', publicKey, data)
}

AuthenticationManager.prototype.onCode = function (topic, publicKey, data) {
  if (_.has(this.ongoingVerifications, publicKey)) {
    this.ongoingVerifications[publicKey].onCode(data)
  }
}

AuthenticationManager.prototype.onConfirmation = function (topic, publicKey, data) {
  if (_.has(this.ongoingVerifications, publicKey)) {
    this.ongoingVerifications[publicKey].onConfirmation(data)
  }
}

var PublicKeyVerificationProtocol = function (publicKey, state, name, messaging) {
  events.EventEmitter.call(this)
  this.name = name
  this.messaging = messaging
  this.publicKey = publicKey
  this.state = state
  this.ongoing
  if (!this.state.verification) {
    this.state.verification = {}
  }
  this.profile = undefined
  if (!this.state.ourCode) {
    this.generateOurCode()
  }
}

inherits(PublicKeyVerificationProtocol, events.EventEmitter)

PublicKeyVerificationProtocol.prototype.generateOurCode = function () {
  this.setOurCode(_generateCode())
  this.emit('ourCodeUpdate')
}

PublicKeyVerificationProtocol.prototype.setOurCode = function (code) {
  this.state.ourCode = code
  this.emit('update')
}

PublicKeyVerificationProtocol.prototype.set = function (attribute) {
  if (!this.state.verification[attribute]) {
    this.state.verification[attribute] = true
    this.emit('update')
  }
}

/* INITIATE LOGIC */

PublicKeyVerificationProtocol.prototype.start = function () {
  if (!this.profile) { return }
  if (!this.ongoing) {
    this.ongoing = setInterval(this.start.bind(this), RESEND_INTERVAL)
  }
  if (!this.state.verification.initiateReceived) {
    this.sendInitiate()
  } else if (!this.state.verification.codeReceived && this.state.verification.otherCode) {
    this.sendCode()
  } else if (this.state.verification.codeReceived && this.state.verification.codeSend && !this.state.verification.confirmationReceived) {
    this.sendConfirmation()
  }
}

PublicKeyVerificationProtocol.prototype.setProfile = function (profile) {
  var start = !Boolean(this.profile)
  this.profile = profile
  if (start) {
    this.start()
  }
}

PublicKeyVerificationProtocol.prototype.sendInitiate = function (reply) {
  var options = {
    realtime: true,
    expireAfter: 1000 * 60
  }
  if (!reply) {
    reply = false
  }
  var data = {
    info: this.profile.info,
    reply: reply
  }
  this.messaging.send(this.name + '.initiate', this.publicKey, data, options)
  this.set('initiateSend')
}

PublicKeyVerificationProtocol.prototype.onInitiate = function (data) {
  this.set('initiateReceived')
  if (!data.reply) {
    this.sendInitiate(true)
  }
  if (this.state.verification.initiateSend && this.state.verification.initiateReceived && this.state.code) {
    this.sendCode()
  }
}

/* CODE LOGIC */

PublicKeyVerificationProtocol.prototype.setCode = function () {
  if (this.state.verification.initiateSend && this.state.verification.initiateReceived) {
    this.sendCode()
  }
}

PublicKeyVerificationProtocol.prototype.sendCode = function () {
  expect(this.state.verification.initiateSend).to.be.true
  expect(this.state.verification.initiateReceived).to.be.true
  expect(this.state.code).to.exist
  expect(this.state.codeType).to.exist
  var options = {
    realtime: true,
    expireAfter: 1000 * 60
  }
  var noCodeRequired = false
  if (this.state.codeType === 'qr') {
    noCodeRequired = true
  }
  var data = {
    codeType: this.state.codeType,
    code: this.state.code,
    noCodeRequired: noCodeRequired
  }
  this.messaging.send(this.name + '.code', this.publicKey, data, options)
  this.set('codeSend')
}

PublicKeyVerificationProtocol.prototype.onCode = function (data) {
  if (this.state.verification.initiateSend && this.state.verification.initiateReceived && !this.state.verification.codeReceived) {
    var codeValid = false
    if (data.codeType === 'qr') {
      codeValid = (data.code === this.profile.code)
      if (codeValid) {
        this.emit('newCodeNeeded')
      }
    } else if (data.codeType === 'sixdots') {
      codeValid = (data.code === this.state.ourCode)
      if (!codeValid) {
        this.generateOurCode()
      }
    } else if (data.codeType === 'none') {
      if (this.state.codeType === 'qr') {
        codeValid = true
      }
    }
    if (codeValid) {
      this.set('codeReceived')
      if (this.state.verification.codeSend) {
        this.sendConfirmation(true)
      } else if (this.state.code) {
        this.sendCode()
      } else if (data.noCodeRequired) {
        this.state.code = ''
        this.state.codeType = 'none'
      }
    }
  }
}

/* CONFIRMATION LOGIC */

PublicKeyVerificationProtocol.prototype.sendConfirmation = function (reply) {
  var options = {
    realtime: true,
    expireAfter: 1000 * 60
  }
  if (!reply) {
    reply = false
  }
  var data = {
    reply: reply
  }
  this.messaging.send(this.name + '.confirmation', this.publicKey, data, options)
  this.set('confirmationSend')
}

PublicKeyVerificationProtocol.prototype.onConfirmation = function (data) {
  expect(this.state.verification.initiateSend).to.be.true
  expect(this.state.verification.initiateReceived).to.be.true
  expect(this.state.verification.codeReceived).to.be.true
  expect(this.state.verification.codeSend).to.be.true
  if (data.reply) {
    this.sendConfirmation(false)
  }
  clearInterval(this.ongoing)
  this.set('confirmationReceived')
}

module.exports = AuthenticationManager
