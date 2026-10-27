package moqtransport

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"

	"github.com/mengelbart/moqtransport/internal/wire"
)

type OutgoingSubscribeRequestOption func(*OutgoingSubscribeRequest) error

type SubscriptionRejectedError struct {
	Code   uint64
	Reason string
}

func (e *SubscriptionRejectedError) Error() string {
	return fmt.Sprintf("subscription rejected (%d): %s", e.Code, e.Reason)
}

type OutgoingSubscribeRequest struct {
	logger       *slog.Logger
	requestID    uint64
	session      *Session
	streamWriter messageWriter
	streamReader messageReader
	buffer       chan *Object
	bufferMu     sync.Mutex
	bufferBytes  int
	ctx          context.Context
	cancel       context.CancelCauseFunc
	stopStream   func()
	closeOnce    sync.Once
}

func newOutgoingSubscribeRequest(
	requestID uint64,
	session *Session,
	streamWriter messageWriter,
	streamReader messageReader,
	namespace [][]byte,
	trackName []byte,
	parameters ...OutgoingSubscribeRequestOption,
) (*OutgoingSubscribeRequest, error) {
	r := &OutgoingSubscribeRequest{
		logger:       defaultLogger,
		requestID:    requestID,
		session:      session,
		streamWriter: streamWriter,
		streamReader: streamReader,
		buffer:       make(chan *Object, 100), // TODO: Make buffer size configurable
	}
	r.ctx, r.cancel = context.WithCancelCause(session.Context())
	for _, opt := range parameters {
		if err := opt(r); err != nil {
			r.cancel(err)
			return nil, err
		}
	}
	msg := &wire.Subscribe{
		RequestID:      requestID,
		TrackNamespace: namespace,
		TrackName:      trackName,
		Parameters:     nil, // TODO: Add parameters if needed
	}
	if err := r.streamWriter.Write(msg); err != nil {
		r.cancel(err)
		return nil, err
	}
	r.logger.Debug("sent subscribe request", "requestID", requestID, "namespace", namespace, "trackName", trackName)
	return r, nil
}

// readMessages reads from the request stream until it fails. It must be called
// from a goroutine tracked by the session WaitGroup.
func (r *OutgoingSubscribeRequest) readMessages() {
	for {
		msg, err := r.streamReader.Read()
		if err != nil {
			r.cancel(err)
			_ = r.Close()
			return
		}
		switch msg := msg.(type) {
		case *wire.SubscribeOk:
			if err := r.session.bindTrackAlias(msg.TrackAlias, r); err != nil {
				r.session.closeWithError(&SessionError{
					Code:   uint64(ErrorCodeProtocolViolation),
					Reason: err.Error(),
				})
				return
			}
		case *wire.RequestOk:
		case *wire.RequestError:
			r.cancel(&SubscriptionRejectedError{Code: msg.ErrorCode, Reason: msg.ErrorReason})
			_ = r.Close()
			return
		default:
			r.session.closeWithError(&SessionError{
				Code:   uint64(ErrorCodeProtocolViolation),
				Reason: fmt.Sprintf("unexpected message type: %T", msg),
			})
			return
		}
	}
}

func (t *OutgoingSubscribeRequest) push(o *Object) {
	t.bufferMu.Lock()
	defer t.bufferMu.Unlock()
	if t.ctx != nil && t.ctx.Err() != nil {
		return
	}
	if t.bufferBytes+len(o.Payload) > maxGroupBytes {
		return
	}
	// Session-wide byte accounting prevents many subscribed tracks from
	// multiplying the large-object budget. Reserve room for small objects.
	limit := int64(maxGroupBytes)
	if len(o.Payload) <= 1024 {
		limit += 64 * 1024
	}
	for {
		queued := t.session.receiveBytes.Load()
		if queued+int64(len(o.Payload)) > limit {
			return
		}
		if t.session.receiveBytes.CompareAndSwap(queued, queued+int64(len(o.Payload))) {
			break
		}
	}
	select {
	case t.buffer <- o:
		t.bufferBytes += len(o.Payload)
	default:
		t.session.receiveBytes.Add(-int64(len(o.Payload)))
		t.logger.Info("buffer overflow: dropping incoming object")
	}
}

func (r *OutgoingSubscribeRequest) Close() error {
	r.closeOnce.Do(func() {
		if r.cancel != nil {
			r.cancel(io.EOF)
		}
		if r.stopStream != nil {
			r.stopStream()
		}
		r.session.removeReceiver(r)
		r.bufferMu.Lock()
		defer r.bufferMu.Unlock()
		for {
			select {
			case obj := <-r.buffer:
				r.bufferBytes -= len(obj.Payload)
				r.session.receiveBytes.Add(-int64(len(obj.Payload)))
			default:
				return
			}
		}
	})
	return nil
}

func (r *OutgoingSubscribeRequest) ReadObject(ctx context.Context) (*Object, error) {
	r.logger.Debug("waiting for next object")
	var terminal <-chan struct{}
	if r.ctx != nil {
		if r.ctx.Err() != nil {
			return nil, context.Cause(r.ctx)
		}
		terminal = r.ctx.Done()
	}
	select {
	case <-terminal:
		return nil, context.Cause(r.ctx)
	case <-ctx.Done():
		return nil, context.Cause(ctx)
	case obj := <-r.buffer:
		r.bufferMu.Lock()
		r.bufferBytes -= len(obj.Payload)
		r.session.receiveBytes.Add(-int64(len(obj.Payload)))
		r.bufferMu.Unlock()
		return obj, nil
	}
}
