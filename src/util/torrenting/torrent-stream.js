var hat = require('hat')
var PeerWireSwarm = require('./peer-wire-swarm.js')
var bncode = require('bncode')
var crypto = require('crypto')
var bitfield = require('bitfield')
var parseTorrent = require('parse-torrent')
var mkdirp = require('mkdirp')
var events = require('events')
var path = require('path')
var fs = require('fs')
var eos = require('end-of-stream')
var piece = require('torrent-piece')
var FSChunkStore = require('fs-chunk-store')
var ImmediateChunkStore = require('immediate-chunk-store')
var inherits = require('inherits')
var debug = require('debug')('flunky-platform:util:torrenting:TorrentStream')

var exchangeMetadata = require('./exchange-metadata.js')
var fileStream = require('./file-stream.js')

var MAX_REQUESTS = 5
var CHOKE_TIMEOUT = 5000
var REQUEST_TIMEOUT = 30000
var SPEED_THRESHOLD = 3 * piece.BLOCK_LENGTH

var BAD_PIECE_STRIKES_MAX = 3
var BAD_PIECE_STRIKES_DURATION = 120000 // 2 minutes

var RECHOKE_INTERVAL = 10000
var RECHOKE_OPTIMISTIC_DURATION = 2

var noop = function () {}

var sha1 = function (data) {
  return crypto.createHash('sha1').update(data).digest('hex')
}

var thruthy = function () {
  return true
}

var toNumber = function (val) {
  return val === true ? 1 : (val || 0)
}

var TorrentStream = function (infoHash, storagePath, torrenting) {
  debug('initialize')
  events.EventEmitter.call(this)

  this.metadata = null
  this.infoHash = infoHash
  this.id = '-TS0008-' + hat(48)

  this.destroyed = false

  this.path = storagePath
  this.torrentPath = storagePath + '.torrent'

  this._critical = []
  this._flood = 0
  this._pulse = Number.MAX_SAFE_INTEGER // Do not pulse

  this.rechokeSlots = 10
  this.rechokeOptimistic = null
  this.rechokeOptimisticTime = 0
  this.rechokeIntervalId

  this.timeout = REQUEST_TIMEOUT
  this._verify = true
  this.files = []
  this.selection = []
  this.torrent = null
  this.bitfield = null
  this.amInterested = false
  this.store = null
  this.swarm = new PeerWireSwarm(this.infoHash, this.id, torrenting)
  this.wires = this.swarm.wires
  this._initializeSwarm()
}

inherits(TorrentStream, events.EventEmitter)

TorrentStream.prototype._initializeSwarm = function () {
  debug('_initializeSwarm')
  var torrentStream = this
  this.swarm.on('wire', function (wire) {
    debug('onwire')
    torrentStream.emit('wire', wire)
    torrentStream.exchangeMetadata()(wire)
    if (torrentStream.bitfield) wire.bitfield(torrentStream.bitfield)
  })
  this.swarm.pause()
  fs.readFile(this.torrentPath, function (_, buf) {
    if (torrentStream.destroyed) return
    torrentStream.swarm.resume()

    // We know only infoHash here, not full infoDictionary.
    if (!buf) return

    var torrent = parseTorrent(buf)

    // Bad cache file - fetch it again
    if (torrent.infoHash !== torrentStream.infoHash) return

    torrentStream.metadata = torrent.infoBuffer
    torrentStream.torrent = torrent
    torrentStream.ontorrent()
  })
}

TorrentStream.prototype.ontorrent = function () {
  debug('ontorrent')
  var torrentStream = this
  var torrent = this.torrent
  var storage = this.storage || FSChunkStore
  this.store = ImmediateChunkStore(storage(torrent.pieceLength, {
    files: torrent.files.map(function (file) {
      return {
        path: path.join(torrentStream.path, file.path),
        length: file.length,
        offset: file.offset
      }
    })
  }))
  this.bitfield = bitfield(torrent.pieces.length)

  var pieceLength = torrent.pieceLength
  var pieceRemainder = (torrent.length % pieceLength) || pieceLength

  this.pieces = torrent.pieces.map(function (hash, i) {
    return piece(i === torrent.pieces.length - 1 ? pieceRemainder : pieceLength)
  })
  this.reservations = torrent.pieces.map(function () {
    return []
  })

  this.files = torrent.files.map(function (file) {
    file = Object.create(file)
    var offsetPiece = (file.offset / torrent.pieceLength) | 0
    var endPiece = ((file.offset + file.length - 1) / torrent.pieceLength) | 0

    file.deselect = function () {
      torrentStream.deselect(offsetPiece, endPiece, false)
    }

    file.select = function () {
      torrentStream.select(offsetPiece, endPiece, false)
    }

    file.createReadStream = function (opts) {
      var stream = fileStream(torrentStream, file, opts)

      var notify = stream.notify.bind(stream)
      torrentStream.select(stream.startPiece, stream.endPiece, true, notify)
      eos(stream, function () {
        torrentStream.deselect(stream.startPiece, stream.endPiece, true, notify)
      })
      return stream
    }

    return file
  })
  this.verify()
}

