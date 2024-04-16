const test = require('brittle')
const { Socket } = require('.')

// working in progress
// testing manually with netcat
// > echo 'echo' | nc -k -l 8880
test('socket read and write', (t) => {
  t.plan(2)

  const socket = new Socket()
  socket.connect(8880, '127.0.0.1')

  socket.once('connect', () => {
    socket.end('hello world\n')
    t.pass()

    socket.on('data', data => {
      t.alike('echo\n', data.toString())
    })
  })
})
