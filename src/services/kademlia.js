var kademlia = require('kad')
var inherits = require('inherits')
var debug = require('debug')('flunky-platform:services:kademlia')
var debugTransport = require('debug')('flunky-platform:services:kademlia:transport')
var _ = require('lodash')

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
  debugTransport('initialize FlunkyTransport')
  this.messaging = options.messaging
  kademlia.RPC.call(this, options)
  var self = this
  process.nextTick(function () {
    self.emit('ready')
  })
  this.messaging.on('self.kademlia', this._onMessage.bind(this))
  this.messaging.on('friends.kademlia', this._onMessage.bind(this))
  this.messaging.on('public.kademlia', this._onMessage.bind(this))
}

FlunkyTransport.prototype._onMessage = function (topic, publicKey, data) {
  debugTransport('_onMessage')
  debugTransport(data)
  data = new Buffer(JSON.stringify(data), 'utf8')
  this._handleMessage(data, {publicKey: publicKey})
}

FlunkyTransport.prototype._createContact = function (options) {
  debugTransport('_createContact')
  debugTransport(JSON.stringify(options))
  return new FlunkyContact(options)
}

FlunkyTransport.prototype._send = function (data, contact) {
  debugTransport('_send')
  data = JSON.parse(data.toString('utf8'))
  this.messaging.send('kademlia', contact.publicKey, data, {realtime: true, expireAfter: 10000})
}

FlunkyTransport.prototype._close = function () {}

inherits(FlunkyTransport, kademlia.RPC)

/* FLUNKY SERVICE */

var KademliaService = function (options) {
  debug('initialize')
  this.messaging = options.messaging
  this.storage = options.storage
  this.replyTo = {}
  this.online = false
  this.messaging.on('self.messaging.myConnectionInfo', this._updateReplyTo.bind(this))
}

KademliaService.prototype._updateReplyTo = function (topic, publicKey, data) {
  debug('_updateReplyTo')
  this.replyTo.publicKey = data.publicKey
  this.replyTo.connectionInfo = data
  if (!this.dht) {
    this._setup()
  }
  if (this.online) {
    this.dht.put(data.publicKey, data, function (err) {
      debug(err)
    })
  }
}

KademliaService.prototype._setup = function () {
  debug('_setup')
  var service = this
  this.messaging.on('self.directory.get', this.get.bind(this))
  this.messaging.on('self.directory.put', this.put.bind(this))
  this.messaging.on('self.messaging.connectionInfo', this.connect.bind(this))
  this.messaging.on('self.messaging.requestConnectionInfo', this.requestConnectionInfo.bind(this))
  this.dht = new kademlia.Node({
    messaging: this.messaging,
    storage: this.storage,
    transport: FlunkyTransport,
    replyto: this.replyTo
  })
  this.dht.once('connect', function () {
    service.online = true
  })
  this._setupSeeds()
  this.messaging.send('messaging.requestAllConnectionInfo', 'local', {})
}
KademliaService.prototype.connect = function (topic, publicKey, data) {
  debug('connect')
  if (data.publicKey !== this.replyTo.publicKey) {
    this.dht.connect({publicKey: data.publicKey, connectionInfo: data})
  }
}

KademliaService.prototype.requestConnectionInfo = function (topic, publicKey, data) {
  debug('requestConnectionInfo')
  // TODO: Also check and use info from internal routing table
  publicKey = data
  var self = this
  if (!this.online) { return }
  this.dht.get(publicKey, function (err, value) {
    if (!value) {
      debug(err)
      return
    }
    self.messaging.send('messaging.connectionInfo', 'local', value)
  })
}

KademliaService.prototype.get = function (topic, publicKey, data) {
  debug('get')
  var self = this
  if (!this.online) { return }
  this.dht.get(data.key, function (err, value) {
    if (!value) {
      debug(err)
      return
    }
    self.messaging.send('directory.getReply', 'local', {key: data.key, value: value})
  })
}
KademliaService.prototype.put = function (topic, publicKey, data) {
  debug('put')
  if (this.online) {
    this.dht.put(data.key, data.value)
  }
}

KademliaService.prototype._setupSeeds = function () {
  debug('_setupSeeds')
  var self = this
  _.forEach(seeds, function (connectionInfo, publicKey) {
    this.messaging.send('messaging.connectionInfo', 'local', connectionInfo)
    setImmediate(function () {
      self.dht.connect({publicKey: publicKey, connectionInfo: connectionInfo})

    })
  }, this)
}

module.exports = KademliaService