TorrentStream.prototype.oninterestchange = function () {
  debug('oninterestchange')
  var prev = this.amInterested
  this.amInterested = !!this.selection.length

  this.wires.forEach(function (wire) {
    if (this.amInterested) wire.interested()
    else wire.uninterested()
  })

  if (prev === this.amInterested) return
  if (this.amInterested) this.emit('interested')
  else this.emit('uninterested')
}

TorrentStream.prototype.gc = function () {
  debug('gc')
  for (var i = 0; i < this.selection.length; i++) {
    var s = this.selection[i]
    var oldOffset = s.offset

    while (!this.pieces[s.from + s.offset] && s.from + s.offset < s.to) s.offset++

    if (oldOffset !== s.offset) s.notify()
    if (s.to !== s.from + s.offset) continue
    if (this.pieces[s.from + s.offset]) continue

    this.selection.splice(i, 1)
    i-- // -1 to offset splice
    s.notify()
    this.oninterestchange()
  }

  if (!this.selection.length) this.emit('idle')
}

TorrentStream.prototype.onpiececomplete = function (index, buffer) {
  debug('onpiececomplete')
  if (!this.pieces[index]) return

  this.pieces[index] = null
  this.reservations[index] = null
  this.bitfield.set(index, true)

  for (var i = 0; i < this.wires.length; i++) this.wires[i].have(index)

  this.emit('verify', index)
  this.emit('download', index, buffer)

  this.store.put(index, buffer)
  this.gc()
}

TorrentStream.prototype.onhotswap = function (wire, index) {
  debug('onhotswap')
  var speed = wire.downloadSpeed()
  if (speed < piece.BLOCK_LENGTH) return
  if (!this.reservations[index] || !this.pieces[index]) return

  var r = this.reservations[index]
  var minSpeed = Infinity
  var min

  for (var i = 0; i < r.length; i++) {
    var other = r[i]
    if (!other || other === wire) continue

    var otherSpeed = other.downloadSpeed()
    if (otherSpeed >= SPEED_THRESHOLD) continue
    if (2 * otherSpeed > speed || otherSpeed > minSpeed) continue

    min = other
    minSpeed = otherSpeed
  }

  if (!min) return false

  for (i = 0; i < r.length; i++) {
    if (r[i] === min) r[i] = null
  }

  for (i = 0; i < min.requests.length; i++) {
    var req = min.requests[i]
    if (req.piece !== index) continue
    this.pieces[index].cancel((req.offset / piece.BLOCK_SIZE) | 0)
  }

  this.emit('hotswap', min, wire, index)
  return true
}

TorrentStream.prototype.onupdatetick = function () {
  debug('onupdatetick')
  process.nextTick(this.onupdate.bind(this))
}

TorrentStream.prototype.onrequest = function (wire, index, hotswap) {
  debug('onrequest')
  if (!this.pieces[index]) return false

  var p = this.pieces[index]
  var reservation = p.reserve()

  if (reservation === -1 && hotswap && this.onhotswap(wire, index)) {
    reservation = p.reserve()
  }
  if (reservation === -1) return false

  var r = this.reservations[index] || []
  var offset = p.chunkOffset(reservation)
  var size = p.chunkLength(reservation)

  var i = r.indexOf(null)
  if (i === -1) i = r.length
  r[i] = wire

  var torrentStream = this

  wire.request(index, offset, size, function (err, block) {
    if (r[i] === wire) r[i] = null

    if (p !== torrentStream.pieces[index]) {
      torrentStream.onupdatetick()
      return
    }
    if (err) {
      p.cancel(reservation)
      torrentStream.onupdatetick()
      return
    }

    if (!p.set(reservation, block, wire)) {
      torrentStream.onupdatetick()
      return
    }

    var sources = p.sources
    var buffer = p.flush()

    if (sha1(buffer) !== torrentStream.torrent.pieces[index]) {
      torrentStream.pieces[index] = piece(p.length)
      torrentStream.emit('invalid-piece', index, buffer)
      torrentStream.onupdatetick()

      sources.forEach(function (wire) {
        var now = Date.now()

        wire.badPieceStrikes = wire.badPieceStrikes.filter(function (strike) {
          return (now - strike) < BAD_PIECE_STRIKES_DURATION
        })

        wire.badPieceStrikes.push(now)

        if (wire.badPieceStrikes.length > BAD_PIECE_STRIKES_MAX) {
          torrentStream.block(wire.peerAddress)
        }
      })

      return
    }

    torrentStream.onpiececomplete(index, buffer)
    torrentStream.onupdatetick()
  })

  return true
}

