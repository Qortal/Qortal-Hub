package moqclient

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"math/big"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/mengelbart/moqtransport"
	"github.com/mengelbart/moqtransport/quicmoq"
	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/yosida95/uritemplate/v3"
	masqueclient "qortal.org/qortal-hub/private-transport/internal/masque"
)

type integrationHandler struct {
	subscriptions chan *moqtransport.IncomingSubscribeRequest
}

func (h *integrationHandler) HandleGoAway(string) {}

func (h *integrationHandler) HandleSubscribe(request *moqtransport.IncomingSubscribeRequest) {
	h.subscriptions <- request
}

func TestSessionTransportsOpaqueMOQTObjectOnlyThroughMasque(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	backendCertificate := integrationCertificate(t, "moq-backend")
	backendSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer backendSocket.Close()
	backendListener, err := quic.Listen(
		backendSocket,
		&tls.Config{Certificates: []tls.Certificate{backendCertificate}, NextProtos: []string{ALPN}},
		&quic.Config{EnableDatagrams: true, InitialPacketSize: 1200, DisablePathMTUDiscovery: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer backendListener.Close()

	relayCertificate := integrationCertificate(t, "moq-relay")
	relaySocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer relaySocket.Close()
	relayAddress := relaySocket.LocalAddr().String()
	backendAddress := backendSocket.LocalAddr().String()
	template := uritemplate.MustNew("https://" + relayAddress + "/.well-known/masque/udp/{target_host}/{target_port}/")
	proxy := masque.Proxy{}
	defer proxy.Close()
	relayEgress := make(chan string, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/masque/udp/", func(w http.ResponseWriter, r *http.Request) {
		request, parseErr := masque.ParseProxyRequest(r, template)
		if parseErr != nil || request.Target != backendAddress {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		target, resolveErr := net.ResolveUDPAddr("udp", backendAddress)
		if resolveErr != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		egress, dialErr := net.DialUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)}, target)
		if dialErr != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		relayEgress <- egress.LocalAddr().String()
		_ = proxy.ProxyConnectedSocket(w, request, egress)
	})
	relayServer := &http3.Server{
		TLSConfig:  &tls.Config{Certificates: []tls.Certificate{relayCertificate}, NextProtos: []string{http3.NextProtoH3}},
		QUICConfig: &quic.Config{EnableDatagrams: true}, EnableDatagrams: true, Handler: mux,
	}
	defer relayServer.Close()
	go func() { _ = relayServer.Serve(relaySocket) }()

	attachToken := "integration-one-time-token-000000000000"
	publicationNamespace := []string{"qortal", "apps", "sample", "publisher-123"}
	publicationTrack := "realtime-data"
	tracks := []string{publicationTrack, "auxiliary", "status"}
	backendSource := make(chan string, 1)
	backendErrors := make(chan error, 1)
	go func() {
		connection, acceptErr := backendListener.Accept(ctx)
		if acceptErr != nil {
			backendErrors <- acceptErr
			return
		}
		backendSource <- connection.RemoteAddr().String()
		handler := &integrationHandler{subscriptions: make(chan *moqtransport.IncomingSubscribeRequest, 1)}
		session, sessionErr := moqtransport.NewSession(quicmoq.NewServer(connection), "", moqtransport.WithHandler(handler))
		if sessionErr != nil {
			backendErrors <- sessionErr
			return
		}
		defer session.CloseWithError(0, "test complete")
		for session.Path() == "" && ctx.Err() == nil {
			time.Sleep(time.Millisecond)
		}
		if session.Path() != "attach/"+attachToken {
			backendErrors <- context.Canceled
			return
		}
		sources := make([]*moqtransport.OutgoingSubscribeRequest, 0, len(tracks))
		for _, track := range tracks {
			source, subscribeErr := session.Subscribe(ctx, stringsToNamespace(publicationNamespace), track)
			if subscribeErr != nil {
				backendErrors <- subscribeErr
				return
			}
			sources = append(sources, source)
		}
		for index, source := range sources {
			object, readErr := source.ReadObject(ctx)
			if readErr != nil {
				backendErrors <- readErr
				return
			}
			var downstream *moqtransport.IncomingSubscribeRequest
			select {
			case downstream = <-handler.subscriptions:
			case <-ctx.Done():
				backendErrors <- ctx.Err()
				return
			}
			downstream.Accept(uint64(index + 10))
			if sendErr := downstream.SendScheduledDatagram(*object, moqtransport.DeliveryPolicy{Priority: index % 3, MaxQueueAgeMillis: 200}); sendErr != nil {
				backendErrors <- sendErr
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}()

	events := make(chan Event, 1)
	session, err := Open(ctx, Config{
		Relay: masqueclient.Config{
			RelayAddress: relayAddress, RelayServerName: "moq-relay",
			RelayCertSHA256: integrationCertificatePin(t, relayCertificate),
			TargetAddress:   backendAddress, Timeout: 5 * time.Second,
		},
		BackendServerName: "moq-backend", BackendCertSHA256: integrationCertificatePin(t, backendCertificate),
		LogicalSessionID: "logical-session", AttachToken: attachToken,
		PublicationNamespace: publicationNamespace, PublicationTrack: publicationTrack, PublicationTracks: tracks, Timeout: 5 * time.Second,
	}, func(event Event) { events <- event })
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	for _, publicationTrack := range tracks {
		if err = session.Subscribe("self-"+publicationTrack, publicationNamespace, publicationTrack); err != nil {
			t.Fatal(err)
		}
		payload := []byte("opaque-application-object/" + publicationTrack)
		if err = session.PublishTrackObject(publicationTrack, payload); err != nil {
			t.Fatal(err)
		}
		select {
		case event := <-events:
			if event.Kind != "object" || event.SubscriptionID != "self-"+publicationTrack ||
				event.TrackName != publicationTrack || !equalStringNamespace(event.Namespace, publicationNamespace) ||
				!bytes.Equal(event.Data, payload) {
				t.Fatalf("unexpected MOQT event: %#v", event)
			}
		case err = <-backendErrors:
			t.Fatal(err)
		case <-ctx.Done():
			t.Fatal("timed out waiting for relayed object")
		}
	}
	var observedBackendSource, observedRelayEgress string
	select {
	case observedBackendSource = <-backendSource:
	case <-ctx.Done():
		t.Fatal("backend did not observe a source")
	}
	select {
	case observedRelayEgress = <-relayEgress:
	case <-ctx.Done():
		t.Fatal("relay did not report its egress")
	}
	if observedBackendSource != observedRelayEgress {
		t.Fatalf("backend saw %q instead of relay %q", observedBackendSource, observedRelayEgress)
	}
}

func integrationCertificate(t *testing.T, name string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(now.UnixNano()), Subject: pkix.Name{CommonName: name}, DNSNames: []string{name},
		NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func integrationCertificatePin(t *testing.T, certificate tls.Certificate) string {
	t.Helper()
	parsed, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(parsed.Raw)
	return hex.EncodeToString(digest[:])
}
