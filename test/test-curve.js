var net = require('net')
var CurveCPStream = require('./crypto-curvecp0.js')
var nacl = require('tweetnacl')

var keypair = nacl.box.keyPair()

var serverPublicKey = keypair.publicKey
var serverPrivateKey = keypair.secretKey

keypair = nacl.box.keyPair()

var clientPublicKey = keypair.publicKey
var clientPrivateKey = keypair.secretKey

var server = net.createServer(function (connection) {
  var opts = {
    stream: connection,
    serverPublicKey: serverPublicKey,
    serverPrivateKey: serverPrivateKey,
    is_server: true
  }
  var curveCPStream = new CurveCPStream(opts)
  curveCPStream.on('data', function (chunk) {
    console.log(chunk.toString())
    curveCPStream.write(chunk, function () {
      console.log('done')
    })
  })
})
server.listen(58788)

var connection = net.connect(58788)

var opts = {
  stream: connection,
  clientPublicKey: clientPublicKey,
  clientPrivateKey: clientPrivateKey,
  serverPublicKey: serverPublicKey,
  is_server: false
}

var curveCPStream = new CurveCPStream(opts)

curveCPStream.on('connect', function () {
  curveCPStream.write('hello')
})
curveCPStream.once('data', function (data) {
  console.log(data.toString())
  curveCPStream.write('hello 2')
})
curveCPStream.connect()
