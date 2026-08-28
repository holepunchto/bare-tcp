const EventEmitter = require('bare-events')
const { Duplex, isFinished, isReadable, isWritable } = require('bare-stream')
const dns = require('bare-dns')
const binding = require('./binding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')
const ip = require('./lib/ip')

const defaultReadBufferSize = 65536
const empty = Buffer.alloc(0)

const ipcHandle = Symbol.for('bare.ipc.handle')
const ipcAccept = Symbol.for('bare.ipc.accept')

exports.Socket = class TCPSocket extends Duplex {
  constructor(opts = {}) {
    const { readBufferSize = defaultReadBufferSize, allowHalfOpen = true, eagerOpen = true } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)

    super({ eagerOpen: !!eagerOpen })

    this._state = 0

    this._allowHalfOpen = !!allowHalfOpen

    this._keepAlive = false
    this._keepAliveInitialDelay = 0
    this._noDelay = false

    this._localAddress = null
    this._remoteAddress = null

    this._pendingOpen = null
    this._pendingWrite = null
    this._pendingWriteBatch = null
    this._pendingFinal = null
    this._pendingDestroy = null

    this._timer = null
    this._timeout = 0

    this._buffer = Buffer.alloc(readBufferSize)

    this._addresses = null
    this._errors = null

    this._handle = binding.init(
      this._buffer,
      this,
      noop,
      this._onconnect,
      this._onreset,
      this._onread,
      this._onwrite,
      this._onfinal,
      this._onclose
    )
  }

  get connecting() {
    return (this._state & constants.state.CONNECTING) !== 0
  }

  get pending() {
    if (this._state & (constants.state.CLOSING | constants.state.CLOSED)) return true

    return (this._state & constants.state.CONNECTED) === 0
  }

  get timeout() {
    return this._timeout || undefined // For Node.js compatibility
  }

  get readyState() {
    if (this._state & constants.state.CONNECTING) return 'opening'

    if (this._state & constants.state.CONNECTED) {
      const readable = isReadable(this)
      const writable = isWritable(this) && !isFinished(this)

      if (readable && writable) return 'open'
      if (readable) return 'readOnly'
      if (writable) return 'writeOnly'
    }

    return 'closed'
  }

  get keepAlive() {
    return this._keepAlive
  }

  get keepAliveInitialDelay() {
    return this._keepAliveInitialDelay
  }

  get noDelay() {
    return this._noDelay
  }

  get localAddress() {
    if (this._localAddress) return this._localAddress.address
  }

  get localFamily() {
    if (this._localAddress) return `IPv${this._localAddress.family}`
  }

  get localPort() {
    if (this._localAddress) return this._localAddress.port
  }

  get remoteAddress() {
    if (this._remoteAddress) return this._remoteAddress.address
  }

  get remoteFamily() {
    if (this._remoteAddress) return `IPv${this._remoteAddress.family}`
  }

  get remotePort() {
    if (this._remoteAddress) return this._remoteAddress.port
  }

  get [ipcHandle]() {
    return this._handle
  }

  address() {
    if (this._localAddress === null) return null

    const { address, family, port } = this._localAddress

    return { address, family: `IPv${family}`, port }
  }

  connect(port, host = 'localhost', opts = {}, onconnect) {
    if (this._state & constants.state.CLOSING) {
      throw errors.SOCKET_IS_CLOSED('Socket is closed')
    }

    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.SOCKET_ALREADY_CONNECTED('Socket is already connected')
    }

    if (typeof host === 'function') {
      onconnect = host
      host = 'localhost'
    } else if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (typeof port === 'object' && port !== null) {
      opts = port
      port = defaultTo(opts.port, 0)
      host = opts.host || 'localhost'
    }

    if (!host) host = 'localhost'

    validateHost(host, 'Host')
    validatePort(port)

    const {
      lookup = dns.lookup,
      hints,
      family = 0,
      keepAlive = false,
      keepAliveInitialDelay = 0,
      noDelay = false,
      timeout
    } = opts

    if (keepAlive) this.setKeepAlive(true, keepAliveInitialDelay)
    if (noDelay) this.setNoDelay(true)
    if (timeout) this.setTimeout(timeout)

    this._state |= constants.state.CONNECTING

    if (ip.isIP(host) === 0) {
      lookup(host, { all: true, family, hints }, (err, addresses) => {
        if (this._state & constants.state.CLOSING) return

        if (!err) err = lookupError(addresses, host)

        if (err) {
          this._state &= ~constants.state.CONNECTING

          this.emit('lookup', err, null, 0, host)

          if (this._pendingOpen) this._continueOpen(err)
          else this.destroy(err)
          return
        }

        for (const { address, family } of addresses) {
          this.emit('lookup', null, address, family, host)
        }

        const [{ address }, ...rest] = addresses

        if (rest.length > 0) {
          this._addresses = rest.map(({ address }) => [port, address])

          this._errors = []
        }

        this._connect(port, address, onconnect)
      })

      return this
    }

    this._connect(port, host, onconnect)

    return this
  }

  _connect(port, host, onconnect) {
    this._state |= constants.state.CONNECTING

    try {
      binding.connect(this._handle, port, host, ip.isIP(host))

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      queueMicrotask(() => this._failConnect(err))
    }
  }

  open(fd, opts = {}, onconnect) {
    if (this._state & constants.state.CLOSING) {
      throw errors.SOCKET_IS_CLOSED('Socket is closed')
    }

    if (this._state & (constants.state.CONNECTING | constants.state.CONNECTED)) {
      throw errors.SOCKET_ALREADY_CONNECTED('Socket is already connected')
    }

    if (typeof opts === 'function') {
      onconnect = opts
      opts = {}
    }

    if (typeof fd === 'object' && fd !== null) {
      opts = fd
      fd = opts.fd
    }

    validateFd(fd)

    const { keepAlive = false, keepAliveInitialDelay = 0, noDelay = false, timeout } = opts

    if (keepAlive) this.setKeepAlive(true, keepAliveInitialDelay)
    if (noDelay) this.setNoDelay(true)
    if (timeout) this.setTimeout(timeout)

    try {
      binding.open(this._handle, fd)

      this._updateAddresses()

      this._state |= constants.state.CONNECTED

      if (this._keepAlive) this.setKeepAlive(this._keepAlive, this._keepAliveInitialDelay)
      if (this._noDelay) this.setNoDelay(this._noDelay)

      if (onconnect) this.once('connect', onconnect)
    } catch (err) {
      queueMicrotask(() => {
        if (this._pendingOpen) this._continueOpen(err)
        else this.destroy(err)
      })

      return this
    }

    this._continueOpen()

    queueMicrotask(() => {
      if (this._state & constants.state.CLOSING) return

      this.emit('connect')
    })

    return this
  }

  setKeepAlive(enable = false, delay = 0) {
    if (typeof enable === 'number') {
      delay = enable
      enable = true
    }

    validateInteger(delay, 'Keep alive initial delay', 0, 0x7fffffff)

    enable = !!enable

    this._keepAlive = enable
    this._keepAliveInitialDelay = delay

    if (this._state & constants.state.CONNECTED) {
      binding.keepalive(this._handle, enable, Math.floor(delay / 1000))
    }

    return this
  }

  setNoDelay(enable = true) {
    enable = !!enable

    this._noDelay = enable

    if (this._state & constants.state.CONNECTED) {
      binding.nodelay(this._handle, enable)
    }

    return this
  }

  setTimeout(ms, ontimeout) {
    validateInteger(ms, 'Timeout', 0, 0x7fffffff)

    clearTimeout(this._timer)

    this._timer = null

    if (ms === 0) {
      if (ontimeout) this.removeListener('timeout', ontimeout)
    } else {
      if (ontimeout) this.once('timeout', ontimeout)

      this._timer = setTimeout(() => this.emit('timeout'), ms)
      this._timer.unref()
    }

    this._timeout = ms

    return this
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._state & constants.state.CLOSING) return this

    binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._state & constants.state.CLOSING) return this

    binding.unref(this._handle)

    return this
  }

  [ipcAccept]() {
    this._onaccept()
  }

  _open(cb) {
    if (this._state & constants.state.CONNECTED) return cb(null)

    this._pendingOpen = cb
  }

  _read() {
    if ((this._state & constants.state.READING) === 0) {
      this._state |= constants.state.READING

      binding.resume(this._handle)
    }
  }

  _writev(batch, cb) {
    this._pendingWrite = cb
    this._pendingWriteBatch = batch

    try {
      coerceBatch(batch)

      binding.writev(
        this._handle,
        batch.map(({ chunk }) => chunk)
      )
    } catch (err) {
      this._continueWrite(err)
    }
  }

  _final(cb) {
    this._pendingFinal = cb

    try {
      binding.end(this._handle)
    } catch (err) {
      this._onfinal(err)
    }
  }

  _predestroy() {
    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._state &= ~constants.state.CONNECTING

    binding.close(this._handle)
  }

  _destroy(err, cb) {
    if (this._state & constants.state.CLOSED) return cb(err)

    this._pendingDestroy = cb

    if (this._state & constants.state.CLOSING) return
    this._state |= constants.state.CLOSING
    this._state &= ~constants.state.CONNECTING

    binding.close(this._handle)
  }

  _continueOpen(err) {
    if (this._pendingOpen === null) return
    const cb = this._pendingOpen
    this._pendingOpen = null
    cb(err)
  }

  _continueWrite(err) {
    if (this._pendingWrite === null) return
    const cb = this._pendingWrite
    this._pendingWrite = null
    this._pendingWriteBatch = null
    cb(err)
  }

  _continueFinal(err) {
    if (this._pendingFinal === null) return
    const cb = this._pendingFinal
    this._pendingFinal = null
    cb(err)
  }

  _continueDestroy() {
    if (this._pendingDestroy === null) return
    const cb = this._pendingDestroy
    this._pendingDestroy = null
    cb(null)
  }

  _reset() {
    this._state &= constants.state.UNREFED

    this._localAddress = null
    this._remoteAddress = null

    binding.reset(this._handle)
  }

  _updateAddresses() {
    try {
      this._localAddress = binding.address(this._handle, true)
    } catch {
      this._localAddress = null
    }

    try {
      this._remoteAddress = binding.address(this._handle, false)
    } catch {
      this._remoteAddress = null
    }
  }

  _failConnect(err) {
    if (this._state & constants.state.CLOSING) return

    if (this._addresses !== null) {
      this._errors.push(err)

      if (this._addresses.length > 0) return this._reset()

      err = this._errors.length === 1 ? this._errors[0] : new AggregateError(this._errors)
    }

    this._state &= ~constants.state.CONNECTING

    if (this._pendingOpen) this._continueOpen(err)
    else this.destroy(err)
  }

  _onconnect(err) {
    if (err) {
      this._failConnect(err)
      return
    }

    this._updateAddresses()

    this._state |= constants.state.CONNECTED
    this._state &= ~constants.state.CONNECTING

    if (this._keepAlive) this.setKeepAlive(this._keepAlive, this._keepAliveInitialDelay)
    if (this._noDelay) this.setNoDelay(this._noDelay)

    this._continueOpen()

    this.emit('connect')
  }

  _onaccept() {
    this._updateAddresses()

    this._state |= constants.state.CONNECTED

    if (this._keepAlive) this.setKeepAlive(this._keepAlive, this._keepAliveInitialDelay)
    if (this._noDelay) this.setNoDelay(this._noDelay)

    this._continueOpen()
  }

  _onreset(err) {
    if (err) {
      this._errors.push(err)
      this.destroy(this._errors.length === 1 ? this._errors[0] : new AggregateError(this._errors))
      return
    }

    if (this._state & constants.state.UNREFED) binding.unref(this._handle)

    this._connect(...this._addresses.shift())
  }

  _onread(err, read) {
    if (this._timer) this._timer.refresh()

    if (err) {
      this.destroy(err)
      return
    }

    if (read === 0) {
      this.push(null)
      if (this._allowHalfOpen === false) this.end()
      return
    }

    // Unpooled, as a read too small to be given a buffer of its own would
    // otherwise pin the whole pool it came from for as long as its consumer
    // holds on to it.
    const copy = Buffer.allocUnsafeSlow(read)
    copy.set(this._buffer.subarray(0, read))

    if (this.push(copy) === false && this.destroying === false) {
      this._state &= ~constants.state.READING

      binding.pause(this._handle)
    }
  }

  _onwrite(err) {
    if (this._timer) this._timer.refresh()

    this._continueWrite(err)
  }

  _onfinal(err) {
    this._continueFinal(err === null || err.code === 'ENOTCONN' ? null : err)
  }

  _onclose() {
    this._state |= constants.state.CLOSED

    clearTimeout(this._timer)

    this._continueOpen()
    this._continueDestroy()
  }
}

