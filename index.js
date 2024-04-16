// const EventEmitter = require('bare-events')
const { Duplex } = require('streamx')
const binding = require('./binding')

const defaultReadBufferSize = 65536

exports.Socket = class TCPSocket extends Duplex {
  constructor () {
    super({ mapWritable, eager: true })

    this._pendingWrite = null
    this._pendingFinal = null

    this._reading = false

    this._buffer = Buffer.alloc(defaultReadBufferSize)

    this._handle = binding.init(this._buffer, this, this._onconnect, this._onread, this._onwrite, this._onfinal)
  }

  connect (port, host) {
    binding.connect(this._handle, port, host)
  }

  _read (cb) {
    if (!this._reading) {
      this._reading = true
      binding.resume(this._handle)
    }

    cb(null)
  }

  _writev (chunk, cb) {
    this._pendingWrite = cb
    binding.writev(this._handle, chunk)
  }

  _final (cb) {
    this._pendingFinal = cb
    binding.end(this._handle)
  }

  _continueWrite (err) {
    if (this._pendingWrite === null) return
    const cb = this._pendingWrite
    this._pendingWrite = null
    cb(err)
  }

  _continueFinal (err) {
    if (this._pendingFinal === null) return
    const cb = this._pendingFinal
    this._pendingFinal = null
    cb(err)
  }

  _onconnect (err) {
    if (!err) this.emit('connect')
  }

  _onread (err, read) {
    if (err || read === 0) {
      this.push(null)
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
}

function mapWritable (buf) {
  return typeof buf === 'string' ? Buffer.from(buf) : buf
}
