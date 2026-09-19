package protocol

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/mengelbart/moqtransport"
	"io"
	"strings"
	"sync"
	"time"

	"qortal.org/qortal-hub/private-transport/internal/innerquic"
	masqueclient "qortal.org/qortal-hub/private-transport/internal/masque"
	"qortal.org/qortal-hub/private-transport/internal/moqclient"
)

const (
	Version                 = 2
	SidecarVersion          = "0.11.0"
	MaxControlMessageBytes  = 64 * 1024
	MaxBinaryMessageBytes   = innerquic.MaxReliablePayloadBytes
	maxRememberedRequestIDs = 4096
)

// Dispatch and execution must decode the same complete schema. The decoder
// rejects unknown fields, so a routing-only subset rejects valid requests.
type privateSendParams struct {
	SessionID string `json:"sessionId"`
	MessageID string `json:"messageId"`
	StreamKey string `json:"streamKey"`
	EndStream bool   `json:"endStream"`
}

type moqPublishParams struct {
	MoqSessionID string                       `json:"moqSessionId"`
	TrackName    string                       `json:"trackName"`
	Batched      bool                         `json:"batched"`
	Delivery     *moqtransport.DeliveryPolicy `json:"delivery"`
	GroupID      *uint64                      `json:"groupId"`
	ObjectID     *uint64                      `json:"objectId"`
}

type Request struct {
	receivedAt   time.Time
	Version      int             `json:"version"`
	RequestID    string          `json:"requestId"`
	Operation    string          `json:"operation"`
	Params       json.RawMessage `json:"params,omitempty"`
	BinaryLength int             `json:"binaryLength,omitempty"`
}
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Response struct {
	Version   int         `json:"version"`
	Type      string      `json:"type"`
	RequestID string      `json:"requestId"`
	OK        bool        `json:"ok"`
	Result    interface{} `json:"result,omitempty"`
	Error     *Error      `json:"error,omitempty"`
}
type Event struct {
	Version        int      `json:"version"`
	Type           string   `json:"type"`
	Event          string   `json:"event"`
	SessionID      string   `json:"sessionId"`
	MessageID      string   `json:"messageId,omitempty"`
	SubscriptionID string   `json:"subscriptionId,omitempty"`
	Namespace      []string `json:"namespace,omitempty"`
	TrackName      string   `json:"trackName,omitempty"`
	GroupID        uint64   `json:"groupId"`
	ObjectID       uint64   `json:"objectId"`
	Code           string   `json:"code,omitempty"`
	BinaryLength   int      `json:"binaryLength,omitempty"`
}

type Server struct {
	mu          sync.Mutex
	tunnels     map[string]*masqueclient.Tunnel
	sessions    map[string]*innerquic.Session
	moqSessions map[string]*moqclient.Session
	seen        map[string]struct{}
	seenIDs     []string
	writeMu     sync.Mutex
	emit        func(Event, []byte)
}

func NewServer() *Server {
	return &Server{
		tunnels: map[string]*masqueclient.Tunnel{}, sessions: map[string]*innerquic.Session{},
		moqSessions: map[string]*moqclient.Session{}, seen: map[string]struct{}{},
	}
}

