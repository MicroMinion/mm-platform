# MicroMinion platform

MicroMinion platform is a secure messaging layer that allows applications to establish end-to-end connectivity between two nodes using a variety of underlying transport mechanisms.

It is also a local pub/sub broker

## Installation

```bash
npm install mm-platform
```

## Messaging API's

The MicroMinion platform sends/receives messages locally and with remote peers

A message is a javascript dictionary with the following fields:
* **sender**: public key of sender node (string, base64 encoded)
* **protocol**: string that determines protocol of message
* **topic**: string that determines topic of message (format depends on protocol)
* **scope**: string that can either have the value public, friends or self. This is to indicate the trust level of the sender (no trust level, in your friends circle or one of your own devices
* **payload**: format depends on protocol

## Supported messaging API's

Out of the box, the platform supports 2 messaging API's (others can be added, see customization section).
* **messaging (protocol code 'ms')**: payload is a JSON string. Topic is name-spaced message type (separated by .)
* **torrenting (protocol code 'bt')**: payload is a bittorrent message. Topic is identification hash of torrent file

```js
//Example code to use messaging layer ('ms')

var MicroMinionPlatform = require('mm-platform')

//Create MicroMinionPlatform instance
var platform = new MicroMinionPlatform()

//Subscribe to messages that are send locally or from one of our own devices with topic 'test.testMessage'
platform.messaging.on('self.test.testMessage', function(topic, sender, messageDictionary) {
  console.log(topic)
  console.log(sender)
  console.log(messageDictionary)
})

//Send a message to the local bus (if you want to send a message to a remote peer, the peer ID needs to be put as argument instead of 'local'
//The last dictionary is an options object (not required) which signals that this message is a realtime message and expires after 15 seconds
platform.messaging.send('test.testMessage', 'local', {test: 'Test String'}, {realtime: true, expireAfter: 15000})
```

## Local messages and scoping

Scoping is the mechanism used to prefix a received message with the string public, friends or self to indicate the trust level of the message.

Local messages are always scoped as 'self'

## Remote peer identification

The platform relies heavily on [Daniel Bernstein's](http://cr.yp.to) [nacl crypto library](https://nacl.cr.yp.to/). It uses ecnryption (boxId) and signature (signId) keypairs and the [CurveCP](http://www.curvecp.org) protocol for all communications.

Remote peers are identified by their signID, encoded in base64 format

## Built-in messages

Out of the box, the mm-platform supports local messages but needs a lookup mechanism to map peer id's (public keys) to connection information that can be used by the underlying [1tp](https://github.com/MicroMinion/1tp) library to establish connections.

When the mm-platform needs to lookup connection information for a peer ID, it uses it's own messaging API to do so.

### Data structures

#### nodeInfo: Javascript object with node information

* **boxId**: base64 encoded public encryption key used by [nacl](https://github.com/dchest/tweetnacl-js#public-key-authenticated-encryption-box)
* **signId**: base64 encoded public signature key used by [nacl](https://github.com/dchest/tweetnacl-js#signatures)
* **connectionInfo**: javascript dictionary with [1tp](https://github.com/MicroMinion/1tp) connection information

### Published messages

#### self.transports.myNodeInfo

Periodically (every 5 minutes) publish our own nodeInfo which is a dictionary with 3 keys: boxId: public key used for encryption, signId: public key used for signing and connectionInfo: [1tp](https://github.com/MicroMinion/1tp) connection information dictionary

```js
var MicroMinionPlatform = require('mm-platform')

var platform = new MicroMinionPlatform()

platform.messaging.on('self.transports.myNodeInfo', function(topic, sender, nodeInfo) {
  console.log(topic) // 'self.transports.myNodeInfo'
  console.log(sender) // 'local'
  console.log(nodeInfo) // {boxId: <boxId>, signId: <signId>, connectionInfo: <1tp connectionInfo>}
})
```

#### self.transports.requestNodeInfo

requests outside directory service to lookup nodeInfo for a publicKey (signId is used as lookup key)

```js
var MicroMinionPlatform = require('mm-platform')

var platform = new MicroMinionPlatform()

platform.messaging.on('self.transports.requestNodeInfo', function(topic, sender, nodeId) {
  console.log(topic) // 'self.transports.requestNodeInfo'
  console.log(sender) // 'local'
  console.log(nodeInfo) // signId of other node (base64 encoded string)
})
```

#### self.directory.get

requests outside directory service to lookup other key-value pair. Within the platform this is used to map boxId's (encryption keys) to signId's (signature keys)

```js
var MicroMinionPlatform = require('mm-platform')

var platform = new MicroMinionPlatform()

platform.messaging.on('self.directory.get', function(topic, sender, key) {
  console.log(topic) // 'self.directory.get'
  console.log(sender) // 'local'
  console.log(key) // boxId of other node (base34 encoded string)
})
```

### Subscribed messages

#### self.transports.nodeInfo

Payload is dictionary containing signId, boxId and connectionInfo for a node

```js
var MicroMinionPlatform = require('mm-platform')

var platform = new MicroMinionPlatform()

//This is our own nodeInfo.
//This message format is used to publish remote nodeInfo (e.g., obtained through mDNS or DHT)
//It allows the platform to establish a connection with the remote node
var nodeInfo = {
  boxId: platform.directory.identity.getBoxId()
  signId: platform.directory.identity.getSignId()
  connectionInfo: platform.directory._connectionInfo
}

platform.messaging.send('transports.nodeInfo', 'local', nodeInfo)
```

#### self.directory.getReply

Payload is dictionary containing key and value pair (used by platform to map boxId to signId)

```js
var MicroMinionPlatform = require('mm-platform')

var platform = new MicroMinionPlatform()

platform.messaging.on('self.directory.get', function(topic, sender, key) {
  //Lookup key in directory
  //When send by platform, the key will be a boxId
  var signID = "NeedToImplement"
  platform.messaging.send('directory.getReply', 'local', {key: key, value: signId})
})
```

## Low-level messaging support

The messaging API's ('ms' for JSON messages and 'bt' for bittorrent messages) are just syntactic sugar for core messaging API's in the platform.

``` js
var MicroMinionPlatform = require('mm-platform')

//Create MicroMinionPlatform instance
var platform = new MicroMinionPlatform()

//Attach message listener
platform.on('message', function(message) {
  console.log(message.topic)
  console.log(message.sender)
  console.log(message.scope)
  console.log(message.protocol)
  console.log(message.payload)
})

//Sending a message. Destination can be any publicKey to contact other hosts
platform.send({
  destination: 'local'
  topic: 'test'
  protocol: 'ms',
  payload: 'test'
})
```

## Building services on top of platform

The core use case for which the platform was developed is to built a set of services on top of it that use the local and remote messaging functionality.

An example usage of the platform can be found in the [mm-dht](https://github.com/MicroMinion/mm-dht) module where we use the platform to build a DHT that also supports local discovery of peers through mDNS.

```js
var Platform = require('mm-platform')
var MulticastDNS = require('mm-services-mdns')
var Kademlia = require('mm-services-kademlia')
var kadfs = require('kad-fs')
var path = require('path')

var storageDir = './data'

var platform = new Platform({
  storage: kadfs(path.join(storageDir, 'platform'))
})
var mdns = new MulticastDNS({
  platform: platform,
})
var dht = new Kademlia({
  platform: platform,
  storage: kadfs(path.join(storageDir, 'dht'))
})
```

Each of the services (in this case [MulticastDNS](https://github.com/MicroMinion/mm-services-mdns) and [Kademlia](https://github.com/MicroMinion/mm-services-kademlia)) can use the platform object to subscribe to messages and publish messages as described above.

## Events

The platform will emit the following events:
* **ready**: when identity is loaded from persistent storage (or created on first time use)
* **connection**: when new connection is established (incoming or outgoing). Argument is signId of remote node
* **disconnected**: when connection is destroyed (incoming or outgoing). Argument is signId of remote node
* **message**: when new message is received

## Customizing platform

### Initialization options

The platform supports the following constructor options:
* **storage**: alternative storage mechanism. This needs to be a kadfs compatible interface
* **friends, devices**: 'Circle' definition of trusted nodes used for scoping received messages. The default implementation will namespace all received messages as public (except for local messages)
* **identity**: alternative identity object. The default identity object uses 2 public/private key pairs: for signing (signId) and for encryption (boxId). When our own identity is loaded from persistent storage (or created on first time use), the platform will emit a 'ready' event.
* **directory**: alternative directory object to lookup nodeInfo and publish our own nodeInfo
* **connectionInfo**: hard-coded connectionInfo for [1tp](https://github.com/MicroMinion/1tp)

### Adding new messaging API's

New Messaging API's can be added on top of the standard torrenting and messaging API's. Just initialize a new API object (api.js) and add it as attribute to platform.

API objects can also be chained. For example, the messaging API object uses an offline buffer to make sure that no messages are being lost when offline.
