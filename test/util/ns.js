var netstring = require('../../src/util/ns.js')

var a = '124567971'
var b = 'abcdefghk'

var aBuffer = netstring.nsWrite(a)
var bBuffer = netstring.nsWrite(b)

// console.log(netstring.nsLength(aBuffer))
// console.log(netstring.nsLength(bBuffer))

var buffer = Buffer.concat([netstring.nsWrite(a), netstring.nsWrite(b)])
console.log(buffer.length)
console.log(netstring.nsLength(buffer))
console.log(netstring.nsPayload(buffer).toString())
// console.log(netstring.nsWrite(a).length)
// console.log(a.length)
// console.log(netstring.nsPayload(buffer).toString())
