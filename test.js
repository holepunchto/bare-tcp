const test = require('brittle')
const os = require('bare-os')
const tcp = require('.')
const binding = require('./binding')

test('server + client', async (t) => {
  t.plan(2)

  const lc = t.test('lifecycle')
  lc.plan(5)

  const server = tcp
    .createServer()
    .on('close', () => t.pass('server closed'))
    .on('connection', (socket) => {
      socket
        .on('close', () => lc.pass('server connection closed'))
        .on('data', (data) => lc.alike(data.toString(), 'hello world', 'server received message'))
        .end()
    })
    .on('listening', () => lc.pass('server listening'))
    .listen()

  await waitForListening(server)

  const { port } = server.address()

  tcp
    .createConnection(port)
    .on('connect', () => lc.pass('client connection opened'))
    .on('close', () => lc.pass('client connection closed'))
    .end('hello world')

  await lc

  server.close()
})

test('server + client, over IPv4', async (t) => {
  t.plan(2)

  const lc = t.test('lifecycle')
  lc.plan(5)

  const server = tcp
    .createServer()
    .on('close', () => t.pass('server closed'))
    .on('connection', (socket) => {
      socket
        .on('close', () => lc.pass('server connection closed'))
        .on('data', (data) => lc.alike(data.toString(), 'hello world', 'server received message'))
        .end()
    })
    .on('listening', () => lc.pass('server listening'))
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  tcp
    .createConnection(port)
    .on('connect', () => lc.pass('client connection opened'))
    .on('close', () => lc.pass('client connection closed'))
    .end('hello world')

  await lc

  server.close()
})

test('server + client, over IPv6', async (t) => {
  t.plan(2)

  const server = tcp
    .createServer()
    .on('connection', (socket) => {
      socket
        .on('data', (data) => {
          t.is(data.toString(), 'hello ipv6', 'received message')

          server.close()
        })
        .end()
    })
    .listen(0, '::')

  await waitForListening(server)

  const { port, family } = server.address()

  t.is(family, 'IPv6', "server family is 'IPv6'")

  tcp.createConnection({ port, family: 6 }).end('hello ipv6')
})

test('socket, state getters', async (t) => {
  t.plan(5)

  const server = tcp.createServer((socket) => socket.end()).listen()
  await waitForListening(server)

  const socket = new tcp.Socket()
  t.is(socket.pending, true, 'pending')

  socket.connect(server.address().port)
  t.is(socket.connecting, true, 'connecting')

  await waitFor(socket, 'connect')

  t.is(socket.pending, false, 'not pending once connected')

  socket.destroy()

  await waitFor(socket, 'close')

  t.is(socket.pending, true, 'pending again once the handle is gone, as in Node')
  t.is(socket.connecting, false, 'not connecting')

  server.close()
})

test('socket, readyState', async (t) => {
  t.plan(6)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = new tcp.Socket()
  t.is(socket.readyState, 'closed', 'closed before connect, as in Node')

  socket.connect(server.address().port, '127.0.0.1')

  t.is(socket.readyState, 'opening', 'opening while connecting')

  await waitFor(socket, 'connect')

  t.is(socket.readyState, 'open', 'open once connected')

  // The peer ends, which ends the readable half and leaves the writable half
  // open, as in Node.
  socket.resume()

  await waitFor(socket, 'end')

  t.is(socket.readyState, 'writeOnly', 'write only once the peer has ended')

  socket.end()

  await waitFor(socket, 'close')

  t.is(socket.readyState, 'closed', 'closed once destroyed')

  server.close()

  await waitFor(server, 'close')

  const unconnected = new tcp.Socket()
  unconnected.destroy()

  await waitFor(unconnected, 'close')

  t.is(unconnected.readyState, 'closed', 'closed without ever connecting')
})

test('socket, readyState is read only once the writable half has ended', async (t) => {
  t.plan(1)

  const server = tcp.createServer().listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  await waitFor(socket, 'connect')

  socket.end()

  await waitFor(socket, 'finish')

  t.is(socket.readyState, 'readOnly', 'read only once the writable half has ended')

  socket.destroy()
  server.close()
})

test('socket, address', async (t) => {
  t.plan(4)

  const server = tcp
    .createServer()
    .on('connection', (socket) => {
      t.alike(
        socket.address(),
        { address: '127.0.0.1', family: 'IPv4', port: server.address().port },
        'server connection address'
      )

      socket.on('close', () => server.close()).end()
    })
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = new tcp.Socket()

  t.is(socket.address(), null, 'no address before connect')

  socket
    .on('connect', () => {
      t.alike(
        socket.address(),
        { address: socket.localAddress, family: socket.localFamily, port: socket.localPort },
        'address matches the local getters'
      )

      t.is(socket.address().address, '127.0.0.1', 'connected over IPv4 loopback')
    })
    .connect(server.address().port, '127.0.0.1')
    .end()
})

test('socket, link local addresses keep their zone', async (t) => {
  const bound = await listenLinkLocal()

  if (bound === null) {
    t.comment('no bindable link local interface available')

    return
  }

  const { server, host } = bound

  // A link local address without its zone is ambiguous between interfaces, so
  // it has to survive the round trip through the binding.
  const { address, port } = server.address()

  t.not(address.indexOf('%'), -1, 'the reported address carries a zone: ' + address)
  t.is(address.split('%')[0], host.split('%')[0], 'and is otherwise unchanged')

  const socket = tcp.createConnection(port, address)

  await waitFor(socket, 'connect')

  t.is(socket.remoteAddress, address, 'the peer address carries it too')

  socket.destroy()
  server.close()
})

test('socket, connecting is false after failed connect', async (t) => {
  const socket = new tcp.Socket()
  socket.on('error', () => {})
  socket.connect(1, '127.0.0.1')

  await new Promise((resolve) => socket.on('close', resolve))

  t.absent(socket.connecting, 'not connecting after failed connect')
})

