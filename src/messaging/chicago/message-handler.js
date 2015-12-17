var Chicago = require('./congestion.js')
var Message = require('./message.js')
var RingBuffer = require('ringbufferjs')
var NanoTimer = require('nanotimer')

var MAX_MESSAGE_SIZE = 1088
var MINIMAL_PADDING = 16
var HEADER_SIZE = 48
var MESSAGE_BODY = MAX_MESSAGE_SIZE - HEADER_SIZE - MINIMAL_PADDING

var MAX_OUTGOING = 128
var MAX_INCOMING = 64

var MessageHandler = function (client) {
  /* Bytes that still need to be processed */
  this.sendBytes = new Buffer(0)
  /* Bytes that have been processed / send to peer */
  this.sendProcessed = 0
  /* Blocks that have been send but not yet acknowledged by other party */
  this.outgoing = new RingBuffer(MAX_OUTGOING)
  /* Messages that have been received but not yet processed */
  this.incoming = new RingBuffer(MAX_INCOMING)
  /* Blocks that been acknowledged but not yet send upstream */
  this.receivedBlocks = new RingBuffer(MAX_INCOMING)
  /* Number of bytes that have been received and send upstream */
  this.receivedBytes = 0
  /* Chicago congestion control algorithm */
  this.chicago = new Chicago()
  /* nanosecond precision timer */
  this.timer = new NanoTimer()
  this.timer.setTimeout(this._process.bind(this), '', this.chicago.wr_rate.toString() + 'm')
}

MessageHandler.prototype._process = function () {
  // TODO: Message handling logic
  this.timer.setTimeout(this._process.bind(this), '', this.chicago.wr_rate.toString() + 'm')
}

module.exports = MessageHandler
