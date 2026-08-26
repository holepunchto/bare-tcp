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

interface TCPSocketAddress {
  address: string
  family: `IPv${IPFamily}`
  port: number
}

interface TCPSocketEvents extends DuplexEvents {
  connect: []
  lookup: [err: Error | null, address: string | null, family: IPFamily | 0, host: string]
  timeout: []
}

interface TCPSocketOptions {
  allowHalfOpen?: boolean
  eagerOpen?: boolean
  readBufferSize?: number
}

interface TCPSocketConnectOptions extends LookupOptions {
  lookup?: DNSLookup
  host?: string
  keepAlive?: boolean | number
  keepAliveInitialDelay?: number
  noDelay?: boolean
  port?: number
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
  readonly connecting: boolean
  readonly pending: boolean
  readonly timeout?: number
  readonly readyState: 'open' | 'opening' | 'readOnly' | 'writeOnly' | 'closed'
  readonly keepAlive: boolean
  readonly keepAliveInitialDelay: number
  readonly noDelay: boolean
  readonly localAddress?: string
  readonly localFamily?: string
  readonly localPort?: number
  readonly remoteAddress?: string
  readonly remoteFamily?: string
  readonly remotePort?: number

  address(): TCPSocketAddress | null

  connect(port: number, host?: string, opts?: TCPSocketConnectOptions, onconnect?: () => void): this
  connect(port: number, host: string, onconnect: () => void): this
  connect(port: number, onconnect: () => void): this
  connect(opts: TCPSocketConnectOptions, onconnect?: () => void): this

  open(fd: number, opts?: TCPSocketOpenOptions, onconnect?: () => void): this
  open(fd: number, onconnect: () => void): this
  open(opts: TCPSocketOpenOptions & { fd: number }, onconnect?: () => void): this

  setKeepAlive(enable?: boolean, delay?: number): this
  setKeepAlive(delay: number): this

  setNoDelay(enable?: boolean): this

  setTimeout(ms: number, ontimeout?: () => void): this

  ref(): this
  unref(): this
}

declare class TCPSocket<M extends TCPSocketEvents = TCPSocketEvents> extends Duplex<M> {
  constructor(opts?: TCPSocketOptions)
}

interface TCPServerDropInfo {
  localAddress?: string
  localPort?: number
  localFamily?: string
  remoteAddress?: string
  remotePort?: number
  remoteFamily?: string
}

interface TCPServerEvents extends EventMap {
  close: []
  connection: [socket: TCPSocket]
  drop: [info: TCPServerDropInfo]
  error: [err: Error]
  listening: []
  lookup: [err: Error | null, address: string | null, family: IPFamily | 0, host: string]
}

interface TCPServerOptions {
  allowHalfOpen?: boolean
  keepAlive?: boolean | number
  keepAliveInitialDelay?: number
  maxConnections?: number
  noDelay?: boolean
  pauseOnConnect?: boolean
  readBufferSize?: number
}

interface TCPServerListenOptions extends LookupOptions {
  lookup?: DNSLookup
  backlog?: number
  host?: string
  port?: number
}

interface TCPServer<M extends TCPServerEvents = TCPServerEvents> extends EventEmitter<M> {
  readonly listening: boolean
  readonly closing: boolean
  readonly connections: Set<TCPSocket>
  maxConnections: number

  address(): TCPSocketAddress | null

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

  close(onclose?: () => void): this

  ref(): this
  unref(): this
}

declare class TCPServer<M extends TCPServerEvents = TCPServerEvents> extends EventEmitter<M> {
  constructor(opts?: TCPServerOptions, onconnection?: (socket: TCPSocket) => void)
  constructor(onconnection: (socket: TCPSocket) => void)
}

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

declare function createServer(
  opts?: TCPServerOptions,
  onconnection?: (socket: TCPSocket) => void
): TCPServer

declare function createServer(onconnection: (socket: TCPSocket) => void): TCPServer

declare function isIP(host: string): IPFamily | 0

declare function isIPv4(host: string): boolean

declare function isIPv6(host: string): boolean

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
