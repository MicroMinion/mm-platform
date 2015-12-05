var Uint64BE = require('int64-buffer').Uint64BE
var hrtime = require('browser-process-hrtime')

var MAX_MESSAGE_SIZE = 1088
var HEADER_SIZE = 48
var MESSAGE_BODY = MAX_MESSAGE_SIZE - HEADER_SIZE

var STOP_SUCCESS = 2048
var STOP_FAILURE = 4096
var STOP = STOP_SUCCESS + STOP_FAILURE

var Message = function () {
  this.id = 0
  this.acknowledging_id = 0
  this.padding = 0
}

Message.prototype.setPadding = function (bytes) {
  this.padding = bytes
}

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

var Chicago = function () {
  this.clock = null
  this.refresh_clock()
  this.rtt_latest = 0
  this.rtt_average = 0
  this.rtt_deviation = 0
  this.rtt_highwater = 0
  this.rtt_lowwater = 0
  this.rtt_timeout = 1000
  this.seen_recent_high = 0
  this.seen_recent_low = 0
  this.seen_older_high = 0
  this.seen_older_low = 0
  this.rtt_phase = 0
  this.wr_rate = 1000
  this.ns_last_update = this.clock
  this.ns_last_edge = 0
  this.ns_last_doubling = 0
  this.ns_last_panic = 0
}

Chicago.prototype.refresh_clock = function () {
  this.clock = hrtime()
}
Chicago.prototype.on_timeout = function () {
  if (this.clock > this.ns_last_panic + 4 * this.rtt_timeout) {
    this.wr_rate = this.wr_rate * 2
    this.ns_last_panic = this.clock
    this.ns_last_edge = this.clock
  }
}

Chicago.prototype._try_update_rates = function () {
  if (this.clock - this.ns_last_edge < 60000) {
    if (this.clock < this.ns_last_doubling + 4 * this.wr_rate + 64 * this.rtt_timeout + 5000) {
      return
    }
  } else {
    if (this.clock < this.n_last_doubling + 4 * this.wr_rate + 2 * this.rtt_timeout) {
      return
    }
  }
  if (this.wr_rate <= 0.065535) {
    return
  }
  this.wr_rate = this.wr_rate / 2
  this.ns_last_doubling = this.clock
  if (this.ns_last_edge) {
    this.ns_last_edge = this.clock
  }
}

Chicago.prototype._update = function (rtt_ns) {
  this.rtt_latest = rtt_ns
  /* Initialization */
  if (!this.rtt_average) {
    this.wr_rate = this.rtt_latest
    this.rtt_average = this.rtt_latest
    this.rtt_deviation = this.rtt_latest / 2
    this.rtt_highwater = this.rtt_latest
    this.rtt_lowwater = this.rtt_latest
  }
  /* Jacobson's retransmission timeout calculation. */
  var rtt_delta = this.rtt_latest - this.rtt_average
  this.rtt_average = this.rtt_average + (rtt_delta / 8)
  if (rtt_delta < 0) {
    rtt_delta = -rtt_delta
  }
  rtt_delta = rtt_delta - this.rtt_deviation
  this.rtt_deviation = this.rtt_deviation + rtt_delta / 4
  this.rtt_timeout = this.rtt_average + 4 * this.rtt_deviation
  /* Adjust for delayed acknowledgements with anti-spiking. */
  this.rtt_timeout = this.rtt_timeout + 8 * this.wr_rate
  /* Recognize top and bottom of congestion cycle. */
  rtt_delta = this.rtt_latest - this.rtt_highwater
  this.rtt_highwater = this.rtt_highwater + rtt_delta / 1024
  rtt_delta = this.rtt_latest - this.rtt_lowwater
  if (rtt_delta > 0) {
    this.rtt_lowwater = this.rtt_lowwater + rtt_delta / 8192
  } else {
    this.rtt_lowwater = this.rtt_lowwater + rtt_delta / 256
  }
  if (this.rtt_average > this.rtt_highwater + 5) {
    this.seen_recent_high = 1
  } else {
    this.seen_recent_low = 1
  }
  if (this.clock >= this.ns_last_update + 16 * this.wr_rate) {
    if (this.clock - this.ns_last_update > 10000) {
      this.wr_rate = 0.001
      this.wr_rate += this.random__mod_n(this.wr_rate / 8)
    }
    this.ns_last_update = this.clock

    if (this.wr_rate >= 0.131072) {
      if (this.wr_rate < 16.777216) {
        var u = this.wr_rate / 0.131072
        this.wr_rate -= u * u * u
      } else {
        var d = this.wr_rate
        this.wr_rate = d / (1 + d * d / 2251799813.685248)
      }
    }
    if (this.rtt_phase === 0) {
      if (this.seen_older_high) {
        this.rtt_phase = 1
        this.ns_last_edge = this.clock
        this.wr_rate += this.random__mod_n(this.wr_rate / 4)
      }
    } else {
      if (this.seen_older_low) {
        this.rtt_phase = 0
      }
    }
    this.seen_older_high = this.seen_recent_high
    this.seen_older_low = this.seen_recent_low
    this.seen_recent_high = 0
    this.seen_recent_low = 0
    this._try_update_rates()
  }
}

Chicago.prototype.random__mod_n = function (n) {}

Chicago.prototype.on_recv = function (ns_sent) {
  this._update(this.clock - ns_sent)
}

var Messager = function (client) {
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

Messager.prototype.send_block = function (block) {
  if (block && block.length > this.my_maximum_send_bytes) {
    throw new Error('Block length longer than maximum byte length')
  }
  var message = new Message()
  if (block) {
    message.setPadding(MESSAGE_BODY - block.length)
    this.my_id = this.my_id + 1
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

module.exports = Messager