test('socket, address getters', async (t) => {
  t.plan(14)

  const server = tcp
    .createServer()
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

  await waitForListening(server)

  const { port: serverPort } = server.address()

  const socket = tcp
    .createConnection({ port: serverPort, noDelay: true, keepAlive: 1000 })
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

test('socket, address getters of an opened socket', (t) => {
  t.plan(2)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket().open(a)
  const right = new tcp.Socket().open(b)

  // A socket pair is not necessarily a TCP socket, in which case it has no
  // address.
  t.ok(left.localAddress === undefined || typeof left.localAddress === 'string', 'local address')
  t.ok(left.remoteAddress === undefined || typeof left.remoteAddress === 'string', 'remote address')

  left.destroy()
  right.destroy()
})

test('socket, connect arguments', async (t) => {
  const args = t.test('args')
  args.plan(4)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const a = new tcp.Socket().connect(port, () => {
    args.pass('port and listener')
    a.destroy()
  })

  const b = new tcp.Socket().connect(port, '127.0.0.1', () => {
    args.pass('port, host and listener')
    b.destroy()
  })

  const c = new tcp.Socket().connect(port, '127.0.0.1', {}, () => {
    args.pass('port, host, options and listener')
    c.destroy()
  })

  const d = new tcp.Socket().connect({ port, host: '127.0.0.1' }, () => {
    args.pass('options and listener')
    d.destroy()
  })

  await args

  server.close()
})

test('socket, connect passes the family option to the lookup', async (t) => {
  const families = t.test('families')
  families.plan(4)

  function lookup(label) {
    return (host, opts, cb) => {
      families.is(opts.family, 6, label)

      queueMicrotask(() => cb(new Error('lookup failed')))
    }
  }

  const a = new tcp.Socket().on('error', noop)
  a.connect(1, 'test.invalid', { family: 6, lookup: lookup('port, host and options') })

  const b = new tcp.Socket().on('error', noop)
  b.connect({ port: 1, host: 'test.invalid', family: 6, lookup: lookup('options') })

  const c = tcp
    .createConnection(1, 'test.invalid', {
      family: 6,
      lookup: lookup('createConnection with port, host and options')
    })
    .on('error', noop)

  const d = tcp
    .createConnection({
      port: 1,
      host: 'test.invalid',
      family: 6,
      lookup: lookup('createConnection with options')
    })
    .on('error', noop)

  await families

  t.ok(c.destroying && d.destroying, 'the failed lookups destroyed the sockets')
})

test('socket, connect while already connecting or connected', async (t) => {
  t.plan(2)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const socket = tcp.createConnection(port, '127.0.0.1')

  t.exception(
    () => socket.connect(port, '127.0.0.1'),
    /SOCKET_ALREADY_CONNECTED/,
    'while connecting'
  )

  socket.on('connect', () => {
    t.exception(
      () => socket.connect(port, '127.0.0.1'),
      /SOCKET_ALREADY_CONNECTED/,
      'while connected'
    )

    socket.destroy()
    server.close()
  })
})

test('socket, connect without port', (t) => {
  t.plan(1)

  const socket = new tcp.Socket().connect({ host: '127.0.0.1' })

  socket.on('error', (err) => t.ok(err.code, `connecting to port 0 failed with ${err.code}`))
})

test('socket, connect without host', async (t) => {
  t.plan(1)

  const server = tcp.createServer((socket) => socket.end()).listen()

  await waitForListening(server)

  const socket = new tcp.Socket().connect({ port: server.address().port }, () => {
    t.pass('connected to localhost')

    socket.destroy()
    server.close()
  })
})

test('socket, connect with empty host', async (t) => {
  t.plan(1)

  const server = tcp.createServer((socket) => socket.end()).listen()

  await waitForListening(server)

  const { port } = server.address()

  const socket = new tcp.Socket().connect(port, '', () => {
    t.pass('connected to localhost')

    socket.destroy()
    server.close()
  })
})

test('socket, connect with an out-of-range port', (t) => {
  const cases = [-1, 65536, 75535, 1.5, NaN, Infinity, 'foo', null, undefined]

  for (const port of cases) {
    t.exception(
      () => new tcp.Socket().connect(port, '127.0.0.1'),
      /INVALID_PORT/,
      `connect(${String(port)})`
    )
  }
})

test('socket, connect with an out-of-range port in options', (t) => {
  t.exception(() => new tcp.Socket().connect({ port: 65536, host: '127.0.0.1' }), /INVALID_PORT/)
  t.exception(() => tcp.createServer().listen({ port: 65536 }), /INVALID_PORT/)
})

test('socket, connect with an invalid host', (t) => {
  t.plan(1)

  const server = tcp.createServer()

  server.on('error', (err) => t.ok(err)).listen(0, 'garbage')
})

test('socket, connect with a host longer than the maximum', (t) => {
  const max = tcp.constants.address.MAX_LENGTH
  const host = `::1%${'a'.repeat(max)}`

  t.ok(Buffer.byteLength(host) > max)

  // Rejected up front, like any other invalid argument, rather than reaching
  // the binding and failing asynchronously.
  t.exception(() => new tcp.Socket().connect(1234, host), /INVALID_HOST/)
})

test('socket, connect with empty lookup results', (t) => {
  t.plan(2)

  const socket = tcp.createConnection({
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

test('socket, connect with malformed lookup results', async (t) => {
  // A resolved address is used as the host of another connect, so one that
  // isn't an IP address would be resolved again, and again.
  const cases = [
    ['not an IP address', [{ address: 'not-an-ip', family: 4 }]],
    ['address not a string', [{ address: 42, family: 4 }]],
    ['not an array', 'wat'],
    ['null', null],
    ['entry not an object', [42]],
    [
      'address too long',
      [{ address: `::1%${'a'.repeat(tcp.constants.address.MAX_LENGTH)}`, family: 6 }]
    ]
  ]

  t.plan(cases.length * 2)

  for (const [name, result] of cases) {
    let calls = 0

    await new Promise((resolve) => {
      const socket = tcp.createConnection({
        host: 'example.invalid',
        port: 1234,
        lookup(hostname, opts, cb) {
          calls++
          cb(null, result)
        }
      })

      socket.on('error', (err) => {
        t.is(err.code, 'INVALID_HOST', name)
        t.is(calls, 1, `${name} is not retried`)

        resolve()
      })
    })
  }
})

test('socket, connect tolerates an unusable family from the lookup', (t) => {
  t.plan(1)

  // The family is derived locally from the address, so whatever the resolver
  // reports for it never reaches the binding.
  const socket = tcp.createConnection({
    host: 'example.invalid',
    port: 1,
    lookup(hostname, opts, cb) {
      cb(null, [{ address: '127.0.0.1', family: 'four' }])
    }
  })

  socket.on('error', (err) => t.ok(err.code, `connect proceeded and failed with ${err.code}`))
})

test('socket, lookup failure while opening', (t) => {
  t.plan(2)

  const socket = tcp.createConnection({
    port: 1234,
    host: 'test.invalid',
    lookup(hostname, opts, cb) {
      // Resolve asynchronously so that the socket is already opening by the
      // time the lookup fails.
      setImmediate(() => {
        const err = new Error(`No address found for host "${hostname}"`)
        err.code = 'ENOTFOUND'

        cb(err)
      })
    }
  })

  socket.on('lookup', (err) => t.is(err.code, 'ENOTFOUND', 'lookup failed'))
  socket.on('error', (err) => t.is(err.code, 'ENOTFOUND', 'socket errored'))
})

test('socket, connect listener is called once when retrying addresses', async (t) => {
  t.plan(2)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  let connects = 0

  const socket = tcp.createConnection(
    {
      port: server.address().port,
      host: 'test.invalid',
      lookup(hostname, opts, cb) {
        // The first address is not listened on, so it is retried.
        cb(null, [
          { address: '::1', family: 6 },
          { address: '127.0.0.1', family: 4 }
        ])
      }
    },
    () => connects++
  )

  socket.on('connect', () =>
    setImmediate(() => {
      t.is(socket.remoteAddress, '127.0.0.1', 'connected to the second address')
      t.is(connects, 1, 'connect listener called once')

      socket.destroy()
      server.close()
    })
  )
})

test('socket, connect fails for every address', (t) => {
  t.plan(2)

  const socket = tcp.createConnection({
    port: 1,
    host: 'test.invalid',
    lookup(hostname, opts, cb) {
      cb(null, [
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ])
    }
  })

  socket.on('error', (err) => {
    t.ok(err instanceof AggregateError, 'aggregate error')
    t.is(err.errors.length, 2, 'one error per address')
  })
})

test('socket, connect retries a synchronous failure', async (t) => {
  t.plan(2)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection({
    port: server.address().port,
    host: 'test.invalid',
    lookup(hostname, opts, cb) {
      // Connecting to a multicast address fails synchronously.
      cb(null, [
        { address: 'ff02::1', family: 6 },
        { address: '127.0.0.1', family: 4 }
      ])
    }
  })

  socket.on('error', (err) => t.fail(`should have retried, got ${err.code}`))

  socket.on('connect', () => {
    t.is(socket.remoteAddress, '127.0.0.1', 'connected to the second address')
    t.pass('retried the second address')

    socket.destroy()
    server.close()
  })
})

test('socket, connect failure without eager open', (t) => {
  t.plan(1)

  const socket = new tcp.Socket({ eagerOpen: false }).connect(1, '127.0.0.1')

  socket.on('error', (err) => t.ok(err.code, `connect failed with ${err.code}`))
})

test('socket, connect without port or eager open', (t) => {
  t.plan(1)

  const socket = new tcp.Socket({ eagerOpen: false }).connect({ host: '127.0.0.1' })

  socket.on('error', (err) => t.ok(err.code, `connecting to port 0 failed with ${err.code}`))
})

test('socket, connect validates the socket options before connecting', async (t) => {
  t.plan(6)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const socket = new tcp.Socket()

  t.exception(
    () => socket.connect(port, '127.0.0.1', { timeout: 1.5 }),
    /INVALID_ARGUMENT/,
    'timeout'
  )

  t.exception(
    () => socket.connect(port, '127.0.0.1', { keepAlive: true, keepAliveInitialDelay: -1 }),
    /INVALID_ARGUMENT/,
    'keep alive initial delay'
  )

  // The host is resolved only once the options check out, so a hostname throws
  // just the same rather than failing the connect from the lookup callback.
  t.exception(
    () =>
      socket.connect(port, 'test.invalid', {
        timeout: 1.5,
        lookup: () => t.fail('should not have resolved')
      }),
    /INVALID_ARGUMENT/,
    'timeout with a hostname'
  )

  t.absent(socket.connecting, 'the socket was left alone')

  socket.connect(port, '127.0.0.1', () => {
    t.pass('connects once the options are valid')

    socket.destroy()
    server.close()
  })

  t.ok(socket.connecting, 'connecting')
})

test('socket, connect after a failed connect', (t) => {
  t.plan(1)

  const socket = new tcp.Socket()

  socket.on('error', () => {})
  socket.connect(1, '127.0.0.1')

  socket.on('close', () =>
    t.exception(() => socket.connect(1, '127.0.0.1'), /SOCKET_IS_CLOSED/, 'connect')
  )
})

test('socket, connect after being destroyed', async (t) => {
  t.plan(2)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const a = new tcp.Socket()
  a.destroy()

  a.on('close', () => {
    t.exception(() => a.connect(port, '127.0.0.1'), /SOCKET_IS_CLOSED/, 'connect')
    t.exception(() => a.open(9999), /SOCKET_IS_CLOSED/, 'open')

    server.close()
  })
})

test('socket, destroy during reset', (t) => {
  t.plan(2)

  const socket = new tcp.Socket()

  socket.on('close', () => t.pass('closed'))

  socket.connect({
    port: 1,
    host: 'test.invalid',
    lookup(hostname, opts, cb) {
      cb(null, [
        { address: '0000:0000:0000:0000:0000:ffff:255.255.255.255%lo0', family: 6 },
        { address: '127.0.0.1', family: 4 }
      ])

      queueMicrotask(() => {
        // The reset clears the state of the failed attempt, which is what tells
        // the two apart: the socket is still connecting if the attempt has yet
        // to fail.
        t.absent(socket.connecting, 'the failed attempt has been reset')

        socket.destroy()
      })
    }
  })
})

test('socket, destroy while connecting with multiple addresses', (t) => {
  t.plan(1)

  const socket = new tcp.Socket()

  socket.on('close', () => t.pass('closed'))

  socket.connect({
    port: 1,
    host: 'test.invalid',
    lookup(hostname, opts, cb) {
      cb(null, [
        { address: '127.0.0.1', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ])

      socket.destroy()
    }
  })
})

test('socket, open arguments', async (t) => {
  const args = t.test('args')
  args.plan(2)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket().open(a, () => {
    args.pass('fd and listener')
    left.destroy()
  })

  const right = new tcp.Socket().open({ fd: b }, () => {
    args.pass('options and listener')
    right.destroy()
  })

  await args
})

test('socket, open with options', (t) => {
  t.plan(3)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket()
  const right = new tcp.Socket().open(b)

  left.open({ fd: a, timeout: 5000 })

  t.is(left.timeout, 5000, 'the timeout option is applied')
  t.absent(left.keepAlive, 'keep alive is untouched')
  t.absent(left.noDelay, 'no delay is untouched')

  left.destroy()
  right.destroy()
})

test('socket, open validates the socket options before adopting the fd', (t) => {
  t.plan(4)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket()
  const right = new tcp.Socket().open(b)

  t.exception(() => left.open(a, { timeout: 1.5 }), /INVALID_ARGUMENT/, 'timeout')

  t.exception(
    () => left.open(a, { keepAlive: true, keepAliveInitialDelay: -1 }),
    /INVALID_ARGUMENT/,
    'keep alive initial delay'
  )

  t.ok(left.pending, 'the file descriptor was not adopted')

  left.open(a, () => {
    t.pass('opens once the options are valid')

    left.destroy()
    right.destroy()
  })
})

test('socket, open with an invalid fd', (t) => {
  const cases = [-1, 1.5, NaN, Infinity, 'foo', null, undefined, {}]

  for (const fd of cases) {
    t.exception(() => new tcp.Socket().open(fd), /INVALID_FD/, `open(${String(fd)})`)
  }
})

test('socket, open with an unusable fd', (t) => {
  t.plan(1)

  // A valid file descriptor number that is not an open socket.
  const socket = new tcp.Socket().open(9999)

  socket.on('error', (err) =>
    t.ok(err.code === 'EBADF' || err.code === 'ENOTSOCK', `open failed with ${err.code}`)
  )
})

test('socket, open with an unusable fd without eager open', (t) => {
  t.plan(1)

  const socket = new tcp.Socket({ eagerOpen: false }).open(9999)

  socket.on('error', (err) =>
    t.ok(err.code === 'EBADF' || err.code === 'ENOTSOCK', `open failed with ${err.code}`)
  )
})

test('socket, open on a later tick', (t) => {
  t.plan(2)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket()
  const right = new tcp.Socket().open(b)

  right.on('data', (data) => {
    t.alike(data, Buffer.from('hello'), 'data flows after a deferred open')

    left.destroy()
    right.destroy()
  })

  // Open on a later tick, as an fd received over IPC would be.
  setImmediate(() => {
    left.open(a, () => t.pass('connected'))
    left.write('hello')
  })
})

test('socket, open twice', (t) => {
  const [a, b] = tcp.socketpair()

  const socket = new tcp.Socket().open(a)

  t.exception(() => socket.open(b), /SOCKET_ALREADY_CONNECTED/)

  socket.destroy()
})

test('socket, options recorded before an accept are applied', (t) => {
  const keepalive = binding.keepalive
  const nodelay = binding.nodelay

  t.teardown(() => {
    binding.keepalive = keepalive
    binding.nodelay = nodelay
  })

  const applied = []

  binding.keepalive = (handle, enable, delay) => applied.push(['keepalive', enable, delay])
  binding.nodelay = (handle, enable) => applied.push(['nodelay', enable])

  const socket = new tcp.Socket()

  socket.setKeepAlive(true, 5000)
  socket.setNoDelay(true)

  t.alike(applied, [], 'nothing is applied while the socket has no peer')

  // An IPC accept hands over an already connected handle, the way bare-pipe's
  // `accept()` does.
  socket[Symbol.for('bare.ipc.accept')]()

  t.alike(
    applied,
    [
      ['keepalive', true, 5],
      ['nodelay', true]
    ],
    'the recorded options are applied once accepted'
  )

  socket.destroy()
})

test('socket, keepAlive and noDelay', async (t) => {
  t.plan(8)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const a = new tcp.Socket()

  t.absent(a.keepAlive, 'keep alive is disabled by default')
  t.is(a.keepAliveInitialDelay, 0, 'no initial delay by default')
  t.absent(a.noDelay, 'no delay is disabled by default')

  a.setKeepAlive(true)
  t.ok(a.keepAlive, 'setKeepAlive(true) enables keep alive')

  a.setKeepAlive(5000)
  t.ok(a.keepAlive, 'setKeepAlive(delay) enables keep alive')
  t.is(a.keepAliveInitialDelay, 5000, 'setKeepAlive(delay) sets the initial delay')

  a.destroy()

  const b = tcp.createConnection({ port, host: '127.0.0.1', keepAlive: 1000, noDelay: true })

  b.on('connect', () => {
    t.ok(b.keepAlive, 'the keepAlive option enables keep alive')
    t.ok(b.noDelay, 'the noDelay option enables no delay')

    b.destroy()
    server.close()
  })
})

test('socket, setKeepAlive without delay', async (t) => {
  t.plan(2)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  socket.on('connect', () => {
    t.is(socket.setKeepAlive(true), socket, 'returns the socket')
    t.is(socket.setNoDelay(), socket, 'returns the socket')

    socket.destroy()
    server.close()
  })
})

test('socket, setKeepAlive and setNoDelay on a non-TCP socket', (t) => {
  t.plan(2)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket().open(a)
  const right = new tcp.Socket().open(b)

  // Depending on the platform, socketpair() may not return TCP sockets, in
  // which case the options cannot be set and must be reported as such.
  for (const [name, fn] of [
    ['setNoDelay', () => left.setNoDelay()],
    ['setKeepAlive', () => left.setKeepAlive(true, 1000)]
  ]) {
    try {
      fn()
      t.pass(`${name} succeeded`)
    } catch (err) {
      t.ok(err.code, `${name} failed with ${err.code}`)
    }
  }

  left.destroy()
  right.destroy()
})

test('socket, timeout', async (t) => {
  const sub = t.test()
  sub.plan(3)

  const server = tcp.createServer((socket) => socket.end()).listen()
  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, () => {
    socket.setTimeout(100, () => sub.pass('timeout callback'))
    socket.on('timeout', () => sub.pass('timeout event'))
    sub.is(socket.timeout, 100)
  })

  await sub

  socket.destroy()
  server.close()
})

test('socket, timeout option', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = tcp.createServer((socket) => socket.end()).listen()
  await waitForListening(server)

  const { port } = server.address()

  const socket = tcp.createConnection({ port, timeout: 100 }, () => {
    socket.on('timeout', () => {
      sub.pass('timeout triggered')

      socket.end()
    })
  })

  await sub

  server.close()
})

test('socket, setTimeout of zero disables the timeout', async (t) => {
  const sub = t.test()
  sub.plan(2)

  const server = tcp.createServer((socket) => socket.end()).listen()
  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, () => {
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

test('socket, setTimeout validation', (t) => {
  const socket = new tcp.Socket()

  socket.setTimeout(50)

  t.exception(() => socket.setTimeout('x'), /INVALID_ARGUMENT/, 'not a number')
  t.exception(() => socket.setTimeout(-1), /INVALID_ARGUMENT/, 'negative')
  t.exception(() => socket.setTimeout(NaN), /INVALID_ARGUMENT/, 'NaN')
  t.exception(() => socket.setTimeout(1.5), /INVALID_ARGUMENT/, 'not an integer')

  t.is(socket.timeout, 50, 'unchanged by the failed assignments')

  socket.setTimeout(0)

  t.is(socket.timeout, undefined, 'disabled')

  socket.destroy()
})

test('socket, setTimeout of zero removes the timeout listener', (t) => {
  const socket = new tcp.Socket()

  const ontimeout = () => t.fail('should have been removed')

  socket.setTimeout(50, ontimeout)
  socket.setTimeout(0, ontimeout)

  t.is(socket.listenerCount('timeout'), 0, 'listener removed, as in Node')

  socket.setTimeout(50, ontimeout)

  t.is(socket.listenerCount('timeout'), 1, 'listener added again')

  socket.setTimeout(0)

  t.is(socket.listenerCount('timeout'), 1, 'left alone when no listener is passed')

  socket.destroy()
})

test('socket, setTimeout replaces the previous timeout', async (t) => {
  const sub = t.test()
  sub.plan(3)

  const server = tcp
    .createServer({ allowHalfOpen: false }, (socket) => socket.resume())
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1', () => {
    socket.setTimeout(50)
    socket.setTimeout(5000)

    sub.is(socket.timeout, 5000, 'timeout updated')

    const onstale = () => sub.fail('replaced timeout triggered')

    socket.on('timeout', onstale)

    setTimeout(() => {
      sub.pass('replaced timeout did not trigger')

      socket.off('timeout', onstale)

      socket.setTimeout(100, () => {
        sub.pass('rearmed timeout triggered')

        socket.destroy()
        server.close()
      })
    }, 200)
  })

  await sub
})

test('socket, write activity defers the timeout', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = tcp
    .createServer((socket) => {
      socket.end()
      socket.resume()
    })
    .listen()
  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, () => {
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

test('socket, read activity defers the timeout', async (t) => {
  const sub = t.test()
  sub.plan(1)

  const server = tcp
    .createServer((socket) => {
      const interval = setInterval(() => socket.write('message'), 5)

      setTimeout(() => {
        sub.pass('timeout not triggered')

        clearInterval(interval)
        socket.end()
      }, 500)
    })
    .listen()

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, () => {
    socket
      .on('timeout', () => sub.fail('timeout triggered'))
      .setTimeout(200, () => sub.fail('timeout triggered'))

    socket.end()
    socket.resume()
  })

  await sub

  server.close()
})

test('socket, pause and resume while reading', async (t) => {
  t.plan(2)

  const size = 1024 * 1024

  const server = tcp.createServer((socket) => socket.end(Buffer.alloc(size))).listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  let received = 0
  let paused = false

  socket.on('data', (data) => {
    received += data.byteLength

    if (paused) return

    // Stop consuming so that the read buffer fills up and reading is paused.
    paused = true
    socket.pause()

    setTimeout(() => socket.resume(), 100)
  })

  socket.on('end', () => {
    t.ok(paused, 'reading was paused')
    t.is(received, size, 'received everything')

    socket.destroy()
    server.close()
  })
})

test('socket, read error when peer closes with unread data', async (t) => {
  t.plan(1)

  const server = tcp
    .createServer((socket) => {
      // Leave the incoming data unread so that closing resets the connection.
      socket.pause()

      setTimeout(() => socket.destroy(), 300)
    })
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  socket.on('connect', () => socket.write(Buffer.alloc(256 * 1024)))
  socket.resume()

  socket.on('error', (err) => {
    t.ok(err.code === 'ECONNRESET' || err.code === 'ECONNABORTED', `read failed with ${err.code}`)

    server.close()
  })
})

test('socket, destroy with a write in flight', async (t) => {
  t.plan(2)

  const server = tcp
    .createServer((socket) => {
      socket.resume()
      socket.end()
    })
    .listen()

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, () => {
    socket.write('hello')
    setImmediate(() => socket.destroy())
  })

  socket.on('close', () => {
    t.pass('socket closed')

    server.close(() => t.pass('server closed'))
  })
})

test('socket, close is emitted once the handle has closed', async (t) => {
  t.plan(1)

  const server = tcp.createServer((socket) => socket.resume()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const order = []

  let socket = null

  // The native close callback is captured when the socket is constructed, so it
  // has to be replaced on the prototype before connecting.
  const onclose = tcp.Socket.prototype._onclose

  t.teardown(() => {
    tcp.Socket.prototype._onclose = onclose
  })

  tcp.Socket.prototype._onclose = function () {
    if (this === socket) order.push('handle')

    return onclose.call(this)
  }

  socket = tcp.createConnection(server.address().port, '127.0.0.1')

  await waitFor(socket, 'connect')

  socket.on('close', () => order.push('close'))

  socket.destroy()

  await waitFor(socket, 'close')

  t.alike(order, ['handle', 'close'], 'the handle is closed before close is emitted')

  server.close()
})

test('socket, destroying is set before close is emitted', async (t) => {
  t.plan(7)

  const server = tcp.createServer((socket) => socket.resume()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  await waitFor(socket, 'connect')

  let closed = false

  socket.on('close', () => {
    closed = true
  })

  socket.destroy()

  // `close` is only emitted once the handle has closed, which takes at least
  // one turn of the loop, so `destroying` is the only synchronous signal that
  // the socket is on its way out. Consumers that pool sockets have to check it
  // rather than `destroyed`.
  t.is(socket.destroying, true, 'destroying immediately after destroy')
  t.is(socket.destroyed, false, 'not destroyed until the handle has closed')
  t.is(socket.readyState, 'closed', 'closed immediately after destroy')
  t.is(closed, false, 'close not emitted synchronously')

  await new Promise((resolve) => setImmediate(resolve))

  t.is(closed, false, 'close not emitted within the same turn of the loop')

  await waitFor(socket, 'close')

  t.is(socket.destroying, true, 'still destroying once closed')
  t.is(socket.destroyed, true, 'destroyed once closed')

  server.close()
})

test('socket, ref and unref', async (t) => {
  t.plan(3)

  const server = tcp.createServer((socket) => socket.end()).listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  t.is(socket.unref(), socket, 'unref returns the socket')
  t.is(socket.ref(), socket, 'ref returns the socket')

  socket.on('connect', () => {
    t.pass('still connects')

    socket.destroy()
    server.close()
  })
})

test('server, keepAlive and noDelay options', async (t) => {
  t.plan(1)

  const server = tcp
    .createServer({ keepAlive: 1000, noDelay: true }, (socket) => {
      socket.on('data', (data) => {
        t.alike(data.toString(), 'hello world', 'server received message')

        socket.end()
        server.close()
      })
    })
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  tcp.createConnection(server.address().port, '127.0.0.1').end('hello world')
})

test('server, listening is false after close', async (t) => {
  t.plan(3)

  const server = tcp.createServer()

  server.listen(0)

  await waitForListening(server)

  t.ok(server.listening, 'listening while bound')

  server.close(() => {
    t.absent(server.listening, 'not listening after close')
    t.is(server.address(), null, 'no address after close')
  })
})

test('server, closing', async (t) => {
  t.plan(3)

  const server = tcp.createServer()

  t.absent(server.closing, 'not closing before listening')

  server.listen(0)

  await waitForListening(server)

  server.close()

  t.ok(server.closing, 'closing as soon as close is called')

  await new Promise((resolve) => server.on('close', resolve))

  t.absent(server.closing, 'no longer closing once closed')
})

test('server, address while not listening', (t) => {
  const server = tcp.createServer()
  t.is(server.address(), null)
})

test('server, listen arguments', (t) => {
  const args = t.test('args')
  args.plan(4)

  const server1 = tcp.createServer().listen()
  server1.on('listening', () => {
    args.pass('no args')
    server1.close()
  })

  const server2 = tcp.createServer().listen(() => {
    args.pass('listener')
    server2.close()
  })

  const server3 = tcp.createServer().listen(0, () => {
    args.pass('port and listener')
    server3.close()
  })

  const server4 = tcp.createServer().listen(0, '0.0.0.0', () => {
    args.pass('port, host and listener')
    server4.close()
  })
})

test('server, listen arguments with backlog and options', async (t) => {
  const args = t.test('args')
  args.plan(3)

  const a = tcp.createServer().listen(0, '127.0.0.1', 511, () => {
    args.pass('port, host, backlog and listener')
    a.close()
  })

  const b = tcp.createServer().listen({ host: '127.0.0.1' })
  b.on('listening', () => {
    args.pass('options without port')
    b.close()
  })

  const c = tcp.createServer().listen(0, '', 0)
  c.on('listening', () => {
    args.pass('empty host and backlog')
    c.close()
  })

  await args
})

test('server, listen passes the family option to the lookup', async (t) => {
  const families = t.test('families')
  families.plan(2)

  function lookup(label) {
    return (host, opts, cb) => {
      families.is(opts.family, 6, label)

      queueMicrotask(() => cb(new Error('lookup failed')))
    }
  }

  const a = tcp.createServer().on('error', noop)
  a.listen(0, 'test.invalid', 511, {
    family: 6,
    lookup: lookup('port, host, backlog and options')
  })

  const b = tcp.createServer().on('error', noop)
  b.listen({ port: 0, host: 'test.invalid', family: 6, lookup: lookup('options') })

  await families

  a.close()
  b.close()
})

test('server, listen with an out-of-range port', (t) => {
  const cases = [-1, 65536, 75535, 1.5, NaN, Infinity, 'foo']

  for (const port of cases) {
    t.exception(() => tcp.createServer().listen(port), /INVALID_PORT/, `listen(${String(port)})`)
  }
})

test('server, listen with a malformed host, port or backlog', (t) => {
  const server = tcp.createServer()

  t.exception(() => server.listen(0, 42), /INVALID_HOST/, 'host that is not a string')
  t.exception(() => server.listen(0, '127.0.0.1', NaN), /INVALID_ARGUMENT/, 'backlog of NaN')
  t.exception(
    () => server.listen({ backlog: NaN }),
    /INVALID_ARGUMENT/,
    'backlog of NaN in options'
  )
  t.exception(() => server.listen({ port: NaN }), /INVALID_PORT/, 'port of NaN in options')

  t.absent(server.listening, 'the server was left alone')

  server.listen(0, '127.0.0.1', () => {
    t.pass('listens once the arguments are valid')

    server.close()
  })
})

test('server, listen with a host longer than the maximum', (t) => {
  const max = tcp.constants.address.MAX_LENGTH
  const host = `::1%${'a'.repeat(max)}`

  t.ok(Buffer.byteLength(host) > max)

  t.exception(() => tcp.createServer().listen(0, host), /INVALID_HOST/)
})

test('server, listen with malformed lookup results', async (t) => {
  const cases = [
    ['not an IP address', 'not-an-ip'],
    ['address not a string', 42],
    ['address undefined', undefined],
    ['address too long', `::1%${'a'.repeat(tcp.constants.address.MAX_LENGTH)}`]
  ]

  t.plan(cases.length * 3)

  for (const [name, address] of cases) {
    let calls = 0

    await new Promise((resolve) => {
      const server = tcp.createServer()

      server.on('lookup', (err) => t.is(err.code, 'INVALID_HOST', `${name} reported to 'lookup'`))

      server.on('error', (err) => {
        t.is(err.code, 'INVALID_HOST', name)
        t.is(calls, 1, `${name} is not retried`)

        resolve()
      })

      server.listen(0, 'example.invalid', 511, {
        lookup(hostname, opts, cb) {
          calls++
          cb(null, address, 4)
        }
      })
    })
  }
})

test('server, listen while already listening', async (t) => {
  t.plan(1)

  const server = tcp.createServer().listen()
  await waitForListening(server)

  const { port } = server.address()

  try {
    server.listen(port)
  } catch (err) {
    t.is(err.code, 'SERVER_ALREADY_LISTENING')
    server.close()
  }
})

test('server, listen on a port already in use', async (t) => {
  t.plan(1)

  const a = tcp.createServer().listen()
  await waitForListening(a)

  const b = tcp.createServer().listen(a.address().port)

  b.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE', 'catch EADDRINUSE error')

    a.close()
    b.close()
  })
})

test('server, listen again after a port already in use', async (t) => {
  t.plan(2)

  const a = tcp.createServer().listen()
  await waitForListening(a)

  const b = tcp.createServer().listen(a.address().port)

  b.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE', 'catch EADDRINUSE error')

    b.listen(() => {
      t.pass()

      a.close()
      b.close()
    })
  })
})

test('server, listen after close', async (t) => {
  t.plan(3)

  const server = tcp.createServer().listen(0)

  await waitForListening(server)
  await new Promise((resolve) => server.close(resolve))

  t.absent(server.closing, 'no longer closing once closed')

  // A fully closed server is reusable, as in Node.
  server.listen(0)

  await waitForListening(server)

  t.ok(server.listening, 'listening again')
  t.ok(server.address().port > 0, 'bound to a new port')

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen after close while resolving host', async (t) => {
  t.plan(2)

  const server = tcp.createServer()

  let listening = 0
  server.on('listening', () => listening++)

  server.listen(0, 'localhost', 511, {
    lookup(hostname, opts, cb) {
      setImmediate(() => cb(null, '127.0.0.1', 4))
    }
  })

  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  // The close abandons the lookup, so it must not bind once it resolves.
  t.is(listening, 0, 'the abandoned lookup did not listen')

  server.listen(0)

  await waitForListening(server)

  t.ok(server.listening, 'listening again')

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen again while the abandoned lookup is still resolving', async (t) => {
  t.plan(3)

  // Hold a port so that binding it again fails, letting the abandoned listen
  // be told apart from the one that replaced it.
  const taken = tcp.createServer().listen(0, '127.0.0.1')

  await waitForListening(taken)

  const { port } = taken.address()

  const server = tcp.createServer()

  server.on('error', (err) => t.fail(`unexpected error: ${err.code}`))

  let resolved = 0

  function lookup(delay) {
    return (hostname, opts, cb) => {
      setTimeout(() => {
        resolved++
        cb(null, '127.0.0.1', 4)
      }, delay)
    }
  }

  // The first lookup outlives the close and resolves while the second one is
  // still pending, so it must not bind on behalf of the second listen.
  server.listen(port, 'first.invalid', 511, { lookup: lookup(50) })

  await new Promise((resolve) => server.close(resolve))

  server.listen(0, 'second.invalid', 511, { lookup: lookup(150) })

  await waitForListening(server)

  t.is(resolved, 2, 'both lookups resolved')
  t.not(server.address().port, port, 'bound by the second listen')
  t.ok(server.listening, 'listening')

  await new Promise((resolve) => server.close(resolve))

  taken.close()
})

test('server, listen while closing', async (t) => {
  t.plan(1)

  const server = tcp.createServer().listen(0)

  await waitForListening(server)

  server.close()

  t.exception(() => server.listen(0), /SERVER_IS_CLOSED/)

  await new Promise((resolve) => server.on('close', resolve))
})

test('server, listen while connections drain', async (t) => {
  t.plan(2)

  const server = tcp.createServer()
  server.listen(0, '127.0.0.1')

  await waitForListening(server)

  const client = tcp.createConnection(server.address().port, '127.0.0.1')
  const socket = await new Promise((resolve) => server.on('connection', resolve))

  server.close()

  t.ok(server.closing, 'closing while the connection drains')
  t.exception(() => server.listen(0), /SERVER_IS_CLOSED/)

  socket.destroy()
  client.destroy()

  await new Promise((resolve) => server.on('close', resolve))
})

test('server, connection that cannot be accepted', async (t) => {
  t.plan(2)

  const accept = binding.accept

  t.teardown(() => {
    binding.accept = accept
  })

  const server = tcp.createServer(() => t.fail('should not have been accepted'))

  server.listen(0, '127.0.0.1')

  await waitForListening(server)

  const errored = new Promise((resolve) => server.once('error', resolve))

  binding.accept = () => {
    throw new Error('cannot accept')
  }

  const socket = tcp.createConnection(server.address().port, '127.0.0.1').on('error', noop)

  t.teardown(() => socket.destroy())

  const err = await errored

  binding.accept = accept

  t.is(err.message, 'cannot accept', 'the server errors')
  t.is(server.connections.size, 0, 'no connection is tracked')

  server.close()
})

test('server, connection listener that throws', async (t) => {
  t.plan(3)

  const server = tcp.createServer()

  server.on('error', () => t.fail('a listener bug must not become a server error'))

  // Capture the connection before the listener that throws runs, as listeners
  // are called in the order they were added.
  const accepted = new Promise((resolve) => server.on('connection', resolve))

  server.on('connection', () => {
    throw new Error('listener bug')
  })

  // The exception propagates out of the accept, as in Node, so it has to be
  // caught here to keep it from taking the test process down with it.
  const onuncaught = (err) => t.is(err.message, 'listener bug', 'the exception propagates')

  Bare.on('uncaughtException', onuncaught)

  t.teardown(() => Bare.off('uncaughtException', onuncaught))

  server.listen(0, '127.0.0.1')

  await waitForListening(server)

  const client = tcp.createConnection(server.address().port, '127.0.0.1').on('error', noop)

  const socket = await accepted

  t.absent(socket.destroying, 'the connection handed to the listener survives')
  t.ok(server.connections.has(socket), 'and is still tracked by the server')

  client.destroy()
  server.close()
})

test('server, maxConnections drops excess connections', async (t) => {
  t.plan(4)

  const server = tcp
    .createServer({ maxConnections: 1, allowHalfOpen: false })
    .on('connection', (socket) => {
      t.pass('first connection accepted')
      socket.resume()
    })
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const first = tcp.createConnection(port, '127.0.0.1', () => {
    const second = tcp.createConnection(port, '127.0.0.1')
    second.resume()
    second.on('end', () => second.destroy())
  })

  const info = await new Promise((resolve) => server.once('drop', resolve))

  t.is(typeof info.remotePort, 'number', 'drop info has remotePort')
  t.is(server.connections.size, 1, 'dropped connection not tracked')

  first.destroy()

  await new Promise((resolve) => server.close(resolve))

  t.pass('server closed')
})

test('server, maxConnections is mutable', (t) => {
  const server = tcp.createServer()
  t.is(server.maxConnections, Infinity, 'defaults to Infinity')
  server.maxConnections = 10
  t.is(server.maxConnections, 10, 'settable')
})

test('server, maxConnections validation', (t) => {
  t.exception(
    () => tcp.createServer({ maxConnections: 'x' }),
    /INVALID_ARGUMENT/,
    'not a number in options'
  )

  t.exception(
    () => tcp.createServer({ maxConnections: -1 }),
    /INVALID_ARGUMENT/,
    'negative in options'
  )

  const server = tcp.createServer()

  t.exception(() => (server.maxConnections = 'x'), /INVALID_ARGUMENT/, 'not a number')
  t.exception(() => (server.maxConnections = -1), /INVALID_ARGUMENT/, 'negative')
  t.exception(() => (server.maxConnections = 1.5), /INVALID_ARGUMENT/, 'not an integer')
  t.exception(() => (server.maxConnections = NaN), /INVALID_ARGUMENT/, 'NaN')

  t.is(server.maxConnections, Infinity, 'unchanged by the failed assignments')

  server.maxConnections = 0
  t.is(server.maxConnections, 0, 'zero')

  server.maxConnections = 8
  t.is(server.maxConnections, 8, 'positive integer')

  server.maxConnections = Infinity
  t.is(server.maxConnections, Infinity, 'infinity')
})

test('server, maxConnections of zero is unlimited', async (t) => {
  t.plan(3)

  const server = tcp
    .createServer({ maxConnections: 0, allowHalfOpen: false }, (socket) => {
      t.pass('connection accepted')

      socket.on('close', () => {
        t.is(server.connections.size, 0, 'connection released')

        server.close()
      })

      socket.end()
    })
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  server.on('drop', () => t.fail('should not drop connections'))

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  socket.on('end', () => {
    t.pass('server ended the connection')

    // The accepted socket sent FIN first and will not close until it sees one
    // in return, so the client has to end its own side.
    socket.end()
  })
  socket.resume()
})

test('server, close twice', async (t) => {
  t.plan(3)

  const server = tcp.createServer().listen()

  await waitForListening(server)

  t.absent(server.closing, 'not closing while listening')

  let closed = 0

  server.on('close', () => closed++)

  server.close()
  server.close()

  t.ok(server.closing, 'closing')

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.is(closed, 1, 'closed once')
})

test('server, close after having closed', async (t) => {
  t.plan(2)

  const server = tcp.createServer().listen(0, '127.0.0.1')

  await waitForListening(server)

  await new Promise((resolve) => server.close(resolve))

  t.absent(server.closing, 'closed')

  await new Promise((resolve) => server.close(resolve))

  t.pass('closing again calls back without emitting close')
})

test('server, close while resolving host', (t) => {
  t.plan(2)

  const server = tcp.createServer()

  server.listen(0, 'localhost', 511, {
    lookup(hostname, opts, cb) {
      setImmediate(() => cb(null, '127.0.0.1', 4))
    }
  })

  server.on('listening', () => t.fail('should not listen'))

  server.close(() => {
    t.absent(server.listening, 'not listening')
    t.is(server.address(), null, 'no address')
  })
})

test('server, close after a failed listen', async (t) => {
  t.plan(2)

  const a = tcp.createServer().listen(0, '127.0.0.1')

  await waitForListening(a)

  const b = tcp.createServer()

  b.on('error', (err) => t.is(err.code, 'EADDRINUSE', 'listen failed'))

  b.listen(a.address().port, '127.0.0.1')

  await new Promise((resolve) => b.close(resolve))

  t.pass('close called back')

  a.close()
})

test('server, close releases the port before connections drain', async (t) => {
  t.plan(3)

  const server = tcp
    .createServer({ allowHalfOpen: false }, (socket) => socket.resume())
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const { port } = server.address()

  const socket = tcp.createConnection(port, '127.0.0.1')

  await new Promise((resolve) => socket.on('connect', resolve))

  let drained = false

  server.close(() => {
    drained = true
    t.pass('closed once the connection drained')
  })

  t.absent(server.listening, 'no longer listening')

  // The port is released right away, so it can be bound again.
  const other = tcp.createServer().listen(port, '127.0.0.1')

  await waitForListening(other)

  t.absent(drained, 'not closed while the connection is open')

  await new Promise((resolve) => other.close(resolve))

  socket.destroy()
})

test('server, close after listening again', async (t) => {
  t.plan(2)

  const server = tcp.createServer().listen(0)

  await waitForListening(server)
  await new Promise((resolve) => server.close(resolve))

  server.listen(0)

  await waitForListening(server)

  let closed = 0
  server.on('close', () => closed++)

  await new Promise((resolve) => server.close(resolve))

  t.is(closed, 1, 'the second close closed the server')
  t.absent(server.listening, 'not listening')
})

test('server, ref and unref', async (t) => {
  t.plan(4)

  const server = tcp.createServer((socket) => socket.end())

  t.is(server.unref(), server, 'unref returns the server')

  server.listen(0, '127.0.0.1')
  server.ref()

  await waitForListening(server)

  t.is(server.unref(), server, 'unref returns the server while listening')
  t.is(server.ref(), server, 'ref returns the server while listening')

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  socket.on('connect', () => {
    t.pass('still accepts connections')

    socket.destroy()
    server.close()
  })
})

test('createConnection, arguments', async (t) => {
  const createConnectionArgs = t.test('createConnection')
  createConnectionArgs.plan(3)

  const connectArgs = t.test('connect')
  connectArgs.plan(3)

  const server = tcp
    .createServer()
    .on('connection', (s) => s.end())
    .listen()

  await waitForListening(server)

  const { port } = server.address()
  const host = 'localhost'

  // createConnection
  const a = tcp.createConnection(port, () => {
    createConnectionArgs.pass('port and listener')
    a.destroy()
  })

  const b = tcp.createConnection(port, host, () => {
    createConnectionArgs.pass('port, host and listener')
    b.destroy()
  })

  const c = tcp.createConnection({ port, host }, () => {
    createConnectionArgs.pass('options and listener')
    c.destroy()
  })

  // connect
  const d = tcp.connect(port, () => {
    connectArgs.pass('port and listener')
    d.destroy()
  })

  const e = tcp.connect(port, host, () => {
    connectArgs.pass('port, host and listener')
    e.destroy()
  })

  const f = tcp.connect({ port, host }, () => {
    connectArgs.pass('options and listener')
    f.destroy()
  })

  await Promise.all([createConnectionArgs, connectArgs])

  server.close()
})

test('createConnection, without port', (t) => {
  t.plan(1)

  const socket = tcp.createConnection({ host: '127.0.0.1' })

  socket.on('error', (err) => t.ok(err.code, `connecting to port 0 failed with ${err.code}`))
})

test('socketpair, returns two distinct fds', (t) => {
  t.plan(4)

  const [a, b] = tcp.socketpair()

  t.is(typeof a, 'number')
  t.is(typeof b, 'number')
  t.ok(a >= 0)
  t.ok(b >= 0)

  new tcp.Socket().open(a).destroy()
  new tcp.Socket().open(b).destroy()
})

test('socketpair, data flow from first to second', (t) => {
  t.plan(1)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket().open(a)
  const right = new tcp.Socket().open(b)

  right.on('data', (data) => {
    t.alike(data, Buffer.from('hello'))
    left.destroy()
    right.destroy()
  })

  left.write(Buffer.from('hello'))
})

test('socketpair, bidirectional data flow', (t) => {
  t.plan(2)

  const [a, b] = tcp.socketpair()

  const left = new tcp.Socket().open(a)
  const right = new tcp.Socket().open(b)

  let leftDone = false
  let rightDone = false

  function maybeClose() {
    if (leftDone && rightDone) {
      left.destroy()
      right.destroy()
    }
  }

  left.on('data', (data) => {
    t.alike(data, Buffer.from('from right'))
    leftDone = true
    maybeClose()
  })

  right.on('data', (data) => {
    t.alike(data, Buffer.from('from left'))
    rightDone = true
    maybeClose()
  })

  left.write(Buffer.from('from left'))
  right.write(Buffer.from('from right'))
})

test('isIP', (t) => {
  t.is(tcp.isIP('127.0.0.1'), 4, 'IPv4')
  t.is(tcp.isIP('::1'), 6, 'IPv6')
  t.is(tcp.isIP('::ffff:127.0.0.1'), 6, 'IPv4-mapped IPv6')
  t.is(tcp.isIP('fe80::1%lo0'), 6, 'IPv6 with zone')
  t.is(tcp.isIP('localhost'), 0, 'hostname')
  t.is(tcp.isIP('256.0.0.1'), 0, 'out-of-range IPv4')
  t.is(tcp.isIP('1.2.3'), 0, 'partial IPv4')
  t.is(tcp.isIP('fffff::1'), 0, 'out-of-range IPv6')

  t.ok(tcp.isIPv4('0.0.0.0'), 'IPv4')
  t.absent(tcp.isIPv4('::1'), 'IPv6 is not IPv4')

  t.ok(tcp.isIPv6('1:2:3:4:5:6:7:8'), 'IPv6')
  t.absent(tcp.isIPv6('127.0.0.1'), 'IPv4 is not IPv6')
})

async function listenLinkLocal() {
  for (const host of linkLocalHosts()) {
    const server = tcp.createServer((socket) => socket.resume())

    try {
      server.listen(0, host)

      await waitForListening(server)
    } catch {
      server.close()

      continue
    }

    return { server, host }
  }

  return null
}

function linkLocalHosts() {
  const hosts = []

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses) {
      if (address.family !== 'IPv6') continue
      if (address.address.startsWith('fe80:') === false) continue
      if (address.scopeid === 0) continue

      // Windows scopes an address by interface index, everything else by
      // interface name, which is also how each platform reports the zone back.
      const zone = Bare.platform === 'win32' ? address.scopeid : name

      hosts.push(`${address.address}%${zone}`)
    }
  }

  return hosts
}

test('socket, coerces a view that is not a buffer', async (t) => {
  t.plan(1)

  const chunks = []

  const server = tcp.createServer((socket) => {
    socket.on('data', (chunk) => chunks.push(chunk)).on('end', () => socket.end())
  })

  server.listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  const buffer = new ArrayBuffer(4)
  new Uint8Array(buffer).set([1, 2, 3, 4])

  // A view that is not a buffer shares its memory with the buffer it is coerced
  // to, so the bytes have to arrive unchanged, offset and length included.
  socket.end(new DataView(buffer, 1, 2))

  await waitFor(socket, 'close')

  t.alike(Buffer.concat(chunks), Buffer.from([2, 3]))

  server.close()
})

test('socket, rejects a chunk that is not a view', async (t) => {
  t.plan(1)

  const server = tcp.createServer((socket) => socket.resume())

  server.listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  await waitFor(socket, 'connect')

  // An array buffer is not a view, so there is nothing for the write request to
  // point at. It has to fail the write rather than reach the binding.
  socket.write(new ArrayBuffer(4))

  const err = await new Promise((resolve) => socket.on('error', resolve))

  t.is(err.code, 'INVALID_ARGUMENT')

  server.close()
})

test('socket, keep alive is coerced to a boolean', async (t) => {
  t.plan(2)

  const server = tcp.createServer((socket) => socket.resume()).listen(0, '127.0.0.1')

  await waitForListening(server)

  // A truthy value enables keep alive without standing in for the delay, which
  // the number overload of setKeepAlive() would otherwise take it for.
  const socket = tcp.createConnection({
    port: server.address().port,
    host: '127.0.0.1',
    keepAlive: 1,
    keepAliveInitialDelay: 5000
  })

  t.is(socket.keepAlive, true, 'keep alive enabled')
  t.is(socket.keepAliveInitialDelay, 5000, 'delay kept')

  socket.destroy()
  server.close()

  await waitFor(server, 'close')
})

test('server, keep alive is coerced to a boolean', async (t) => {
  t.plan(2)

  const server = tcp
    .createServer({ keepAlive: 1, keepAliveInitialDelay: 5000 }, (socket) => {
      t.is(socket.keepAlive, true, 'keep alive enabled')
      t.is(socket.keepAliveInitialDelay, 5000, 'delay kept')

      socket.destroy()
    })
    .listen(0, '127.0.0.1')

  await waitForListening(server)

  const socket = tcp.createConnection(server.address().port, '127.0.0.1')

  // The client may see 'connect' while the connection is still sitting in the
  // backlog, so closing on that would race the server ever accepting it.
  await waitFor(server, 'connection')

  socket.destroy()

  server.close()

  await waitFor(server, 'close')
})

test('socket, allow half open is coerced to a boolean', async (t) => {
  t.plan(1)

  const server = tcp.createServer((socket) => socket.end('hello client')).listen(0, '127.0.0.1')

  await waitForListening(server)

  // A falsy value disables half open, as in Node, so the peer ending also ends
  // the writable half.
  const socket = tcp.createConnection({
    port: server.address().port,
    host: '127.0.0.1',
    allowHalfOpen: 0
  })

  socket.on('finish', () => t.pass('socket finished without being ended')).resume()

  await waitFor(socket, 'close')

  server.close()

  await waitFor(server, 'close')
})

function waitForListening(server) {
  if (server.listening) return Promise.resolve()

  return waitFor(server, 'listening')
}

function waitFor(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.on(event, onevent).on('error', onerror)

    // The event may carry a payload of its own, such as the socket passed to
    // 'connection', so only 'error' can be taken for a failure.
    function onevent(value) {
      done()

      resolve(value)
    }

    function onerror(err) {
      done()

      reject(err)
    }

    function done() {
      emitter.off(event, onevent).off('error', onerror)
    }
  })
}

function noop() {}
