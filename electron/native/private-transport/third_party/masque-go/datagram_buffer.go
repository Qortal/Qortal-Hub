package masque

import "github.com/quic-go/quic-go"

// EnableDatagramReceiveBuffer enables receive burst absorption on a successfully
// opened tunnel. Not called automatically for unaccepted CONNECT requests.
func (c *Conn) EnableDatagramReceiveBuffer() {
	if s, ok := c.str.(interface{ EnableDatagramReceiveBuffer() }); ok {
		s.EnableDatagramReceiveBuffer()
	}
}
func (c *Conn) DatagramReceiveBufferStats() quic.DatagramReceiveBufferStats {
	if s, ok := c.str.(interface {
		DatagramReceiveBufferStats() quic.DatagramReceiveBufferStats
	}); ok {
		return s.DatagramReceiveBufferStats()
	}
	return quic.DatagramReceiveBufferStats{}
}
