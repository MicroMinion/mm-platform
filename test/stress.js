/* eslint-env mocha */
'use strict'

var parallel = require('run-parallel')
var _ = require('lodash')

var Platform = require('../src/index.js')
var Directory = require('../stub/directory.js')

var Logger = function () {
  this.debug = this.log.bind(this, 'debug')
  this.info = this.log.bind(this, 'info')
  this.warn = this.log.bind(this, 'warn')
  this.error = this.log.bind(this, 'error')
}

Logger.prototype.log = function (level, msg, attributes) {}

var _makeNodes = function (platformNodes, number, done) {
  var readyCounter = 0
  for (var i = 0; i < number; i++) {
    var platform = new Platform({
      directory: new Directory(),
      logger: new Logger()
    })
    platform.once('ready', function () {
      readyCounter += 1
      if (readyCounter === number) {
        done()
      }
    })
    platformNodes.push(platform)
  }
}

var _callback = function (nodes, messageId, callback) {
  var sample = _.sampleSize(nodes, 2)
  var sender = sample[0]
  var destinationKey = sample[1].identity.getBoxId()
  console.time(messageId)
  sender.messaging.send('test.test', destinationKey, {
    'testSequence': messageId
  }, {
    callback: function (err, result) {
      console.timeEnd(messageId)
      callback(err, result)
    }
  })
}

describe('stress test', function () {
  this.timeout(0)
  var nodes = [2, 5, 10, 20, 30, 50]
  nodes.forEach(function (node) {
    describe('between ' + node + ' nodes', function () {
      var platformNodes = []
      beforeEach(function (done) {
        _makeNodes(platformNodes, node, done)
      })
      var messages = [1, 10, 100]
      messages.forEach(function (nbMessages) {
        it('correctly sends ' + nbMessages, function (done) {
          var callbacks = []
          for (var i = 1; i <= nbMessages; i++) {
            callbacks.push(_callback.bind(null, platformNodes, i))
          }
          parallel(callbacks, done)
        })
      })
    })
  })
})
