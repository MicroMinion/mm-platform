var _ = require('lodash')
var AbstractTransport = require('./transport-abstract.js')
var chai = require('chai')
var debug = require('debug')('flunky-platform:messaging:transport-udpTurn')
var dgram = (_.isUndefined(window.chrome)) ? require('dgram') : require('chrome-dgram')
var Duplex = require('stream').Duplex
var extend = require('extend.js')
var inherits = require('inherits')
var Q = require('q')
var turn = require('turn-js')

var expect = chai.expect

var turnArgs = {
  addr: '54.154.15.84',
  port: 19302,
  user: 'wire',
  pwd: 'wire123'
}

var lifetime = 600

var UDPTurnTransport = function (publicKey, privateKey) {
  AbstractTransport.call(this, publicKey, privateKey)
  this.udpConnectionStreams = {}
  var udpSocket = dgram.createSocket('udp4')
  this.turnSocket = turn(turnArgs.addr, turnArgs.port, turnArgs.user, turnArgs.pwd, udpSocket)
  this.enabled = false
  this.turnSocket.on('message', this._onMessage.bind(this)) // TODO: must be bytes!
  this.turnSocket.on('error', function (errorMessage) {
    debug(errorMessage)
  // TODO: transport._listen(0)
  })
}

inherits(UDPTurnTransport, AbstractTransport)

UDPTurnTransport.prototype._emitReady = function (srflxAddresses, relayAddresses) {
  var connectionInfo = {
    'udpTurn': {
      'srflx': {
        'address': srflxAddresses.address,
        'port': srflxAddresses.port
      },
      'relay': {
        'address': relayAddresses.address,
        'port': relayAddresses.port
      }
    }
  }
  this.emit('ready', connectionInfo)
}

UDPTurnTransport.prototype._onMessage = function (message, channelId) {
  this.udpConnectionStreams[channelId].emit('data', message)
}

/** establish connection with peer */

UDPTurnTransport.prototype._connect = function (connectionInfo) {
  expect(this.isDisabled()).to.be.false
  var relayAddress = connectionInfo.udpTurn.relay
  var self = this
  if (_isValidConnectionInfo(connectionInfo)) {
    // create permission
    return this.turnSocket.createPermissionP(relayAddress.address)
      .then(function () {
        debug('permission set for ' + relayAddress + ' to send messages')
        // create channel
        return self.turnSocket.bindChannelP(relayAddress.address, relayAddress.port)
      })
      .then(function (channelId) {
        // create connection
        var connectionStream = self._createConnectionStream(channelId)
        // and return another promise
        return Q.fcall(function () {
          return connectionStream
        })
      })
  }
}

UDPTurnTransport.prototype._createConnectionStream = function (channelId) {
  expect(this.udpConnectionStreams).not.to.have.property(channelId) // channelId should be new
  var udpConnectionStream = new UDPConnectionStream({
    channel: channelId
  })
  this.udpConnectionStreams[channelId] = udpConnectionStream
  var self = this
  udpConnectionStream.on('close', function () {
    // TODO: disconnect channel and remove permission (to be added to turn-js lib)
    delete self.udpConnectionStreams[channelId]
  })
  return udpConnectionStream
}

function _isValidConnectionInfo (connectionInfo) {
  return _.isObject(connectionInfo) &&
  _.has(connectionInfo, 'udpTurn') &&
  _.has(connectionInfo.udpTurn, 'srflx') &&
  _.has(connectionInfo.udpTurn, 'relay') &&
  _.has(connectionInfo.udpTurn.srflx, 'address') &&
  _.has(connectionInfo.udpTurn.srflx, 'port') &&
  _.has(connectionInfo.udpTurn.relay, 'address') &&
  _.has(connectionInfo.udpTurn.relay, 'port')
// TODO: check if value formats are correct
}

/** enable and disable this transport */

UDPTurnTransport.prototype.enable = function (onSuccess, onFailure) {
  debug('enable')
  if (this.enabled) {
    debug('socket is already enabled, ignoring')
  }
  var self = this
  this.turnSocket.allocateP()
    .then(function (addresses) {
      self.srflxAddresses = addresses.mappedAddress
      self.relayAddress = addresses.relayedAddress
      debug('srflx address = ' + self.srflxAddresses.address + ':' + self.srflxAddresses.port)
      debug('relay address = ' + self.relayAddress.address + ':' + self.relayAddress.port)
      return self.socket.refreshP(lifetime)
    })
    .then(function (duration) {
      debug('lifetime = ' + duration)
      self.enabled = true
      self._startRefreshLoop(duration * 1000)
      debug('activation finished')
      self._emitReady(self.srflxAddresses, self.relayAddress)
      if (onSuccess) {
        onSuccess()
      }
    })
    .catch(function (error) {
      debug('activation failed: ' + error)
      if (onFailure) {
        onFailure(error)
      }
    })
}

// TODO: disable without closing socket -- for instance to handle reconnection attempts
UDPTurnTransport.prototype.disable = function (onSuccess, onFailure) {
  debug('disable')
  if (!this.enabled) {
    debug('socket is already disabled, ignoring')
  }
  var self = this
  this.turnSocket.close(
    function () { // on success
      debug('closed')
      self.enabled = false
      self._stopRefreshLoop()
      // TODO: emit disabled -- see APs
      if (onSuccess) {
        onSuccess()
      }
    },
    function (error) {
      debug('closing failure: ' + error)
      if (onFailure) {
        onFailure(error)
      }
    }
  )
}

UDPTurnTransport.prototype.isDisabled = function () {
  debug('is disabled = ' + !this.enabled)
  return !this.enabled
}

/** reflesh loop */

UDPTurnTransport.prototype._startRefreshLoop = function (duration) {
  var self = this
  this.refreshTimer = setInterval(function () {
    self.socket.refreshP(
      duration,
      function () {}, // on success
      function (error) { // on error
        debug('failure while sending TURN refresh message: ' + error)
        self._stopRefreshLoop()
      }
    )
  }, duration - 5000) // include a safety margin
}

UDPTurnTransport.prototype._stopRefreshLoop = function () {
  clearInterval(this.refreshTimer)
}

/** connection stream */

var UDPConnectionStream = function (opts) {
  debug('initialize connection stream')
  expect(opts).to.not.be.undefined
  expect(opts.channel).to.not.be.undefined
  opts.objectMode = false
  opts.decodeStrings = true
  Duplex.call(this, opts)
  extend(this, opts)
}

UDPConnectionStream.prototype._read = function (size) {
  debug('_read')
}

UDPConnectionStream.prototype._write = function (chunk, encoding, done) {
  this.turnSocket.sendChannelData(
    this.channel,
    chunk,
    function () { // on success
      done()
    },
    function (error) { // on error
      done(error)
    }
  )
}

inherits(UDPConnectionStream, Duplex)
