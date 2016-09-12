'use strict'

var nacl = require('tweetnacl')
var crypto = require('crypto')
nacl.util = require('tweetnacl-util')

nacl.setPRNG(function (x, n) {
  var i
  var v = crypto.randomBytes(n)
  for (i = 0; i < n; i++) x[i] = v[i]
  for (i = 0; i < v.length; i++) v[i] = 0
})

var isEqual = function (a, b) {
  // debug('isEqual')
  if (a.length !== b.length) {
    return false
  }
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

var decrypt = function (source, prefix, from, to) {
  // debug('decrypt')
  try {
    prefix = nacl.util.decodeUTF8(prefix)
    var nonceLength = 24 - prefix.length
    var shortNonce = source.subarray(0, nonceLength)
    var nonce = new Uint8Array(24)
    nonce.set(prefix)
    nonce.set(shortNonce, prefix.length)
    var result = nacl.box.open(source.subarray(nonceLength), nonce, from, to)
  } catch (err) {
    return
  }
  return result
}

var encryptSymmetric = function (data, prefix, key) {
  prefix = nacl.util.decodeUTF8(prefix)
  var nonceLength = 24 - prefix.length
  var randomNonce = new Uint8Array(nacl.randomBytes(nacl.secretbox.nonceLength))
  var shortNonce = randomNonce.subarray(0, nonceLength)
  var nonce = new Uint8Array(24)
  nonce.set(prefix)
  nonce.set(shortNonce, prefix.length)
  var box = nacl.secretbox(data, nonce, key)
  var result = new Uint8Array(nonceLength + box.length)
  result.set(shortNonce)
  result.set(box, nonceLength)
  return result
}

var encrypt = function (data, nonce, prefixLength, from, to) {
  // debug('encrypt')
  var box = nacl.box(data, nonce, to, from)
  var result = new Uint8Array(24 - prefixLength + box.length)
  var shortNonce = nonce.subarray(prefixLength)
  result.set(shortNonce)
  result.set(box, 24 - prefixLength)
  return result
}

var decryptShared = function (source, prefix, key) {
  try {
    prefix = nacl.util.decodeUTF8(prefix)
    var nonceLength = 24 - prefix.length
    var shortNonce = source.subarray(0, nonceLength)
    var nonce = new Uint8Array(24)
    nonce.set(prefix)
    nonce.set(shortNonce, prefix.length)
    var result = nacl.box.open.after(source.subarray(nonceLength), nonce, key)
  } catch (err) {
    return
  }
  return result
}

var encryptShared = function (data, nonce, prefixLength, key) {
  var box = nacl.box.after(data, nonce, key)
  var result = new Uint8Array(24 - prefixLength + box.length)
  var shortNonce = nonce.subarray(prefixLength)
  result.set(shortNonce)
  result.set(box, 24 - prefixLength)
  return result
}

var decryptSymmetric = function (data, prefix, key) {
  try {
    prefix = nacl.util.decodeUTF8(prefix)
    var nonceLength = 24 - prefix.length
    var shortNonce = data.subarray(0, nonceLength)
    var nonce = new Uint8Array(24)
    nonce.set(prefix)
    nonce.set(shortNonce, prefix.length)
    var result = nacl.secretbox.open(data.subarray(nonceLength), nonce, key)
  } catch (err) {
    return
  }
  return result
}

var safeIntegerAddition = function (original, addition) {
  if (Number.MAX_SAFE_INTEGER - addition < original) {
    return Number.MAX_SAFE_INTEGER
  } else {
    return original + addition
  }
}

var safeIntegerMultiplication = function (original, multiplier) {
  if (Number.MAX_SAFE_INTEGER / 4 < original) {
    return Number.MAX_SAFE_INTEGER
  } else {
    return original * multiplier
  }
}

var randommod = function (n) {
  var result = 0
  if (n <= 1) {
    return 0
  }
  var randomBytes = nacl.randomBytes(32)
  for (var j = 0; j < 32; ++j) {
    result = safeIntegerAddition(safeIntegerMultiplication(result, 256), Number(randomBytes[j]))
    result = result % n
  }
  return result
}

var createRandomNonce = function (prefix) {
  var nonce = new Uint8Array(24)
  nonce.set(nacl.util.decodeUTF8(prefix))
  nonce.set(nacl.randomBytes(16), 8)
  return nonce
}

var codifyServerName = function (serverName) {
  if (serverName.length !== 256) {
    var buffer = new Buffer(256)
    buffer.fill(0)
    buffer.write('0A', 'hex')
    buffer.write(serverName, 1)
    return new Uint8Array(buffer)
  } else {
    return serverName
  }
}

module.exports = {
  isEqual: isEqual,
  encrypt: encrypt,
  decrypt: decrypt,
  encryptSymmetric: encryptSymmetric,
  decryptSymmetric: decryptSymmetric,
  encryptShared: encryptShared,
  decryptShared: decryptShared,
  HELLO_MSG: nacl.util.decodeUTF8('QvnQ5XlH'),
  COOKIE_MSG: nacl.util.decodeUTF8('RL3aNMXK'),
  INITIATE_MSG: nacl.util.decodeUTF8('QvnQ5XlI'),
  SERVER_MSG: nacl.util.decodeUTF8('RL3aNMXM'),
  CLIENT_MSG: nacl.util.decodeUTF8('QvnQ5XlM'),
  randommod: randommod,
  safeIntegerAddition: safeIntegerAddition,
  safeIntegerMultiplication: safeIntegerMultiplication,
  createRandomNonce: createRandomNonce,
  codifyServerName: codifyServerName
}
