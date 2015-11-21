var Uint64BE = require('int64-buffer').Uint64BE

// var HEADER_SIZE = 48

var STOP_SUCCESS = 2048
var STOP_FAILURE = 4096
var STOP = STOP_SUCCESS + STOP_FAILURE

var Message = function () {}

Message.prototype.fromBuffer = function (buf) {
  this.id = buf.readUInt32BE()
  this.acknowledging_id = buf.readUInt32BE(4)
  this.acknowledging_range_1_size = new Uint64BE(buf, 8)
  this.acknowledging_range_12_gap = buf.readUInt32BE(buf, 16)
  this.acknowledging_range_2_size = buf.readUInt16BE(buf, 20)
  this.acknowledging_range_23_gap = buf.readUInt16BE(buf, 22)
  this.acknowledging_range_3_size = buf.readUInt16BE(buf, 24)
  this.acknowledging_range_34_gap = buf.readUInt16BE(buf, 26)
  this.acknowledging_range_4_size = buf.readUInt16BE(buf, 28)
  this.acknowledging_range_45_gap = buf.readUInt16BE(buf, 30)
  this.acknowledging_range_5_size = buf.readUInt16BE(buf, 32)
  this.acknowledging_range_56_gap = buf.readUInt16BE(buf, 34)
  this.acknowledging_range_6_size = buf.readUInt16BE(buf, 36)
  this.flags = buf.readUInt16BE(buf, 38)
  this.offset = new Uint64BE(buf, 40)
  this.data_length = this.flags - (this.flags & STOP)
  this.data = buf.slice(buf.length - this.data_length)
}

Message.prototype.toBuffer = function () {}

var Chicago = function () {}

var Messager = function (client) {
  this.chicago = new Chicago()
  this.my_id = null
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

Messager.prototype.sendq_head = function (block_stored) {}
Messager.prototype.sendq_move_to_sendmarkq = function (block, block_stored) {}
Messager.prototype.sendq_is_empty = function () {}
Messager.prototype.sendmarkq_head = function (block_stored) {}
Messager.prototype.sendmarkq_get = function (acknowledging_id, block_stored) {}
Messager.prototype.sendmarkq_remove_range = function (start, end) {}
Messager.prototype.sendmarkq_is_full = function () {}
Messager.prototype.recvmarkq_put = function (block, block_stored) {}
Messager.prototype.recvmarkq_get_nth_unacknowledged = function (n, block_stored) {}
Messager.prototype.recvmarkq_is_empty = function () {}
Messager.prototype.recvmarkq_remove_range = function (start, end) {}
Messager.prototype.send = function (buf) {}
Messager.prototype.receive = function (buf) {}
Messager.prototype.process_sendq = function () {}
Messager.prototype.put_next_timeout = function (timeout) {}
Messager.prototype.next_timeout = function () {}

module.exports = Messager
