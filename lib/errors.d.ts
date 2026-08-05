/** An error produced by `bare-tcp`; `code` identifies the failure. */
declare class TCPError extends Error {
  /** The error code, such as `SOCKET_ALREADY_CONNECTED` or `INVALID_PORT`. */
  readonly code: string
}

export = TCPError
