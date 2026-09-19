package innerquic

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/quic-go/quic-go"
	masqueclient "qortal.org/qortal-hub/private-transport/internal/masque"
)

const (
	privateKeepAlivePeriod = 15 * time.Second
	privateMaxIdleTimeout  = 2 * time.Minute
)

func privateQUICConfig() *quic.Config {
	return &quic.Config{
		EnableDatagrams:         true,
		InitialPacketSize:       InnerPacketSize,
		DisablePathMTUDiscovery: true,
		KeepAlivePeriod:         privateKeepAlivePeriod,
		MaxIdleTimeout:          privateMaxIdleTimeout,
	}
}

type Config struct {
	Relay             masqueclient.Config
	BackendServerName string
	BackendCertSHA256 string
	LogicalSessionID  string
	AttachToken       string
	Nonce             string
	Purpose           string
	OwnerBindingHash  string
	Timeout           time.Duration
}

type Event struct {
	Kind, MessageID, Code string
	Data                  []byte
}
type Metrics struct {
	TunnelReceiveQueuedBytes        int64  `json:"tunnelReceiveQueuedBytes"`
	TunnelReceiveDroppedFull        uint64 `json:"tunnelReceiveDroppedFull"`
	TunnelReceiveDroppedBudget      uint64 `json:"tunnelReceiveDroppedBudget"`
	TunnelReceiveDroppedExpired     uint64 `json:"tunnelReceiveDroppedExpired"`
	TunnelReceiveMaxResidenceMicros uint64 `json:"tunnelReceiveMaxResidenceMicros"`
	OuterReceiveDroppedFull         uint64 `json:"outerReceiveDroppedFull"`
	OuterReceiveDroppedBudget       uint64 `json:"outerReceiveDroppedBudget"`
	OuterReceiveDroppedExpired      uint64 `json:"outerReceiveDroppedExpired"`
	InnerPacketsSent                uint64 `json:"innerPacketsSent"`
	InnerPacketsLost                uint64 `json:"innerPacketsLost"`
	InnerWireBytesSent              uint64 `json:"innerWireBytesSent"`
	InnerWireBytesLost              uint64 `json:"innerWireBytesLost"`
	OuterRTTMillis                  int64  `json:"outerRttMillis"`
	OuterPacketsSent                uint64 `json:"outerPacketsSent"`
	OuterPacketsLost                uint64 `json:"outerPacketsLost"`
	OuterWireBytesSent              uint64 `json:"outerWireBytesSent"`
	OuterWireBytesLost              uint64 `json:"outerWireBytesLost"`
	TunnelWrites                    uint64 `json:"tunnelWrites"`
	TunnelWriteMicros               uint64 `json:"tunnelWriteMicros"`
	TunnelWriteErrors               uint64 `json:"tunnelWriteErrors"`
	InnerRTTMillis                  int64  `json:"innerRttMillis"`
	BytesSent                       uint64 `json:"bytesSent"`
	BytesReceived                   uint64 `json:"bytesReceived"`
	DatagramsDropped                uint64 `json:"datagramsDropped"`
	StreamErrors                    uint64 `json:"streamErrors"`
	ConnectionErrors                uint64 `json:"connectionErrors"`
}

type Session struct {
	tunnel           *masqueclient.Tunnel
	conn             *quic.Conn
	stream           *quic.Stream
	onEvent          func(Event)
	reliableWriter   *boundedFrameWriter
	streamsMu        sync.Mutex
	streams          map[string]*reliableLane
	reliableStreams  bool
	maxReliableBytes int
	closed           atomic.Bool
	appSent          atomic.Uint64
	appReceived      atomic.Uint64
	datagramsDropped atomic.Uint64
	streamErrors     atomic.Uint64
	connectionErrors atomic.Uint64
}

type attachMetadata struct {
	ProtocolVersion  int    `json:"protocolVersion"`
	LogicalSessionID string `json:"logicalSessionId"`
	AttachToken      string `json:"attachToken"`
	Nonce            string `json:"nonce"`
	Purpose          string `json:"purpose"`
	OwnerBindingHash string `json:"ownerBindingHash"`
}
type attachedMetadata struct {
	MaxReliableBytes    int    `json:"maxReliablePayloadBytes"`
	ReliableStreams     bool   `json:"reliableStreams"`
	OK                  bool   `json:"ok"`
	LogicalSessionID    string `json:"logicalSessionId"`
	TransportGeneration int    `json:"transportGeneration"`
	Reliable            bool   `json:"reliable"`
	Datagrams           bool   `json:"datagrams"`
	Code                string `json:"code,omitempty"`
}
type messageMetadata struct {
	MessageID string `json:"messageId"`
}

