package masqueclient

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/yosida95/uritemplate/v3"
)

const MaxDatagramBytes = 1200

const (
	tunnelKeepAlivePeriod = 15 * time.Second
	tunnelMaxIdleTimeout  = 2 * time.Minute
)

func tunnelQUICConfig() *quic.Config {
	return &quic.Config{
		EnableDatagrams: true,
		KeepAlivePeriod: tunnelKeepAlivePeriod,
		MaxIdleTimeout:  tunnelMaxIdleTimeout,
	}
}

type Config struct {
	PreparedRelay   string
	LegacyRelay     bool
	RelayAddress    string
	RelayServerName string
	RelayCertSHA256 string
	TargetAddress   string
	Timeout         time.Duration
}

type Tunnel struct {
	conn        net.PacketConn
	outer       *quic.Conn
	writes      atomic.Uint64
	writeNanos  atomic.Uint64
	writeErrors atomic.Uint64
	onClose     func()
	closeOnce   sync.Once
}

// PacketConn is the only packet path exposed to the inner QUIC transport.
func (t *Tunnel) PacketConn() net.PacketConn {
	return &measuredPacketConn{PacketConn: t.conn, tunnel: t}
}

type measuredPacketConn struct {
	net.PacketConn
	tunnel *Tunnel
}

func (c *measuredPacketConn) WriteTo(data []byte, addr net.Addr) (int, error) {
	start := time.Now()
	n, err := c.PacketConn.WriteTo(data, addr)
	c.tunnel.writes.Add(1)
	c.tunnel.writeNanos.Add(uint64(time.Since(start)))
	if err != nil {
		c.tunnel.writeErrors.Add(1)
	}
	return n, err
}

// Outer counters cover the pooled relay connection, potentially shared by
// multiple tunnels. Write timing covers only this tunnel's packet submission.
func (t *Tunnel) TransportMetrics() (quic.ConnectionStats, uint64, uint64, uint64) {
	var stats quic.ConnectionStats
	if t.outer != nil {
		stats = t.outer.ConnectionStats()
	}
	return stats, t.writes.Load(), t.writeNanos.Load() / uint64(time.Microsecond), t.writeErrors.Load()
}

func (t *Tunnel) ReceiveBufferMetrics() (quic.DatagramReceiveBufferStats, quic.DatagramReceiveBufferStats) {
	var httpStats, quicStats quic.DatagramReceiveBufferStats
	if c, ok := t.conn.(interface {
		DatagramReceiveBufferStats() quic.DatagramReceiveBufferStats
	}); ok {
		httpStats = c.DatagramReceiveBufferStats()
	}
	if t.outer != nil {
		quicStats = t.outer.DatagramReceiveBufferStats()
	}
	return httpStats, quicStats
}

// RemoteAddr is the logical backend endpoint represented by CONNECT-UDP.
func (t *Tunnel) RemoteAddr() net.Addr {
	type remoteAddr interface{ RemoteAddr() net.Addr }
	if conn, ok := t.conn.(remoteAddr); ok {
		return conn.RemoteAddr()
	}
	return nil
}

func Open(ctx context.Context, cfg Config) (*Tunnel, error) {
	if cfg.PreparedRelay != "" {
		return openPrepared(ctx, cfg)
	}
	relay, err := parseLiteralAddrPort("relayAddress", cfg.RelayAddress)
	if err != nil {
		return nil, err
	}
	target, err := parseLiteralAddrPort("targetAddress", cfg.TargetAddress)
	if err != nil {
		return nil, err
	}
	if cfg.RelayServerName == "" {
		return nil, errors.New("relayServerName is required")
	}
	pin, err := hex.DecodeString(cfg.RelayCertSHA256)
	if err != nil || len(pin) != sha256.Size {
		return nil, errors.New("relayCertSha256 must be a 64-character hexadecimal SHA-256 hash")
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	relayAddress := relay.String()
	tlsConfig := &tls.Config{
		MinVersion:         tls.VersionTLS13,
		NextProtos:         []string{http3.NextProtoH3},
		ServerName:         cfg.RelayServerName,
		InsecureSkipVerify: true, // Standard verification is replaced by the mandatory leaf pin below.
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("relay did not present a certificate")
			}
			leaf := state.PeerCertificates[0]
			if now := time.Now(); now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
				return errors.New("relay certificate is outside its validity period")
			}
			if err := leaf.VerifyHostname(cfg.RelayServerName); err != nil {
				return errors.New("relay certificate identity mismatch")
			}
			observed := sha256.Sum256(leaf.Raw)
			if subtle.ConstantTimeCompare(observed[:], pin) != 1 {
				return errors.New("relay certificate pin mismatch")
			}
			return nil
		},
	}

	proxyTemplate := uritemplate.MustNew(fmt.Sprintf(
		"https://%s/.well-known/masque/udp/{target_host}/{target_port}/",
		relayAddress,
	))
	req, err := masque.NewRequest(ctx, proxyTemplate, target.String())
	if err != nil {
		return nil, fmt.Errorf("create CONNECT-UDP request: %w", err)
	}
	var outer *quic.Conn
	transport := masque.Transport{
		TLSClientConfig: tlsConfig,
		QUICConfig:      tunnelQUICConfig(),
		// Pin the network destination as well as its certificate identity. This
		// prevents a library change from resolving or substituting a hostname.
		DialAddr: func(dialCtx context.Context, addr string, tlsConf *tls.Config, quicConf *quic.Config) (*quic.Conn, error) {
			if addr != relayAddress {
				return nil, fmt.Errorf("unexpected relay address %q", addr)
			}
			var err error
			outer, err = quic.DialAddr(dialCtx, relayAddress, tlsConf, quicConf)
			return outer, err
		},
	}
	conn, response, err := transport.Dial(req)
	if err != nil {
		if response != nil {
			return nil, responseError(response)
		}
		return nil, fmt.Errorf("open CONNECT-UDP tunnel: %w", err)
	}
	conn.EnableDatagramReceiveBuffer()
	outer.EnableDatagramReceiveBuffer()
	return &Tunnel{conn: conn, outer: outer}, nil
}

