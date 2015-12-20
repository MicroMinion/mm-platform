module.exports = {
  Devices: require('./devices.js'),
  Profile: require('./profile.js'),
  Contacts: require('./contacts.js'),
  DirectoryClient: require('./directory/index.js').DirectoryClient,
  DirectoryServer: require('./directory/index.js').DirectoryServer,
  Events: require('./events.js'),
  ServiceManager: require('./service-manager.js'),
  Kademlia: require('./kademlia.js')
}
