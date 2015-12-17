var Chicago = require('./congestion.js')
var Message = require('./message.js')
var RingBuffer = require('ringbufferjs')
var NanoTimer = require('nanotimer')
var isBuffer = require('isbuffer')
var assert = require('assert')
var Duplex = require('stream').Duplex
var inherits = require('inherits')
var Block = require('./block.js')
var Uint64BE = require('int64-buffer').Uint64BE

var MAX_MESSAGE_SIZE = 1088
var MINIMAL_PADDING = 16
var HEADER_SIZE = 48
var MESSAGE_BODY = MAX_MESSAGE_SIZE - HEADER_SIZE - MINIMAL_PADDING

var MAX_OUTGOING = 128
var MAX_INCOMING = 64

var MAXIMUM_UNPROCESSED_SEND_BYTES = 1024 * 1024

// TODO: First message needs to be max 512 if we are client (check curveCPStream)
// TODO: Add support for sending end of file (either error or normal)

var MessageHandler = function (curveCPStream) {
  var opts = {
    objectMode: false,
    decodeStrings: true
  }
  Duplex.call(this, opts)
  this.maxBlockLength = 512
  this.stream = curveCPStream
  if (this.stream.is_server) {
    this.maxBlockLength = MESSAGE_BODY
  }
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
  this._nextMessageId = 1
}

inherits(MessageHandler, Duplex)

MessageHandler.prototype.nextMessageId = function () {
  var result = this._nextMessageId
  this._nextMessageId += 1
  return result
}

MessageHandler.prototype._read = function (size) {}

MessageHandler.prototype._process = function () {
  if (this.canResend()) {
    this.resendBlock()
  } else if (this.canSend()) {
    this.sendBlock()
  }
  if (this.canProcessMessage()) {
    this.processMessage()
  }
  this.timer.setTimeout(this._process.bind(this), '', this.chicago.wr_rate.toString() + 'm')
}

MessageHandler.prototype._write = function (chunk, encoding, done) {
  assert(isBuffer(chunk))
  this.sendBytes = Buffer.concat([this.sendBytes, chunk])
  if (this.sendBytes.length > MAXIMUM_UNPROCESSED_SEND_BYTES) {
    done(new Error('Buffer full'))
  } else {
    done()
  }
}

MessageHandler.prototype.canResend = function () {
  return !this.outgoing.isEmpty()
}

MessageHandler.prototype.resendBlock = function () {}

MessageHandler.prototype.canSend = function () {
  return this.sendBytes.length > 0 && !this.outgoing.isFull()
}

MessageHandler.prototype.sendBlock = function () {
  var blockSize = this.sendBytes.length
  if (blockSize > this.maxBlockLength) {
    blockSize = this.maxBlockLength
  }
  var block = new Block()
  block.start_byte = this.sendProcessed
  block.transmission_time = this.chicago.clock
  block.id = this.nextMessageId()
  block.data = this.sendBytes.slice(0, blockSize)
  this.sendBytes = this.sendBytes.slice(blockSize)
  this.sendProcessed = this.sendProcessed + block.data.length
  this.outgoing.enq(block)
  var message = new Message()
  message.id = block.id
  // TODO: Fill in and use int64 once receive logic is done
  message.acknowledging_range_1_size = 0
  message.data = block.data
  message.offset = new Uint64BE(block.start_byte)
  this.stream.write(message.toBuffer())
}

MessageHandler.prototype.canProcessMessage = function () {}

MessageHandler.prototype.processMessage = function () {}

module.exports = MessageHandler
