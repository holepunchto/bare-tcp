/* global Bare */
const EventEmitter = require('bare-events')
const { Duplex } = require('bare-stream')
const dns = require('bare-dns')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')
const ip = require('./lib/ip')

const defaultReadBufferSize = 65536

const Socket = exports.Socket = class TCPSocket extends Duplex {
  constructor (opts = {}) {
    super({ eagerOpen: true })

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true
    } = opts

    this._state = 0

    this._allowHalfOpen = allowHalfOpen

    this._remotePort = -1
    this._remoteHost = null

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingFinal = null
    this._pendingDestroy = null

    this._buffer = Buffer.alloc(readBufferSize)

    this._handle = binding.init(this._buffer, this,
      noop,
      this._onconnect,
      this._onread,
      this._onwrite,
      this._onfinal,
      this._onclose
    )

    TCPSocket._sockets.add(this)
  }

  get connecting () {
    return (this._state & constants.state.CONNECTING) !== 0
  }

  get pending () {
    return (this._state & constants.state.CONNECTED) === 0
  }

  connect (port, host = 'localhost', opts = {}, onconnect) {
    if (this._state & constants.state.CONNECTING || this._state & constants.state.CONNECTED) {
      throw errors.SOCKET_ALREADY_CONNECTED('Socket is already connected')
    }

    this._state |= constants.state.CONNECTING

    if (typeof host === 'function') {
      onconnect = host
      host = 'localhost'
    } else if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    let family = 0

    if (typeof port === 'object' && port !== null) {
      opts = port || {}
      port = opts.port || 0
      host = opts.host || 'localhost'
      family = opts.family || 0
    }

    if (!host) host = 'localhost'

    const type = ip.isIP(host)

    if (type === 0) {
      const {
        lookup = dns.lookup,
        hints
      } = opts

      lookup(host, { family, hints }, (err, address, family) => {
        this.emit('lookup', err, address, family, host)

        this._state &= ~constants.state.CONNECTING

        if (err) {
          if (this._pendingOpen) this._continueOpen(err)
          else this.destroy(err)
          return
        }

        if (this._handle !== null) {
          this.connect(port, address, { ...opts, family }, onconnect)
        }
      })

      return this
    }

    family = type

    try {
      binding.connect(this._handle, port, host, family)

      if (opts.keepAlive === true) this.setKeepAlive(opts.keepAlive, opts.keepAliveInitialDelay)
      if (opts.noDelay === true) this.setNoDelay()

      this._remotePort = port
      this._remoteHost = host
      this._remoteFamily = family

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      queueMicrotask(() => {
        if (this._pendingOpen) this._pendingOpen(err)
        else this.destroy(err)
      })
    }

    return this
  }

  setKeepAlive (enable = false, delay = 0) {
    if (typeof enable === 'number') {
      delay = enable
      enable = false
    }

    delay = Math.floor(delay / 1000)

    if (delay === 0) enable = false

    binding.keepalive(this._handle, enable, delay)

    return this
  }

  setNoDelay (enable = true) {
    binding.nodelay(this._handle, enable)

    return this
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  _open (cb) {
    if (this._state & constants.state.CONNECTED) return cb(null)
    this._pendingOpen = cb
  }

  _read () {
    if ((this._state & constants.state.READING) === 0) {
      this._state |= constants.state.READING
      binding.resume(this._handle)
    }
  }

  _writev (batch, cb) {
    this._pendingWrite = [cb, batch]
    binding.writev(this._handle, batch.map(({ chunk }) => chunk))
  }

  _final (cb) {
    this._pendingFinal = cb
    binding.end(this._handle)
  }

  _predestroy () {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    binding.close(this._handle)
    TCPSocket._sockets.delete(this)
  }

  _destroy (err, cb) {
    if (this._state & constants.state.CLOSING) return cb(err)
    this._state |= constants.state.CLOSING
    this._pendingDestroy = cb
    binding.close(this._handle)
    TCPSocket._sockets.delete(this)
  }

  _continueOpen (err) {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _continueWrite (err) {
    if (this._pendingWrite === null) return
    const cb = this._pendingWrite[0]
    this._pendingWrite = null
    cb(err)
  }

  _continueFinal (err) {
    if (this._pendingFinal === null) return
    const cb = this._pendingFinal
    this._pendingFinal = null
    cb(err)
  }

  _continueDestroy () {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _onconnect (err) {
    if (err) {
      if (this._pendingOpen) this._continueOpen(err)
      else this.destroy(err)
      return
    }

    this._state |= constants.state.CONNECTED
    this._state &= ~constants.state.CONNECTING
    this._continueOpen()

    this.emit('connect')
  }

  _onread (err, read) {
    if (err) {
      this.destroy(err)
      return
    }

    if (read === 0) {
      this.push(null)
      if (this._allowHalfOpen === false) this.end()
      return
    }

    const copy = Buffer.allocUnsafe(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._state &= ~constants.state.READING
      binding.pause(this._handle)
    }
  }

  _onwrite (err) {
    this._continueWrite(err)
  }

  _onfinal (err) {
    this._continueFinal(err)
  }

  _onclose () {
    this._handle = null
    this._continueDestroy()
  }

  static _sockets = new Set()
}

const Server = exports.Server = class TCPServer extends EventEmitter {
  constructor (opts = {}, onconnection) {
    if (typeof opts === 'function') {
      onconnection = opts
      opts = {}
    }

    super()

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true
    } = opts

    this._state = 0

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = allowHalfOpen

    this._keepAlive = opts.keepAlive
    this._keepAliveDelay = opts.keepAliveInitialDelay
    this._noDelay = opts.noDelay

    this._port = -1
    this._host = null
    this._family = 0
    this._connections = new Set()

    this._error = null
    this._handle = null

    if (onconnection) this.on('connection', onconnection)

    TCPServer._servers.add(this)
  }

  get listening () {
    return (this._state & constants.state.BOUND) !== 0
  }

  address () {
    if ((this._state & constants.state.BOUND) === 0) {
      return null
    }

    return {
      address: this._host,
      family: `IPv${this._family}`,
      port: this._port
    }
  }

  listen (port = 0, host = 'localhost', backlog = 511, opts = {}, onlistening) {
    if (this._state & constants.state.BINDING || this._state & constants.state.BOUND) {
      throw errors.SERVER_ALREADY_LISTENING('Server is already listening')
    }

    if (this._state & constants.state.CLOSING) {
      throw errors.SERVER_IS_CLOSED('Server is closed')
    }

    this._state |= constants.state.BINDING

    if (typeof port === 'function') {
      onlistening = port
      port = 0
    } else if (typeof host === 'function') {
      onlistening = host
      host = 'localhost'
    } else if (typeof backlog === 'function') {
      onlistening = backlog
      backlog = 511
    } else if (typeof opts === 'function') {
      onlistening = opts
      opts = {}
    }

    let family = 0

    if (typeof port === 'object' && port !== null) {
      opts = port || {}
      port = opts.port || 0
      host = opts.host || 'localhost'
      family = opts.family || 0
      backlog = opts.backlog || 511
    }

    if (!host) host = 'localhost'
    if (!backlog) backlog = 511

    const type = ip.isIP(host)

    if (type === 0) {
      const {
        lookup = dns.lookup,
        hints
      } = opts

      lookup(host, { family, hints }, (err, address, family) => {
        if (this._state & constants.state.CLOSING) return

        this.emit('lookup', err, address, family, host)

        this._state &= ~constants.state.BINDING

        if (err) return this.emit('error', err)

        this.listen(port, address, backlog, { ...opts, family }, onlistening)
      })

      return this
    }

    family = type

    this._handle = binding.init(empty, this,
      this._onconnection,
      noop,
      noop,
      noop,
      noop,
      this._onclose
    )

    if (this._state & constants.state.UNREFED) binding.unref(this._handle)

    try {
      this._port = binding.bind(this._handle, port, host, backlog, family)
      this._host = host
      this._family = family
      this._state |= constants.state.BOUND
      this._state &= ~constants.state.BINDING

      if (onlistening) this.once('listening', onlistening)

      queueMicrotask(() => this.emit('listening'))
    } catch (err) {
      this._error = err

      binding.close(this._handle)
    }

    return this
  }

  close (onclose) {
    if (onclose) this.once('close', onclose)
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._closeMaybe()
  }

  ref () {
    this._state &= ~constants.state.UNREFED
    if (this._handle !== null) binding.ref(this._handle)
  }

  unref () {
    this._state |= constants.state.UNREFED
    if (this._handle !== null) binding.unref(this._handle)
  }

  _closeMaybe () {
    if ((this._state & constants.state.CLOSING) && this._connections.size === 0) {
      if (this._handle !== null) binding.close(this._handle)
      else queueMicrotask(() => this.emit('close'))
      TCPServer._servers.delete(this)
    }
  }

  _onconnection (err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this._state & constants.state.CLOSING) return

    const socket = new Socket({
      readBufferSize: this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen
    })

    try {
      binding.accept(this._handle, socket._handle)

      socket._state |= constants.state.CONNECTED

      this._connections.add(socket)

      if (this._keepAlive === true) socket.setKeepAlive(this._keepAlive, this._keepAliveDelay)
      if (this._noDelay === true) socket.setNoDelay()

      socket.on('close', () => {
        this._connections.delete(socket)
        this._closeMaybe()
      })

      this.emit('connection', socket)
    } catch (err) {
      socket.destroy()

      throw err
    }
  }

  _onclose () {
    const err = this._error

    this._state &= ~constants.state.BINDING
    this._error = null
    this._handle = null

    if (err) this.emit('error', err)
    else this.emit('close')
  }

  static _servers = new Set()
}

exports.constants = constants
exports.errors = errors

exports.isIP = ip.isIP
exports.isIPv4 = ip.isIPv4
exports.isIPv6 = ip.isIPv6

exports.createConnection = function createConnection (port, host, opts, onconnect) {
  if (typeof host === 'function') {
    onconnect = host
    host = 'localhost'
  } else if (typeof opts === 'function') {
    onconnect = opts
    opts = {}
  }

  if (typeof port === 'object' && port !== null) {
    opts = port || {}
    port = opts.port || 0
    host = opts.host || 'localhost'
  }

  return new Socket(opts).connect(port, host, opts, onconnect)
}

exports.createServer = function createServer (opts, onconnection) {
  return new Server(opts, onconnection)
}

Bare
  .on('exit', () => {
    for (const socket of Socket._sockets) {
      socket.destroy()
    }

    for (const server of Server._servers) {
      server.close()
    }
  })

const empty = Buffer.alloc(0)

function noop () {}