exports.Server = class TCPServer extends EventEmitter {
  constructor(opts = {}, onconnection) {
    if (typeof opts === 'function') {
      onconnection = opts
      opts = {}
    }

    super()

    const {
      readBufferSize = defaultReadBufferSize,
      allowHalfOpen = true,
      keepAlive = false,
      keepAliveInitialDelay = 0,
      noDelay = false,
      pauseOnConnect = false,
      maxConnections = Infinity
    } = opts

    validateInteger(readBufferSize, 'Read buffer size', 1, 0x7fffffff)
    validateMaxConnections(maxConnections)

    this._state = 0

    this._readBufferSize = readBufferSize
    this._allowHalfOpen = !!allowHalfOpen
    this._keepAlive = !!keepAlive
    this._keepAliveInitialDelay = keepAliveInitialDelay
    this._noDelay = !!noDelay
    this._pauseOnConnect = !!pauseOnConnect
    this._maxConnections = maxConnections

    this._address = null
    this._connections = new Set()

    this._attempt = 0

    this._error = null
    this._handle = null

    if (onconnection) this.on('connection', onconnection)
  }

  get listening() {
    return (this._state & constants.state.BOUND) !== 0
  }

  get closing() {
    return (this._state & constants.state.CLOSING) !== 0
  }

  get connections() {
    return this._connections
  }

  get maxConnections() {
    return this._maxConnections
  }

  set maxConnections(value) {
    validateMaxConnections(value)

    this._maxConnections = value
  }

  address() {
    if ((this._state & constants.state.BOUND) === 0) return null

    const { address, family, port } = this._address

    return { address, family: `IPv${family}`, port }
  }

  listen(port = 0, host = 'localhost', backlog = 511, opts = {}, onlistening) {
    if (this._state & constants.state.CLOSING) {
      throw errors.SERVER_IS_CLOSED('Server is closed')
    }

    if (this._state & (constants.state.BINDING | constants.state.BOUND)) {
      throw errors.SERVER_ALREADY_LISTENING('Server is already listening')
    }

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

    if (typeof port === 'object' && port !== null) {
      opts = port
      port = defaultTo(opts.port, 0)
      host = opts.host || 'localhost'
      backlog = defaultTo(opts.backlog, 511)
    }

    if (!host) host = 'localhost'
    if (backlog === null || backlog === 0) backlog = 511

    validateHost(host, 'Host')
    validateInteger(backlog, 'Backlog', 0, 0x7fffffff)
    validatePort(port)

    this._state |= constants.state.BINDING
    this._state &= ~constants.state.CLOSED

    const attempt = ++this._attempt

    const { lookup = dns.lookup, hints, family = 0 } = opts

    const type = ip.isIP(host)

    if (type === 0) {
      lookup(host, { family, hints }, (err, address, family) => {
        if (attempt !== this._attempt) return

        this._state &= ~constants.state.BINDING

        if (!err) err = resolvedHostError(address)

        if (err) {
          this.emit('lookup', err, null, 0, host)

          return this.emit('error', err)
        }

        this.emit('lookup', null, address, family, host)

        this.listen(port, address, backlog, { ...opts, family }, onlistening)
      })

      return this
    }

    this._handle = binding.init(
      empty,
      this,
      this._onconnection,
      noop,
      noop,
      noop,
      noop,
      noop,
      this._onclose
    )

    if (this._state & constants.state.UNREFED) binding.unref(this._handle)

    try {
      binding.bind(this._handle, port, host, type, backlog)

      this._address = binding.address(this._handle, true)

      this._state |= constants.state.BOUND
      this._state &= ~constants.state.BINDING

      if (onlistening) this.once('listening', onlistening)

      queueMicrotask(() => {
        if (this._state & constants.state.CLOSING) return

        this.emit('listening')
      })
    } catch (err) {
      this._error = err

      binding.close(this._handle)
    }

    return this
  }

  close(onclose) {
    if (this._state & constants.state.CLOSED) {
      if (onclose) queueMicrotask(onclose)

      return this
    }

    if (onclose) this.once('close', onclose)

    if (this._state & constants.state.CLOSING) return this
    this._state |= constants.state.CLOSING
    this._state &= ~(constants.state.BINDING | constants.state.BOUND)

    this._attempt++

    if (this._handle !== null) binding.close(this._handle)
    else this._closeMaybe()

    return this
  }

  ref() {
    this._state &= ~constants.state.UNREFED

    if (this._handle !== null) binding.ref(this._handle)

    return this
  }

  unref() {
    this._state |= constants.state.UNREFED

    if (this._handle !== null) binding.unref(this._handle)

    return this
  }

  _closeMaybe() {
    if ((this._state & constants.state.CLOSING) === 0) return
    if (this._state & constants.state.CLOSED) return
    if (this._handle !== null || this._connections.size > 0) return

    this._state |= constants.state.CLOSED
    this._state &= ~constants.state.CLOSING

    queueMicrotask(() => this.emit('close'))
  }

  _onconnection(err) {
    if (err) {
      this.emit('error', err)
      return
    }

    if (this._state & constants.state.CLOSING) return

    const overLimit = this._maxConnections > 0 && this._connections.size >= this._maxConnections

    const socket = new exports.Socket({
      readBufferSize: overLimit ? 1 : this._readBufferSize,
      allowHalfOpen: this._allowHalfOpen,
      eagerOpen: !this._pauseOnConnect
    })

    let info = null
    try {
      binding.accept(this._handle, socket._handle)

      socket._onaccept()

      if (overLimit) {
        info = {
          localAddress: socket.localAddress,
          localPort: socket.localPort,
          localFamily: socket.localFamily,
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
          remoteFamily: socket.remoteFamily
        }

        socket.destroy()
      } else {
        this._connections.add(socket)

        if (this._keepAlive) socket.setKeepAlive(this._keepAlive, this._keepAliveInitialDelay)
        if (this._noDelay) socket.setNoDelay(this._noDelay)

        socket.on('close', () => {
          this._connections.delete(socket)
          this._closeMaybe()
        })
      }
    } catch (err) {
      socket.destroy()

      this.emit('error', err)
      return
    }

    if (info !== null) this.emit('drop', info)
    else this.emit('connection', socket)
  }

  _onclose() {
    const err = this._error

    this._state &= ~(constants.state.BINDING | constants.state.BOUND)
    this._error = null
    this._handle = null
    this._address = null

    if (err) this.emit('error', err)

    this._closeMaybe()
  }
}