func (s *Server) Serve(ctx context.Context, input io.Reader, output io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	var preparations sync.WaitGroup
	slots := make(chan struct{}, 4)
	defer func() { cancel(); preparations.Wait(); masqueclient.CloseAllRelays() }()
	reader := bufio.NewReaderSize(input, 4096)
	s.emit = func(event Event, binary []byte) { s.write(output, event, binary) }
	reliableSends := reliableDispatcher{maxQueueAge: 6 * time.Second}
	var moqSends reliableDispatcher
	defer moqSends.workers.Wait()
	defer reliableSends.workers.Wait()
	defer s.Close()
	for {
		line, err := readControlLine(reader)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			s.write(output, failure("", "CONTROL_MESSAGE_TOO_LARGE", "control message exceeds limit"), nil)
			return nil
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var req Request
		if json.Unmarshal(line, &req) != nil {
			s.write(output, failure("", "MALFORMED_JSON", "invalid JSON request"), nil)
			continue
		}
		if req.BinaryLength < 0 || req.BinaryLength > MaxBinaryMessageBytes {
			s.write(output, failure(req.RequestID, "BINARY_FRAME_TOO_LARGE", "binary frame exceeds limit"), nil)
			return nil
		}
		binary := make([]byte, req.BinaryLength)
		if _, err := io.ReadFull(reader, binary); err != nil {
			s.write(output, failure(req.RequestID, "MALFORMED_BINARY_FRAME", "truncated binary frame"), nil)
			return nil
		}
		req.receivedAt = time.Now()
		if req.Operation == "publishMoqObject" {
			var p moqPublishParams
			if decodeParams(req.Params, &p) != nil || len(p.MoqSessionID) > 128 || len(p.TrackName) > 128 {
				s.write(output, failure(req.RequestID, "INVALID_PARAMS", "invalid publication params"), nil)
				continue
			}
			if !moqSends.submit(p.MoqSessionID+"\x00"+p.TrackName, len(binary), func(ready bool) {
				if !ready {
					s.write(output, failure(req.RequestID, "MOQ_OBJECT_EXPIRED", "publication queue timed out"), nil)
					return
				}
				response, _ := s.handleRequest(ctx, req, binary)
				s.write(output, response, nil)
			}) {
				s.write(output, failure(req.RequestID, "MOQ_QUEUE_LIMIT", "publication capacity reached"), nil)
			}
			continue
		}
		if req.Operation == "sendPrivateReliable" {
			var p privateSendParams
			if decodeParams(req.Params, &p) != nil || len(p.SessionID) > 128 || len(p.StreamKey) > 96 {
				s.write(output, failure(req.RequestID, "INVALID_PARAMS", "invalid stream params"), nil)
				continue
			}
			if !reliableSends.submit(p.SessionID+"\x00"+p.StreamKey, len(binary), func(ready bool) {
				if !ready {
					s.write(output, failure(req.RequestID, "RELIABLE_SEND_NOT_STARTED", "send expired before writing"), nil)
					return
				}
				response, _ := s.handleRequest(ctx, req, binary)
				s.write(output, response, nil)
			}) {
				s.write(output, failure(req.RequestID, "STREAM_LIMIT_REACHED", "stream send capacity reached"), nil)
			}
			continue
		}
		if req.Operation == "prepareRelay" || req.Operation == "authorizeRelay" {
			select {
			case slots <- struct{}{}:
				preparations.Add(1)
				go func(req Request) {
					defer preparations.Done()
					defer func() { <-slots }()
					response, _ := s.handleRequest(ctx, req, nil)
					s.write(output, response, nil)
				}(req)
			default:
				s.write(output, failure(req.RequestID, "RELAY_BUSY", "relay preparation capacity reached"), nil)
			}
			continue
		}
		response, shutdown := s.handleRequest(ctx, req, binary)
		s.write(output, response, nil)
		if shutdown {
			return nil
		}
	}
}

func readControlLine(reader *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		part, prefix, err := reader.ReadLine()
		if err != nil {
			return nil, err
		}
		if len(line)+len(part) > MaxControlMessageBytes {
			return nil, errors.New("control too large")
		}
		line = append(line, part...)
		if !prefix {
			return line, nil
		}
	}
}
func (s *Server) write(output io.Writer, value interface{}, binary []byte) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	encoded, err := json.Marshal(value)
	if err != nil {
		return
	}
	if writeAll(output, append(encoded, '\n')) != nil {
		return
	}
	if len(binary) > 0 {
		_ = writeAll(output, binary)
	}
}

