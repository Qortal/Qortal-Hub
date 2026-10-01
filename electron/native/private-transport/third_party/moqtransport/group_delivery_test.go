package moqtransport

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

type leaseTestStream struct {
	mu     sync.Mutex
	data   bytes.Buffer
	closed atomic.Int32
	resets atomic.Int32
	done   chan struct{}
	once   sync.Once
	block  bool
}

func (s *leaseTestStream) Write(p []byte) (int, error) {
	if s.block {
		<-s.done
		return 0, errors.New("reset")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.Write(p)
}
func (s *leaseTestStream) Close() error     { s.closed.Add(1); return nil }
func (s *leaseTestStream) Reset(uint32)     { s.resets.Add(1); s.once.Do(func() { close(s.done) }) }
func (s *leaseTestStream) StreamID() uint64 { return 7 }

func groupTestRequest(t *testing.T, stream *leaseTestStream) *IncomingSubscribeRequest {
	c := NewMockConnection(gomock.NewController(t))
	c.EXPECT().OpenUniStream().Return(stream, nil).AnyTimes()
	return &IncomingSubscribeRequest{session: &Session{ctx: context.Background(), conn: c, version: 18}}
}
func TestGroupObjectFinAndBoundedRetransmission(t *testing.T) {
	stream := &leaseTestStream{done: make(chan struct{})}
	r := groupTestRequest(t, stream)
	require.NoError(t, r.SendGroupObject(Object{GroupID: 1, ObjectID: 1, Payload: bytes.Repeat([]byte{7}, 100_000)}, DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 30}))
	require.EqualValues(t, 1, stream.closed.Load())
	select {
	case <-stream.done:
	case <-time.After(time.Second):
		t.Fatal("FIN did not expire")
	}
	require.Eventually(t, func() bool { r.groupMu.Lock(); defer r.groupMu.Unlock(); return r.groupBytes == 0 }, time.Second, time.Millisecond)
}
func TestGroupDeadlineInterruptsBlockedHeaderWrite(t *testing.T) {
	stream := &leaseTestStream{done: make(chan struct{}), block: true}
	r := groupTestRequest(t, stream)
	done := make(chan error, 1)
	go func() {
		done <- r.SendGroupObject(Object{GroupID: 1, ObjectID: 1, Payload: []byte("test")}, DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 20})
	}()
	select {
	case err := <-done:
		require.ErrorIs(t, err, ErrObjectExpired)
	case <-time.After(time.Second):
		t.Fatal("write remained blocked")
	}
}
func TestNewGroupCancelsOldAndRejectsStaleGroup(t *testing.T) {
	stream := &leaseTestStream{done: make(chan struct{})}
	r := groupTestRequest(t, stream)
	policy := DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 30}
	require.NoError(t, r.SendGroupObject(Object{GroupID: 1, ObjectID: 1, Payload: []byte("first")}, policy))
	require.NoError(t, r.SendGroupObject(Object{GroupID: 2, ObjectID: 2, Payload: []byte("key")}, policy))
	require.GreaterOrEqual(t, stream.resets.Load(), int32(1))
	require.ErrorIs(t, r.SendGroupObject(Object{GroupID: 1, Payload: []byte("old")}, policy), ErrObjectExpired)
	time.Sleep(40 * time.Millisecond)
}
func TestSubgroupCloseReallySendsFinOnce(t *testing.T) {
	stream := &leaseTestStream{done: make(chan struct{})}
	r := groupTestRequest(t, stream)
	subgroup, err := r.OpenSubgroup(1, 1, 0)
	require.NoError(t, err)
	require.NoError(t, subgroup.Close())
	require.NoError(t, subgroup.Close())
	require.EqualValues(t, 1, stream.closed.Load())
	subgroup.Reset(1)
	require.EqualValues(t, 1, stream.resets.Load())
}
func TestCancelledDataStreamDoesNotCloseSession(t *testing.T) {
	conn := newTestConnection(t)
	session, err := NewSession(conn, "")
	require.NoError(t, err)
	defer session.CloseWithError(0, "done")
	reader := conn.acceptUniStream(encodeDataStream(t, 17, 3, 5, testObject{0, "hello"}))
	<-reader.drained
	reader.close(errors.New("peer expired subgroup"))
	time.Sleep(20 * time.Millisecond)
	require.NoError(t, session.Context().Err())
}

func TestGroupAdmissionBoundsAndDuplicateIDs(t *testing.T) {
	stream := &leaseTestStream{done: make(chan struct{})}
	r := groupTestRequest(t, stream)
	t.Cleanup(func() {
		r.groupMu.Lock()
		defer r.groupMu.Unlock()
		for lease := range r.groupLeases {
			r.releaseLeaseLocked(lease)
		}
	})
	policy := DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 2000}
	large := bytes.Repeat([]byte{1}, MaxReliableObjectBytes)
	require.NoError(t, r.SendGroupObject(Object{GroupID: 1, ObjectID: 1, Payload: large}, policy))
	require.ErrorIs(t, r.SendGroupObject(Object{GroupID: 1, ObjectID: 1, Payload: []byte{1}}, policy), ErrDeliveryPolicy)
	require.NoError(t, r.SendGroupObject(Object{GroupID: 1, ObjectID: 2, Payload: large}, policy))
	require.ErrorIs(t, r.SendGroupObject(Object{GroupID: 1, ObjectID: 3, Payload: []byte{1}}, policy), ErrDeliveryQueueFull)
	require.EqualValues(t, 2*MaxReliableObjectBytes, r.session.reliableBytes.Load())
	// Replacing the group releases its byte reservation immediately.
	require.NoError(t, r.SendGroupObject(Object{GroupID: 2, ObjectID: 1, Payload: []byte{1}}, policy))
	require.EqualValues(t, 1, r.session.reliableBytes.Load())
}
