import EventEmitter, { EventMap } from 'bare-events'
import { Duplex, DuplexEvents } from 'bare-stream'
import { IPFamily, LookupOptions } from 'bare-dns'
import type { IPCAcceptable } from 'bare-pipe'
import TCPError from './lib/errors'
import constants from './lib/constants'

interface DNSLookup {
  (
    hostname: string,
    opts: LookupOptions,
    cb: (err: Error | null, address: string | null, family: IPFamily | 0) => void
  ): void
}

/** The address of a TCP socket, as `{ address, family, port }`. */
interface TCPSocketAddress {
  /** The IP address. */
  address: string
  /** The IP family (`'IPv4'` or `'IPv6'`). */
  family: `IPv${IPFamily}`
  /** The port number. */
  port: number
}

/** Events emitted by a `TCPSocket`. */
interface TCPSocketEvents extends DuplexEvents {
  /** Emitted when the socket connects. */
  connect: []
  /**
   * Emitted after resolving the hostname. The arguments are `err`, `address`, `family`, and `host`.
   */
  lookup: [err: Error | null, address: string | null, family: IPFamily | 0, host: string]
  /** Emitted when the socket times out due to inactivity. */
  timeout: []
}

/** Options for a `TCPSocket`. */
interface TCPSocketOptions {
  /** Keep the writable side of the socket open after the readable side ends. Defaults to `true`. */
  allowHalfOpen?: boolean
  /** Open the socket immediately instead of waiting for the first write. Defaults to `true`. */
  eagerOpen?: boolean
  /** Size, in bytes, of the socket's internal read buffer. Defaults to `65536`. */
  readBufferSize?: number
}

/** Options for `connect()`. */
interface TCPSocketConnectOptions extends LookupOptions {
  /** The function used to resolve hostnames. Defaults to `dns.lookup` from `bare-dns`. */
  lookup?: DNSLookup
  /** The host to connect to. Defaults to `'localhost'`. */
  host?: string
  /** Enable keep-alive on the socket once connected. Defaults to `false`. */
  keepAlive?: boolean | number
  /**
   * The initial delay in milliseconds before the first keep-alive probe is sent. Defaults to `0`.
   */
  keepAliveInitialDelay?: number
  /** Send data immediately without buffering, disabling Nagle's algorithm. Defaults to `false`. */
  noDelay?: boolean
  /** The port to connect to. */
  port?: number
  /** An inactivity timeout in milliseconds, set on the socket once connected. */
  timeout?: number
}

interface TCPSocketOpenOptions {
  fd?: number
  keepAlive?: boolean | number
  keepAliveInitialDelay?: number
  noDelay?: boolean
  timeout?: number
}

interface TCPSocket<M extends TCPSocketEvents = TCPSocketEvents> extends Duplex<M>, IPCAcceptable {
  /** Whether the socket is currently connecting. */
  readonly connecting: boolean
  /** Whether the socket has not yet connected. */
  readonly pending: boolean
  /** The timeout in milliseconds, or `undefined` if no timeout is set. */
  readonly timeout?: number
  /** The current state of the socket. */
  readonly readyState: 'open' | 'opening' | 'readOnly' | 'writeOnly' | 'closed'
  readonly keepAlive: boolean
  readonly keepAliveInitialDelay: number
  readonly noDelay: boolean
  /** The local IP address of the socket, if connected. */
  readonly localAddress?: string
  /** The local IP family (`'IPv4'` or `'IPv6'`), if connected. */
  readonly localFamily?: string
  /** The local port of the socket, if connected. */
  readonly localPort?: number
  /** The remote IP address of the socket, if connected. */
  readonly remoteAddress?: string
  /** The remote IP family (`'IPv4'` or `'IPv6'`), if connected. */
  readonly remoteFamily?: string
  /** The remote port of the socket, if connected. */
  readonly remotePort?: number

  address(): TCPSocketAddress | null

  /**
   * Connect the socket to `port` on `host`. If `host` is not provided, it defaults to
   * `'localhost'`. `onconnect` is called when the connection is established.
   * @param port - The port to connect to.
   * @param host - The host to connect to; defaults to `'localhost'`.
   * @param opts - Connection options; if `host` is a hostname it is resolved with `opts.lookup`,
   * which defaults to `dns.lookup` from `bare-dns`.
   * @param onconnect - Called when the connection is established.
   * @throws {SOCKET_ALREADY_CONNECTED} the socket is already connecting or connected.
   * @throws {INVALID_PORT} `port` is not an integer between 0 and 65535.
   */
  connect(port: number, host?: string, opts?: TCPSocketConnectOptions, onconnect?: () => void): this
  connect(port: number, host: string, onconnect: () => void): this
  connect(port: number, onconnect: () => void): this
  connect(opts: TCPSocketConnectOptions, onconnect?: () => void): this

