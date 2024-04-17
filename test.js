const test = require('brittle')
const { Socket, Server } = require('.')

test('server + client', (t) => {
  t.plan(2)

  const server = new Server()
    .listen(10000)
    .on('connection', (socket) => {
      socket
        .on('data', data => {
          t.alike(data.toString(), 'hello world')

          socket.end()
          server.close()
        })
    })
    .on('close', () => t.pass('server closed'))

  const client = new Socket()
  client
    .connect(10000)
    .end('hello world')
})
