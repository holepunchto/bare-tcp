# bare-tcp

Native TCP sockets for JavaScript.

```
npm i bare-tcp
```

## Usage

```js
const tcp = require('bare-tcp')

const server = tcp.createServer()
server.on('connection', (socket) => socket.on('data', console.log))
server.listen(() => console.log('server is up'))

const { port } = server.address()
const socket = tcp.createConnection(port)
socket.write('hello world')
```

## API

#### `const socket = new tcp.Socket([options])`

Create a new TCP socket. `socket` extends <https://github.com/holepunchto/bare-stream>.

Options include:

```js
options = {
  readBufferSize: 65536,
  allowHalfOpen: true,
  eagerOpen: true
}
```

#### `const socket = tcp.createConnection(port[, host[, options]][, onconnect])`

Create a new socket and connect it to `port` on `host`. Shorthand for `new tcp.Socket(options).connect(port, host, options, onconnect)`.

#### `socket.connecting`

Whether the socket is currently connecting.

#### `socket.pending`

Whether the socket has not yet connected.

#### `socket.timeout`

The timeout in milliseconds, or `undefined` if no timeout is set.

#### `socket.readyState`

The current state of the socket. Either `'open'` or `'opening'`.

#### `socket.keepAlive`

Whether keep-alive is enabled.

#### `socket.keepAliveInitialDelay`

The keep-alive initial delay in milliseconds.

#### `socket.noDelay`

Whether Nagle's algorithm is disabled.

#### `socket.localAddress`

The local IP address of the socket, if connected.

#### `socket.localFamily`

The local IP family (`'IPv4'` or `'IPv6'`), if connected.

#### `socket.localPort`

The local port of the socket, if connected.

#### `socket.remoteAddress`

The remote IP address of the socket, if connected.

#### `socket.remoteFamily`

The remote IP family (`'IPv4'` or `'IPv6'`), if connected.

#### `socket.remotePort`

The remote port of the socket, if connected.

#### `socket.connect(port[, host[, options]][, onconnect])`

Connect the socket to `port` on `host`. If `host` is not provided, it defaults to `'localhost'`. `onconnect` is called when the connection is established.

Hosts may carry a zone identifier, such as `fe80::1%en0`, and an IP address may be at most `tcp.constants.address.MAX_LENGTH` bytes long.

Options include:

```js
options = {
  lookup: dns.lookup,
  hints: null,
  family: 0,
  keepAlive: false,
  keepAliveInitialDelay: 0,
  noDelay: false,
  timeout: null
}
```

If `host` is a hostname, `options.lookup` is used to resolve it. By default, <https://github.com/holepunchto/bare-dns> is used. Set `options.family` to `4` or `6` to restrict the lookup to IPv4 or IPv6.

A custom `lookup` must resolve to IP addresses, as a resolved address is used as the host of another connect or listen. A result that is not an IP address, or is not shaped like the result `bare-dns` returns, is reported as a failed lookup rather than resolved again.

#### `socket.open(fd[, options][, onconnect])`

Adopt an already connected socket from the file descriptor `fd`, such as one obtained from `tcp.socketpair()` or received over IPC. `onconnect` is called when the socket is ready.

Options include:

```js
options = {
  keepAlive: false,
  keepAliveInitialDelay: 0,
  noDelay: false,
  timeout: null
}
```

#### `socket.setKeepAlive([enable][, delay])`

Enable or disable keep-alive. `delay` is the initial delay in milliseconds before the first keep-alive probe is sent; when it is `0`, the system default is used. Passing a number as the first argument enables keep-alive with that delay.

The option is applied once the socket is connected.

#### `socket.setNoDelay([enable])`

Enable or disable Nagle's algorithm. When `enable` is `true` (the default), data is sent immediately without buffering.

The option is applied once the socket is connected.

#### `socket.setTimeout(ms[, ontimeout])`

Set a timeout in milliseconds. When the socket is idle for `ms` milliseconds, a `timeout` event is emitted. Pass `0` to disable the timeout.

#### `socket.ref()`

Ref the socket, preventing the process from exiting.

#### `socket.unref()`

