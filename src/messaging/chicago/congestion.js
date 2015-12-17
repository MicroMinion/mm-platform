var hrtime = require('browser-process-hrtime')

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

module.exports = Chicago
