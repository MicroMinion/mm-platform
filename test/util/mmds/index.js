var EventEmitter = require('ak-eventemitter')
var inherits = require('inherits')
var proxyquire = require('proxyquire')
var storagejs = require('./storagejs.js')
var _ = require('lodash')
var debug = require('debug')('test')
var uuid = require('node-uuid')

var stubs = {
  storagejs: storagejs
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
  debug(topic + ' to ' + publicKey + ' : ' + JSON.stringify(data))
  var messaging = this
  process.nextTick(function () {
    if (publicKey === 'local') {
      messaging.emit('self.' + topic, publicKey, data)
    } else {
      messagingInstances[publicKey].emit('self.' + topic, messaging.publicKey, data)
    }
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
var devices = {}

var INSTANCES = 20

for (var i = 0; i < INSTANCES; i++) {
  var name = 'in' + (i + 1)
  messagingInstances[name] = new Messaging()
  messagingInstances[name].publicKey = name
  documentInstances[name] = new Documents(messagingInstances[name])
  devices[name] = {
    publicKey: name,
    verificationState: 5
  }
}

process.nextTick(function () {
  _.forEach(messagingInstances, function (messaging, publicKey) {
    messaging.send('profile.update', 'local', {publicKey: publicKey})
  })
})

i = 0
var ITERATIONS = 10

function iterations () {
  var instance = _.sample(_.values(documentInstances))
  var operation = _.sample(['add', 'update', 'delete'])
  var document = _.sample(_.values(instance.documents))
  if (document === null || document === undefined) {
    operation = 'add'
  }
  if (operation === 'add') {
    var u = uuid.v4()
    instance.documents[u] = {
      uuid: u
    }
    instance.syncEngine.add(u)
  } else if (operation === 'delete') {
    instance.syncEngine.remove(document.uuid)
    delete instance.documents[document.uuid]
  } else {
    var r = Math.random() * 16
    document.test = r.toString(16)
    instance.syncEngine.update(document.uuid)
  }
  i = i + 1
  if (i >= ITERATIONS) {
    clearInterval(intervalId)
    _.forEach(messagingInstances, function (messaging, publicKey) {
      messaging.send('devices.update', 'local', devices)
    })
    console.log('SETTING TIMEOUT')
    setTimeout(function () {
      _.forEach(documentInstances, function (instance) {
        console.log(instance.syncEngine.publicKey)
        console.log(JSON.stringify(instance.documents))
      })
    }, 1000 * 60)
  }
}
var intervalId = setInterval(iterations, 500)
