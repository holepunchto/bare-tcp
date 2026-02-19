const test = require('brittle')
const { createServer, createConnection, connect, Socket } = require('.')

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

test('connect IPv4 loopback', async (t) => {
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
    .listen(0, '127.0.0.1')

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

test('address getters', async (t) => {
  t.plan(14)

  const server = createServer()
    .on('connection', (socket) => {
      t.is(socket.localAddress, '127.0.0.1')
      t.is(socket.localFamily, 'IPv4')
      t.is(typeof socket.localPort, 'number')

      t.is(socket.remoteAddress, '127.0.0.1')
      t.is(socket.remoteFamily, 'IPv4')
      t.is(typeof socket.remotePort, 'number')

      t.ok(socket.localPort !== socket.remotePort)

      socket.on('close', () => server.close()).end()
    })
    .listen(0, '127.0.0.1')

  await waitForServer(server)

  const { port: serverPort } = server.address()

  const socket = createConnection({ port: serverPort, noDelay: true, keepAlive: 1000 })
    .on('connect', () => {
      t.is(socket.localAddress, '127.0.0.1')
      t.is(socket.localFamily, 'IPv4')
      t.is(typeof socket.localPort, 'number')

      t.is(socket.remoteAddress, '127.0.0.1')
      t.is(socket.remoteFamily, 'IPv4')
      t.is(socket.remotePort, serverPort)

      t.ok(socket.localPort !== socket.remotePort)
    })
    .end()
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

test('createConnection and connect arguments', async (t) => {
  const createConnectionArgs = t.test('createConnection')
  createConnectionArgs.plan(3)

  const connectArgs = t.test('connect')
  connectArgs.plan(3)

  const server = createServer()
    .on('connection', (s) => s.end())
    .listen()

  await waitForServer(server)

  const { port } = server.address()
  const host = 'localhost'

  // createConnection
  const a = createConnection(port, () => {
    createConnectionArgs.pass('port and listener')
    a.destroy()
  })

  const b = createConnection(port, host, () => {
    createConnectionArgs.pass('port, host and listener')
    b.destroy()
  })

  const c = createConnection({ port, host }, () => {
    createConnectionArgs.pass('options and listener')
    c.destroy()
  })

  // connect
  const d = connect(port, () => {
    connectArgs.pass('port and listener')
    d.destroy()
  })

  const e = connect(port, host, () => {
    connectArgs.pass('port, host and listener')
    e.destroy()
  })

  const f = connect({ port, host }, () => {
    connectArgs.pass('options and listener')
    f.destroy()
  })

  await Promise.all([createConnectionArgs, connectArgs])

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

  t.is(family, 'IPv6', "server family is 'IPv6'")

  createConnection({ port, family: 6 }).end('hello ipv6')
})

test('handle invalid host', (t) => {
  t.plan(1)

  const server = createServer()

  server.on('error', (err) => t.ok(err)).listen(0, 'garbage')
})

test('connect handles empty DNS lookup results', (t) => {
  t.plan(2)

  const socket = createConnection({
    host: 'localhost',
    port: 1234,
    lookup(hostname, opts, cb) {
      t.is(hostname, 'localhost')
      cb(null, [])
    }
  })

  socket.on('error', (err) => {
    t.is(err.code, 'ENOTFOUND')
  })
})

test('basic timeout', async (t) => {
  const sub = t.test()
  sub.plan(3)

  const server = createServer((socket) => socket.end()).listen()
  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket.setTimeout(100, () => sub.pass('timeout callback'))
    socket.on('timeout', () => sub.pass('timeout event'))
    sub.is(socket.timeout, 100)
  })

  await sub

  socket.destroy()
  server.close()
})

test('disable timeout with setTimeout(0)', async (t) => {
  const sub = t.test()
  sub.plan(2)

  const server = createServer((socket) => socket.end()).listen()
  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket.setTimeout(100, () => sub.fail('timeout triggered'))

    socket.setTimeout(0)
    sub.is(socket.timeout, undefined)

    setTimeout(() => {
      sub.pass('timeout not triggeded')

      socket.end()
    }, 200)
  })

  await sub

  server.close()
})

test('timeout option', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = createServer((socket) => socket.end()).listen()
  await waitForServer(server)

  const { port } = server.address()

  const socket = createConnection({ port, timeout: 100 }, () => {
    socket.on('timeout', () => {
      sub.pass('timeout triggered')

      socket.end()
    })
  })

  await sub

  server.close()
})

test('should not trigger timeout by writing activity', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = createServer((socket) => {
    socket.end()
    socket.resume()
  }).listen()
  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket
      .on('timeout', () => sub.fail('timeout triggered'))
      .setTimeout(200, () => sub.fail('timeout triggered'))

    const interval = setInterval(() => socket.write('message'), 5)
    setTimeout(() => {
      sub.pass('timeout not triggered')

      clearInterval(interval)
      socket.end()
    }, 500)
  })

  await sub

  server.close()
})

test('should not trigger timeout by reading activity', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = createServer((socket) => {
    const interval = setInterval(() => socket.write('message'), 5)

    setTimeout(() => {
      sub.pass('timeout not triggered')

      clearInterval(interval)
      socket.end()
    }, 500)
  }).listen()

  await waitForServer(server)

  const socket = createConnection(server.address().port, () => {
    socket
      .on('timeout', () => sub.fail('timeout triggered'))
      .setTimeout(200, () => sub.fail('timeout triggered'))

    socket.end()
    socket.resume()
  })

  await sub

  server.close()
})

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    server.on('listening', done).on('error', done)

    function done(error) {
      server.off('listening', done).off('error', done)

      error ? reject(error) : resolve()
    }
  })
}
