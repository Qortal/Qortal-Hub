package moqtransport

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

type datagramCapture struct {
	Connection
	data  []byte
	calls int
	err   error
}

func (c *datagramCapture) SendDatagram(data []byte) error {
	c.calls++
	c.data = append([]byte(nil), data...)
	return c.err
}

func TestDatagramSendWireAndErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		id   uint64
		want []byte
	}{
		{"zero", 0, []byte{0x04, 0x01, 0x02, 0x00, 0xaa, 0xbb}},
		{"nonzero", 3, []byte{0x00, 0x01, 0x02, 0x03, 0x00, 0xaa, 0xbb}},
		{"multibyte", 128, []byte{0x00, 0x01, 0x02, 0x80, 0x80, 0x00, 0xaa, 0xbb}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := &datagramCapture{}
			r := &IncomingSubscribeRequest{session: &Session{ctx: context.Background(), conn: conn}, trackAlias: 1}
			if err := r.SendDatagram(Object{GroupID: 2, ObjectID: tc.id, Payload: []byte{0xaa, 0xbb}}); err != nil {
				t.Fatal(err)
			}
			if conn.calls != 1 || !bytes.Equal(conn.data, tc.want) {
				t.Fatalf("got %x (%d sends), want %x", conn.data, conn.calls, tc.want)
			}
			conn.err = errors.New("datagram too large")
			if err := r.SendDatagram(Object{}); !errors.Is(err, conn.err) || conn.calls != 2 {
				t.Fatalf("transport error must propagate after exactly one attempt: %v", err)
			}
			if err := r.SendDatagram(Object{SubGroupID: 1}); err == nil || conn.calls != 2 {
				t.Fatal("subgroup was silently discarded")
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			r.session.ctx = ctx
			if err := r.SendDatagram(Object{}); !errors.Is(err, context.Canceled) || conn.calls != 2 {
				t.Fatal("closed session sent a datagram")
			}
		})
	}
}
