# Flunky platform

Flunky platform is a secure messaging layer that allows applications to establish end-to-end connectivity between two nodes using a variety of underlying transport mechanisms

## Quick start

``` js
var FlunkyPlatform = require('flunky-platform')

//Create FlunkyPlatform instance
var platform = new FlunkyPlatform({
  identity: new Keypair() //TODO
  storage: //TODO: kad-fs compatible storage interface (make optional?)
  directory: //TODO: directory interface to lookup connectionInfo
})

platform.on('message', function(message) {
  console.log(message.topic)
  console.log(message.sender)
  console.log(message.scope)
  console.log(message.protocol)
  console.log(message.payload)
})

platform.send({
  destination: <publicKey>
  topic: 'test'
  protocol: 'ms',
  payload: 'test'
})
```

## Design
