var Chicago = require('./chicago.js')
var Message = require('./message.js')
var isBuffer = require('isbuffer')
var assert = require('assert')
var Duplex = require('stream').Duplex
var inherits = require('inherits')
var Block = require('./message-block.js')
var Uint64BE = require('int64-buffer').Uint64BE
var _ = require('lodash')
var debug = require('debug')('flunky-platform:messaging:chicago:MessageStream')

var MAX_MESSAGE_SIZE = 1088
var MINIMAL_PADDING = 16
var HEADER_SIZE = 48
var MESSAGE_BODY = MAX_MESSAGE_SIZE - HEADER_SIZE - MINIMAL_PADDING

var MAX_OUTGOING = 128
var MAX_INCOMING = 64

var MAXIMUM_UNPROCESSED_SEND_BYTES = 1024 * 1024

// TODO: Add support for sending end of file (either error or normal)

var MessageStream = function (curveCPStream) {
  debug('initialize')
  var opts = {
    objectMode: false,
    decodeStrings: true
  }
  Duplex.call(this, opts)
  this.maxBlockLength = 512
  this.stream = curveCPStream
  var self = this
  this.stream.on('data', this._receiveData.bind(this))
  this.stream.on('error', function (error) {
    self.emit('error', error)
  })
  this.stream.on('close', function () {
    self.emit('close')
  })
  this.stream.on('connect', function () {
    self.emit('connect')
  })
  if (this.stream.is_server) {
    this.maxBlockLength = MESSAGE_BODY
  }
  /* Bytes that still need to be processed */
  this.sendBytes = new Buffer(0)
  /* Bytes that have been processed / send to peer */
  this.sendProcessed = 0
  /* Blocks that have been send but not yet acknowledged by other party */
  this.outgoing = {}
  /* Messages that have been received but not yet processed */
  this.incoming = []
  /* Number of bytes that have been received and send upstream */
  this.receivedBytes = 0
  /* Chicago congestion control algorithm */
  this.chicago = new Chicago()
  /* nanosecond precision timer */
  this.chicago.setTimeout(this._process.bind(this))
  this._nextMessageId = 1
}

inherits(MessageStream, Duplex)

MessageStream.prototype.nextMessageId = function () {
  var result = this._nextMessageId
  this._nextMessageId += 1
  return result
}

MessageStream.prototype._receiveData = function (data) {
  debug('_receiveData')
  var message = new Message()
  message.fromBuffer(data)
  if (_.size(this.incoming) < MAX_INCOMING) {
    this.incoming.push(message)
    this.chicago.enableTimer()
  }
}

MessageStream.prototype.connect = function () {
  this.stream.connect()
}

MessageStream.prototype.destroy = function () {
  this.stream.destroy()
}

MessageStream.prototype._read = function (size) {}

MessageStream.prototype._process = function () {
  debug('_process')
  debug(this.label)
  debug(this.chicago.nsecperblock)
  this.chicago.refresh_clock()
  if (this.canResend()) {
    this.resendBlock()
  } else if (this.canSend()) {
    this.sendBlock()
  }
  if (this.canProcessMessage()) {
    this.chicago.refresh_clock()
    this.processMessage()
  }
  this.chicago.refresh_clock()
  if (_.isEmpty(this.incoming) && _.isEmpty(this.outgoing) && this.sendBytes.length === 0) {
    this.chicago.disableTimer()
  }
}

MessageStream.prototype._write = function (chunk, encoding, done) {
  debug('_write')
  assert(isBuffer(chunk))
  this.sendBytes = Buffer.concat([this.sendBytes, chunk])
  if (this.sendBytes.length > MAXIMUM_UNPROCESSED_SEND_BYTES) {
    done(new Error('Buffer full'))
  } else {
    this.chicago.enableTimer()
    done()
  }
}

MessageStream.prototype.canResend = function () {
  return !_.isEmpty(this.outgoing) && _.some(this.outgoing, function (block) {
    return block.transmission_time + this.chicago.rtt_timeout < this.chicago.clock
  }, this)
}

MessageStream.prototype.resendBlock = function () {
  var block = _.min(this.outgoing, 'transmission_time')
  block.transmission_time = this.chicago.clock
  block.id = this.nextMessageId()
  this.chicago.retransmission()
  this._sendBlock(block)
}

MessageStream.prototype.canSend = function () {
  return this.sendBytes.length > 0 && _.size(this.outgoing) < MAX_OUTGOING
}

MessageStream.prototype.sendBlock = function () {
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
  this.outgoing[block.id] = block
  this._sendBlock(block)
}

MessageStream.prototype._sendBlock = function (block) {
  var message = new Message()
  message.id = block.id
  message.acknowledging_range_1_size = new Uint64BE(this.receivedBytes)
  message.data = block.data
  message.offset = new Uint64BE(block.start_byte)
  this.chicago.send_block(block.transmission_time)
  this.stream.write(message.toBuffer())
  this.maxBlockLength = MESSAGE_BODY
}

MessageStream.prototype.canProcessMessage = function () {
  return this.incoming.length > 0
}

MessageStream.prototype.processMessage = function () {
  debug('processMessage')
  var message = this.incoming.shift()
  this.processAcknowledgments(message)
  this._processMessage(message)
}

MessageStream.prototype.processAcknowledgments = function (message) {
  debug('processAcknowledgements')
  if (_.has(this.outgoing, message.acknowledging_id)) {
    debug('processing acknowledgement')
    var block = this.outgoing[message.acknowledging_id]
    delete this.outgoing[message.acknowledging_id]
    this.chicago.acknowledgement(block.transmission_time)
  }
}

MessageStream.prototype.sendAcknowledgment = function (message) {
  debug('sendAcknowledgment')
  var reply = new Message()
  reply.id = this.nextMessageId()
  reply.acknowledging_id = message.id
  reply.acknowledging_range_1_size = new Uint64BE(this.receivedBytes)
  this.stream.write(reply.toBuffer())
}

MessageStream.prototype._processMessage = function (message) {
  debug('_processMessage')
  if (Number(message.offset) <= this.receivedBytes) {
    if (message.data_length > 1) {
      var ignoreBytes = this.receivedBytes - Number(message.offset)
      var data = message.data.slice(ignoreBytes)
      this.receivedBytes += data.length
      this.emit('data', data)
      this.sendAcknowledgment(message)
    }
  }
}

module.exports = MessageStream
