const test = require('brittle')
const { createServer, createConnection, Socket } = require('.')

test('server + client', async (t) => {
  t.plan(2)

  const lc = t.test('lifecycle')
  lc.plan(5)

  const server = createServer()
    .on('close', () => t.pass('server closed'))
    .on('connection', (socket) => {
      socket
        .on('close', () => lc.pass('server connection closed'))
        .on('data', (data) => lc.alike(data.toString(), 'hello world', 'server received message'))
        .end()
    })
    .on('listening', () => lc.pass('server listening'))
    .listen()

  const { port } = server.address()

  createConnection(port)
    .on('connect', () => lc.pass('client connection opened'))
    .on('close', () => lc.pass('client connection closed'))
    .end('hello world')

  await lc

  server.close()
})

test('socket state getters', async (t) => {
  t.plan(2)

  const server = createServer().listen()
  await waitForServer(server)

  const socket = new Socket()
  t.is(socket.pending, true, 'pending')

  socket.connect(server.address().port)
  t.is(socket.connecting, true, 'connecting')

  socket.destroy()
  server.close()
})

test('port already in use', async (t) => {
  t.plan(1)

  const server = createServer().listen()
  await waitForServer(server)

  const server2 = createServer().listen(server.address().port)

  server2.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE', 'catch EADDRINUSE error')

    server.close()
    server2.close()
  })
})

test('not accept address request when not listening', (t) => {
  const server = createServer()
  t.is(server.address(), null)
})

test('not accept server calling listen method twice', async (t) => {
  t.plan(1)

  const server = createServer().listen()
  await waitForServer(server)

  const { port } = server.address()

  try {
    server.listen(port)
  } catch (err) {
    t.ok(err.code?.includes('SERVER_ALREADY_LISTEN'))
    server.close()
  }
})

test('createConnection arguments', async (t) => {
  const args = t.test('args')
  args.plan(2)

  const server = createServer()
    .on('connection', (s) => s.end())
    .listen()

  await waitForServer(server)

  const { port } = server.address()

  const socket1 = createConnection(port, () => {
    args.pass('port and listener')
    socket1.destroy()
  })

  const socket2 = createConnection(port, 'localhost', () => {
    args.pass('port, host and listener')
    socket2.destroy()
  })

  await args

  server.close()
})

test('server.listen arguments', (t) => {
  const args = t.test('args')
  args.plan(4)

  const server1 = createServer().listen()
  server1.on('listening', () => {
    args.pass('no args')
    server1.close()
  })

  const server2 = createServer().listen(() => {
    args.pass('listener')
    server2.close()
  })

  const server3 = createServer().listen(99234, () => {
    args.pass('port and listener')
    server3.close()
  })

  const server4 = createServer().listen(99235, '0.0.0.0', () => {
    args.pass('port, host and listener')
    server4.close()
  })
})

function waitForServer (server) {
  return new Promise((resolve, reject) => {
    server.on('listening', done)
    server.on('error', done)

    function done (error) {
      server.removeListener('listening', done)
      server.removeListener('error', done)
      error ? reject(error) : resolve()
    }
  })
}