Unref the socket, allowing the process to exit.

#### `event: 'connect'`

Emitted when the socket connects.

#### `event: 'lookup'`

Emitted after resolving the hostname. The arguments are `err`, `address`, `family`, and `host`.

#### `event: 'timeout'`

Emitted when the socket times out due to inactivity.

#### `const server = new tcp.Server([options][, onconnection])`

Create a new TCP server. `server` extends <https://github.com/holepunchto/bare-events>.

Options include:

```js
options = {
  readBufferSize: 65536,
  allowHalfOpen: true,
  keepAlive: false,
  keepAliveInitialDelay: 0,
  noDelay: false,
  pauseOnConnect: false,
  maxConnections: Infinity
}
```

These options are applied to each incoming socket. If `onconnection` is provided, it is added as a listener for the `connection` event.

#### `const server = tcp.createServer([options][, onconnection])`

Convenience function equivalent to `new tcp.Server(options, onconnection)`.

#### `server.listening`

Whether the server is listening.

#### `server.closing`

Whether the server is closing.

#### `server.connections`

A `Set` of active connections.

#### `server.maxConnections`

The maximum number of concurrent connections. Further connections are dropped and a `drop` event is emitted. `0` or `Infinity` means no limit.

#### `server.address()`

Returns the bound address as `{ address, family, port }`, or `null` if the server is not listening.

#### `server.listen([port[, host[, backlog[, options]]]][, onlistening])`

Start listening for connections on `port` and `host`. If `port` is `0`, an available port is assigned. If `host` is not provided, it defaults to `'localhost'`. `backlog` defaults to `511`.

Options include:

```js
options = {
  lookup: dns.lookup,
  hints: null,
  family: 0
}
```

#### `server.close([onclose])`

Close the server, releasing the port right away so that no new connections are accepted. Existing connections are left open and the server emits `close` after all of them have ended. `server.listening` is `false` and `server.address()` returns `null` as soon as `close()` is called.

A connection accepted with `allowHalfOpen: true` stays open after the peer closes its end: the peer's `FIN` ends only the readable half, and the writable half remains open until the local side ends it. Such a connection has not "ended", so it keeps the server open and `close` will not fire until you end it (for example `socket.on('end', () => socket.end())`). This matches Node's `net`, which also waits for half-open connections to end.

#### `server.ref()`

Ref the server, preventing the process from exiting.

#### `server.unref()`

Unref the server, allowing the process to exit.

#### `event: 'listening'`

Emitted when the server starts listening.

#### `event: 'connection'`

Emitted when a new connection is received. The argument is a `tcp.Socket`.

#### `event: 'drop'`

Emitted when a connection is dropped because `server.maxConnections` was reached. The argument is the address information of the dropped connection.

#### `event: 'close'`

Emitted when the server closes.

#### `event: 'error'`

Emitted when an error occurs.

#### `event: 'lookup'`

Emitted after resolving the hostname. The arguments are `err`, `address`, `family`, and `host`.

#### `const [first, second] = tcp.socketpair()`

Create a pair of connected sockets, returning their file descriptors. Use `socket.open(fd)` to adopt them.

#### `tcp.isIP(host)`

Returns `4` if `host` is an IPv4 address, `6` if it is an IPv6 address, or `0` otherwise.

#### `tcp.isIPv4(host)`

Returns `true` if `host` is an IPv4 address.

#### `tcp.isIPv6(host)`

Returns `true` if `host` is an IPv6 address.

#### `tcp.constants`

Object containing internal state constants, as well as `address.MAX_LENGTH`, the maximum length in bytes of an IP address accepted by `socket.connect()` and `server.listen()`:

```js
tcp.constants.address.MAX_LENGTH
```

#### `tcp.errors`

Class for TCP specific errors, with a static factory per error code.

## IPC handle passing

`tcp.Socket` implements the `IPCAcceptable` protocol, so a connected socket can be passed to a peer over a `bare-pipe` created with `ipc: true`, and a received socket can be adopted with `pipe.accept(socket)`. See <https://github.com/holepunchto/bare-pipe#ipc-handle-passing>.

## License

Apache-2.0