  /**
   * Open the socket on the file descriptor of an existing TCP connection, emitting `'connect'` once
   * open.
   * @param fd - The file descriptor of an existing TCP connection to open the socket on.
   * @param opts - `fd` may be given here instead of as the first argument.
   * @param onconnect - Called once when the socket emits `'connect'`.
   */
  open(fd: number, opts?: TCPSocketOpenOptions, onconnect?: () => void): this
  open(fd: number, onconnect: () => void): this
  open(opts: TCPSocketOpenOptions & { fd: number }, onconnect?: () => void): this

  /**
   * Enable or disable keep-alive. `delay` is the initial delay in milliseconds before the first
   * keep-alive probe is sent.
   */
  setKeepAlive(enable?: boolean, delay?: number): this
  setKeepAlive(delay: number): this

  /**
   * Enable or disable Nagle's algorithm. When `enable` is `true` (the default), data is sent
   * immediately without buffering.
   */
  setNoDelay(enable?: boolean): this

  /**
   * Set a timeout in milliseconds. When the socket is idle for `ms` milliseconds, a `timeout` event
   * is emitted. Pass `0` to disable the timeout.
   */
  setTimeout(ms: number, ontimeout?: () => void): this

  /** Ref the socket, preventing the process from exiting. */
  ref(): this
  /** Unref the socket, allowing the process to exit. */
  unref(): this
}

declare class TCPSocket<M extends TCPSocketEvents = TCPSocketEvents> extends Duplex<M> {
  /** Create a new TCP socket. */
  constructor(opts?: TCPSocketOptions)
}

/** Details of a connection dropped because `maxConnections` was exceeded. */
interface TCPServerDropInfo {
  /** The local IP address of the dropped connection. */
  localAddress?: string
  /** The local port of the dropped connection. */
  localPort?: number
  /** The local IP family of the dropped connection. */
  localFamily?: string
  /** The remote IP address of the dropped connection. */
  remoteAddress?: string
  /** The remote port of the dropped connection. */
  remotePort?: number
  /** The remote IP family of the dropped connection. */
  remoteFamily?: string
}

/** Events emitted by a `TCPServer`. */
interface TCPServerEvents extends EventMap {
  /** Emitted when the server closes. */
  close: []
  /** Emitted when a new connection is received. The argument is a `TCPSocket`. */
  connection: [socket: TCPSocket]
  /**
   * Emitted when an incoming connection is dropped because `maxConnections` was exceeded, with
   * details of the dropped connection.
   */
  drop: [info: TCPServerDropInfo]
  /** Emitted when an error occurs. */
  error: [err: Error]
  /** Emitted when the server starts listening. */
  listening: []
  /**
   * Emitted after resolving the hostname. The arguments are `err`, `address`, `family`, and `host`.
   */
  lookup: [err: Error | null, address: string | null, family: IPFamily | 0, host: string]
}

/** Options for a TCP server, applied to each incoming socket. */
interface TCPServerOptions {
  /**
   * Keep the writable side of each incoming socket open after the readable side ends. Defaults to
   * `true`.
   */
  allowHalfOpen?: boolean
  /** Enable keep-alive on each incoming socket. Defaults to `false`. */
  keepAlive?: boolean | number
  /**
   * The initial delay in milliseconds before the first keep-alive probe is sent. Defaults to `0`.
   */
  keepAliveInitialDelay?: number
  /**
   * The maximum number of concurrent connections; connections beyond it are dropped. Defaults to
   * `Infinity`.
   */
  maxConnections?: number
  /**
   * Send data immediately without buffering, disabling Nagle's algorithm, on each incoming socket.
   * Defaults to `false`.
   */
  noDelay?: boolean
  /**
   * Pause each incoming socket on connection instead of opening it eagerly. Defaults to `false`.
   */
  pauseOnConnect?: boolean
  /** Size, in bytes, of each incoming socket's read buffer. Defaults to `65536`. */
  readBufferSize?: number
}

/** Options for `listen()`. */
interface TCPServerListenOptions extends LookupOptions {
  /** The function used to resolve hostnames. Defaults to `dns.lookup` from `bare-dns`. */
  lookup?: DNSLookup
  /** The maximum length of the queue of pending connections. Defaults to `511`. */
  backlog?: number
  /** The host to listen on. Defaults to `'localhost'`. */
  host?: string
  /** The port to listen on; if `0`, an available port is assigned. Defaults to `0`. */
  port?: number
}

interface TCPServer<M extends TCPServerEvents = TCPServerEvents> extends EventEmitter<M> {
  /** Whether the server is listening. */
  readonly listening: boolean
  /** Whether the server is closing. */
  readonly closing: boolean
  /** A `Set` of active connections. */
  readonly connections: Set<TCPSocket>
  /**
   * The maximum number of concurrent connections; connections beyond it are destroyed and reported
   * via the `'drop'` event. Defaults to `Infinity`.
   */
  maxConnections: number

  /**
   * @returns The bound address as `{ address, family, port }`, or `null` if the server is not
   * listening.
   */
  address(): TCPSocketAddress | null

