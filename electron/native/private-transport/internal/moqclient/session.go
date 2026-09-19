package moqclient

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mengelbart/moqtransport"
	"github.com/mengelbart/moqtransport/quicmoq"
	"github.com/quic-go/quic-go"
	masqueclient "qortal.org/qortal-hub/private-transport/internal/masque"
)

const (
	ALPN                   = "moqt-18"
	MaxObjectBytes         = 1024
	MaxSubscriptions       = 128
	MaxNamespaceComponents = 8
	defaultConnectTimeout  = 8 * time.Second
	maxSafeJSONInteger     = uint64(1<<53 - 1)
	mediaKeepAlivePeriod   = 15 * time.Second
	mediaMaxIdleTimeout    = 2 * time.Minute
)

var safeName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

func mediaQUICConfig() *quic.Config {
	return &quic.Config{
		EnableDatagrams:         true,
		InitialPacketSize:       1200,
		DisablePathMTUDiscovery: true,
		KeepAlivePeriod:         mediaKeepAlivePeriod,
		MaxIdleTimeout:          mediaMaxIdleTimeout,
	}
}

type Config struct {
	Relay                masqueclient.Config
	BackendServerName    string
	BackendCertSHA256    string
	LogicalSessionID     string
	AttachToken          string
	PublicationNamespace []string
	PublicationTrack     string
	PublicationTracks    []string
	Timeout              time.Duration
}

type Event struct {
	Kind           string
	SubscriptionID string
	Namespace      []string
	TrackName      string
	GroupID        uint64
	ObjectID       uint64
	Data           []byte
	Code           string
}

type Metrics struct {
	moqtransport.DeliveryMetrics
	TunnelReceiveDroppedFull    uint64 `json:"tunnelReceiveDroppedFull"`
	TunnelReceiveDroppedBudget  uint64 `json:"tunnelReceiveDroppedBudget"`
	TunnelReceiveDroppedExpired uint64 `json:"tunnelReceiveDroppedExpired"`
	OuterReceiveDroppedFull     uint64 `json:"outerReceiveDroppedFull"`
	OuterReceiveDroppedBudget   uint64 `json:"outerReceiveDroppedBudget"`
	OuterReceiveDroppedExpired  uint64 `json:"outerReceiveDroppedExpired"`
	InnerRTTMillis              int64  `json:"innerRttMillis"`
	InnerMinRTTMillis           int64  `json:"innerMinRttMillis"`
	InnerPacketsSent            uint64 `json:"innerPacketsSent"`
	InnerPacketsLost            uint64 `json:"innerPacketsLost"`
	ObjectsSent                 uint64 `json:"objectsSent"`
	ObjectsRead                 uint64 `json:"objectsReceived"`
	BytesSent                   uint64 `json:"bytesSent"`
	BytesRead                   uint64 `json:"bytesReceived"`
	ObjectErrors                uint64 `json:"objectErrors"`
}

type publicationHandler struct {
	namespace   [][]byte
	track       string
	tracks      []string
	publication chan *moqtransport.IncomingSubscribeRequest
}

func (h *publicationHandler) HandleGoAway(string) {}

func (h *publicationHandler) HandleSubscribe(request *moqtransport.IncomingSubscribeRequest) {
	alias := uint64(0)
	tracks := h.tracks
	if len(tracks) == 0 {
		tracks = []string{h.track}
	}
	for index, track := range tracks {
		if string(request.Name()) == track {
			alias = uint64(index + 1)
		}
	}
	if !equalNamespace(request.Namespace(), h.namespace) || alias == 0 {
		request.Reject(moqtransport.RequestErrorCodeUnauthorized, "publication is not authorized")
		return
	}
	request.Accept(alias)
	select {
	case h.publication <- request:
	default:
		_ = request.Close()
	}
}

type subscription struct {
	namespace []string
	track     string
	request   *moqtransport.OutgoingSubscribeRequest
}

type Session struct {
	tunnel       *masqueclient.Tunnel
	conn         *quic.Conn
	moq          *moqtransport.Session
	publication  *moqtransport.IncomingSubscribeRequest
	publications map[string]*moqtransport.IncomingSubscribeRequest
	defaultTrack string
	onEvent      func(Event)

	mu            sync.Mutex
	subscriptions map[string]subscription
	closed        atomic.Bool
	nextObjectID  atomic.Uint64
	objectsSent   atomic.Uint64
	objectsRead   atomic.Uint64
	bytesSent     atomic.Uint64
	bytesRead     atomic.Uint64
	objectErrors  atomic.Uint64
}

