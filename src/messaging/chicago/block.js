var Block = function () {
  /* Start byte in stream */
  this.start_byte = null
  /* Last transmission time of block */
  this.transmission_time = 0
  /* Number of transmission attempts of this block */
  this.transmissions = 0
  /* ID of last message sending this block */
  this.id = null
  /* Actual block data (buffer) */
  this.data = null
}

module.exports = Block
