import EventEmitter, { EventMap } from 'bare-events'
import { Duplex, DuplexOptions, DuplexEvents } from 'bare-stream'
import { lookup as Lookup } from 'bare-dns'

interface TCPSocketAddress {
  address: string
  family: 'IPv4' | 'IPv6'
  port: number
}

type IPFamily = 0 | 4 | 6

interface TCPSocketEvents extends DuplexEvents {
  connect: []
  lookup: [err: TCPError, address: string, family: number, host: string]
  timeout: [ms: number]
}

interface TCPSocketOptions<S extends TCPSocket = TCPSocket>
  extends DuplexOptions<S> {
  readBufferSize?: number
  allowHalfOpen?: boolean
}

interface TCPSocketConnectOptions {
  dns?: { lookup: typeof Lookup }
  family?: IPFamily
  hints?: number
  host?: string
  keepAlive?: boolean
  keepAliveInitialDelay?: boolean
  noDelay?: boolean
  port?: number
  timeout?: number
}

declare class TCPSocket<
  M extends TCPSocketEvents = TCPSocketEvents
> extends Duplex<M> {
  constructor(opts?: TCPSocketOptions)

  readonly connecting: boolean
  readonly pending: boolean
  readonly timeout?: number

  connect(
    port: number,
    host?: string,
    opts?: TCPSocketConnectOptions,
    onconnect?: () => void
  ): this

  connect(port: number, host: string, onconnect: () => void): this
  connect(port: number, onconnect: () => void): this
  connect(opts: TCPSocketConnectOptions): this

  setKeepAlive(enable?: boolean, delay?: number): this
  setKeepAlive(delay: number): this

  setNoDelay(enable?: boolean): this

  setTimeout(ms: number, ontimeout?: () => void): this

  ref(): void
  unref(): void
}

interface TCPServerEvents extends EventMap {
  close: []
  connection: [socket: TCPSocket]
  error: [err: TCPError]
  listening: []
  lookup: [err: TCPError, address: string, family: number, host: string]
}

interface TCPServerOptions {
  allowHalfOpen?: number
  keepAlive?: boolean
  keepAliveInitialDelay?: boolean
  noDelay?: boolean
  readBufferSize?: number
}

interface TCPServerListenOptions {
  backlog?: number
  dns?: { lookup: typeof Lookup }
  family?: IPFamily
  hints?: number
  host?: string
  port?: number
}

declare class TCPServer<
  M extends TCPServerEvents = TCPServerEvents
> extends EventEmitter<M> {
  constructor(opts?: TCPServerOptions, onconnection?: () => void)
  constructor(onconnection: () => void)

  readonly listening: boolean

  address(): TCPSocketAddress

  listen(
    port?: number,
    host?: string,
    backlog?: number,
    opts?: TCPServerListenOptions,
    onlistening?: () => void
  ): this

  listen(
    port: number,
    host: string,
    backlog: number,
    onlistening: () => void
  ): this

  listen(port: number, host: string, onlistening: () => void): this
  listen(port: number, onlistening: () => void): this
  listen(onlistening: () => void): this

  close(onclose?: (err: Error) => void): void

  ref(): void
  unref(): void
}

declare function createConnection(
  port: number,
  host?: string,
  opts?: TCPSocketOptions & TCPSocketConnectOptions,
  onconnect?: () => void
): TCPSocket

declare function createConnection(
  port: number,
  host: string,
  onconnect: () => void
): TCPSocket

declare function createConnection(
  port: number,
  onconnect: () => void
): TCPSocket

declare function createConnection(
  opts: TCPSocketOptions & TCPSocketConnectOptions,
  onconnect: () => void
): TCPSocket

declare function createConnection(
  opts: TCPSocketOptions & TCPSocketConnectOptions
): TCPSocket

declare function createServer(
  opts?: TCPServerOptions,
  onconnection?: () => void
): TCPServer

declare function createServer(onconnection: () => void): TCPServer

declare const constants: {
  state: {
    CONNECTING: number
    CONNECTED: number
    BINDING: number
    BOUND: number
    READING: number
    CLOSING: number
    UNREFED: number
  }
}

declare class TCPError extends Error {
  static SOCKET_ALREADY_CONNECTED(msg: string): TCPError
  static SERVER_ALREADY_LISTENING(msg: string): TCPError
  static SERVER_IS_CLOSED(msg: string): TCPError
  static INVALID_HOST(msg?: string): TCPError

  readonly code: string
}

declare function isIP(host: string): IPFamily

declare function isIPv4(host: string): boolean

declare function isIPv6(host: string): boolean

export {
  TCPSocket as Socket,
  TCPServer as Server,
  createConnection,
  createConnection as connect,
  createServer,
  constants,
  TCPError,
  TCPError as errors,
  isIP,
  isIPv4,
  isIPv6,
  TCPSocketAddress,
  IPFamily,
  TCPSocketEvents,
  TCPSocketOptions,
  TCPSocketConnectOptions,
  TCPServerEvents,
  TCPServerOptions,
  TCPServerListenOptions
}
