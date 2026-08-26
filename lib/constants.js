const binding = require('../binding')

module.exports = {
  state: {
    CONNECTING: 0x1,
    CONNECTED: 0x2,
    BINDING: 0x4,
    BOUND: 0x8,
    READING: 0x10,
    CLOSING: 0x20,
    CLOSED: 0x40,
    UNREFED: 0x80
  },
  address: {
    MAX_LENGTH: binding.MAX_ADDRESS_LENGTH
  }
}
