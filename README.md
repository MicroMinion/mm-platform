# MicroMinion platform

MicroMinion platform is a secure messaging layer that allows applications to establish end-to-end connectivity between two nodes using a variety of underlying transport mechanisms.

At the same time, it also acts as a local pub-sub system.

## Quick start

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

## Installation

```bash
npm install mm-platform
```

## Messaging API's

The MicroMinion platform sends/receives messages locally and with remote peers

A message contains the following fields:

## Supported messaging API's

## Local messages and scoping

## Built-in messages

## Low-level messaging support

## Building services on top of platform

## Customizing platform

### Initialization options

### Adding new messaging API's
