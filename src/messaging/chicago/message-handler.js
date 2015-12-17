var Chicago = require('./congestion.js')
var Message = require('./message.js')

var MAX_MESSAGE_SIZE = 1088
var MINIMAL_PADDING = 16
var HEADER_SIZE = 48
var MESSAGE_BODY = MAX_MESSAGE_SIZE - HEADER_SIZE - MINIMAL_PADDING

var MessageHandler = function (client) {
  this.chicago = new Chicago()
  this.my_id = 1
  this.my_eof = null
  this.my_final = null
  this.my_maximum_send_bytes = client ? 512 : 1024
  this.my_sent_bytes = null
  this.my_sent_clock = null
  this.their_sent_id = null
  this.their_eof = null
  this.their_final = null
  this.their_contiguous_sent_bytes = null
  this.their_total_bytes = null
  this.next_timeout()
}

MessageHandler.prototype.next_id = function () {
  if (!this.my_id) {
    this.my_id = 1
  }
  this.my_id += 1
  return this.my_id
}

MessageHandler.prototype.sendq_head = function (block_stored) {}
MessageHandler.prototype.sendq_move_to_sendmarkq = function (block, block_stored) {}
MessageHandler.prototype.sendq_is_empty = function () {}
MessageHandler.prototype.sendmarkq_head = function (block_stored) {}
MessageHandler.prototype.sendmarkq_get = function (acknowledging_id, block_stored) {}
MessageHandler.prototype.sendmarkq_remove_range = function (start, end) {}
MessageHandler.prototype.sendmarkq_is_full = function () {}
MessageHandler.prototype.recvmarkq_put = function (block, block_stored) {}
MessageHandler.prototype.recvmarkq_get_nth_unacknowledged = function (n, block_stored) {}
MessageHandler.prototype.recvmarkq_is_empty = function () {}
MessageHandler.prototype.recvmarkq_remove_range = function (start, end) {}
MessageHandler.prototype.send = function (buf) {}
MessageHandler.prototype.receive = function (buf) {}
MessageHandler.prototype.process_sendq = function () {}
MessageHandler.prototype.put_next_timeout = function (timeout) {}
MessageHandler.prototype.next_timeout = function () {}

MessageHandler.prototype.send_block = function (block) {
  if (block && block.length > this.my_maximum_send_bytes) {
    throw new Error('Block length longer than maximum byte length')
  }
  var message = new Message()
  if (block) {
    message.setPadding(MESSAGE_BODY - block.length)
    this.my_id = this.next_id()
    message.id = this.my_id
  } else {
    message.setPadding(MESSAGE_BODY)
    message.id = 0
  }
  if (this.their_sent_id) {
    message.acknowledging_id = this.their_sent_id
  }
// TODO: Complete
}

module.exports = MessageHandler