func Open(ctx context.Context, cfg Config, onEvent func(Event)) (*Session, error) {
	tracks := cfg.PublicationTracks
	if len(tracks) == 0 {
		tracks = []string{cfg.PublicationTrack}
	}
	if len(tracks) > 8 {
		return nil, errors.New("INVALID_MOQ_CONFIG")
	}
	seen := map[string]bool{}
	for _, track := range tracks {
		if !safeName.MatchString(track) || seen[track] {
			return nil, errors.New("INVALID_MOQ_CONFIG")
		}
		seen[track] = true
	}
	cfg.PublicationTrack = tracks[0]
	if !validNamespace(cfg.PublicationNamespace) || !safeName.MatchString(cfg.PublicationTrack) ||
		cfg.LogicalSessionID == "" || len(cfg.LogicalSessionID) > 512 ||
		len(cfg.AttachToken) < 32 || len(cfg.AttachToken) > 128 {
		return nil, errors.New("INVALID_MOQ_CONFIG")
	}
	pin, err := hex.DecodeString(cfg.BackendCertSHA256)
	if err != nil || len(pin) != sha256.Size {
		return nil, errors.New("INVALID_MOQ_CONFIG")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultConnectTimeout
	}
	openCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tunnel, err := masqueclient.Open(openCtx, cfg.Relay)
	if err != nil {
		return nil, fmt.Errorf("MASQUE_TUNNEL_FAILED: %w", err)
	}
	fail := func(openErr error) (*Session, error) {
		_ = tunnel.Close()
		return nil, openErr
	}
	if tunnel.RemoteAddr() == nil {
		return fail(errors.New("MOQ_QUIC_FAILED: missing proxied backend address"))
	}
	connection, err := quic.Dial(
		openCtx,
		tunnel.PacketConn(),
		tunnel.RemoteAddr(),
		backendTLSConfig(cfg.BackendServerName, pin),
		mediaQUICConfig(),
	)
	if err != nil {
		return fail(fmt.Errorf("MOQ_QUIC_FAILED: %w", err))
	}
	handler := &publicationHandler{
		namespace: stringsToNamespace(cfg.PublicationNamespace),
		track:     cfg.PublicationTrack, tracks: tracks, publication: make(chan *moqtransport.IncomingSubscribeRequest, len(tracks)),
	}
	moq, err := moqtransport.NewSession(
		quicmoq.NewClient(connection), "attach/"+cfg.AttachToken,
		moqtransport.WithHandler(handler),
	)
	if err != nil {
		_ = connection.CloseWithError(1, "MOQT setup failed")
		return fail(fmt.Errorf("MOQ_SESSION_FAILED: %w", err))
	}
	publications := make(map[string]*moqtransport.IncomingSubscribeRequest)
	for len(publications) < len(tracks) {
		select {
		case publication := <-handler.publication:
			if !connection.ConnectionState().SupportsDatagrams.Remote {
				moq.CloseWithError(1, "datagrams required")
				return fail(errors.New("DATAGRAM_UNSUPPORTED"))
			}
			name := string(publication.Name())
			if publications[name] != nil {
				_ = publication.Close()
				continue
			}
			publications[name] = publication
		case <-moq.Context().Done():
			moq.CloseWithError(1, "MOQT attach failed")
			return fail(errors.New("MOQ_ATTACH_FAILED"))
		case <-openCtx.Done():
			moq.CloseWithError(1, "MOQT attach timed out")
			return fail(errors.New("MOQ_ATTACH_FAILED"))
		}
	}
	return &Session{tunnel: tunnel, conn: connection, moq: moq, publication: publications[tracks[0]],
		publications: publications, defaultTrack: tracks[0], onEvent: onEvent, subscriptions: make(map[string]subscription)}, nil
}

func backendTLSConfig(serverName string, pin []byte) *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS13, NextProtos: []string{ALPN}, ServerName: serverName,
		InsecureSkipVerify: true, // Replaced by the mandatory identity and leaf-pin checks below.
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("backend certificate missing")
			}
			leaf := state.PeerCertificates[0]
			if now := time.Now(); now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
				return errors.New("backend certificate expired")
			}
			if err := leaf.VerifyHostname(serverName); err != nil {
				return errors.New("backend certificate name mismatch")
			}
			observed := sha256.Sum256(leaf.Raw)
			if subtle.ConstantTimeCompare(observed[:], pin) != 1 {
				return errors.New("backend certificate pin mismatch")
			}
			return nil
		},
	}
}

