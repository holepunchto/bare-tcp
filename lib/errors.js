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

  static SERVER_ALREADY_LISTENING(msg) {
    return new TCPError(msg, TCPError.SERVER_ALREADY_LISTENING)
  }

  static SERVER_IS_CLOSED(msg) {
    return new TCPError(msg, TCPError.SERVER_IS_CLOSED)
  }

  static INVALID_HOST(msg = 'Unrecognizable host format') {
    return new TCPError(msg, TCPError.INVALID_HOST)
  }
}