func writeAll(output io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := output.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func (s *Server) Handle(ctx context.Context, line []byte) (Response, bool) {
	var req Request
	if json.Unmarshal(line, &req) != nil {
		return failure("", "MALFORMED_JSON", "invalid JSON request"), false
	}
	return s.handleRequest(ctx, req, nil)
}

func (s *Server) handleRequest(ctx context.Context, req Request, binary []byte) (Response, bool) {
	if req.RequestID == "" {
		return failure("", "MISSING_REQUEST_ID", "requestId is required"), false
	}
	if req.Version != Version {
		return failure(req.RequestID, "UNSUPPORTED_VERSION", "unsupported protocol version"), false
	}
	if s.rememberRequestID(req.RequestID) {
		return failure(req.RequestID, "DUPLICATE_REQUEST_ID", "requestId was already used"), false
	}
	switch req.Operation {
	case "prepareRelay", "authorizeRelay", "closeRelay", "clearRelays", "prepareRelayTickets", "finalizeRelayTickets":
		return s.relayOperation(ctx, req), false
	case "health":
		return success(req.RequestID, map[string]interface{}{"service": "qortal-private-transport", "sidecarVersion": SidecarVersion, "protocolVersion": Version, "innerAlpn": innerquic.ALPN, "moqAlpn": moqclient.ALPN}), false
	case "openMasqueTunnel":
		return s.openTunnel(ctx, req), false
	case "sendDatagram":
		return s.sendTunnel(req), false
	case "receiveDatagram":
		return s.receiveTunnel(req), false
	case "closeTunnel":
		return s.closeTunnel(req), false
	case "openPrivateSession":
		return s.openPrivateSession(ctx, req), false
	case "sendPrivateReliable":
		return s.sendPrivate(req, binary, true), false
	case "sendPrivateDatagram":
		return s.sendPrivate(req, binary, false), false
	case "sessionMetrics":
		return s.sessionMetrics(req), false
	case "closePrivateSession":
		return s.closePrivateSession(req), false
	case "openMoqSession":
		return s.openMoqSession(ctx, req), false
	case "subscribeMoqTrack":
		return s.subscribeMoqTrack(req), false
	case "publishMoqObject":
		return s.publishMoqObject(req, binary), false
	case "moqSessionMetrics":
		return s.moqSessionMetrics(req), false
	case "closeMoqSession":
		return s.closeMoqSession(req), false
	case "shutdown":
		return success(req.RequestID, map[string]bool{"shuttingDown": true}), true
	default:
		return failure(req.RequestID, "UNKNOWN_OPERATION", "unsupported operation"), false
	}
}

type moqOpenParams struct {
	PreparedRelay        string          `json:"preparedRelay"`
	RelayAddress         string          `json:"relayAddress"`
	RelayServerName      string          `json:"relayServerName"`
	RelayCertSHA256      string          `json:"relayCertSha256"`
	BackendAddress       string          `json:"backendAddress"`
	BackendServerName    string          `json:"backendServerName"`
	BackendCertSHA256    string          `json:"backendCertSha256"`
	LogicalSessionID     string          `json:"logicalSessionId"`
	AttachToken          string          `json:"attachToken"`
	PublicationNamespace []string        `json:"publicationNamespace"`
	PublicationTrack     json.RawMessage `json:"publicationTrack"`
	TimeoutMS            int             `json:"timeoutMs"`
}

func (s *Server) openMoqSession(ctx context.Context, req Request) Response {
	var p moqOpenParams
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	var track string
	var tracks []string
	if json.Unmarshal(p.PublicationTrack, &track) == nil {
		tracks = []string{track}
	} else if json.Unmarshal(p.PublicationTrack, &tracks) != nil || len(tracks) == 0 {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid publication tracks")
	}
	sessionID, err := randomID("moq-")
	if err != nil {
		return failure(req.RequestID, "INTERNAL_ERROR", "failed to allocate MOQT session ID")
	}
	session, err := moqclient.Open(ctx, moqclient.Config{
		Relay: masqueclient.Config{
			PreparedRelay: p.PreparedRelay,
			RelayAddress:  p.RelayAddress, RelayServerName: p.RelayServerName,
			RelayCertSHA256: p.RelayCertSHA256, TargetAddress: p.BackendAddress,
			Timeout: duration(p.TimeoutMS),
		},
		BackendServerName: p.BackendServerName, BackendCertSHA256: p.BackendCertSHA256,
		LogicalSessionID: p.LogicalSessionID, AttachToken: p.AttachToken,
		PublicationNamespace: p.PublicationNamespace, PublicationTrack: tracks[0], PublicationTracks: tracks,
		Timeout: duration(p.TimeoutMS),
	}, func(event moqclient.Event) { s.emitMoq(sessionID, event) })
	if err != nil {
		return failure(req.RequestID, moqErrorCode(err), "MOQT session establishment failed")
	}
	s.mu.Lock()
	s.moqSessions[sessionID] = session
	s.mu.Unlock()
	return success(req.RequestID, map[string]interface{}{
		"moqSessionId": sessionID, "logicalSessionId": p.LogicalSessionID,
		"publicationNamespace": p.PublicationNamespace, "publicationTrack": p.PublicationTrack,
		"applicationProtocol": moqclient.ALPN,
	})
}

func moqErrorCode(err error) string {
	if code := relayErrorCode(err); code != "" {
		return code
	}
	text := err.Error()
	if strings.Contains(text, "MASQUE_TUNNEL_FAILED") {
		return "MASQUE_TUNNEL_FAILED"
	}
	if strings.Contains(text, "certificate") {
		return "BACKEND_IDENTITY_MISMATCH"
	}
	for _, code := range []string{
		"MOQ_QUEUE_LIMIT", "MOQ_OBJECT_EXPIRED",
		"INVALID_MOQ_CONFIG", "MOQ_QUIC_FAILED", "MOQ_SESSION_FAILED",
		"MOQ_ATTACH_FAILED", "DATAGRAM_UNSUPPORTED", "INVALID_MOQ_SUBSCRIPTION",
		"MOQ_SUBSCRIBE_FAILED", "MOQ_SESSION_CLOSED", "MOQ_SUBSCRIPTION_LIMIT",
		"MOQ_SUBSCRIPTION_ID_REUSED", "MOQ_OBJECT_TOO_LARGE", "MOQ_SEND_FAILED",
	} {
		if strings.Contains(text, code) {
			return code
		}
	}
	return "MOQ_SESSION_FAILED"
}

func (s *Server) emitMoq(sessionID string, event moqclient.Event) {
	if s.emit == nil {
		return
	}
	s.emit(Event{
		Version: Version, Type: "event", Event: event.Kind, SessionID: sessionID,
		SubscriptionID: event.SubscriptionID, Namespace: event.Namespace, TrackName: event.TrackName,
		GroupID: event.GroupID, ObjectID: event.ObjectID, Code: event.Code,
		BinaryLength: len(event.Data),
	}, event.Data)
}

func (s *Server) subscribeMoqTrack(req Request) Response {
	var p struct {
		MoqSessionID   string   `json:"moqSessionId"`
		SubscriptionID string   `json:"subscriptionId"`
		Namespace      []string `json:"namespace"`
		TrackName      string   `json:"trackName"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	session := s.getMoqSession(p.MoqSessionID)
	if session == nil {
		return failure(req.RequestID, "MOQ_SESSION_CLOSED", "MOQT session does not exist")
	}
	if err := session.Subscribe(p.SubscriptionID, p.Namespace, p.TrackName); err != nil {
		return failure(req.RequestID, moqErrorCode(err), "MOQT subscription failed")
	}
	return success(req.RequestID, map[string]interface{}{
		"subscribed": true, "subscriptionId": p.SubscriptionID,
		"namespace": p.Namespace, "trackName": p.TrackName,
	})
}

func (s *Server) publishMoqObject(req Request, binary []byte) Response {
	var p moqPublishParams
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	session := s.getMoqSession(p.MoqSessionID)
	if session == nil {
		return failure(req.RequestID, "MOQ_SESSION_CLOSED", "MOQT session does not exist")
	}
	objects := [][]byte{binary}
	if p.Batched {
		var err error
		objects, err = parseMoqBatch(binary)
		if err != nil {
			return failure(req.RequestID, "INVALID_PARAMS", "invalid object batch")
		}
	}
	policy := moqtransport.DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 200}
	if p.Delivery != nil {
		policy = *p.Delivery
	}
	if !policy.Valid() {
		return failure(req.RequestID, "INVALID_MOQ_CONFIG", "invalid delivery policy")
	}
	if !req.receivedAt.IsZero() {
		policy.MaxQueueAgeMillis -= int(time.Since(req.receivedAt).Milliseconds())
	}
	if policy.MaxQueueAgeMillis < 10 {
		return failure(req.RequestID, "MOQ_OBJECT_EXPIRED", "publication deadline exceeded")
	}
	var err error
	if p.GroupID != nil || p.ObjectID != nil {
		if p.GroupID == nil || p.ObjectID == nil || p.Batched {
			return failure(req.RequestID, "INVALID_MOQ_CONFIG", "invalid reliable object")
		}
		err = session.PublishGroupObject(p.TrackName, *p.GroupID, *p.ObjectID, binary, policy)
	} else {
		err = session.PublishTrackBatch(p.TrackName, objects, policy)
	}
	if err != nil {
		return failure(req.RequestID, moqErrorCode(err), "MOQT object publish failed")
	}
	return success(req.RequestID, map[string]interface{}{
		"accepted": true, "bytesSent": len(binary),
	})
}

func parseMoqBatch(data []byte) ([][]byte, error) {
	var objects [][]byte
	for len(data) > 0 {
		if len(data) < 2 || len(objects) >= 8 {
			return nil, errors.New("invalid batch")
		}
		size := int(binary.BigEndian.Uint16(data[:2]))
		data = data[2:]
		if size == 0 || size > moqclient.MaxObjectBytes || size > len(data) {
			return nil, errors.New("invalid batch")
		}
		objects = append(objects, data[:size])
		data = data[size:]
	}
	if len(objects) == 0 {
		return nil, errors.New("empty batch")
	}
	return objects, nil
}

func (s *Server) moqSessionMetrics(req Request) Response {
	var p struct {
		MoqSessionID string `json:"moqSessionId"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	session := s.getMoqSession(p.MoqSessionID)
	if session == nil {
		return failure(req.RequestID, "MOQ_SESSION_CLOSED", "MOQT session does not exist")
	}
	return success(req.RequestID, session.Metrics())
}

func (s *Server) closeMoqSession(req Request) Response {
	var p struct {
		MoqSessionID string `json:"moqSessionId"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	s.mu.Lock()
	session := s.moqSessions[p.MoqSessionID]
	delete(s.moqSessions, p.MoqSessionID)
	s.mu.Unlock()
	if session == nil {
		return failure(req.RequestID, "MOQ_SESSION_CLOSED", "MOQT session does not exist")
	}
	_ = session.Close()
	return success(req.RequestID, map[string]bool{"closed": true})
}

func (s *Server) getMoqSession(id string) *moqclient.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.moqSessions[id]
}

type privateOpenParams struct {
	PreparedRelay     string `json:"preparedRelay"`
	RelayAddress      string `json:"relayAddress"`
	RelayServerName   string `json:"relayServerName"`
	RelayCertSHA256   string `json:"relayCertSha256"`
	BackendAddress    string `json:"backendAddress"`
	BackendServerName string `json:"backendServerName"`
	BackendCertSHA256 string `json:"backendCertSha256"`
	LogicalSessionID  string `json:"logicalSessionId"`
	AttachToken       string `json:"attachToken"`
	Nonce             string `json:"nonce"`
	Purpose           string `json:"purpose"`
	OwnerBindingHash  string `json:"ownerBindingHash"`
	TimeoutMS         int    `json:"timeoutMs"`
}

func (s *Server) openPrivateSession(ctx context.Context, req Request) Response {
	var p privateOpenParams
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	sessionID, err := randomID("session-")
	if err != nil {
		return failure(req.RequestID, "INTERNAL_ERROR", "failed to allocate session ID")
	}
	session, err := innerquic.Open(ctx, innerquic.Config{Relay: masqueclient.Config{PreparedRelay: p.PreparedRelay, RelayAddress: p.RelayAddress, RelayServerName: p.RelayServerName, RelayCertSHA256: p.RelayCertSHA256, TargetAddress: p.BackendAddress, Timeout: duration(p.TimeoutMS)}, BackendServerName: p.BackendServerName, BackendCertSHA256: p.BackendCertSHA256, LogicalSessionID: p.LogicalSessionID, AttachToken: p.AttachToken, Nonce: p.Nonce, Purpose: p.Purpose, OwnerBindingHash: p.OwnerBindingHash, Timeout: duration(p.TimeoutMS)}, func(e innerquic.Event) { s.emitInner(sessionID, e) })
	if err != nil {
		return failure(req.RequestID, innerErrorCode(err), "private session establishment failed")
	}
	s.mu.Lock()
	s.sessions[sessionID] = session
	s.mu.Unlock()
	innerID, _ := randomID("inner-")
	return success(req.RequestID, map[string]interface{}{"sessionId": sessionID, "innerQuicConnectionId": innerID, "logicalSessionId": p.LogicalSessionID, "transportGeneration": 1})
}
func innerErrorCode(err error) string {
	if code := relayErrorCode(err); code != "" {
		return code
	}
	text := err.Error()
	for _, code := range []string{"ATTACH_TOKEN_REJECTED", "DATAGRAM_UNSUPPORTED", "SESSION_ATTACH_FAILED", "MASQUE_TUNNEL_FAILED"} {
		if strings.Contains(text, code) {
			return code
		}
	}
	if strings.Contains(text, "certificate") {
		return "BACKEND_IDENTITY_MISMATCH"
	}
	if strings.Contains(text, "INNER_QUIC_FAILED") {
		return "INNER_QUIC_FAILED"
	}
	return "INNER_QUIC_FAILED"
}
func (s *Server) emitInner(sessionID string, e innerquic.Event) {
	if s.emit == nil {
		return
	}
	s.emit(Event{Version: Version, Type: "event", Event: e.Kind, SessionID: sessionID, MessageID: e.MessageID, Code: e.Code, BinaryLength: len(e.Data)}, e.Data)
}
func (s *Server) sendPrivate(req Request, binary []byte, reliable bool) Response {
	var p privateSendParams
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	if len(binary) == 0 {
		return failure(req.RequestID, "INVALID_BINARY_FRAME", "binary payload required")
	}
	session := s.getSession(p.SessionID)
	if session == nil {
		return failure(req.RequestID, "TRANSPORT_CLOSED", "session does not exist")
	}
	var err error
	if reliable {
		// Queueing and writing share one budget, below the seven-second IPC
		// timeout. Never restart a full write timeout after a long queue wait.
		budget := 5 * time.Second
		if !req.receivedAt.IsZero() {
			remaining := time.Until(req.receivedAt.Add(6 * time.Second))
			if remaining <= 0 {
				return failure(req.RequestID, "RELIABLE_SEND_NOT_STARTED", "send expired before writing")
			}
			budget = min(budget, remaining)
		}
		if p.StreamKey != "" {
			err = session.SendReliableStreamWithTimeout(p.StreamKey, p.MessageID, binary, p.EndStream, budget)
		} else {
			err = session.SendReliableWithTimeout(p.MessageID, binary, budget)
		}
	} else {
		err = session.SendDatagram(p.MessageID, binary)
	}
	if err != nil {
		code := "TRANSPORT_SEND_FAILED"
		for _, streamCode := range []string{"STREAM_LIMIT_REACHED", "RELIABLE_STREAM_FAILED", "RELIABLE_STREAMS_UNSUPPORTED", "TRANSPORT_CLOSED"} {
			if err.Error() == streamCode {
				code = streamCode
			}
		}
		if errors.Is(err, innerquic.ErrReliableWriteFailed) {
			code = "TRANSPORT_CLOSED"
		}
		if strings.Contains(err.Error(), "large") || strings.Contains(err.Error(), "invalid") {
			code = "FRAME_TOO_LARGE"
		}
		return failure(req.RequestID, code, "transport send failed")
	}
	return success(req.RequestID, map[string]interface{}{"accepted": true, "bytesSent": len(binary)})
}
func (s *Server) sessionMetrics(req Request) Response {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	session := s.getSession(p.SessionID)
	if session == nil {
		return failure(req.RequestID, "TRANSPORT_CLOSED", "session does not exist")
	}
	return success(req.RequestID, session.Metrics())
}
func (s *Server) closePrivateSession(req Request) Response {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	s.mu.Lock()
	session := s.sessions[p.SessionID]
	delete(s.sessions, p.SessionID)
	s.mu.Unlock()
	if session == nil {
		return failure(req.RequestID, "TRANSPORT_CLOSED", "session does not exist")
	}
	_ = session.Close()
	return success(req.RequestID, map[string]bool{"closed": true})
}
func (s *Server) getSession(id string) *innerquic.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id]
}

// Step 2 tunnel operations remain for regression tests.
func (s *Server) openTunnel(ctx context.Context, req Request) Response {
	var p struct {
		PreparedRelay   string `json:"preparedRelay"`
		RelayAddress    string `json:"relayAddress"`
		RelayServerName string `json:"relayServerName"`
		RelayCertSHA256 string `json:"relayCertSha256"`
		TargetAddress   string `json:"targetAddress"`
		TimeoutMS       int    `json:"timeoutMs"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	t, err := masqueclient.Open(ctx, masqueclient.Config{PreparedRelay: p.PreparedRelay, RelayAddress: p.RelayAddress, RelayServerName: p.RelayServerName, RelayCertSHA256: p.RelayCertSHA256, TargetAddress: p.TargetAddress, Timeout: duration(p.TimeoutMS)})
	if err != nil {
		return failure(req.RequestID, "MASQUE_OPEN_FAILED", "failed to open authenticated MASQUE tunnel")
	}
	id, _ := randomID("tunnel-")
	s.mu.Lock()
	s.tunnels[id] = t
	s.mu.Unlock()
	return success(req.RequestID, map[string]string{"tunnelId": id})
}
func (s *Server) sendTunnel(req Request) Response {
	var p struct {
		TunnelID   string `json:"tunnelId"`
		DataBase64 string `json:"dataBase64"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	data, err := base64.StdEncoding.DecodeString(p.DataBase64)
	if err != nil || len(data) == 0 || len(data) > masqueclient.MaxDatagramBytes {
		return failure(req.RequestID, "INVALID_DATAGRAM", "invalid or oversized datagram")
	}
	t := s.getTunnel(p.TunnelID)
	if t == nil {
		return failure(req.RequestID, "UNKNOWN_TUNNEL", "tunnel does not exist")
	}
	if t.Send(data) != nil {
		return failure(req.RequestID, "DATAGRAM_SEND_FAILED", "failed to send datagram")
	}
	return success(req.RequestID, map[string]int{"bytesSent": len(data)})
}
func (s *Server) receiveTunnel(req Request) Response {
	var p struct {
		TunnelID  string `json:"tunnelId"`
		TimeoutMS int    `json:"timeoutMs"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	t := s.getTunnel(p.TunnelID)
	if t == nil {
		return failure(req.RequestID, "UNKNOWN_TUNNEL", "tunnel does not exist")
	}
	data, err := t.Receive(duration(p.TimeoutMS))
	if err != nil {
		return failure(req.RequestID, "DATAGRAM_RECEIVE_FAILED", "failed to receive datagram")
	}
	return success(req.RequestID, map[string]string{"dataBase64": base64.StdEncoding.EncodeToString(data)})
}
func (s *Server) closeTunnel(req Request) Response {
	var p struct {
		TunnelID string `json:"tunnelId"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid params")
	}
	s.mu.Lock()
	t := s.tunnels[p.TunnelID]
	delete(s.tunnels, p.TunnelID)
	s.mu.Unlock()
	if t == nil {
		return failure(req.RequestID, "UNKNOWN_TUNNEL", "tunnel does not exist")
	}
	_ = t.Close()
	return success(req.RequestID, map[string]bool{"closed": true})
}
func (s *Server) getTunnel(id string) *masqueclient.Tunnel {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tunnels[id]
}
func (s *Server) Close() {
	s.mu.Lock()
	ts := s.tunnels
	ss := s.sessions
	ms := s.moqSessions
	s.tunnels = map[string]*masqueclient.Tunnel{}
	s.sessions = map[string]*innerquic.Session{}
	s.moqSessions = map[string]*moqclient.Session{}
	s.mu.Unlock()
	for _, x := range ms {
		_ = x.Close()
	}
	for _, x := range ss {
		_ = x.Close()
	}
	for _, x := range ts {
		_ = x.Close()
	}
}
func (s *Server) rememberRequestID(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.seen[id]; ok {
		return true
	}
	if len(s.seenIDs) == maxRememberedRequestIDs {
		delete(s.seen, s.seenIDs[0])
		s.seenIDs = s.seenIDs[1:]
	}
	s.seen[id] = struct{}{}
	s.seenIDs = append(s.seenIDs, id)
	return false
}
func decodeParams(raw json.RawMessage, target interface{}) error {
	if len(raw) == 0 {
		return errors.New("params required")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return errors.New("invalid params")
	}
	return nil
}
func duration(ms int) time.Duration {
	if ms < 1 || ms > 30_000 {
		return 8 * time.Second
	}
	return time.Duration(ms) * time.Millisecond
}
func randomID(prefix string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(b), nil
}
func success(id string, result interface{}) Response {
	return Response{Version: Version, Type: "response", RequestID: id, OK: true, Result: result}
}
func failure(id, code, message string) Response {
	return Response{Version: Version, Type: "response", RequestID: id, OK: false, Error: &Error{Code: code, Message: message}}
}
