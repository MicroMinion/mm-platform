var inherits = require('inherits')
var Duplex = require('stream').Duplex
var protobuf = require('protocol-buffers')
var fs = require('fs')
var expect = require('chai').expect
var path = require('path')

var FlunkyMessage = protobuf(fs.readFileSync(path.join(path.resolve(__dirname), 'flunky-protocol.proto'))).FlunkyMessage

var FlunkyProtocol = function (options) {
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.friends = options.friends
  this.devices = options.devices
  this.directory = options.directory
  var flunkyProtocol = this
  this.stream.on('data', function (data) {
    var message = FlunkyMessage.decode(data)
    message.sender = flunkyProtocol.remoteAddress
    message.scope = flunkyProtocol._getScope(message.publicKey)
    flunkyProtocol.emit('data', message)
  })
  this.stream.on('close', function () {
    flunkyProtocol.emit('close')
  })
  this.stream.on('connect', function () {
    flunkyProtocol.emit('connect')
  })
  this.stream.on('drain', function () {
    flunkyProtocol.emit('drain')
  })
  this.stream.on('end', function () {
    flunkyProtocol.emit('end')
  })
  this.stream.on('error', function (err) {
    flunkyProtocol.emit('error', err)
  })
  this.stream.on('timeout', function () {
    flunkyProtocol.emit('timeout')
  })
  this.stream.on('lookup', function (err, address, family) {
    flunkyProtocol.emit('lookup', err, address, family)
  })
}

inherits(FlunkyProtocol, Duplex)

FlunkyProtocol.prototype.connect = function (publicKey) {
  var self = this
  this.directory.getConnectionInfo(publicKey, function (err, result) {
    if (err) {
      self.emit('error', err)
      self.emit('lookup', err, null, null)
    } else {
      self.emit('lookup', null, result, 'flunky')
      self.stream.connect(publicKey, result)
    }
  })
}

FlunkyProtocol.prototype.isConnected = function () {
  return this.stream.isConnected()
}

FlunkyProtocol.prototype._read = function (size) {}

FlunkyProtocol.prototype._write = function (chunk, encoding, callback) {
  var message = {
    topic: chunk.topic,
    protocol: chunk.protocol,
    payload: chunk.payload
  }
  this.stream.write(FlunkyMessage.encode(message), 'buffer', callback)
}

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
FlunkyProtocol.prototype._getScope = function (publicKey) {
  expect(publicKey).to.be.a('string')
  if (this.devices.inScope(publicKey)) {
    return 'self'
  } else if (this.friends.inScope(publicKey)) {
    return 'friends'
  } else {
    return 'public'
  }
}

FlunkyProtocol.prototype.destroy = function () {
  this.stream.destroy()
}

Object.defineProperty(FlunkyProtocol.prototype, 'remoteAddress', {
  get: function () {
    return this.stream.remoteAddress
  }
})

module.exports = FlunkyProtocol
