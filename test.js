const test = require('brittle')
const { Socket, Server } = require('.')

test('server + client', (t) => {
  t.plan(1)

  new Server()
    .listen(8880, '127.0.0.1')
    .on('connection', (socket) => {
      socket.on('data', data => t.alike(data.toString(), 'hello world'))
    })

  const client = new Socket()
  client.connect(8880, '127.0.0.1')
  client.once('connect', () => client.end('hello world'))
})
