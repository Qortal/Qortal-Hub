package moqtransport

import (
	"errors"
	"time"

	"github.com/mengelbart/moqtransport/internal/wire"
)

// MaxReliableObjectBytes bounds an opaque application object, not a datagram.
const MaxReliableObjectBytes = 1024 * 1024
const maxGroupBytes = 2 * MaxReliableObjectBytes
const maxGroupStreams = 64

var ErrObjectExpired = errors.New("MOQ_OBJECT_EXPIRED")

type objectLease struct {
	stream SendStream
	timer  *time.Timer
	size   int
}

// SendGroupObject sends one complete object on its own cancellable subgroup.
// Group IDs must increase when dependencies are replaced. The application owns
// dependency semantics; the transport never inspects the encrypted payload.
// Success means QUIC accepted the write, not that the peer received the object.
// FIN alone does not bound retransmission: the lease resets even FIN'd streams.
func (r *IncomingSubscribeRequest) SendGroupObject(o Object, policy DeliveryPolicy) error {
	if len(o.Payload) == 0 || len(o.Payload) > MaxReliableObjectBytes || !policy.Valid() ||
		o.GroupID >= 1<<62 || o.ObjectID >= 1<<62 {
		return ErrDeliveryPolicy
	}
	if err := r.session.ctx.Err(); err != nil {
		return err
	}
	r.groupMu.Lock()
	if r.groupStarted && o.GroupID < r.groupID {
		r.groupMu.Unlock()
		return ErrObjectExpired
	}
	if !r.groupStarted || o.GroupID > r.groupID {
		for lease := range r.groupLeases {
			r.releaseLeaseLocked(lease)
		}
		r.groupLeases = make(map[*objectLease]struct{})
		r.groupBytes = 0
		r.groupID, r.groupStarted = o.GroupID, true
		r.groupObjectStarted = false
	}
	if r.groupObjectStarted && o.ObjectID <= r.groupObjectID {
		r.groupMu.Unlock()
		return ErrDeliveryPolicy
	}
	if len(r.groupLeases) >= maxGroupStreams || r.groupBytes+len(o.Payload) > maxGroupBytes {
		r.groupMu.Unlock()
		return ErrDeliveryQueueFull
	}
	size := int64(len(o.Payload))
	for {
		queued := r.session.reliableBytes.Load()
		if queued+size > 4*MaxReliableObjectBytes {
			r.groupMu.Unlock()
			return ErrDeliveryQueueFull
		}
		if r.session.reliableBytes.CompareAndSwap(queued, queued+size) {
			break
		}
	}
	stream, err := r.session.conn.OpenUniStream()
	if err != nil {
		r.session.reliableBytes.Add(-size)
		r.groupMu.Unlock()
		if r.session.ctx.Err() == nil {
			return ErrDeliveryQueueFull
		}
		return err
	}
	lease := &objectLease{stream: stream, size: len(o.Payload)}
	r.groupObjectID, r.groupObjectStarted = o.ObjectID, true
	r.groupLeases[lease] = struct{}{}
	r.groupBytes += len(o.Payload)

	release := func() {
		r.groupMu.Lock()
		r.releaseLeaseLocked(lease)
		r.groupMu.Unlock()
	}
	// Reset also interrupts a Write blocked by QUIC flow/congestion control.
	timer := time.AfterFunc(time.Duration(policy.MaxQueueAgeMillis)*time.Millisecond, release)
	lease.timer = timer
	r.groupMu.Unlock()
	subgroup, err := newSubgroup(wire.NewAppender(stream, r.session.version), r.trackAlias, o.GroupID, o.ObjectID, uint8(policy.Priority*64))
	if err == nil {
		subgroup.sender = stream
		_, err = subgroup.WriteObject(o.ObjectID, o.Payload)
		if err == nil {
			err = subgroup.Close()
		}
	}
	if err != nil {
		timer.Stop()
		release()
		// A cancelled/expired subgroup is not a failed media connection.
		// The session's control reader handles genuine connection closure.
		if r.session.ctx.Err() == nil {
			return ErrObjectExpired
		}
	}
	return err
}

// Caller holds groupMu; timer, group replacement and write failure race here.
func (r *IncomingSubscribeRequest) releaseLeaseLocked(lease *objectLease) {
	if _, ok := r.groupLeases[lease]; !ok {
		return
	}
	lease.timer.Stop()
	lease.stream.Reset(uint32(StreamResetErrorCodeInternal))
	delete(r.groupLeases, lease)
	r.groupBytes -= lease.size
	r.session.reliableBytes.Add(-int64(lease.size))
}
