package http3

import "github.com/quic-go/quic-go"

// EnableDatagramReceiveBuffer enables bounded burst absorption on an admitted
// datagram stream. Call only after authorization. It does not change wire data.
func (s *Stream) EnableDatagramReceiveBuffer() {
	if b, ok := s.datagramStream.(interface{ enableDatagramReceiveBuffer() }); ok {
		b.enableDatagramReceiveBuffer()
	}
}
func (s *Stream) DatagramReceiveBufferStats() quic.DatagramReceiveBufferStats {
	if b, ok := s.datagramStream.(interface {
		datagramReceiveBufferStats() quic.DatagramReceiveBufferStats
	}); ok {
		return b.datagramReceiveBufferStats()
	}
	return quic.DatagramReceiveBufferStats{}
}
func (s *RequestStream) EnableDatagramReceiveBuffer() { s.str.EnableDatagramReceiveBuffer() }
func (s *RequestStream) DatagramReceiveBufferStats() quic.DatagramReceiveBufferStats {
	return s.str.DatagramReceiveBufferStats()
}
