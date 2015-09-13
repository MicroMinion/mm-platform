var netstring = require('netstring')

var a = '124567971'
var b = 'abcdefghk'

var aBuffer = netstring.nsWrite(a)
var bBuffer = netstring.nsWrite(b)

console.log(netstring.nsLength(aBuffer))
console.log(netstring.nsLength(bBuffer))

var buffer = Buffer.concat([netstring.nsWrite(a), netstring.nsWrite(b)])

console.log(netstring.nsPayload(buffer).toString())
