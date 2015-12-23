var inherits = require('inherits')
var _ = require('lodash')
var Q = require('q')
var AuthenticationManager = require('../util/authentication.js')
var verificationState = require('../constants/verificationState.js')
var node_uuid = require('node-uuid')
var SyncEngine = require('../util/mmds/index.js')

var CONTACT_LOOKUP_INTERVAL = 1000 * 60

var Contacts = function (options) {
  var contacts = this
  this.messaging = options.messaging
  this.storage = options.storage
  this.contacts = {}
  AuthenticationManager.call(this, {scope: 'friends', name: 'contacts'})
  this.loadContacts()
  this.messaging.on('self.profile.update', this.setProfile.bind(this))
  this.messaging.send('profile.updateRequest', 'local', {})
  this.messaging.on('self.contacts.updateInfo', this.updateInfo.bind(this))
  this.messaging.on('self.contacts.addKey', this.addKey.bind(this))
  this.messaging.on('self.contacts.startVerification', this.startVerification.bind(this))
  this.messaging.on('self.contacts.enterCode', this.enterCode.bind(this))
  this.messaging.on('self.directory.getReply', function (topic, publicKey, data) {
    var contact = _.find(contacts.contacts, function (contact) {
      return _.any(contact.info.accounts, function (account) {
        var key = account.type + ':' + account.id
        return key === data.key
      })
    })
    if (contact) {
      contacts.addKey('self.contacts.addKey', 'local', {uuid: contact.uuid, publicKey: data.value})
    }
  })
  this.on('newInstance', function (publicKey, data) {
    var contact = contacts.getContact(publicKey)
    var uuid
    if (!contact) {
      uuid = node_uuid.v4()
    } else {
      uuid = contact.uuid
    }
    contacts.updateInfo('self.contacts.updateInfo', 'local', {uuid: uuid, info: data.info})
    contacts.addKey('self.contacts.addKey', 'local', {uuid: uuid, publicKey: publicKey})
    contacts.updateVerificationState(publicKey)
    if (contacts.contacts[uuid].verificationState < verificationState.CONFIRMED) {
      contacts.createProtocol(publicKey, contacts.contacts[uuid])
      contacts.ongoingVerifications[publicKey].onInitiate(data)
    }
  })
  this.on('updateVerificationState', function (publicKey) {
    contacts.updateVerificationState(publicKey)
  })
  this.on('ourCodeUpdate', function (publicKey) {
    contacts.ourCodeUpdate(publicKey)
  })
  setInterval(function () {
    _.forEach(contacts.contacts, function (contact, uuid) {
      _.forEach(contact.info.accounts, function (account) {
        this.searchKey(uuid, account)
      }, contacts)
    })
  }, CONTACT_LOOKUP_INTERVAL)
  this.syncEngine = new SyncEngine(this.messaging, 'contacts', 'uuid', this.contacts, this.storage)
  this.syncEngine.on('processEvent', function (action, document) {
    if (action === 'update') {
      contacts.contacts[document.uuid] = document
    } else if (action === 'add') {
      contacts.contacts[document.uuid] = document
    } else if (action === 'remove') {
      delete contacts.contacts[document.uuid]
    }
    contacts.update()
  })
}

inherits(Contacts, AuthenticationManager)

/* PERSISTENCE */

Contacts.prototype.loadContacts = function () {
  var contacts = this
  var options = {
    success: function (value) {
      value = JSON.parse(value)
      contacts.contacts = value
      contacts.syncEngine.setCollection(value)
      _.forEach(contacts.contacts, function (contact, uuid) {
        if (contact.verificationState < verificationState.CONFIRMED && contact.verificationState >= verificationState.PENDING) {
          _.forEach(contact.keys, function (keyData, publicKey) {
            this.createProtocol(publicKey, contact)
            this.ongoingVerifications[publicKey].start()
          }, contacts)
        }
      }, contacts)
      contacts.update()
    }
  }
  Q.nfcall(this.storage.get.bind(this.storage), 'contacts').then(options.success)
}

Contacts.prototype.update = function () {
  this.messaging.send('contacts.update', 'local', this.contacts)
  this.storage.put('contacts', JSON.stringify(this.contacts))
}

/* MESSAGE HANDLERS */

Contacts.prototype.setProfile = function (topic, publicKey, data) {
  this.profile = data
  _.forEach(this.ongoingVerifications, function (protocol, publicKey) {
    protocol.setProfile(data)
  })
}

Contacts.prototype.updateInfo = function (topic, publicKey, data) {
  if (!_.has(this.contacts, data.uuid)) {
    this.contacts[data.uuid] = {}
    this.contacts[data.uuid].uuid = data.uuid
    this.contacts[data.uuid].info = data.info
    this.syncEngine.add(data.uuid)
  } else {
    this.contacts[data.uuid].info = data.info
    this.syncEngine.update(data.uuid)
  }
  this.update()
  this.searchKeys(data.uuid)
}

