/* global Bare */
const EventEmitter = require('bare-events')
const { Duplex } = require('streamx')
const binding = require('./binding')

const defaultReadBufferSize = 65536

const Socket = exports.Socket = class TCPSocket extends Duplex {
  constructor (opts = {}) {
    super({ mapWritable, eagerOpen: true })

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true
    } = opts

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = allowHalfOpen

    this._pendingWrite = null
    this._pendingFinal = null
    this._pendingDestroy = null

    this._reading = false
    this._closing = false

    this._buffer = Buffer.alloc(this._readBufferSize)

    this._handle = binding.init(this._buffer, this, noop, this._onconnect, this._onread, this._onwrite, this._onfinal, this._onclose)

    TCPSocket._sockets.add(this)
  }

  connect (port, host = 'localhost', opts = {}, onconnect) {
    if (typeof port !== 'number') {
      opts = port || {}
      port = opts.port || 0
      host = opts.host || 'localhost'
    } else if (typeof host === 'function') {
      onconnect = host
      host = 'localhost'
    } else if (typeof host !== 'string') {
      opts = host || {}
      host = opts.host || 'localhost'
    } else if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (host === 'localhost') host = '127.0.0.1'

    if (onconnect) this.once('connect', onconnect)

    binding.connect(this._handle, port, host)

    return this
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  _read (cb) {
    if (!this._reading) {
      this._reading = true
      binding.resume(this._handle)
    }

    cb(null)
  }

  _writev (datas, cb) {
    this._pendingWrite = [cb, datas]
    binding.writev(this._handle, datas)
  }

  _final (cb) {
    this._pendingFinal = cb
    binding.end(this._handle)
  }

  _predestroy () {
    if (this._closing) return
    this._closing = true
    binding.close(this._handle)
    TCPSocket._sockets.delete(this)
  }

  _destroy (cb) {
    if (this._closing) return cb(null)
    this._closing = true
    this._pendingDestroy = cb
    binding.close(this._handle)
    TCPSocket._sockets.delete(this)
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
      this.destroy(err)
      return
    }

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

    if (this.push(copy) === false) {
      this._reading = false
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

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = allowHalfOpen

    this.host = null
    this.port = null
    this.closing = false
    this.connections = new Set()

    this._handle = binding.init(empty, this, this._onconnection, noop, noop, noop, noop, this._onclose)

    if (onconnection) this.on('connection', onconnection)

    TCPServer._servers.add(this)
  }

  listen (port = 0, host = '0.0.0.0', backlog = 511, onlistening) {
    if (this.closing) throw new Error('Server is closed')

    if (typeof port === 'function') {
      onlistening = port
      port = 0
    } else if (typeof host === 'function') {
      onlistening = host
      host = '0.0.0.0'
    } else if (typeof backlog === 'function') {
      onlistening = backlog
      backlog = 511
    }

    if (onlistening) this.once('listening', onlistening)

    this.port = binding.bind(this._handle, port, host, backlog)
    this.host = host

    this.emit('listening')

    return this
  }

  close () {
    if (this.closing) return
    this.closing = true
    this._closeMaybe()
  }

  address () {
    if (!this.host) throw new Error('Server is not bound')

    return { address: this.host, family: 4, port: this.port }
  }

  ref () {
    binding.ref(this._handle)
  }

  unref () {
    binding.unref(this._handle)
  }

  _closeMaybe () {
    if (this.closing && this.connections.size === 0) {
      binding.close(this._handle)
      TCPServer._servers.delete(this)
    }
  }

  _onconnection (err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this.closing) return

    const socket = new Socket({
      readBufferSize: this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen
    })

    try {
      binding.accept(this._handle, socket._handle)

      this.connections.add(socket)

      socket.on('close', () => {
        this.connections.delete(socket)
        this._closeMaybe()
      })

      this.emit('connection', socket)
    } catch (err) {
      socket.destroy()

      throw err
    }
  }

  _onclose () {
    this._handle = null
    this.emit('close')
  }

  static _servers = new Set()
}

exports.createConnection = function createConnection (port, host, opts, onconnect) {
  if (typeof port !== 'number') {
    opts = port || {}
    port = opts.port || 0
    host = opts.host || 'localhost'
  } else if (typeof host === 'function') {
    onconnect = host
    host = 'localhost'
  } else if (typeof host !== 'string') {
    opts = host || {}
    host = opts.host || 'localhost'
  } else if (typeof opts === 'function') {
    onconnect = opts
    opts = {}
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

function mapWritable (buf) {
  return typeof buf === 'string' ? Buffer.from(buf) : buf
}
