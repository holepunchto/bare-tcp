const test = require('brittle')
const { createServer, createConnection } = require('.')

test('server + client', async (t) => {
  t.plan(2)

  const lc = t.test('lifecycle')
  lc.plan(3)

  const server = createServer()
    .on('close', () => t.pass('server closed'))
    .on('connection', (socket) => {
      socket
        .on('close', () => lc.pass('server connection closed'))
        .on('data', (data) => lc.alike(data.toString(), 'hello world'))
        .end()
    })
    .listen()

  const { port } = server.address()

  createConnection(port)
    .on('close', () => lc.pass('client connection closed'))
    .end('hello world')

  await lc

  server.close()
})
