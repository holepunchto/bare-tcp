# bare-tcp

Native TCP sockets for JavaScript.

```
npm i bare-tcp
```

## Usage

``` js
const { createServer, createSocket } = require('bare-tcp')

const server = createServer()
server.on('connection', (_socket) => _socket.on('data', console.log))
server.listen(() => console.log('server is up'))

const { port } = server.address()
const socket = createSocket(port)
socket.write('hello world')
```

## License

Apache-2.0