func Open(ctx context.Context, cfg Config, onEvent func(Event)) (*Session, error) {
	pin, err := hex.DecodeString(cfg.BackendCertSHA256)
	if err != nil || len(pin) != sha256.Size {
		return nil, errors.New("invalid backend certificate pin")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tunnel, err := masqueclient.Open(ctx, cfg.Relay)
	if err != nil {
		return nil, fmt.Errorf("MASQUE_TUNNEL_FAILED: %w", err)
	}
	fail := func(err error) (*Session, error) { _ = tunnel.Close(); return nil, err }
	tlsConf := &tls.Config{
		MinVersion: tls.VersionTLS13, NextProtos: []string{ALPN}, ServerName: cfg.BackendServerName,
		InsecureSkipVerify: true,
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("backend certificate missing")
			}
			leaf := state.PeerCertificates[0]
			if now := time.Now(); now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
				return errors.New("backend certificate expired")
			}
			if err := leaf.VerifyHostname(cfg.BackendServerName); err != nil {
				return errors.New("backend certificate name mismatch")
			}
			observed := sha256.Sum256(leaf.Raw)
			if subtle.ConstantTimeCompare(observed[:], pin) != 1 {
				return errors.New("backend certificate pin mismatch")
			}
			return nil
		},
	}
	if tunnel.RemoteAddr() == nil {
		return fail(errors.New("INNER_QUIC_FAILED: missing proxied backend address"))
	}
	conn, err := quic.Dial(
		ctx,
		tunnel.PacketConn(),
		tunnel.RemoteAddr(),
		tlsConf,
		privateQUICConfig(),
	)
	if err != nil {
		return fail(fmt.Errorf("INNER_QUIC_FAILED: %w", err))
	}
	stream, err := conn.OpenStreamSync(ctx)
	if err != nil {
		_ = conn.CloseWithError(1, "attach failed")
		_ = tunnel.Close()
		return nil, fmt.Errorf("SESSION_ATTACH_FAILED: %w", err)
	}
	// Dial's context does not bound subsequent stream reads or writes.
	deadline, _ := ctx.Deadline()
	_ = stream.SetDeadline(deadline)
	stopAttach := context.AfterFunc(ctx, func() {
		stream.CancelRead(1)
		stream.CancelWrite(1)
	})
	defer stopAttach()
	metadata, err := Metadata(attachMetadata{ProtocolVersion: ProtocolVersion, LogicalSessionID: cfg.LogicalSessionID, AttachToken: cfg.AttachToken, Nonce: cfg.Nonce, Purpose: cfg.Purpose, OwnerBindingHash: cfg.OwnerBindingHash})
	if err != nil {
		_ = conn.CloseWithError(1, "attach failed")
		_ = tunnel.Close()
		return nil, fmt.Errorf("SESSION_ATTACH_FAILED: %w", err)
	}
	if err := WriteFrame(stream, Frame{Type: FrameAttach, Metadata: metadata}); err != nil {
		_ = conn.CloseWithError(1, "attach failed")
		_ = tunnel.Close()
		return nil, fmt.Errorf("SESSION_ATTACH_FAILED: %w", err)
	}
	response, err := ReadFrame(stream)
	if err != nil || response.Type != FrameAttached {
		_ = conn.CloseWithError(1, "attach failed")
		_ = tunnel.Close()
		return nil, errors.New("SESSION_ATTACH_FAILED")
	}
	var attached attachedMetadata
	if json.Unmarshal(response.Metadata, &attached) != nil || !attached.OK || attached.LogicalSessionID != cfg.LogicalSessionID || attached.TransportGeneration != 1 {
		_ = conn.CloseWithError(1, "attach rejected")
		_ = tunnel.Close()
		if attached.Code == "ATTACH_TOKEN_REJECTED" {
			return nil, errors.New("ATTACH_TOKEN_REJECTED")
		}
		return nil, errors.New("SESSION_ATTACH_FAILED")
	}
	if !conn.ConnectionState().SupportsDatagrams.Remote {
		_ = conn.CloseWithError(1, "datagrams required")
		_ = tunnel.Close()
		return nil, errors.New("DATAGRAM_UNSUPPORTED")
	}
	if !stopAttach() || ctx.Err() != nil {
		_ = conn.CloseWithError(1, "attach timed out")
		return fail(errors.New("SESSION_ATTACH_FAILED"))
	}
	_ = stream.SetDeadline(time.Time{})
	limit := attached.MaxReliableBytes
	if limit < 64*1024 || limit > MaxReliablePayloadBytes {
		limit = 64 * 1024
	}
	s := &Session{tunnel: tunnel, conn: conn, stream: stream, onEvent: onEvent,
		reliableWriter: newBoundedFrameWriter(stream), reliableStreams: attached.ReliableStreams,
		streams: make(map[string]*reliableLane), maxReliableBytes: limit}
	go s.readReliable()
	go s.readDatagrams()
	go s.watchConnection()
	return s, nil
}

func (s *Session) SendReliable(messageID string, data []byte) error {
	return s.SendReliableWithTimeout(messageID, data, 5*time.Second)
}

