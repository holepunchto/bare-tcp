module.exports = class TCPError extends Error {
  constructor(msg, fn = TCPError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'TCPError'
  }

  static SOCKET_ALREADY_CONNECTED(msg) {
    return new TCPError(msg, TCPError.SOCKET_ALREADY_CONNECTED)
  }

  static SOCKET_IS_CLOSED(msg) {
    return new TCPError(msg, TCPError.SOCKET_IS_CLOSED)
  }

  static SERVER_ALREADY_LISTENING(msg) {
    return new TCPError(msg, TCPError.SERVER_ALREADY_LISTENING)
  }

  static SERVER_IS_CLOSED(msg) {
    return new TCPError(msg, TCPError.SERVER_IS_CLOSED)
  }

  static INVALID_ARGUMENT(msg) {
    return new TCPError(msg, TCPError.INVALID_ARGUMENT)
  }

  static INVALID_FD(msg) {
    return new TCPError(msg, TCPError.INVALID_FD)
  }

  static INVALID_HOST(msg = 'Unrecognizable host format') {
    return new TCPError(msg, TCPError.INVALID_HOST)
  }

  static INVALID_PORT(msg) {
    return new TCPError(msg, TCPError.INVALID_PORT)
  }
}
