package innerquic

import (
	"errors"
	"regexp"
	"time"

	"github.com/quic-go/quic-go"
)

var streamKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,96}$`)

type reliableLane struct {
	stream *quic.Stream
	writer *boundedFrameWriter
}

// Keys are opaque application routing labels, scoped to this attached session.
// End sends the final frame and FIN; the reply side remains alive until EOF.
func (s *Session) SendReliableStream(key, messageID string, data []byte, end bool) error {
	return s.SendReliableStreamWithTimeout(key, messageID, data, end, 5*time.Second)
}

func (s *Session) SendReliableStreamWithTimeout(key, messageID string, data []byte, end bool, timeout time.Duration) error {
	if s.closed.Load() || s.conn.Context().Err() != nil {
		return errors.New("TRANSPORT_CLOSED")
	}
	if !s.reliableStreams {
		return errors.New("RELIABLE_STREAMS_UNSUPPORTED")
	}
	limit := s.maxReliableBytes
	if limit == 0 {
		limit = 64 * 1024
	}
	if len(data) > limit {
		return errors.New("BULK_TRANSPORT_UNSUPPORTED")
	}
	if !streamKeyPattern.MatchString(key) || len(messageID) == 0 || len(messageID) > 128 || len(data) > MaxReliablePayloadBytes {
		return errors.New("invalid reliable stream message")
	}
	s.streamsMu.Lock()
	lane := s.streams[key]
	if lane == nil {
		if len(s.streams) >= 32 {
			s.streamsMu.Unlock()
			return errors.New("STREAM_LIMIT_REACHED")
		}
		stream, err := s.conn.OpenStream()
		if err != nil {
			s.streamsMu.Unlock()
			return errors.New("STREAM_LIMIT_REACHED")
		}
		lane = &reliableLane{stream: stream, writer: newBoundedFrameWriter(stream)}
		s.streams[key] = lane
		go func() {
			s.readReliableStream(stream, false)
			stream.CancelRead(1)
			stream.CancelWrite(1)
			s.streamsMu.Lock()
			if s.streams[key] == lane {
				delete(s.streams, key)
			}
			s.streamsMu.Unlock()
		}()
	}
	s.streamsMu.Unlock()
	metadata, _ := Metadata(messageMetadata{MessageID: messageID})
	if err := lane.writer.write(Frame{Type: FrameReliable, Metadata: metadata, Payload: data}, timeout); err != nil {
		lane.stream.CancelRead(1)
		lane.stream.CancelWrite(1)
		return errors.New("RELIABLE_STREAM_FAILED")
	}
	s.appSent.Add(uint64(len(data)))
	if end {
		_ = lane.stream.Close()
		// Bound half-closed lanes even if the backend never finishes its replies.
		_ = lane.stream.SetReadDeadline(time.Now().Add(30 * time.Second))
	}
	return nil
}
