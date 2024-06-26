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

  await waitForServer(server)

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

  const a = createServer().listen()
  await waitForServer(a)

  const b = createServer().listen(a.address().port)

  b.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE', 'catch EADDRINUSE error')

    a.close()
    b.close()
  })
})

test('port already in use, listen again', async (t) => {
  t.plan(2)

  const a = createServer().listen()
  await waitForServer(a)

  const b = createServer().listen(a.address().port)

  b.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE', 'catch EADDRINUSE error')

    b.listen(() => {
      t.pass()

      a.close()
      b.close()
    })
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
    t.is(err.code, 'SERVER_ALREADY_LISTENING')
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

  const a = createConnection(port, () => {
    args.pass('port and listener')
    a.destroy()
  })

  const b = createConnection(port, 'localhost', () => {
    args.pass('port, host and listener')
    b.destroy()
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

  const server3 = createServer().listen(0, () => {
    args.pass('port and listener')
    server3.close()
  })

  const server4 = createServer().listen(0, '0.0.0.0', () => {
    args.pass('port, host and listener')
    server4.close()
  })
})

test('ipv6 support', async (t) => {
  t.plan(2)

  const server = createServer()
    .on('connection', (socket) => {
      socket
        .on('data', (data) => {
          t.is(data.toString(), 'hello ipv6', 'received message')

          server.close()
        })
        .end()
    })
    .listen(0, '::')

  await waitForServer(server)

  const { port, family } = server.address()

  t.is(family, 'IPv6', 'server family is \'IPv6\'')

  createConnection({ port, family: 6 }).end('hello ipv6')
})

test('handle invalid host', (t) => {
  t.plan(1)

  const server = createServer()

  server
    .on('error', (err) => t.ok(err))
    .listen(0, 'garbage')
})

test('basic timeout', async (t) => {
  const sub = t.test()
  sub.plan(3)

  const server = createServer((s) => s.end()).listen()
  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket.setTimeout(10, () => sub.pass('timeout callback'))
    socket.on('timeout', () => sub.pass('timeout event'))
    sub.is(socket.timeout, 10)
  })

  await sub

  socket.destroy()
  server.close()
})

test('timeout option', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = createServer((s) => s.end()).listen()
  await waitForServer(server)

  const { port } = server.address()

  const socket = createConnection({ port, timeout: 10 }, () => {
    socket.on('timeout', () => sub.pass('timeout triggered'))
  })

  await sub

  socket.destroy()
  server.close()
})

test('should not trigger timeout by writing activity', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const _sockets = []

  const server = createServer((s) => _sockets.push(s)).listen()
  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket.setTimeout(20, () => sub.fail('timeout triggered'))
    socket.on('timeout', () => sub.fail('timeout triggered'))

    const interval = setInterval(() => socket.write('message'), 5)
    setTimeout(() => {
      clearInterval(interval)
      sub.pass('timeout not triggered')
    }, 50)

    _sockets.push(socket)
  })

  await sub

  _sockets.forEach((s) => s.destroy())
  server.close()
})

test('should not trigger timeout by reading activity', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const _sockets = []

  const server = createServer((s) => {
    const interval = setInterval(() => s.write('message'), 5)

    setTimeout(() => {
      clearInterval(interval)
      sub.pass('timeout not triggered')
    }, 50)

    _sockets.push(s)
  }).listen()

  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket.setTimeout(20, () => sub.fail('timeout triggered'))
    socket.on('timeout', () => sub.fail('timeout triggered'))

    _sockets.push(socket)
  })

  await sub

  _sockets.forEach((s) => s.destroy())
  server.close()
})

function waitForServer (server) {
  return new Promise((resolve, reject) => {
    server
      .on('listening', done)
      .on('error', done)

    function done (error) {
      server
        .off('listening', done)
        .off('error', done)

      error ? reject(error) : resolve()
    }
  })
}
