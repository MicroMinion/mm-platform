var MessageHandler = require('./message-handler.js')
var net = require('net')

var server = net.createServer(function (connection) {
  connection.is_server = true
  var handlerServer = new MessageHandler(connection)
  handlerServer.label = 'server'
  handlerServer.on('data', function (chunk) {
    console.log('data received')
    console.log(chunk.toString())
  })
})

server.listen(57333)

var connection = net.connect(57333)

connection.is_server = false

var handler = new MessageHandler(connection)
handler.label = 'client'

setTimeout(function () {
  handler.write('TEST MESSAGE')
}, 1000)
