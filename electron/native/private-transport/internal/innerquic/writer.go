package innerquic

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/quic-go/quic-go"
)

// ErrReliableWriteFailed means this physical stream must not be reused. A
// partial frame cannot safely be followed by another frame on the same stream.
var ErrReliableWriteFailed = errors.New("reliable stream write failed")

type deadlineWriteStream interface {
	io.Writer
	SetWriteDeadline(time.Time) error
	CancelWrite(quic.StreamErrorCode)
}

type boundedFrameWriter struct {
	stream deadlineWriteStream
	gate   chan struct{}
	failed bool // protected by gate
}

func newBoundedFrameWriter(stream deadlineWriteStream) *boundedFrameWriter {
	return &boundedFrameWriter{stream: stream, gate: make(chan struct{}, 1)}
}

func (w *boundedFrameWriter) write(frame Frame, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	select {
	case w.gate <- struct{}{}:
		defer func() { <-w.gate }()
	case <-ctx.Done():
		return errors.Join(ErrReliableWriteFailed, ctx.Err())
	}
	if w.failed {
		return ErrReliableWriteFailed
	}
	if err := ctx.Err(); err != nil {
		return errors.Join(ErrReliableWriteFailed, err)
	}
	deadline, _ := ctx.Deadline()
	err := w.stream.SetWriteDeadline(deadline)
	if err == nil {
		err = WriteFrame(w.stream, frame)
	}
	if err != nil {
		w.failed = true
		w.stream.CancelWrite(1)
		return errors.Join(ErrReliableWriteFailed, err)
	}
	return nil
}