  /**
   * Start listening for connections on `port` and `host`. If `port` is `0`, an available port is
   * assigned. If `host` is not provided, it defaults to `'localhost'`. `backlog` defaults to `511`.
   * @param port - The port to listen on; if `0` (the default), an available port is assigned.
   * @param host - The host to listen on; defaults to `'localhost'`.
   * @param backlog - The maximum length of the queue of pending connections (default `511`).
   * @param opts - Listen options; the positional arguments may be given here instead, and `lookup`
   * (default `dns.lookup`) resolves `host` when it is a hostname.
   * @param onlistening - Called once when the server emits `'listening'`.
   * @throws {SERVER_ALREADY_LISTENING} the server is already listening.
   * @throws {SERVER_IS_CLOSED} the server has been closed.
   * @throws {INVALID_PORT} `port` is not an integer between 0 and 65535.
   */
  listen(
    port?: number,
    host?: string,
    backlog?: number,
    opts?: TCPServerListenOptions,
    onlistening?: () => void
  ): this
  listen(port: number, host: string, backlog: number, onlistening: () => void): this
  listen(port: number, host: string, onlistening: () => void): this
  listen(port: number, onlistening: () => void): this
  listen(opts: TCPServerListenOptions, onlistening?: () => void): this
  listen(onlistening: () => void): this

  /**
   * Close the server. No new connections will be accepted. The server emits `close` after all
   * existing connections have ended.
   * @param onclose - Called once when the server emits `'close'`, after all existing connections
   * have ended.
   */
  close(onclose?: () => void): this

  /** Ref the server, preventing the process from exiting. */
  ref(): this
  /** Unref the server, allowing the process to exit. */
  unref(): this
}

declare class TCPServer<M extends TCPServerEvents = TCPServerEvents> extends EventEmitter<M> {
  /**
   * Create a new TCP server. If `onconnection` is provided, it is added as a listener for the
   * `connection` event.
   */
  constructor(opts?: TCPServerOptions, onconnection?: (socket: TCPSocket) => void)
  constructor(onconnection: (socket: TCPSocket) => void)
}

/**
 * Create a new socket and connect it to `port` on `host`. Shorthand for `new
 * tcp.Socket(options).connect(port, host, options, onconnect)`.
 * @param port - The port to connect to.
 * @param host - The host to connect to; defaults to `'localhost'`.
 * @param opts - Options passed to both the `TCPSocket` constructor and `connect()`.
 * @param onconnect - Called when the connection is established.
 */
declare function createConnection(
  port: number,
  host?: string,
  opts?: TCPSocketOptions & TCPSocketConnectOptions,
  onconnect?: () => void
): TCPSocket

declare function createConnection(port: number, host: string, onconnect: () => void): TCPSocket

declare function createConnection(port: number, onconnect: () => void): TCPSocket

declare function createConnection(
  opts: TCPSocketOptions & TCPSocketConnectOptions,
  onconnect?: () => void
): TCPSocket

/**
 * Create a new TCP server. `server` extends <https://github.com/holepunchto/bare-events>.
 * @param opts - Options applied to each incoming socket; `readBufferSize` defaults to `65536`,
 * `allowHalfOpen` to `true`, and `keepAlive`, `noDelay`, and `pauseOnConnect` to `false`.
 * @param onconnection - Called on each `'connection'` event.
 */
declare function createServer(
  opts?: TCPServerOptions,
  onconnection?: (socket: TCPSocket) => void
): TCPServer

declare function createServer(onconnection: (socket: TCPSocket) => void): TCPServer

/**
 * Returns `4` if `host` is an IPv4 address, `6` if it is an IPv6 address, or `0` otherwise.
 * @param host - The string to check.
 */
declare function isIP(host: string): IPFamily | 0

/**
 * Returns `true` if `host` is an IPv4 address.
 * @param host - The string to check.
 */
declare function isIPv4(host: string): boolean

/**
 * Returns `true` if `host` is an IPv6 address.
 * @param host - The string to check.
 */
declare function isIPv6(host: string): boolean

/**
 * Create a pair of connected sockets, returning their file descriptors.
 * @returns The file descriptors of the two connected sockets.
 */
declare function socketpair(): [first: number, second: number]

export {
  type TCPSocket,
  TCPSocket as Socket,
  type TCPServer,
  TCPServer as Server,
  createConnection,
  createConnection as connect,
  createServer,
  socketpair,
  constants,
  type TCPError,
  TCPError as errors,
  type IPFamily,
  isIP,
  isIPv4,
  isIPv6,
  type TCPServerDropInfo,
  type TCPServerEvents,
  type TCPServerListenOptions,
  type TCPServerOptions,
  type TCPSocketAddress,
  type TCPSocketConnectOptions,
  type TCPSocketEvents,
  type TCPSocketOpenOptions,
  type TCPSocketOptions
}
