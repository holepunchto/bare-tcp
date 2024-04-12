// const EventEmitter = require('bare-events')
const { Duplex } = require('streamx')
const binding = require('./binding')

exports.Socket = class TCPSocket extends Duplex {
  constructor () {
    super({ mapWritable, eager: true })

    this._handle = binding.init(this, this._onconnect)
  }

  connect (port, host) {
    binding.connect(this._handle, port, host)
  }

  _onconnect () {
    this.emit('connect')
  }
}

function mapWritable (buf) {
  return typeof buf === 'string' ? Buffer.from(buf) : buf
}
