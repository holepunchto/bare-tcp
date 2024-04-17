const test = require('brittle')
const { Socket, Server } = require('.')

test('server + client', (t) => {
  t.plan(2)

  const server = new Server()
    .listen()
    .on('connection', (socket) => {
      socket
        .on('data', data => {
          t.alike(data.toString(), 'hello world')

          // close
          socket.end()
          server.close()
        })
    })
    .on('close', () => t.pass('server closed'))

  const { port } = server.address()

  const client = new Socket()
  client
    .connect(port)
    .end('hello world')
})