TorrentStream.prototype.block = function (publicKey) {
  debug('block')
  this._blocked.push(publicKey)
  this.disconnect(publicKey)
  this.emit('blocking', publicKey)
}

TorrentStream.prototype.onvalidatewire = function (wire) {
  debug('onvalidatewire')
  if (wire.requests.length) return

  for (var i = this.selection.length - 1; i >= 0; i--) {
    var next = this.selection[i]
    for (var j = next.to; j >= next.from + next.offset; j--) {
      if (!wire.peerPieces[j]) continue
      if (this.onrequest(wire, j, false)) return
    }
  }
}

TorrentStream.prototype.speedRanker = function (wire) {
  debug('speedRanker')
  var torrentStream = this
  var speed = wire.downloadSpeed() || 1
  if (speed > SPEED_THRESHOLD) return thruthy

  var secs = MAX_REQUESTS * piece.BLOCK_LENGTH / speed
  var tries = 10
  var ptr = 0

  return function (index) {
    if (!tries || !torrentStream.pieces[index]) return true

    var missing = torrentStream.pieces[index].missing
    for (; ptr < torrentStream.wires.length; ptr++) {
      var other = torrentStream.wires[ptr]
      var otherSpeed = other.downloadSpeed()

      if (otherSpeed < SPEED_THRESHOLD) continue
      if (otherSpeed <= speed || !other.peerPieces[index]) continue
      if ((missing -= otherSpeed * secs) > 0) continue

      tries--
      return false
    }

    return true
  }
}

TorrentStream.prototype.shufflePriority = function (i) {
  debug('shufflePriority')
  var last = i
  for (var j = i; j < this.selection.length && this.selection[j].priority; j++) {
    last = j
  }
  var tmp = this.selection[i]
  this.selection[i] = this.selection[last]
  this.selection[last] = tmp
}

TorrentStream.prototype._select = function (wire, hotswap) {
  debug('select')
  if (wire.requests.length >= MAX_REQUESTS) return true

  // Pulse, or flood (default)
  if (this.swarm.downloaded > this._flood && this.swarm.downloadSpeed() > this._pulse) {
    return true
  }

  var rank = this.speedRanker(wire)

  for (var i = 0; i < this.selection.length; i++) {
    var next = this.selection[i]
    for (var j = next.from + next.offset; j <= next.to; j++) {
      if (!wire.peerPieces[j] || !rank(j)) continue
      while (wire.requests.length < MAX_REQUESTS && this.onrequest(wire, j, this._critical[j] || hotswap)) {}
      if (wire.requests.length < MAX_REQUESTS) continue
      if (next.priority) this.shufflePriority(i)
      return true
    }
  }

  return false
}

TorrentStream.prototype.onupdatewire = function (wire) {
  debug('onupdatewire')
  if (wire.peerChoking) return
  if (!wire.downloaded) return this.onvalidatewire(wire)
  this._select(wire, false) || this._select(wire, true)
}

TorrentStream.prototype.onupdate = function () {
  debug('onupdate')
  this.wires.forEach(this.onupdatewire.bind(this))
}

