var inherits = require('inherits')
var Duplex = require('stream').Duplex

var FlunkyProtocol = function (options) {
  this.in = new FlunkyEnricher(options)
  this.out = new FlunkyPackager(options)
}

var FlunkyEnricher = function (options) {
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: false
  })
}

inherits(FlunkyEnricher, Duplex)

var FlunkyPackager = function (options) {
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: false,
    writableObjectMode: true
  })
}

inherits(FlunkyPackager, Duplex)

module.exports = FlunkyProtocol
