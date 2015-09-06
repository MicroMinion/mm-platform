var inherits = require('inherits')
var _ = require('lodash')
var storagejs = require('storagejs')
var chai = require('chai')
var AuthenticationManager = require('../util/authentication.js')
var verificationState = require('../constants/verificationState.js')
var SyncEngine = require('../util/mmds/index.js')

var expect = chai.expect

var Devices = function (messaging) {
  var devices = this
  this.messaging = messaging
  this.devices = {}
  AuthenticationManager.call(this, {scope: 'self', name: 'devices'})
  this._loadDevices()
  messaging.on('self.profile.update', this.setProfile.bind(this))
  messaging.send('profile.updateRequest', 'local', {})
  messaging.on('self.devices.add', this.add.bind(this))
  messaging.on('self.devices.startVerification', this.startVerification.bind(this))
  messaging.on('self.devices.code', this.setCode.bind(this))
  this.on('newInstance', function (publicKey, data) {
    devices.add('self.devices.add', 'local', {publicKey: publicKey, info: data.info})
    devices._createProtocol(publicKey)
    devices.ongoingVerifications[publicKey].onInitiate(data)
  })
  this.on('updateVerificationState', function (publicKey) {
    devices._updateVerificationState(devices.devices[publicKey])
  })
  this.messaging.on('self.devices.updateRequest', function (topic, publicKey, data) {
    devices.update(false)
  })
  this.syncEngine = new SyncEngine(messaging, 'devices', 'publicKey', this.devices)
  this.syncEngine.on('processEvent', function (action, document) {
    if (action === 'remove') {
      delete devices.devices[document.publicKey]
    } else {
      devices.devices[document.publicKey] = document
    }
    devices.update(true)
  })
}

inherits(Devices, AuthenticationManager)

/* PERSISTENCE */

Devices.prototype._loadDevices = function () {
  var devices = this
  var options = {
    success: function (value) {
      devices.devices = value
      devices.syncEngine.setCollection(value)
      _.forEach(devices.devices, function (device, publicKey) {
        if (device.verificationState < verificationState.CONFIRMED) {
          this._createProtocol(publicKey)
          this.startVerification('self.devices.startVerification', 'local', {publicKey: publicKey})
        }
      }, devices)
      devices.update(false)
    }
  }
  storagejs.get('devices', options)
}

Devices.prototype.update = function (store) {
  this.messaging.send('devices.update', 'local', this.devices)
  if (store) {
    storagejs.put('devices', this.devices)
  }
}

/* MESSAGE HANDLERS */

Devices.prototype.setProfile = function (topic, publicKey, data) {
  this.profile = data
  _.forEach(this.ongoingVerifications, function (protocol, publicKey) {
    protocol.setProfile(data)
  })
}

Devices.prototype.add = function (topic, publicKey, data) {
  var add = false
  if (!_.has(this.devices, data.publicKey)) {
    this.devices[data.publicKey] = {}
    add = true
  }
  this.devices[data.publicKey].info = data.info
  this.devices[data.publicKey].publicKey = data.publicKey
  if (!_.has(this.devices[data.publicKey], 'verificationState')) {
    this.devices[data.publicKey].verificationState = verificationState.PENDING_VERIFICATION
  }
  if (add) {
    this.syncEngine.add(data.publicKey)
  } else {
    this.syncEngine.update(data.publicKey)
  }
  this.update(true)
}

Devices.prototype.setCode = function (topic, publicKey, data) {
  expect(this.ongoingVerifications).to.have.property(data.publicKey)
  var device = this.devices[data.publicKey]
  device.code = data.code
  device.codeType = data.codeType
  // CHECK: TODO
  this.ongoingVerifications[data.publicKey].setCode()
  this.syncEngine.update(data.publicKey)
}

Devices.prototype.startVerification = function (topic, publicKey, data) {
  this._createProtocol(data.publicKey)
  this.ongoingVerifications[data.publicKey].start()
}

/* AUTHENTICATION HELPER METHODS */

Devices.prototype._createProtocol = function (publicKey) {
  if (!_.has(this.ongoingVerifications, publicKey)) {
    this.connectProtocol(publicKey, this.devices[publicKey])
  }
}

Devices.prototype._updateVerificationState = function (device) {
  var update = false
  var state = device.verificationState
  if (state < verificationState.VERIFIED && device.verification && device.verification.codeReceived) {
    device.verificationState = verificationState.VERIFIED
    update = true
  }
  if (state < verificationState.CONFIRMED && device.verification && device.verification.confirmationSend && device.verification.confirmationReceived) {
    device.verificationState = verificationState.CONFIRMED
    update = true
  }
  if (update) {
    this.syncEngine.update(device.publicKey)
    this.update(true)
  }
}

module.exports = Devices
