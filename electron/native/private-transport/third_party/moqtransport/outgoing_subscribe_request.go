package moqtransport

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"

	"github.com/mengelbart/moqtransport/internal/wire"
)

type OutgoingSubscribeRequestOption func(*OutgoingSubscribeRequest) error

type OutgoingSubscribeRequest struct {
	logger       *slog.Logger
	requestID    uint64
	session      *Session
	streamWriter messageWriter
	streamReader messageReader
	buffer       chan *Object
	bufferMu     sync.Mutex
	bufferBytes  int
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
	for _, opt := range parameters {
		if err := opt(r); err != nil {
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
			if !errors.Is(err, io.EOF) {
				r.session.handleReaderError(err)
			}
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
	// TODO: Send a message to the peer to stop the subscription.
	r.session.removeReceiver(r)
	r.bufferMu.Lock()
	defer r.bufferMu.Unlock()
	for {
		select {
		case obj := <-r.buffer:
			r.bufferBytes -= len(obj.Payload)
			r.session.receiveBytes.Add(-int64(len(obj.Payload)))
		default:
			return nil
		}
	}
}

func (r *OutgoingSubscribeRequest) ReadObject(ctx context.Context) (*Object, error) {
	r.logger.Debug("waiting for next object")
	// TODO: Add case for shutdown when request is closed
	select {
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
