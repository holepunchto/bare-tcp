const test = require('brittle')
const { Socket } = require('.')

// wip, testing manually with netcat
test('socket connect', (t) => {
  t.plan(1)

  const socket = new Socket()
  socket.connect(8880, '127.0.0.1')

  socket.once('connect', () => {
    socket.end('hello world\n')
    t.pass()
  })
})
