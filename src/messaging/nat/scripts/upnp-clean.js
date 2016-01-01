var argv = require('minimist')(process.argv.slice(2))
var upnp = require('../upnp')
var Q = require('q')

if (!argv.d) {
  console.log('Please specify nat description regex using -d')
  process.exit()
}

var regex = argv.d

upnp.getPortMappingsP()
  .then(function (portMappings) {
    var promises = portMappings.map(function (portMapping) {
      if (portMapping.description.match(regex)) {
        return upnp.unmapPrivateToPublicPortP(portMapping)
      }
    })
    return Q.all(promises)
  })
  .catch(function (error) {
    console.error('Failed to remove all nat portmappings matching description ' + regex + '. ' + error)
  })
  .done(function () {
    console.log('Finished removing all nat portmappings matching description ' + regex)
  })