Contacts.prototype.addKey = function (topic, local, data) {
  var contact = this.contacts[data.uuid]
  if (!contact.keys) {
    contact.keys = {}
  }
  if (!contact.keys[data.publicKey]) {
    contact.keys[data.publicKey] = {}
    contact.keys[data.publicKey].verificationState = verificationState.NOT_VERIFIED
    contact.keys[data.publicKey].publicKey = data.publicKey
    this.updateVerificationState(data.publicKey)
    this.update()
    this.syncEngine.update(data.uuid)
  }
}

Contacts.prototype.startVerification = function (topic, publicKey, data) {
  var contact = this.contacts[data.uuid]
  if (contact.verificationState < verificationState.PENDING) {
    contact.verificationState = verificationState.PENDING
  }
  _.forEach(contact.keys, function (value, key) {
    if (contact.keys[key].verificationState < verificationState.PENDING) {
      contact.keys[key].verificationState = verificationState.PENDING
    }
    this.createProtocol(key, contact)
    this.ongoingVerifications[key].start()
  }, this)
  this.syncEngine.update(data.uuid)
  this.update()
}

Contacts.prototype.enterCode = function (topic, local, data) {
  var contact = this.contacts[data.uuid]
  contact.code = data.code
  contact.codeType = data.codeType
  _.forEach(contact.keys, function (value, publicKey) {
    contact.keys[publicKey].code = data.code
    contact.keys[publicKey].codeType = data.codeType
    if (_.has(this.ongoingVerifications, publicKey)) {
      this.ongoingVerifications[publicKey].setCode()
    }
  }, this)
  this.syncEngine.update(data.uuid)
  this.update()
}

/* KEY LOOKUP */

Contacts.prototype.searchKeys = function (uuid) {
  _.forEach(this.contacts[uuid].info.accounts, function (account) {
    this.searchKey(uuid, account)
  }, this)
}

Contacts.prototype.searchKey = function (uuid, account) {
  var key = account.type + ':' + account.id
  this.messaging.send('directory.get', 'local', {key: key})
}

/* AUTHENTICATION HELPER METHODS */

Contacts.prototype.getContact = function (publicKey) {
  return _.find(this.contacts, function (contact) {
    return _.has(contact.keys, publicKey)
  })
}

Contacts.prototype.createProtocol = function (publicKey, contact) {
  if (!_.has(this.ongoingVerifications, publicKey)) {
    if (contact.ourCode) {
      contact.keys[publicKey].ourCode = contact.ourCode
    }
    this.connectProtocol(publicKey, contact.keys[publicKey])
    this.ourCodeUpdate(publicKey)
  }
}

Contacts.prototype.updateVerificationState = function (publicKey) {
  var contact = this.getContact(publicKey)
  if (_.isUndefined(contact.verificationState)) {
    contact.verificationState = verificationState.UNKNOWN
  }
  this.updateVerificationStateKey(contact, publicKey)
  this.updateVerificationStateContact(contact, publicKey)
  this.update()
}

Contacts.prototype.ourCodeUpdate = function (publicKey) {
  var contact = this.getContact(publicKey)
  contact.ourCode = this.ongoingVerifications[publicKey].state.ourCode
  _.forEach(contact.keys, function (value, publicKey) {
    value.ourCode = contact.ourCode
  })
  this.syncEngine.update(contact.uuid)
  this.update()
}

Contacts.prototype.updateVerificationStateKey = function (contact, publicKey) {
  var modified = false
  var state = contact.keys[publicKey]
  if (state.verificationState < verificationState.PENDING && state.verification && (state.verification.initiateSend || state.verificationState.initiateReceived)) {
    modified = true
    state.verificationState = verificationState.PENDING
  }
  if (state.verificationState < verificationState.VERIFIED && state.verification && state.verification.codeReceived) {
    modified = true
    state.verificationState = verificationState.VERIFIED
  }
  if (state.verificationState < verificationState.CONFIRMED && state.verification && state.verification.confirmationSend && state.verification.confirmationReceived) {
    modified = true
    state.verificationState = verificationState.CONFIRMED
  }
  if (modified) {
    this.syncEngine.update(contact.uuid)
  }
}

Contacts.prototype.updateVerificationStateContact = function (contact, publicKey) {
  var modified = false
  var state = contact.keys[publicKey]
  if (contact.verificationState < verificationState.NOT_VERIFIED) {
    modified = true
    contact.verificationState = verificationState.NOT_VERIFIED
  }
  if (contact.verificationState < verificationState.PENDING && state.verification && (state.verification.initiateSend || state.verificationState.initiateReceived)) {
    modified = true
    contact.verificationState = verificationState.PENDING
  }
  if (contact.verificationState < verificationState.VERIFIED && state.verification && state.verification.codeReceived) {
    modified = true
    contact.verificationState = verificationState.VERIFIED
  }
  if (contact.verificationState < verificationState.CONFIRMED && (state.verificationState === verificationState.CONFIRMED)) {
    modified = true
    contact.verificationState = verificationState.CONFIRMED
  }
  if (modified) {
    this.syncEngine.update(contact.uuid)
  }
}

module.exports = Contacts