TorrentStream.prototype.onwire = function (wire) {
  debug('onwire')
  var torrentStream = this
  wire.setTimeout(this.timeout || REQUEST_TIMEOUT, function () {
    torrentStream.emit('timeout', wire)
    wire.destroy()
  })

  if (this.selection.length) wire.interested()

  var timeout = CHOKE_TIMEOUT
  var id

  var onchoketimeout = function () {
    if (this.swarm.queued > 2 * (this.swarm.size - this.swarm.wires.length) && wire.amInterested) {
      wire.destroy()
      return
    }
    id = setTimeout(onchoketimeout.bind(this), timeout)
  }

  wire.on('close', function () {
    debug('close event received on wire')
    clearTimeout(id)
  })

  wire.on('choke', function () {
    debug('choke event received on wire')
    clearTimeout(id)
    id = setTimeout(onchoketimeout.bind(torrentStream), timeout)
  })

  wire.on('unchoke', function () {
    debug('unchoke event received on wire')
    clearTimeout(id)
  })

  wire.on('request', function (index, offset, length, cb) {
    debug('request event received on wire')
    if (torrentStream.pieces[index]) return
    torrentStream.store.get(index, { offset: offset, length: length }, function (err, buffer) {
      if (err) return cb(err)
      torrentStream.emit('upload', index, offset, length)
      cb(null, buffer)
    })
  })

  wire.on('unchoke', this.onupdate.bind(this))
  wire.on('bitfield', this.onupdate.bind(this))
  wire.on('have', this.onupdate.bind(this))

  wire.isSeeder = false

  var i = 0
  var checkseeder = function () {
    if (wire.peerPieces.length !== this.torrent.pieces.length) return
    for (; i < this.torrent.pieces.length; ++i) {
      if (!wire.peerPieces[i]) return
    }
    wire.isSeeder = true
  }

  wire.on('bitfield', checkseeder.bind(this))
  wire.on('have', checkseeder.bind(this))
  checkseeder.bind(this)()

  wire.badPieceStrikes = []

  id = setTimeout(onchoketimeout.bind(this), timeout)
}

TorrentStream.prototype.rechokeSort = function (a, b) {
  debug('rechokeSort')
  // Prefer higher download speed
  if (a.downSpeed !== b.downSpeed) return a.downSpeed > b.downSpeed ? -1 : 1
  // Prefer higher upload speed
  if (a.upSpeed !== b.upSpeed) return a.upSpeed > b.upSpeed ? -1 : 1
  // Prefer unchoked
  if (a.wasChoked !== b.wasChoked) return a.wasChoked ? 1 : -1
  // Random order
  return a.salt - b.salt
}

TorrentStream.prototype.onrechoke = function () {
  debug('onrechoke')
  if (this.rechokeOptimisticTime > 0) --this.rechokeOptimisticTime
  else this.rechokeOptimistic = null

  var peers = []

  this.wires.forEach(function (wire) {
    if (wire.isSeeder) {
      if (!wire.amChoking) wire.choke()
    } else if (wire !== this.rechokeOptimistic) {
      peers.push({
        wire: wire,
        downSpeed: wire.downloadSpeed(),
        upSpeed: wire.uploadSpeed(),
        salt: Math.random(),
        interested: wire.peerInterested,
        wasChoked: wire.amChoking,
        isChoked: true
      })
    }
  })

  peers.sort(this.rechokeSort)

  var i = 0
  var unchokeInterested = 0
  for (; i < peers.length && unchokeInterested < this.rechokeSlots; ++i) {
    peers[i].isChoked = false
    if (peers[i].interested) ++unchokeInterested
  }

  if (!this.rechokeOptimistic && i < peers.length && this.rechokeSlots) {
    var candidates = peers.slice(i).filter(function (peer) { return peer.interested })
    var optimistic = candidates[(Math.random() * candidates.length) | 0]

    if (optimistic) {
      optimistic.isChoked = false
      this.rechokeOptimistic = optimistic.wire
      this.rechokeOptimisticTime = RECHOKE_OPTIMISTIC_DURATION
    }
  }

  peers.forEach(function (peer) {
    if (peer.wasChoked !== peer.isChoked) {
      if (peer.isChoked) peer.wire.choke()
      else peer.wire.unchoke()
    }
  })
}

TorrentStream.prototype.refresh = function () {
  debug('refresh')
  var torrentStream = this
  process.nextTick(torrentStream.gc.bind(torrentStream))
  torrentStream.oninterestchange()
  torrentStream.onupdate()
}

TorrentStream.prototype.onready = function () {
  debug('onready')
  this.swarm.on('wire', this.onwire.bind(this))
  this.swarm.wires.forEach(this.onwire.bind(this))
  this.rechokeIntervalId = setInterval(this.onrechoke.bind(this), RECHOKE_INTERVAL)

  this.emit('ready')
  this.refresh()
}

TorrentStream.prototype.verify = function () {
  var torrentStream = this
  debug('verify')
  if (this._verify === false) {
    this.onready()
    return
  }

  this.emit('verifying')

  var loop = function (i) {
    if (i >= torrentStream.torrent.pieces.length) {
      torrentStream.onready()
      return
    }
    torrentStream.store.get(i, function (_, buf) {
      if (!buf || sha1(buf) !== torrentStream.torrent.pieces[i] || !torrentStream.pieces[i]) return loop(i + 1)
      torrentStream.pieces[i] = null
      torrentStream.bitfield.set(i, true)
      torrentStream.emit('verify', i)
      loop(i + 1)
    })
  }
  loop(0)
}

