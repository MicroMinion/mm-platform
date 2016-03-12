var inherits = require('inherits')
var Duplex = require('stream').Duplex
var protobuf = require('protocol-buffers')

var FlunkyMessage = protobuf("
message FlunkyMessage {
  required string topic = 1;
  required string protocol = 2;
  required bytes payload = 3;
}
").FlunkyMessage

var FlunkyProtocol = function (options) {
  Duplex.call(this, {
    allowHalfOpen: false,
    readableObjectMode: true,
    writableObjectMode: true
  })
  this.stream = options.stream
  this.friends = options.friends
  this.devices = options.devices
  var flunkyProtocol
  this.stream.on('data', function(data) {
    var message = FlunkyMessage.decode(data)
    //TODO: Add publicKey
    //TODO: Add scope
    flunkyProtocol.emit('data', message)
  })
  this.stream.on('close', function() {
    flunkyProtocol.emit('close')
  })
  this.stream.on('connect', function() {
    flunkyProtocol.emit('connect')
  })
  this.stream.on('drain', function() {
    flunkyProtocol.emit('drain')
  })
  this.stream.on('end', function() {
    flunkyProtocol.emit('end')
  })
  this.stream.on('error', function(err) {
    flunkyProtocol.emit('error', err)
  })
  this.stream.on('lookup', function(err, address, family) {
    //TODO
  })
  this.stream.on('timeout', function() {
    //TODO
  })
}

inherits(FlunkyProtocol, Duplex)

FlunkyProtocol.prototype.address = function() {
  return this.stream.address()
}

FlunkyProtocol.prototype.connect = function() {
  this.stream.connect()
}

FlunkyProtocol.prototype.destroy = function() {
  //TODO: Implement
}

FlunkyProtocol.prototype._read = function (size) {}

FlunkyProtocol.prototype._write = function (chunk, encoding, callback) {
  this.stream.write(FlunkyMessage.encode(chunk), 'buffer', callback)
}

/**
 * SCOPING LOGIC
 */

/**
 * Get scope of a publicKey
 *
 * @param {string} publicKey
 * @return {string} one of "self", "friends", "public"
 * @private
 */
FlunkyProtocol.prototype._getScope = function (publicKey) {
  debug('getScope')
  expect(publicKey).to.be.a('string')
  expect(nacl.util.decodeBase64(publicKey)).to.have.length(32)
  if (this._inScope(publicKey, this.devices)) {
    return 'self'
  } else {
    var friends = _.any(_.values(this.friends), function (value, index, collection) {
      return this._inScope(publicKey, value.keys)
    }, this)
    if (friends) {
      return 'friends'
    } else {
      return 'public'
    }
  }
}

/**
 * @private
 * @param {string} publicKey
 * @param {Object} searchObject
 * @return {boolean} true or false if the publicKey is a property of searchObject and it's verificationState is verified
 */
FlunkyProtocol.prototype._inScope = function (publicKey, searchObject) {
  debug('inScope')
  return _.any(searchObject, function (value, index, collection) {
    return index === publicKey && value.verificationState >= verificationState.VERIFIED
  })
}


module.exports = FlunkyProtocol
