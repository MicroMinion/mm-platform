var kademlia = require('kad')
var inherits = require('inherits')
var kadfs = require('kad-fs')
var debug = require('debug')('flunky-platform:services:kademlia')
var _ = require('lodash')

// TODO: Use Storagejs as storage adapter
// TODO: Need to include seeds (format: dictionary with publicKey as key and connectionInfo as value)

var seeds = {}

/* KADEMLIA CONTACT */

var FlunkyContact = function (options) {
  this.publicKey = options.publicKey
  this.connectionInfo = options.connectionInfo
  kademlia.Contact.call(this, options)
}

inherits(FlunkyContact, kademlia.Contact)

FlunkyContact.prototype._createNodeID = function () {
  return kademlia.utils.createID(this.publicKey)
}

FlunkyContact.prototype.toString = function () {
  return this.publicKey
}

/* KADEMLIA TRANSPORT */

var FlunkyTransport = function (options) {
  this.messaging = options.messaging
  kademlia.RPC.call(this, options)
  var self = this
  process.nextTick(function () {
    self.emit('ready')
  })
  this.messaging.on('self.kademlia', this._onMessage.bind(this))
  this.messaging.on('friends.kademlia', this._onMessage.bind(this))
  this.messaging.on('public.kademlia', this._onMessage.bind(this))
  this._setupSeeds()
}

FlunkyTransport.prototype._onMessage = function (topic, publicKey, data) {
  data = new Buffer(JSON.stringify(data), 'utf8')
  this._handleMessage(data, {publicKey: publicKey})
}

FlunkyTransport.prototype._createContact = function (options) {
  return new FlunkyContact(options)
}

FlunkyTransport.prototype._send = function (data, contact) {
  data = JSON.parse(data.toString('utf8'))
  this.messsaging.send('kademlia', contact.publicKey, data)
}

FlunkyTransport.prototype._close = function () {}

inherits(FlunkyTransport, kademlia.RPC)

/* FLUNKY SERVICE */

var KademliaService = function (messaging) {
  this.messaging = messaging
  this.replyTo = {}
  this.messaging.on('self.messaging.myConnectionInfo', this._updateReplyTo.bind(this))
}

KademliaService.prototype._updateReplyTo = function (topic, publicKey, data) {
  this.replyTo.publicKey = data.publicKey
  this.replyTo.connectionInfo = data.connectionInfo
  if (!this.dht) {
    this._setup()
  }
}

KademliaService.prototype._setup = function () {
  this.messaging.on('self.directory.get', this.get.bind(this))
  this.messaging.on('self.directory.put', this.put.bind(this))
  this.dht = new kademlia.Node({
    messaging: this.messaging,
    storage: kadfs('./storage/kad'),
    transport: FlunkyTransport,
    replyto: this.replyTo
  })
  this._setupSeeds()
}

KademliaService.prototype.get = function (topic, publicKey, data) {
  var self = this
  this.dht.get(data.key, function (err, value) {
    if (!value) {
      debug(err)
      return
    }
    self.messaging.send('directory.getReply', 'local', {key: data.key, value: value})
  })
}
KademliaService.prototype.put = function (topic, publicKey, data) {
  this.dht.put(data.key, data.value)
}

KademliaService.prototype._setupSeeds = function () {
  var self = this
  _.forEach(seeds, function (connectionInfo, publicKey) {
    this.messaging.send('messaging.connectionInfo', 'local', {publicKey: publicKey, connectionInfo: connectionInfo})
    setImmediate(function () {
      self.dht.connect({publicKey: publicKey, connectionInfo: connectionInfo})
    })
  }, this)
}

module.exports = KademliaService
