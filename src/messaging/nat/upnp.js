exports.getPublicGWAddressP = getPublicGWAddressP
exports.getPublicGWAddress = getPublicGWAddress
exports.mapPrivateToPublicPortP = mapPrivateToPublicPortP
exports.unmapPrivateToPublicPortP = unmapPrivateToPublicPortP
exports.getPortMappingsP = getPortMappingsP
exports.getPortMappings = getPortMappings
exports.printPortMappings = printPortMappings

var debug = require('debug')
var debugLog = debug('flunky-platform:nat:upnp')
var errorLog = debug('flunky-platform:nat:upnp:error')
var ipAddresses = require('./ip-addresses')
var merge = require('merge')
var natUPnP = require('nat-upnp')
var Q = require('q')

var pjson = require('../../../package.json')
var defaultDescription = pjson.name + ' v' + pjson.version

var defaultOpts = {}
defaultOpts.public = {}
defaultOpts.private = {}
defaultOpts.ttl = 0
defaultOpts.protocol = 'UDP'
defaultOpts.description = defaultDescription

// returns public IP address of the GW, which is not necessarily your overall public IP address (for instance when GWs are chained)
function getPublicGWAddressP () {
  var deferred = Q.defer()
  getPublicGWAddress(
    function (address) { // on success
      deferred.resolve(address)
    },
    function (error) { // on failure
      deferred.reject(error)
    }
  )
  return deferred.promise
}

function getPublicGWAddress (onSuccess, onFailure) {
  debugLog('get public GW address request')
  var client = natUPnP.createClient()
  client.externalIp(function (error, ip) {
    client.close()
    if (error) {
      errorLog('could not determine public GW address. ' + error)
      onFailure(error)
    } else {
      debugLog('retrieved public GW address ' + ip)
      onSuccess(ip)
    }
  })
}

function mapPrivateToPublicPortP (args) {
  debugLog('port mapping request. args = ' + JSON.stringify(args))
  var deferred = Q.defer()

  function executeMapOperation (pmargs) {
    debugLog('executing pmapping request with args ' + JSON.stringify(pmargs))
    var client = natUPnP.createClient()
    client.portMapping(pmargs, function (error) {
      client.close()
      if (error) {
        errorLog('could not map local port ' + args.private.port + ' to public port ' + args.public.port + '. ' + error)
        deferred.reject(error)
      } else {
        deferred.resolve(pmargs)
      }
    })
  }

  if (!args.public.port) {
    var errorMsg = 'public port is undefined'
    errorLog(errorMsg)
    deferred.reject(new Error(errorMsg))
  } else {
    var pmargs = merge(defaultOpts, args)
    pmargs.private.port = pmargs.private.port || pmargs.public.port
    pmargs.public.host = pmargs.public.host || '*'
    if (!pmargs.private.host) {
      ipAddresses.getLocalIpAddress(function (error, address) {
        if (error) {
          errorLog('could not detect local ip address.' + error)
          deferred.reject(error)
        } else {
          pmargs.private.host = address
          executeMapOperation(pmargs)
        }
      })
    } else {
      pmargs.private.host = args.private.host
      executeMapOperation(pmargs)
    }
  }

  return deferred.promise
}

// function mapPrivateToPublicPortP (args) {
//   debugLog('port mapping request. args = ' + JSON.stringify(args))
//   var deferred = Q.defer()
//
//   function executeMapOperation (pmargs) {
//     debugLog('executing pmapping request with args ' + JSON.stringify(pmargs))
//     var client = natUPnP.createClient()
//     client.portMapping(pmargs, function (error) {
//       client.close()
//       if (error) {
//         errorLog('could not map local port ' + args.private.port + ' to public port ' + args.public.port + '. ' + error)
//         deferred.reject(error)
//       } else {
//         deferred.resolve(pmargs)
//       }
//     })
//   }
//
//   if (!args.public.port) {
//     var errorMsg = 'public port is undefined'
//     errorLog(errorMsg)
//     deferred.reject(new Error(errorMsg))
//   } else {
//     var pmargs = merge(defaultOpts, args)
//     pmargs.private.port = pmargs.private.port || pmargs.public.port
//     pmargs.public.host = pmargs.public.host || '*'
//     if (!pmargs.private.host) {
//       ipAddresses.getLocalIpAddress(function (error, address) {
//         if (error) {
//           errorLog('could not detect local ip address.' + error)
//           deferred.reject(error)
//         } else {
//           pmargs.private.host = address
//           executeMapOperation(pmargs)
//         }
//       })
//     } else {
//       pmargs.private.host = args.private.host
//       executeMapOperation(pmargs)
//     }
//   }
//
//   return deferred.promise
// }

function unmapPrivateToPublicPortP (args) {
  debugLog('port un-mapping request. args = ' + JSON.stringify(args))
  var deferred = Q.defer()

  if (!args.public.port) {
    var errorMsg = 'public port is undefined'
    errorLog(errorMsg)
    deferred.reject(new Error(errorMsg))
  } else {
    var client = natUPnP.createClient()
    client.portUnmapping(args, function (error) {
      client.close()
      if (error) {
        errorLog('could not unmap public port ' + args.public.port + '. ' + error)
        deferred.reject(error)
      } else {
        deferred.resolve()
      }
    })
  }

  return deferred.promise
}

// return all current port mappings
function getPortMappingsP () {
  var deferred = Q.defer()
  getPortMappings(
    function (mappings) { // on success
      deferred.resolve(address)
    },
    function (error) { // on failure
      deferred.reject(error)
    }
  )
  return deferred.promise
}

function getPortMappings (onSuccess, onFailure) {
  debugLog('get port mappings')
  var client = natUPnP.createClient()
  client.getMappings(function (error, mappings) {
    client.close()
    if (error) {
      errorLog('could not retrieve port mappings. ' + error)
      onFailure(error)
    } else {
      debugLog('retrieving port mappings ' + JSON.stringify(mappings))
      onSuccess(mappings)
    }
  })
}

function printPortMappings () {
  getPortMappingsP()
    .then(function (mappings) {
      console.log(mappings)
    })
}
