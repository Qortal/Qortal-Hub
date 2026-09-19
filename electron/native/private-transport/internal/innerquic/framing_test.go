package innerquic

import (
	"bytes"
	"testing"
)

func TestReliableFramePreservesMetadataAndBinaryPayload(t *testing.T) {
	var wire bytes.Buffer
	want := Frame{Type: FrameReliable, Metadata: []byte(`{"messageId":"m1"}`), Payload: []byte{0, 1, 2, 255}}
	if err := WriteFrame(&wire, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadFrame(&wire)
	if err != nil {
		t.Fatal(err)
	}
	if got.Type != want.Type || !bytes.Equal(got.Metadata, want.Metadata) || !bytes.Equal(got.Payload, want.Payload) {
		t.Fatalf("frame changed: %#v", got)
	}
}

func TestFramesRejectOversizeAndProtocolMismatch(t *testing.T) {
	if err := WriteFrame(&bytes.Buffer{}, Frame{Payload: make([]byte, MaxReliablePayloadBytes+1)}); err == nil {
		t.Fatal("oversized frame accepted")
	}
	wire, err := EncodeDatagram("m", []byte("ok"))
	if err != nil {
		t.Fatal(err)
	}
	wire[4]++
	if _, _, err := DecodeDatagram(wire); err == nil {
		t.Fatal("unsupported datagram version accepted")
	}
}