exports.constants = constants
exports.errors = errors

exports.isIP = ip.isIP
exports.isIPv4 = ip.isIPv4
exports.isIPv6 = ip.isIPv6

exports.createConnection = function createConnection(port, host, opts, onconnect) {
  if (typeof host === 'function') {
    onconnect = host
    host = 'localhost'
  } else if (typeof opts === 'function') {
    onconnect = opts
    opts = {}
  }

  if (typeof port === 'object' && port !== null) {
    opts = port
    port = defaultTo(opts.port, 0)
    host = opts.host || 'localhost'
  }

  return new exports.Socket(opts).connect(port, host, opts, onconnect)
}

// For Node.js compatibility
exports.connect = exports.createConnection

exports.createServer = function createServer(opts, onconnection) {
  return new exports.Server(opts, onconnection)
}

exports.socketpair = function socketpair() {
  return binding.socketpair()
}

function resolvedHostError(address) {
  if (typeof address !== 'string') {
    return errors.INVALID_HOST(`Resolved address must be a string, got ${typeof address}`)
  }

  if (ip.isIP(address) === 0) {
    return errors.INVALID_HOST(`Resolved address must be an IP address, got "${address}"`)
  }

  const length = Buffer.byteLength(address)

  if (length > constants.address.MAX_LENGTH) {
    return errors.INVALID_HOST(
      `Resolved address must be at most ${constants.address.MAX_LENGTH} bytes, got ${length}`
    )
  }

  return null
}

