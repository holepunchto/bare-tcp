module.exports = class TCPError extends Error {
  constructor (msg, code, fn = TCPError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'TCPError'
  }

  static SERVER_IS_LISTENING (msg) {
    return new TCPError(msg, 'SERVER_IS_LISTENING', TCPError.SERVER_IS_LISTENING)
  }

  static SERVER_IS_NOT_LISTENING (msg) {
    return new TCPError(msg, 'SERVER_IS_NOT_LISTENING', TCPError.SERVER_IS_NOT_LISTENING)
  }

  static SERVER_IS_CLOSED (msg) {
    return new TCPError(msg, 'SERVER_IS_CLOSED', TCPError.SERVER_IS_CLOSED)
  }
}