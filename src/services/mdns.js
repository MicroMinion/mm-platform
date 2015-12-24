var mdns = require('mdns-js')
var _ = require('lodash')

var isFlunky = function (data, protocol) {
  return _.any(data.type, function (typeEntry) {
    return typeEntry.name === 'flunky' && typeEntry.protocol === protocol
  })
}

var mDNSService = function (options) {
  var service = this
  this.hosts = {}
  this.messaging = options.messaging
  // mdns.excludeInterface('0.0.0.0')
  this.browser = mdns.createBrowser()
  this.browser.on('ready', function () {
    service.browser.discover()
  })
  this.browser.on('update', function (data) {
    if (isFlunky(data, 'tcp') || isFlunky(data, 'udp')) {
      var port = data.port
      var addresses = data.addresses
      var publicKey = data.host.split('.')[0]
      var connectionInfo = {
        publicKey: publicKey
      }
      if (isFlunky(data, 'tcp')) {
        connectionInfo['tcp'] = {
          addresses: addresses,
          port: port
        }
      }
      if (isFlunky(data, 'udp')) {
        connectionInfo['udp'] = {
          addresses: addresses,
          port: port
        }
      }
      service.hosts[publicKey] = connectionInfo
      service.messaging.send('messaging.connectionInfo', 'local', connectionInfo)
    }
  })
  this.messaging.on('self.messaging.myConnectionInfo', this._update.bind(this))
  this.messaging.on('self.messaging.requestConnectionInfo', this._request.bind(this))
  this.messaging.on('self.messaging.requestAllConnectionInfo', this._requestAll.bind(this))
}

mDNSService.prototype._requestAll = function (topic, publicKey, data) {
  _.forEach(this.hosts, function (connectionInfo, publicKey) {
    this.messaging.send('messaging.connectionInfo', 'local', connectionInfo)
  }, this)
}

mDNSService.prototype._update = function (topic, publicKey, data) {
  this.connectionInfo = data
  if (_.has(this.connectionInfo, 'tcp')) {
    if (this.serviceTcp) {
      this.serviceTcp.stop()
    }
    this.serviceTcp = mdns.createAdvertisement(mdns.tcp('flunky'), this.connectionInfo.tcp.port, {
      name: data.publicKey
    })
    this.serviceTcp.start()
  }
  if (_.has(this.connectionInfo, 'udp')) {
    if (this.serviceUdp) {
      this.serviceUdp.stop()
    }
    this.serviceUdp = mdns.createAdvertisement(mdns.udp('flunky'), this.connectionInfo.udp.port, {
      name: data.publicKey
    })
    this.serviceUdp.start()
  }
}

mDNSService.prototype._request = function (topic, publicKey, data) {
  if (_.has(this.hosts, data)) {
    this.messaging.send('messaging.connectionInfo', 'local', this.hosts[data])
  }
}

module.exports = mDNSService
