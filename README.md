# Flunky platform

Flunky platform is a secure messaging layer that allows applications to establish end-to-end connectivity between two nodes using a variety of underlying transport mechanisms

## Quick start

``` js
var FlunkyPlatform = require('flunky-platform')
var kadfs = require('kad-fs')
var path = require('path')

//Create FlunkyPlatform instance
var platform = new FlunkyPlatform({
  storage: kadfs(path.join('./data', 'platform'))
})

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

## Design
