package moqtransport

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"

	"github.com/mengelbart/moqtransport/internal/wire"
)

type IncomingSubscribeRequest struct {
	logger       *slog.Logger
	session      *Session
	streamWriter messageWriter
	streamReader messageReader

	namespace [][]byte
	name      []byte

	trackAlias         uint64
	groupMu            sync.Mutex
	groupID            uint64
	groupStarted       bool
	groupObjectStarted bool
	groupObjectID      uint64
	groupLeases        map[*objectLease]struct{}
	groupBytes         int
}

func newIncomingSubscribeRequest(msg *wire.Subscribe, session *Session, streamWriter messageWriter, streamReader messageReader) *IncomingSubscribeRequest {
	isr := &IncomingSubscribeRequest{
		logger:       defaultLogger,
		session:      session,
		streamWriter: streamWriter,
		streamReader: streamReader,
		namespace:    msg.TrackNamespace,
		name:         msg.TrackName,
		trackAlias:   0,
	}
	isr.logger.Debug("incoming subscribe request created", "requestID", msg.RequestID, "namespace", msg.TrackNamespace, "trackName", msg.TrackName)
	return isr
}

// readMessages reads from the request stream until it fails. It must be called
// from a goroutine tracked by the session WaitGroup.
func (r *IncomingSubscribeRequest) readMessages() {
	for {
		msg, err := r.streamReader.Read()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				r.session.handleReaderError(err)
			}
			return
		}
		switch msg := msg.(type) {
		case *wire.RequestUpdate:
			// TODO
		default:
			r.session.closeWithError(&SessionError{
				Code:   uint64(ErrorCodeProtocolViolation),
				Reason: fmt.Sprintf("unexpected message type: %T", msg),
			})
			return
		}
	}
}

func (r *IncomingSubscribeRequest) Accept(trackAlias uint64) {
	r.logger.Debug("accepting subscribe request")
	r.trackAlias = trackAlias
	err := r.streamWriter.Write(&wire.SubscribeOk{
		TrackAlias: trackAlias,
	})
	if err != nil {
		r.logger.Debug("failed to accept subscribe request", "error", err)
	}
}

func (r *IncomingSubscribeRequest) Reject(code RequestErrorCode, reason string) {
	err := r.streamWriter.Write(&wire.RequestError{
		ErrorCode:     uint64(code),
		RetryInterval: 0, // TODO: Add retry interval if needed
		ErrorReason:   reason,
	})
	if err != nil {
		r.logger.Debug("failed to reject subscribe request", "error", err)
	}
}

func (r *IncomingSubscribeRequest) SendDatagram(o Object) error {
	return r.sendDatagram(o, nil)
}

// ScheduleDatagram admits an unreliable object; success is not a delivery ACK.
func (r *IncomingSubscribeRequest) ScheduleDatagram(o Object, policy DeliveryPolicy) error {
	return r.sendDatagram(o, &policy)
}

// SendScheduledDatagram adds producer backpressure without blocking other tracks.
// The result acknowledges QUIC admission, not reception by the peer.
func (r *IncomingSubscribeRequest) SendScheduledDatagram(o Object, policy DeliveryPolicy) error {
	result, err := r.ScheduleDatagramResult(o, policy)
	if err != nil {
		return err
	}
	select {
	case err := <-result:
		return err
	case <-r.session.ctx.Done():
		return r.session.ctx.Err()
	}
}

func (r *IncomingSubscribeRequest) ScheduleDatagramResult(o Object, policy DeliveryPolicy) (<-chan error, error) {
	result := make(chan error, 1)
	if err := r.sendDatagram(o, &policy, result); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *IncomingSubscribeRequest) sendDatagram(o Object, policy *DeliveryPolicy, result ...chan error) error {
	// A datagram carries one complete object. Do not emulate unreliable
	// delivery with a stream or retry a rejected send.
	if err := r.session.ctx.Err(); err != nil {
		return err
	}
	if o.SubGroupID != 0 {
		return errors.New("datagram objects have no subgroup ID")
	}
	message := &wire.DatagramObject{
		TrackAlias:        r.trackAlias,
		GroupID:           o.GroupID,
		ObjectID:          o.ObjectID,
		PublisherPriority: 0,
		ObjectPayload:     o.Payload,
	}
	message.SetZeroObjectID(o.ObjectID == 0)
	if policy != nil {
		if !policy.Valid() {
			return ErrDeliveryPolicy
		}
		message.PublisherPriority = uint8(policy.Priority * 64)
		return r.session.scheduler().enqueue(r.trackAlias, message.AppendDatagram(nil), *policy, result...)
	}
	return r.session.conn.SendDatagram(message.AppendDatagram(nil))
}

func (r *IncomingSubscribeRequest) OpenSubgroup(groupID, subgroupID uint64, priority uint8) (*Subgroup, error) {
	stream, err := r.session.conn.OpenUniStream()
	if err != nil {
		return nil, err
	}
	appender := wire.NewAppender(stream, r.session.version)
	subgroup, err := newSubgroup(appender, r.trackAlias, groupID, subgroupID, priority)
	if err != nil {
		stream.Reset(uint32(StreamResetErrorCodeInternal))
		return nil, err
	}
	subgroup.sender = stream
	return subgroup, nil
}

func (r *IncomingSubscribeRequest) Close() error {
	// TODO
	return nil
}

func (r *IncomingSubscribeRequest) Namespace() [][]byte {
	return r.namespace
}

func (r *IncomingSubscribeRequest) Name() []byte {
	return r.name
}
