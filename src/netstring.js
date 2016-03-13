var NetstringStream = function (options) {
  this.stream = options.stream
  this.buffer = new Buffer()
  var self = this
  this.stream.on('data', function (data) {
    Buffer.concat([self.buffer, data])
    try {
      self._processBuffer()
    } catch (e) {
      debug(e)
      self.buffer = new Buffer()
    }
  })
}

/**
 * @private
 */
NetstringStream.prototype._processBuffer = function () {
  debug('_processBuffer')
  self = this
  var buffer = this.buffer
  if (buffer.length === 0) {
    return
  }
  var messageLength = ns.nsLength(buffer)
  debug('message length: ' + messageLength)
  debug('buffer length: ' + buffer.length)
  if (buffer.length >= messageLength) {
    process.nextTick(function () {
      self.emit('data', ns.nsPayload(buffer))
    })
    this._processMessage(ns.nsPayload(buffer))
    this.buffers = new Buffer(buffer.length - messageLength)
    buffer.copy(this.buffer, 0, messageLength)
    debug('buffer length after processing: ' + this.buffer.length)
    this._processBuffer()
  }
}

/**
 * Send a message to TransportManager
 *
 * @public
 * @param {string} protocol
 * @param {string} publicKey
 * @param {Buffer} message
 */
NetstringStream.prototype._write = function (chunk, encoding, callback) {
  this.stream.write(ns.nsWrite(chunk), encoding, callback)
}
