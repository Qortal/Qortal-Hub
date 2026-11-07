package moqtransport

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/mengelbart/moqtransport/internal/wire"
)

func TestRejectedSubscriptionUnblocksReader(t *testing.T) {
	conn := newTestConnection(t)
	session, err := NewSession(conn, "")
	if err != nil {
		t.Fatal(err)
	}
	defer session.CloseWithError(0, "test complete")
	request, stream := subscribe(t, session, conn)
	stream.feed(encodeControlMessage(t, &wire.RequestError{ErrorCode: 403, ErrorReason: "not authorized"}))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err = request.ReadObject(ctx)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("explicit subscription rejection was ignored; reader only returned at local deadline")
	}
	var rejected *SubscriptionRejectedError
	if !errors.As(err, &rejected) || rejected.Code != 403 {
		t.Fatalf("rejection reason was not preserved: %v", err)
	}
	if session.Context().Err() != nil {
		t.Fatal("rejection closed unrelated tracks")
	}
	other, _ := subscribe(t, session, conn)
	other.push(&Object{Payload: []byte("healthy")})
	obj, err := other.ReadObject(ctx)
	if err != nil || string(obj.Payload) != "healthy" {
		t.Fatalf("unrelated subscription stopped: %v", err)
	}
}

func TestSubscriptionCloseAndEOFWakeBlockedReaders(t *testing.T) {
	for _, local := range []bool{false, true} {
		t.Run(map[bool]string{false: "peer EOF", true: "local close"}[local], func(t *testing.T) {
			conn := newTestConnection(t)
			session, err := NewSession(conn, "")
			if err != nil {
				t.Fatal(err)
			}
			defer session.CloseWithError(0, "done")
			request, stream := subscribe(t, session, conn)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			result := make(chan error, 1)
			go func() { _, err := request.ReadObject(ctx); result <- err }()
			if local {
				_ = request.Close()
			} else {
				stream.close(io.EOF)
			}
			if err := <-result; !errors.Is(err, io.EOF) {
				t.Fatalf("reader was not closed: %v", err)
			}
			if session.Context().Err() != nil {
				t.Fatal("subscription close killed session")
			}
			request.push(&Object{Payload: []byte("late")})
			if session.receiveBytes.Load() != 0 {
				t.Fatal("closed subscription retained bytes")
			}
		})
	}
}
