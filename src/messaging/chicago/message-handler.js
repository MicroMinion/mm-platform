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

// TODO: Add support for sending end of file (either error or normal)

var MessageHandler = function (curveCPStream) {
  var opts = {
    objectMode: false,
    decodeStrings: true
  }
  Duplex.call(this, opts)
  this.maxBlockLength = 512
  this.stream = curveCPStream
  this.stream.on('data', this._receiveData.bind(this))
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

MessageHandler.prototype._receiveData = function (data) {
  var message = new Message()
  message.fromBuffer(data)
  if (!this.incoming.isFull()) {
    this.incoming.enq(message)
  }
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

MessageHandler.prototype.resendBlock = function () {
  var block = this.outgoing.peek()
  block.transmission_time = this.chicago.clock
  block.id = this.nextMessageId()
  this._sendBlock(block)
}

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
  this._sendBlock(block)
}

MessageHandler.prototype._sendBlock = function (block) {
  var message = new Message()
  message.id = block.id
  // TODO: Fill in and use int64 once receive logic is done
  message.acknowledging_range_1_size = 0
  message.data = block.data
  message.offset = new Uint64BE(block.start_byte)
  this.stream.write(message.toBuffer())
  this.maxBlockLength = MESSAGE_BODY
}

MessageHandler.prototype.canProcessMessage = function () {
  return !this.incoming.isEmpty()
}

MessageHandler.prototype.processMessage = function () {
  var message = this.incoming.deq()
  this.processAcknowledgments(message)
  this._processMessage(message)
}

MessageHandler.prototype.processAcknowledgments = function (message) {
  var size = message.acknowledging_range_1_size
  var included = true
  while (included) {
    var block = this.outgoing.peek()
    if (block.isIncluded(size)) {
      this.outgoing.deq()
    } else {
      included = false
    }
  }
}

MessageHandler.prototype.sendAcknowledgment = function (message) {
  var reply = new Message()
  reply.id = this.nextMessageId()
  reply.acknowledging_id = message.id
  reply.acknowledging_range_1_size = new Uint64BE(this.receivedBytes)
  this.stream.write(reply.toBuffer())
}

MessageHandler.prototype._processMessage = function (message) {
  if (message.offset <= this.receivedBytes) {
    if (message.data_length > 1) {
      var ignoreBytes = this.receivedBytes - message.offset
      var data = message.data.slice(ignoreBytes)
      this.receivedBytes += data.length
      this.emit('data', data)
      this.sendAcknowledgment(message)
    }
  }
}

module.exports = MessageHandler
