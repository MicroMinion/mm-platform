var SyncEngine = require('../../../src/util/mmds/index.js')
var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var proxyquire = require('proxyquire')
var storagejs = require('./storagejs.js')

var stubs = {
  storagejs: storagejs,
}

stubs.storagejs['@global'] = true

var SyncEngine = proxyquire('../../../src/util/mmds/index.js', stubs)

var Messaging = function () {
  EventEmitter.call(this, {
    delimiter: '.'
  })
}

inherits(Messaging, EventEmitter)

Messaging.prototype.send = function (topic, publicKey, data, options) {
  var messaging = this
  process.nextTick(function () {
    messaging.emit('self.' + topic, publicKey, data)
  })
}

var Documents = function (messaging) {
  var documents = this
  this.documents = {}
  this.syncEngine = new SyncEngine(messaging, 'documents', 'uuid', this.documents)
  this.syncEngine.on('processEvent', function (action, document) {
    if (action === 'update') {
      documents.documents[document.uuid] = document
    } else if (action === 'add') {
      documents.documents[document.uuid] = document
    } else if (action === 'remove') {
      delete documents.documents[document.uuid]
    }
  })
}

var documentInstances = {}
var messagingInstances = {}

var INSTANCES = 2

for(var i = 0; i < INSTANCES; i++) {
  var name = 'in' + (i+1)
  messagingInstances[name] = new Messaging()
  documentInstances[name] = new Documents(messagingInstances[name])
}
