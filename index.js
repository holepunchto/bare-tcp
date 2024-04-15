// const EventEmitter = require('bare-events')
const { Duplex } = require('streamx')
const binding = require('./binding')

exports.Socket = class TCPSocket extends Duplex {
  constructor () {
    super({ mapWritable, eager: true })

    this._pendingWrite = null
    this._pendingFinal = null

    this._handle = binding.init(this, this._onconnect, this._onwrite, this._onfinal)
  }

  connect (port, host) {
    binding.connect(this._handle, port, host)
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
