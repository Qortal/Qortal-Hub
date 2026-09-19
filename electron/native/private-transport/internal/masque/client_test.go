package masqueclient

import (
	"net"
	"testing"
	"time"
)

func TestPacketMeasurementPreservesDeliveryAndErrors(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	tunnel := &Tunnel{conn: conn}
	measured := tunnel.PacketConn()
	if err := measured.SetDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if n, err := measured.WriteTo([]byte("opaque"), conn.LocalAddr()); n != 6 || err != nil {
		t.Fatalf("write changed: %d %v", n, err)
	}
	buffer := make([]byte, 10)
	if n, _, err := measured.ReadFrom(buffer); err != nil || string(buffer[:n]) != "opaque" {
		t.Fatalf("read changed: %v", err)
	}
	if err := measured.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := measured.WriteTo([]byte("opaque"), conn.LocalAddr()); err == nil {
		t.Fatal("closed socket write succeeded")
	}
	_, writes, _, failures := tunnel.TransportMetrics()
	if writes != 2 || failures != 1 {
		t.Fatalf("wrong counters: %d %d", writes, failures)
	}
}

func TestTunnelQUICConfigKeepsIdleCallTunnelAlive(t *testing.T) {
	config := tunnelQUICConfig()
	if !config.EnableDatagrams || config.KeepAlivePeriod != tunnelKeepAlivePeriod ||
		config.MaxIdleTimeout != tunnelMaxIdleTimeout {
		t.Fatalf("unexpected idle tunnel config: %#v", config)
	}
}