function lookupError(addresses, host) {
  if (!Array.isArray(addresses)) {
    return errors.INVALID_HOST(`Resolved addresses must be an array, got ${typeof addresses}`)
  }

  if (addresses.length === 0) {
    const err = new Error(`No address found for host "${host}"`)
    err.code = 'ENOTFOUND'

    return err
  }

  for (const entry of addresses) {
    if (typeof entry !== 'object' || entry === null) {
      return errors.INVALID_HOST(`Resolved addresses must contain objects, got ${typeof entry}`)
    }

    const err = resolvedHostError(entry.address)

    if (err) return err
  }

  return null
}

function validateHost(host, name) {
  if (typeof host !== 'string') {
    throw errors.INVALID_HOST(`${name} must be a string, got ${typeof host}`)
  }

  if (ip.isIP(host) === 0) return

  validateAddressLength(host, name)
}

function validateAddressLength(address, name) {
  const length = Buffer.byteLength(address)

  if (length > constants.address.MAX_LENGTH) {
    throw errors.INVALID_HOST(
      `${name} must be at most ${constants.address.MAX_LENGTH} bytes, got ${length}`
    )
  }
}

function validatePort(port) {
  if (typeof port !== 'number') {
    throw errors.INVALID_PORT(`Port must be a number, got ${typeof port}`)
  }

  if (!Number.isInteger(port) || port < 0 || port > 0xffff) {
    throw errors.INVALID_PORT(`Port must be an integer between 0 and 65535, got ${port}`)
  }
}

