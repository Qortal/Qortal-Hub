package innerquic

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"github.com/quic-go/quic-go"
	"math/big"
	"testing"
	"time"
)

func TestControlStreamProgressesWhileBulkIsFlowControlled(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := quic.ListenAddr("127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, NextProtos: []string{ALPN}}, &quic.Config{InitialStreamReceiveWindow: 1024, MaxStreamReceiveWindow: 1024, InitialConnectionReceiveWindow: 1024 * 1024, MaxConnectionReceiveWindow: 1024 * 1024})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, err := quic.DialAddr(ctx, listener.Addr().String(), &tls.Config{InsecureSkipVerify: true, NextProtos: []string{ALPN}}, &quic.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseWithError(0, "test complete")
	server, err := listener.Accept(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer server.CloseWithError(0, "test complete")
	events := make(chan Event, 4)
	session := &Session{conn: client, reliableStreams: true, maxReliableBytes: MaxReliablePayloadBytes, streams: map[string]*reliableLane{}, onEvent: func(e Event) { events <- e }}
	// An older attached peer does not opt into larger frames. Reject locally,
	// without creating a stream or disturbing its connection.
	session.maxReliableBytes = 0
	if err := session.SendReliableStream("unsupported", "large", make([]byte, 65537), false); err == nil || err.Error() != "BULK_TRANSPORT_UNSUPPORTED" {
		t.Fatalf("expected old-peer capability rejection, got %v", err)
	}
	if len(session.streams) != 0 {
		t.Fatal("unsupported send created a stream")
	}
	session.maxReliableBytes = MaxReliablePayloadBytes
	bulkResult := make(chan error, 1)
	go func() {
		bulkResult <- session.SendReliableStream("bulk", "bulk-message", make([]byte, MaxReliablePayloadBytes), false)
	}()
	bulk, err := server.AcceptStream(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately don't read bulk: its 1 KiB receive window cannot fit the frame.
	if err := session.SendReliableStream("control", "control-message", []byte("ping"), true); err != nil {
		t.Fatal(err)
	}
	control, err := server.AcceptStream(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if control.StreamID() == bulk.StreamID() {
		t.Fatal("traffic shared a stream")
	}
	frame, err := ReadFrame(control)
	if err != nil {
		t.Fatal(err)
	}
	if string(frame.Payload) != "ping" {
		t.Fatal("wrong control payload")
	}
	if err := WriteFrame(control, frame); err != nil {
		t.Fatal(err)
	}
	_ = control.Close()
	select {
	case event := <-events:
		if event.MessageID != "control-message" {
			t.Fatalf("wrong event: %+v", event)
		}
	case <-ctx.Done():
		t.Fatal("control response blocked behind bulk")
	}
	select {
	case <-bulkResult:
		t.Fatal("bulk unexpectedly completed without being read")
	default:
	}
	bulk.CancelRead(1)
	select {
	case err := <-bulkResult:
		if err == nil {
			t.Fatal("cancelled bulk write succeeded")
		}
	case <-ctx.Done():
		t.Fatal("cancelled write did not terminate")
	}
	// Stream failure must not close the authenticated QUIC connection.
	if err := session.SendReliableStream("diagnostic", "after-reset", []byte("ok"), false); err != nil {
		t.Fatal(err)
	}
}