func parseLiteralAddrPort(name, value string) (netip.AddrPort, error) {
	addr, err := netip.ParseAddrPort(value)
	if err != nil || !addr.Addr().IsValid() || addr.Port() == 0 {
		return netip.AddrPort{}, fmt.Errorf("%s must be a literal IP address and non-zero port", name)
	}
	return addr, nil
}

func (t *Tunnel) Send(data []byte) error {
	if len(data) == 0 || len(data) > MaxDatagramBytes {
		return fmt.Errorf("datagram must contain 1..%d bytes", MaxDatagramBytes)
	}
	_, err := t.conn.WriteTo(data, nil)
	return err
}

func (t *Tunnel) Receive(timeout time.Duration) ([]byte, error) {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	if err := t.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return nil, err
	}
	buf := make([]byte, 1500)
	n, _, err := t.conn.ReadFrom(buf)
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), buf[:n]...), nil
}

func (t *Tunnel) Close() error {
	err := t.conn.Close()
	t.closeOnce.Do(func() {
		if t.onClose != nil {
			t.onClose()
		}
	})
	return err
}

func responseError(response *http.Response) error {
	code := response.Header.Get("Qortal-Relay-Error")
	switch code {
	case "RELAY_ACCESS_DENIED", "RELAY_PROOF_INVALID", "RELAY_AUTH_REQUIRED", "RELAY_MEMBERSHIP_UNAVAILABLE", "RELAY_TARGET_DENIED", "RELAY_FULL", "RELAY_AUTH_RATE_LIMITED", "RELAY_AUTH_UNAVAILABLE":
		return errors.New(code)
	}
	return errors.New("RELAY_PROTOCOL_UNSUPPORTED")
}

// Authenticated QUIC application close codes preserve rejection semantics
// even when an immediate revocation closes before its HTTP response arrives.
func relayConnectionError(err error) error {
	var applicationError *quic.ApplicationError
	if errors.As(err, &applicationError) {
		switch applicationError.ErrorCode {
		case 0x515201:
			return errors.New("RELAY_ACCESS_DENIED")
		case 0x515202:
			return errors.New("RELAY_AUTH_REQUIRED")
		case 0x515203:
			return errors.New("RELAY_FULL")
		}
	}
	return errors.New("RELAY_CONNECT_FAILED")
}

func pinnedRelayTLS(cfg Config) (*tls.Config, string, error) {
	relay, err := parseLiteralAddrPort("relayAddress", cfg.RelayAddress)
	if err != nil {
		return nil, "", err
	}
	pin, err := hex.DecodeString(cfg.RelayCertSHA256)
	if err != nil || len(pin) != 32 || cfg.RelayServerName == "" {
		return nil, "", errors.New("INVALID_RELAY_CONFIG")
	}
	return &tls.Config{MinVersion: tls.VersionTLS13, NextProtos: []string{http3.NextProtoH3}, ServerName: cfg.RelayServerName, InsecureSkipVerify: true, VerifyConnection: func(s tls.ConnectionState) error {
		if len(s.PeerCertificates) == 0 {
			return errors.New("RELAY_CERTIFICATE_INVALID")
		}
		leaf := s.PeerCertificates[0]
		hash := sha256.Sum256(leaf.Raw)
		if time.Now().Before(leaf.NotBefore) || time.Now().After(leaf.NotAfter) || leaf.VerifyHostname(cfg.RelayServerName) != nil || subtle.ConstantTimeCompare(hash[:], pin) != 1 {
			return errors.New("RELAY_CERTIFICATE_INVALID")
		}
		return nil
	}}, relay.String(), nil
}
