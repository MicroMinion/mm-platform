exports.getLocalIpAddress = getLocalIpAddress
exports.getLocalIpAddressP = getLocalIpAddressP
exports.getPublicIpAddress = getPublicIpAddress
exports.getPublicIpAddressP = getPublicIpAddressP

var debug = require('debug')
var debugLog = debug('flunky-platform:nat:ip-addresses')
var errorLog = debug('flunky-platform:nat:ip-addresses:error')
var publicIp = require('public-ip')
var net = require('net')
var Q = require('q')

function getLocalIpAddress (onSuccess, onFailure) {
  var socket = net.createConnection(80, 'www.google.com')
  socket.on('connect', function () {
    onSuccess(socket.address().address)
    socket.end()
  })
  socket.on('error', function (error) {
    onFailure(error)
  })
}

function getLocalIpAddressP () {
  var deferred = Q.defer()
  getLocalIpAddress(
    function (address) {
      debugLog('found private active IP network address ' + address)
      deferred.resolve(address)
    },
    function (error) {
      errorLog('could not find private active IP network address.' + error)
      deferred.reject(error)
    }
  )
  return deferred.promise
}

// returns node's public IP address -- i.e. address visible beyond the latest GW
function getPublicIpAddressP () {
  debugLog('get public IP address request')
  var deferred = Q.defer()
  publicIp(function (error, ip) {
    if (error) {
      errorLog('could not determine public IP address. ' + error)
      deferred.reject(error)
    } else {
      debugLog('retrieved public IP address ' + ip)
      deferred.resolve(ip)
    }
  })
  return deferred.promise
}

function getPublicIpAddress (onSuccess, onFailure) {
  getPublicIpAddressP()
    .then(function (address) {
      return onSuccess(address)
    })
    .catch(function (error) {
      return onFailure(error)
    })
}
