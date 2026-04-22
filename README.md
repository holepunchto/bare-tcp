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

Create a new TCP socket.

Options include:

```js
options = {
  readBufferSize: 65536,
  allowHalfOpen: true,
  eagerOpen: true
}
```

#### `socket.connecting`

Whether the socket is currently connecting.

#### `socket.pending`

Whether the socket has not yet connected.

#### `socket.timeout`

The timeout in milliseconds, or `undefined` if no timeout is set.

#### `socket.readyState`

The current state of the socket. Either `'open'` or `'opening'`.

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

#### `socket.setKeepAlive([enable][, delay])`

Enable or disable keep-alive. `delay` is the initial delay in milliseconds before the first keep-alive probe is sent.

#### `socket.setNoDelay([enable])`

Enable or disable Nagle's algorithm. When `enable` is `true` (the default), data is sent immediately without buffering.

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

#### `const server = tcp.createServer([options][, onconnection])`

Create a new TCP server. `server` extends <https://github.com/holepunchto/bare-events>.

Options include:

```js
options = {
  readBufferSize: 65536,
  allowHalfOpen: true,
  keepAlive: false,
  keepAliveInitialDelay: 0,
  noDelay: false,
  pauseOnConnect: false
}
```

These options are applied to each incoming socket. If `onconnection` is provided, it is added as a listener for the `connection` event.

#### `server.listening`

Whether the server is listening.

#### `server.closing`

Whether the server is closing.

#### `server.connections`

A `Set` of active connections.

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

Close the server. No new connections will be accepted. The server emits `close` after all existing connections have ended.

#### `server.ref()`

Ref the server, preventing the process from exiting.

#### `server.unref()`

Unref the server, allowing the process to exit.

#### `event: 'listening'`

Emitted when the server starts listening.

#### `event: 'connection'`

Emitted when a new connection is received. The argument is a `TCPSocket`.

#### `event: 'close'`

Emitted when the server closes.

#### `event: 'error'`

Emitted when an error occurs.

#### `event: 'lookup'`

Emitted after resolving the hostname. The arguments are `err`, `address`, `family`, and `host`.

#### `const socket = tcp.createConnection(port[, host[, options]][, onconnect])`

Create a new socket and connect it to `port` on `host`. Shorthand for `new tcp.Socket(options).connect(port, host, options, onconnect)`.

#### `tcp.isIP(host)`

Returns `4` if `host` is an IPv4 address, `6` if it is an IPv6 address, or `0` otherwise.

#### `tcp.isIPv4(host)`

Returns `true` if `host` is an IPv4 address.

#### `tcp.isIPv6(host)`

Returns `true` if `host` is an IPv6 address.

#### `tcp.constants`

Object containing internal state constants.

#### `tcp.errors`

Class for TCP-specific errors.

## License

Apache-2.0