func (s *Session) SendReliableWithTimeout(messageID string, data []byte, timeout time.Duration) error {
	if s.closed.Load() {
		return errors.New("TRANSPORT_CLOSED")
	}
	if len(messageID) == 0 || len(messageID) > 128 || len(data) > 64*1024 {
		return errors.New("FRAME_TOO_LARGE")
	}
	metadata, _ := Metadata(messageMetadata{MessageID: messageID})
	err := s.reliableWriter.write(Frame{Type: FrameReliable, Metadata: metadata, Payload: data}, timeout)
	if err == nil {
		s.appSent.Add(uint64(len(data)))
	} else {
		s.streamErrors.Add(1)
	}
	return err
}

func (s *Session) SendDatagram(messageID string, data []byte) error {
	if s.closed.Load() {
		return errors.New("TRANSPORT_CLOSED")
	}
	encoded, err := EncodeDatagram(messageID, data)
	if err != nil {
		return err
	}
	if err = s.conn.SendDatagram(encoded); err != nil {
		s.datagramsDropped.Add(1)
		return err
	}
	s.appSent.Add(uint64(len(data)))
	return nil
}

func (s *Session) Metrics() Metrics {
	stats := s.conn.ConnectionStats()
	m := Metrics{InnerRTTMillis: stats.SmoothedRTT.Milliseconds(), BytesSent: s.appSent.Load(), BytesReceived: s.appReceived.Load(), DatagramsDropped: s.datagramsDropped.Load(), StreamErrors: s.streamErrors.Load(), ConnectionErrors: s.connectionErrors.Load(),
		InnerPacketsSent: stats.PacketsSent, InnerPacketsLost: stats.PacketsLost,
		InnerWireBytesSent: stats.BytesSent, InnerWireBytesLost: stats.BytesLost}
	if s.tunnel != nil {
		h, q := s.tunnel.ReceiveBufferMetrics()
		m.TunnelReceiveQueuedBytes, m.TunnelReceiveDroppedFull, m.TunnelReceiveDroppedBudget, m.TunnelReceiveDroppedExpired = h.QueuedBytes, h.DroppedFull, h.DroppedBudget, h.DroppedExpired
		m.TunnelReceiveMaxResidenceMicros = h.MaxResidenceMicros
		m.OuterReceiveDroppedFull, m.OuterReceiveDroppedBudget, m.OuterReceiveDroppedExpired = q.DroppedFull, q.DroppedBudget, q.DroppedExpired
		outer, writes, micros, errors := s.tunnel.TransportMetrics()
		m.OuterRTTMillis = outer.SmoothedRTT.Milliseconds()
		m.OuterPacketsSent, m.OuterPacketsLost = outer.PacketsSent, outer.PacketsLost
		m.OuterWireBytesSent, m.OuterWireBytesLost = outer.BytesSent, outer.BytesLost
		m.TunnelWrites, m.TunnelWriteMicros, m.TunnelWriteErrors = writes, micros, errors
	}
	return m
}

func (s *Session) Close() error {
	if !s.closed.CompareAndSwap(false, true) {
		return nil
	}
	connErr := s.conn.CloseWithError(0, "closed")
	// The inner CONNECTION_CLOSE must traverse CONNECT-UDP before its packet
	// transport is torn down. A short grace avoids racing the outer tunnel close.
	time.Sleep(50 * time.Millisecond)
	return errors.Join(connErr, s.tunnel.Close())
}

func (s *Session) readReliable() {
	s.readReliableStream(s.stream, true)
}

func (s *Session) readReliableStream(stream *quic.Stream, primary bool) {
	for {
		frame, err := ReadFrame(stream)
		if err != nil {
			if primary && !s.closed.Load() {
				s.streamErrors.Add(1)
				s.emit(Event{Kind: "error", Code: "STREAM_ERROR"})
			}
			return
		}
		if frame.Type != FrameReliable {
			s.streamErrors.Add(1)
			if primary {
				s.emit(Event{Kind: "error", Code: "PROTOCOL_MISMATCH"})
			}
			return
		}
		var metadata messageMetadata
		if json.Unmarshal(frame.Metadata, &metadata) != nil || metadata.MessageID == "" {
			s.streamErrors.Add(1)
			if primary {
				s.emit(Event{Kind: "error", Code: "PROTOCOL_MISMATCH"})
			}
			return
		}
		s.appReceived.Add(uint64(len(frame.Payload)))
		s.emit(Event{Kind: "reliableMessage", MessageID: metadata.MessageID, Data: frame.Payload})
	}
}
func (s *Session) readDatagrams() {
	for {
		data, err := s.conn.ReceiveDatagram(context.Background())
		if err != nil {
			return
		}
		id, payload, err := DecodeDatagram(data)
		if err != nil {
			s.datagramsDropped.Add(1)
			continue
		}
		s.appReceived.Add(uint64(len(payload)))
		s.emit(Event{Kind: "datagram", MessageID: id, Data: payload})
	}
}
func (s *Session) watchConnection() {
	<-s.conn.Context().Done()
	if !s.closed.Load() {
		s.connectionErrors.Add(1)
		s.emit(Event{Kind: "error", Code: "INNER_QUIC_FAILED"})
	}
}
func (s *Session) emit(event Event) {
	if s.onEvent != nil {
		s.onEvent(event)
	}
}