func validNamespace(namespace []string) bool {
	if len(namespace) == 0 || len(namespace) > MaxNamespaceComponents {
		return false
	}
	total := 0
	for _, component := range namespace {
		if !safeName.MatchString(component) {
			return false
		}
		total += len(component)
	}
	return total <= 512
}

func stringsToNamespace(namespace []string) [][]byte {
	result := make([][]byte, len(namespace))
	for index, component := range namespace {
		result[index] = []byte(component)
	}
	return result
}

func equalNamespace(left, right [][]byte) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if string(left[index]) != string(right[index]) {
			return false
		}
	}
	return true
}

func (s *Session) Subscribe(subscriptionID string, namespace []string, track string) error {
	if s.closed.Load() {
		return errors.New("MOQ_SESSION_CLOSED")
	}
	if !safeName.MatchString(subscriptionID) || !validNamespace(namespace) || !safeName.MatchString(track) {
		return errors.New("INVALID_MOQ_SUBSCRIPTION")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, found := s.subscriptions[subscriptionID]; found {
		if equalStringNamespace(existing.namespace, namespace) && existing.track == track {
			return nil
		}
		return errors.New("MOQ_SUBSCRIPTION_ID_REUSED")
	}
	if len(s.subscriptions) >= MaxSubscriptions {
		return errors.New("MOQ_SUBSCRIPTION_LIMIT")
	}
	request, err := s.moq.Subscribe(s.moq.Context(), stringsToNamespace(namespace), track)
	if err != nil {
		return fmt.Errorf("MOQ_SUBSCRIBE_FAILED: %w", err)
	}
	entry := subscription{namespace: append([]string(nil), namespace...), track: track, request: request}
	s.subscriptions[subscriptionID] = entry
	go s.readSubscription(subscriptionID, entry)
	return nil
}

func equalStringNamespace(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (s *Session) PublishObject(payload []byte) error {
	return s.PublishTrackObject(s.defaultTrack, payload)
}

func (s *Session) PublishTrackObject(track string, payload []byte) error {
	return s.PublishTrackObjectWithPolicy(track, payload, moqtransport.DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 200})
}

func (s *Session) PublishTrackObjectWithPolicy(track string, payload []byte, policy moqtransport.DeliveryPolicy) error {
	return s.PublishTrackBatch(track, [][]byte{payload}, policy)
}

func (s *Session) PublishTrackBatch(track string, objects [][]byte, policy moqtransport.DeliveryPolicy) error {
	if track == "" {
		track = s.defaultTrack
	}
	if len(objects) < 1 || len(objects) > 8 || !policy.Valid() {
		return errors.New("INVALID_MOQ_CONFIG")
	}
	for _, payload := range objects {
		if len(payload) < 1 || len(payload) > MaxObjectBytes {
			return errors.New("MOQ_OBJECT_TOO_LARGE")
		}
	}
	var pending []<-chan error
	for _, payload := range objects {
		completion, err := s.queueTrackObject(track, payload, policy)
		if err != nil {
			return err
		}
		pending = append(pending, completion)
	}
	for index, completion := range pending {
		select {
		case err := <-completion:
			if err != nil {
				s.objectErrors.Add(1)
				return err
			}
			s.objectsSent.Add(1)
			s.bytesSent.Add(uint64(len(objects[index])))
		case <-s.moq.Context().Done():
			return errors.New("MOQ_SESSION_CLOSED")
		}
	}
	return nil
}

func (s *Session) PublishGroupObject(track string, groupID, objectID uint64, payload []byte, policy moqtransport.DeliveryPolicy) error {
	if s.closed.Load() {
		return errors.New("MOQ_SESSION_CLOSED")
	}
	if groupID > maxSafeJSONInteger || objectID > maxSafeJSONInteger || !policy.Valid() {
		return errors.New("INVALID_MOQ_CONFIG")
	}
	if len(payload) == 0 || len(payload) > moqtransport.MaxReliableObjectBytes {
		return errors.New("MOQ_OBJECT_TOO_LARGE")
	}
	publication := s.publications[track]
	if publication == nil {
		return errors.New("INVALID_MOQ_CONFIG")
	}
	err := publication.SendGroupObject(moqtransport.Object{GroupID: groupID, ObjectID: objectID, Payload: payload}, policy)
	if err != nil {
		s.objectErrors.Add(1)
		return fmt.Errorf("MOQ_SEND_FAILED: %w", err)
	}
	s.objectsSent.Add(1)
	s.bytesSent.Add(uint64(len(payload)))
	return nil
}

func (s *Session) queueTrackObject(track string, payload []byte, policy moqtransport.DeliveryPolicy) (<-chan error, error) {
	if s.closed.Load() {
		return nil, errors.New("MOQ_SESSION_CLOSED")
	}
	if len(payload) == 0 || len(payload) > MaxObjectBytes {
		return nil, errors.New("MOQ_OBJECT_TOO_LARGE")
	}
	objectID := s.nextObjectID.Add(1) - 1
	publication := s.publication
	if s.publications != nil {
		publication = s.publications[track]
	}
	if publication == nil {
		return nil, errors.New("INVALID_MOQ_CONFIG")
	}
	completion, err := publication.ScheduleDatagramResult(moqtransport.Object{
		GroupID: 0, ObjectID: objectID,
		ForwardingPreference: moqtransport.ObjectForwardingPreferenceDatagram,
		Payload:              append([]byte(nil), payload...),
	}, policy)
	if err != nil {
		s.objectErrors.Add(1)
		return nil, fmt.Errorf("MOQ_SEND_FAILED: %w", err)
	}
	return completion, nil
}

func (s *Session) readSubscription(subscriptionID string, entry subscription) {
	for {
		object, err := entry.request.ReadObject(s.moq.Context())
		if err != nil {
			if !s.closed.Load() {
				s.objectErrors.Add(1)
				s.emit(Event{Kind: "error", SubscriptionID: subscriptionID, Code: "MOQ_READ_FAILED"})
			}
			return
		}
		limit := MaxObjectBytes
		if object.ForwardingPreference == moqtransport.ObjectForwardingPreferenceSubgroup {
			limit = moqtransport.MaxReliableObjectBytes
		}
		if len(object.Payload) == 0 || len(object.Payload) > limit ||
			object.GroupID > maxSafeJSONInteger || object.ObjectID > maxSafeJSONInteger {
			s.objectErrors.Add(1)
			continue
		}
		s.objectsRead.Add(1)
		s.bytesRead.Add(uint64(len(object.Payload)))
		s.emit(Event{
			Kind: "object", SubscriptionID: subscriptionID,
			Namespace: append([]string(nil), entry.namespace...), TrackName: entry.track,
			GroupID: object.GroupID, ObjectID: object.ObjectID,
			Data: append([]byte(nil), object.Payload...),
		})
	}
}

func (s *Session) Metrics() Metrics {
	stats := s.conn.ConnectionStats()
	m := Metrics{
		DeliveryMetrics:   s.moq.DeliveryMetrics(),
		InnerRTTMillis:    stats.SmoothedRTT.Milliseconds(),
		InnerMinRTTMillis: stats.MinRTT.Milliseconds(),
		InnerPacketsSent:  stats.PacketsSent,
		InnerPacketsLost:  stats.PacketsLost,
		ObjectsSent:       s.objectsSent.Load(), ObjectsRead: s.objectsRead.Load(),
		BytesSent: s.bytesSent.Load(), BytesRead: s.bytesRead.Load(),
		ObjectErrors: s.objectErrors.Load(),
	}
	if s.tunnel != nil {
		h, q := s.tunnel.ReceiveBufferMetrics()
		m.TunnelReceiveDroppedFull, m.TunnelReceiveDroppedBudget, m.TunnelReceiveDroppedExpired = h.DroppedFull, h.DroppedBudget, h.DroppedExpired
		m.OuterReceiveDroppedFull, m.OuterReceiveDroppedBudget, m.OuterReceiveDroppedExpired = q.DroppedFull, q.DroppedBudget, q.DroppedExpired
	}
	return m
}

func (s *Session) Close() error {
	if !s.closed.CompareAndSwap(false, true) {
		return nil
	}
	s.mu.Lock()
	for _, entry := range s.subscriptions {
		_ = entry.request.Close()
	}
	s.subscriptions = make(map[string]subscription)
	s.mu.Unlock()
	s.moq.CloseWithError(0, "closed")
	time.Sleep(50 * time.Millisecond)
	return s.tunnel.Close()
}

func (s *Session) emit(event Event) {
	if s.onEvent != nil {
		s.onEvent(event)
	}
}