TorrentStream.prototype.exchangeMetadata = function () {
  debug('exchangeMetadata')
  var torrentStream = this
  return exchangeMetadata(torrentStream, function (metadata) {
    var buf = bncode.encode({
      info: bncode.decode(metadata),
      'announce-list': []
    })
    torrentStream.torrent = parseTorrent(buf)
    torrentStream.ontorrent()
    mkdirp(path.dirname(torrentStream.torrentPath), function (err) {
      if (err) return torrentStream.emit('error', err)
      fs.writeFile(torrentStream.torrentPath, buf, function (err) {
        if (err) torrentStream.emit('error', err)
      })
    })
  }
  )
}

TorrentStream.prototype.critical = function (piece, width) {
  debug('critical')
  for (var i = 0; i < (width || 1); i++) this._critical[piece + i] = true
}

TorrentStream.prototype.select = function (from, to, priority, notify) {
  debug('select')
  this.selection.push({
    from: from,
    to: to,
    offset: 0,
    priority: toNumber(priority),
    notify: notify || noop
  })

  this.selection.sort(function (a, b) {
    return b.priority - a.priority
  })

  this.refresh()
}

TorrentStream.prototype.deselect = function (from, to, priority, notify) {
  debug('deselect')
  notify = notify || noop
  for (var i = 0; i < this.selection.length; i++) {
    var s = this.selection[i]
    if (s.from !== from || s.to !== to) continue
    if (s.priority !== toNumber(priority)) continue
    if (s.notify !== notify) continue
    this.selection.splice(i, 1)
    i--
    break
  }

  this.refresh()
}

TorrentStream.prototype.setPulse = function (bps) {
  debug('setPulse')
  // Set minimum byte/second pulse starting now (dynamic)
  // Eg. Start pulsing at minimum 312 KBps:
  // engine.setPulse(312*1024)

  this._pulse = bps
}

TorrentStream.prototype.setFlood = function (b) {
  debug('setFlood')
  // Set bytes to flood starting now (dynamic)
  // Eg. Start flooding for next 10 MB:
  // engine.setFlood(10*1024*1024)

  this._flood = b + this.swarm.downloaded
}

TorrentStream.prototype.setFloodedPulse = function (b, bps) {
  // Set bytes to flood before starting a minimum byte/second pulse (dynamic)
  // Eg. Start flooding for next 10 MB, then start pulsing at minimum 312 KBps:
  // engine.setFloodedPulse(10*1024*1024, 312*1024)

  this.setFlood(b)
  this.setPulse(bps)
}

TorrentStream.prototype.flood = function () {
  // Reset flood/pulse values to default (dynamic)
  // Eg. Flood the network starting now:
  // engine.flood()

  this._flood = 0
  this._pulse = Number.MAX_SAFE_INTEGER
}

TorrentStream.prototype.connect = function (publicKey) {
  debug('connect')
  this.swarm.add(publicKey)
}

TorrentStream.prototype.disconnect = function (publicKey) {
  debug('disconnect')
  this.swarm.remove(publicKey)
}

TorrentStream.prototype.removeTorrent = function (cb) {
  debug('removeTorrent')
  var torrentStream = this
  fs.unlink(this.torrentPath, function (err) {
    if (err) return cb(err)
    fs.rmdir(torrentStream.path.dirname(torrentStream.torrentPath), function (err) {
      if (err && err.code !== 'ENOTEMPTY') return cb(err)
      cb()
    })
  })
}

TorrentStream.prototype.remove = function (keepPieces, cb) {
  debug('remove')
  var torrentStream = this
  if (typeof keepPieces === 'function') {
    cb = keepPieces
    keepPieces = false
  }

  if (keepPieces || !this.store || !this.store.destroy) {
    this.removeTorrent(cb)
    return
  }

  this.store.destroy(function (err) {
    if (err) return cb(err)
    torrentStream.removeTorrent(cb)
  })
}

TorrentStream.prototype.destroy = function (cb) {
  debug('destroy')
  this.destroyed = true
  this.swarm.destroy()
  clearInterval(this.rechokeIntervalId)
  if (this.store && this.store.close) {
    this.store.close(cb)
  } else if (cb) {
    process.nextTick(cb)
  }
}

TorrentStream.prototype.listen = function () {
  debug('listen')
  this.swarm.listen()
}

module.exports = TorrentStream
