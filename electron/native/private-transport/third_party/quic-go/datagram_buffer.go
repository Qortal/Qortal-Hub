package quic

import "github.com/quic-go/quic-go/internal/datagrambuffer"

func recordRawDatagramPacketDrop() { datagrambuffer.RecordRawPacketDrop() }

type DatagramReceiveBufferStats = datagrambuffer.Stats

// GlobalDatagramReceiveBufferStats includes all QUIC and HTTP/3 receive queues
// in this process. It contains no connection, address, or payload information.
func GlobalDatagramReceiveBufferStats() DatagramReceiveBufferStats {
	return datagrambuffer.GlobalStats()
}

// EnableDatagramReceiveBuffer enables bounded burst absorption after admission.
// Existing congestion control and unreliable DATAGRAM semantics are unchanged.
func (c *Conn) EnableDatagramReceiveBuffer() {
	if q := c.datagramQueue; q != nil {
		q.rcvMx.Lock()
		q.rcvQueue.EnableBurst()
		q.rcvMx.Unlock()
	}
}
func (c *Conn) DatagramReceiveBufferStats() DatagramReceiveBufferStats {
	if q := c.datagramQueue; q != nil {
		q.rcvMx.Lock()
		defer q.rcvMx.Unlock()
		return q.rcvQueue.Stats()
	}
	return DatagramReceiveBufferStats{}
}
