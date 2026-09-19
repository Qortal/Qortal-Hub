package innerquic

import (
	"bytes"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/quic-go/quic-go"
)

type testWriteStream struct {
	bytes.Buffer
	deadline  time.Time
	blocked   bool
	cancelled bool
}

func (s *testWriteStream) SetWriteDeadline(d time.Time) error { s.deadline = d; return nil }
func (s *testWriteStream) CancelWrite(quic.StreamErrorCode)   { s.cancelled = true }
func (s *testWriteStream) Write(p []byte) (int, error) {
	if s.blocked {
		time.Sleep(time.Until(s.deadline))
		return 0, os.ErrDeadlineExceeded
	}
	// Exercise framing across short writes, too.
	if len(p) > 3 {
		p = p[:3]
	}
	return s.Buffer.Write(p)
}

func TestReliableWriteDeadlineCancelsAndPoisonsStream(t *testing.T) {
	s := &testWriteStream{blocked: true}
	w := newBoundedFrameWriter(s)
	start := time.Now()
	err := w.write(Frame{Type: FrameReliable}, 30*time.Millisecond)
	if !errors.Is(err, ErrReliableWriteFailed) || !s.cancelled || time.Since(start) > time.Second {
		t.Fatalf("write not bounded/cancelled: %v", err)
	}
	s.blocked = false
	if err := w.write(Frame{Type: FrameReliable}, time.Second); !errors.Is(err, ErrReliableWriteFailed) || s.Len() != 0 {
		t.Fatal("reused a failed stream")
	}
	// A replacement owns its own gate and failure state.
	replacement := newBoundedFrameWriter(&testWriteStream{})
	if err := replacement.write(Frame{Type: FrameReliable}, time.Second); err != nil {
		t.Fatal(err)
	}
}

func TestReliableWriteGateHasDeadline(t *testing.T) {
	s := &testWriteStream{}
	w := newBoundedFrameWriter(s)
	w.gate <- struct{}{}
	start := time.Now()
	err := w.write(Frame{Type: FrameReliable}, 30*time.Millisecond)
	if !errors.Is(err, ErrReliableWriteFailed) || time.Since(start) > time.Second {
		t.Fatalf("lock wait not bounded: %v", err)
	}
	if s.cancelled || !s.deadline.IsZero() {
		t.Fatal("waiting writer touched active writer's stream")
	}
	<-w.gate
}

func TestReliableWriteKeepsFrameBoundaries(t *testing.T) {
	s := &testWriteStream{}
	w := newBoundedFrameWriter(s)
	for i := 0; i < 2; i++ {
		if err := w.write(Frame{Type: FrameReliable, Payload: []byte("hello")}, time.Second); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		f, err := ReadFrame(&s.Buffer)
		if err != nil || string(f.Payload) != "hello" {
			t.Fatalf("invalid frame: %v", err)
		}
	}
}
