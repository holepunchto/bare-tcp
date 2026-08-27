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

See the [`bare-tcp` reference](https://docs.pears.com/reference/bare/modules/bare-tcp).

## License

Apache-2.0