function validateMaxConnections(value) {
  if (typeof value !== 'number') {
    throw errors.INVALID_ARGUMENT(`Max connections must be a number, got ${typeof value}`)
  }

  if (value === Infinity) return

  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw errors.INVALID_ARGUMENT(
      `Max connections must be a non-negative integer or Infinity, got ${value}`
    )
  }
}

function validateFd(fd) {
  if (typeof fd !== 'number') {
    throw errors.INVALID_FD(`File descriptor must be a number, got ${typeof fd}`)
  }

  if (!Number.isInteger(fd) || fd < 0 || fd > 0x7fffffff) {
    throw errors.INVALID_FD(
      `File descriptor must be an integer between 0 and ${0x7fffffff}, got ${fd}`
    )
  }
}

function validateInteger(value, name, min, max) {
  if (typeof value !== 'number') {
    throw errors.INVALID_ARGUMENT(`${name} must be a number, got ${typeof value}`)
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    throw errors.INVALID_ARGUMENT(
      `${name} must be an integer between ${min} and ${max}, got ${value}`
    )
  }
}

function coerceBatch(batch) {
  for (let i = 0; i < batch.length; i++) {
    const chunk = batch[i].chunk

    if (ArrayBuffer.isView(chunk) === false) {
      throw errors.INVALID_ARGUMENT(`Chunk must be a string or a view, got ${typeof chunk}`)
    }

    batch[i].chunk = Buffer.coerce(chunk)
  }
}

function defaultTo(value, fallback) {
  return value === undefined || value === null ? fallback : value
}

function noop() {}
