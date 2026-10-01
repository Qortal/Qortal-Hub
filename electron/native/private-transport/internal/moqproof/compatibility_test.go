package moqproof

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
	"sync/atomic"
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

const proofTimeout = 5 * time.Second

type proofHandler struct {
	subscriptions chan *moqtransport.IncomingSubscribeRequest
}

func (h *proofHandler) HandleGoAway(string) {}

func (h *proofHandler) HandleSubscribe(request *moqtransport.IncomingSubscribeRequest) {
	h.subscriptions <- request
}

func TestEncryptedMOQTObjectIsBlindlyRelayedBetweenTwoMasqueClients(t *testing.T) {
	t.Run("streams", func(t *testing.T) { testEncryptedRelay(t, false) })
	t.Run("datagrams_with_loss", func(t *testing.T) { testEncryptedRelay(t, true) })
}

// Drop one MoQ datagram before it reaches QUIC to model packet loss without
// disrupting TLS or MoQ control messages. Subsequent packets use the real tunnel.
type dropFirstDatagram struct {
	moqtransport.Connection
	sends atomic.Int32
}

func (c *dropFirstDatagram) SendDatagram(data []byte) error {
	if c.sends.Add(1) == 1 {
		return nil
	}
	return c.Connection.SendDatagram(data)
}

func sendProofObject(r *moqtransport.IncomingSubscribeRequest, o moqtransport.Object, datagrams bool) error {
	if datagrams {
		return r.SendDatagram(o)
	}
	sg, err := r.OpenSubgroup(o.GroupID, o.SubGroupID, 0)
	if err != nil {
		return err
	}
	if _, err = sg.WriteObject(o.ObjectID, o.Payload); err != nil {
		return err
	}
	return sg.Close()
}

func testEncryptedRelay(t *testing.T, datagrams bool) {
	ctx, cancel := context.WithTimeout(context.Background(), proofTimeout)
	defer cancel()

	backendCertificate := testCertificate(t, "moq-proof-backend")
	backendSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer backendSocket.Close()
	backendListener, err := quic.Listen(
		backendSocket,
		&tls.Config{
			Certificates: []tls.Certificate{backendCertificate},
			NextProtos:   []string{moqtransport.MOQT18.String()},
		},
		&quic.Config{
			EnableDatagrams:         true,
			InitialPacketSize:       1200,
			DisablePathMTUDiscovery: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer backendListener.Close()

	relayCertificate := testCertificate(t, "moq-proof-relay")
	relaySocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer relaySocket.Close()
	relayAddress := relaySocket.LocalAddr().String()
	backendAddress := backendSocket.LocalAddr().String()
	template := uritemplate.MustNew(
		"https://" + relayAddress + "/.well-known/masque/udp/{target_host}/{target_port}/",
	)
	proxy := masque.Proxy{}
	defer proxy.Close()
	relayEgress := make(chan string, 2)
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
		egress, dialErr := net.DialUDP(
			"udp",
			&net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)},
			target,
		)
		if dialErr != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		select {
		case relayEgress <- egress.LocalAddr().String():
		default:
		}
		_ = proxy.ProxyConnectedSocket(w, request, egress)
	})
	relayServer := &http3.Server{
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{relayCertificate},
			NextProtos:   []string{http3.NextProtoH3},
		},
		QUICConfig:      &quic.Config{EnableDatagrams: true},
		EnableDatagrams: true,
		Handler:         mux,
	}
	defer relayServer.Close()
	go func() { _ = relayServer.Serve(relaySocket) }()

	serverObjects := make(chan *moqtransport.Object, 1)
	serverRemoteAddress := make(chan string, 2)
	backendSubscriptions := make(chan *moqtransport.IncomingSubscribeRequest, 1)
	go func() {
		connection, acceptErr := backendListener.Accept(ctx)
		if acceptErr != nil {
			return
		}
		serverRemoteAddress <- connection.RemoteAddr().String()
		session, sessionErr := moqtransport.NewSession(
			quicmoq.NewServer(connection),
			"",
			moqtransport.WithHandler(&proofHandler{subscriptions: backendSubscriptions}),
		)
		if sessionErr != nil {
			return
		}
		subscription, subscribeErr := session.Subscribe(
			ctx,
			[][]byte{[]byte("qortal"), []byte("apps"), []byte("proof")},
			"objects",
		)
		if subscribeErr != nil {
			return
		}
		object, readErr := subscription.ReadObject(ctx)
		if readErr != nil {
			return
		}
		var downstream *moqtransport.IncomingSubscribeRequest
		select {
		case downstream = <-backendSubscriptions:
		case <-ctx.Done():
			return
		}
		downstream.Accept(2)
		if writeErr := sendProofObject(downstream, *object, datagrams); writeErr != nil {
			return
		}
		serverObjects <- object
	}()

	tunnel, err := masqueclient.Open(ctx, masqueclient.Config{
		RelayAddress:    relayAddress,
		RelayServerName: "moq-proof-relay",
		RelayCertSHA256: certificatePin(t, relayCertificate),
		TargetAddress:   backendAddress,
		Timeout:         proofTimeout,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer tunnel.Close()
	connection, err := quic.Dial(
		ctx,
		tunnel.PacketConn(),
		tunnel.RemoteAddr(),
		&tls.Config{
			InsecureSkipVerify: true,
			ServerName:         "moq-proof-backend",
			NextProtos:         []string{moqtransport.MOQT18.String()},
		},
		&quic.Config{
			EnableDatagrams:         true,
			InitialPacketSize:       1200,
			DisablePathMTUDiscovery: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	clientHandler := &proofHandler{
		subscriptions: make(chan *moqtransport.IncomingSubscribeRequest, 1),
	}
	publisherConnection := &dropFirstDatagram{Connection: quicmoq.NewClient(connection)}
	publisherSession, err := moqtransport.NewSession(
		publisherConnection,
		"publisher",
		moqtransport.WithHandler(clientHandler),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer publisherSession.CloseWithError(0, "proof complete")

	var publication *moqtransport.IncomingSubscribeRequest
	select {
	case publication = <-clientHandler.subscriptions:
	case <-ctx.Done():
		t.Fatal("backend did not subscribe to the client track")
	}
	publication.Accept(1)

	go func() {
		connection, acceptErr := backendListener.Accept(ctx)
		if acceptErr != nil {
			return
		}
		serverRemoteAddress <- connection.RemoteAddr().String()
		_, _ = moqtransport.NewSession(
			quicmoq.NewServer(connection),
			"",
			moqtransport.WithHandler(&proofHandler{subscriptions: backendSubscriptions}),
		)
	}()
	subscriberTunnel, err := masqueclient.Open(ctx, masqueclient.Config{
		RelayAddress:    relayAddress,
		RelayServerName: "moq-proof-relay",
		RelayCertSHA256: certificatePin(t, relayCertificate),
		TargetAddress:   backendAddress,
		Timeout:         proofTimeout,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer subscriberTunnel.Close()
	subscriberConnection, err := quic.Dial(
		ctx,
		subscriberTunnel.PacketConn(),
		subscriberTunnel.RemoteAddr(),
		&tls.Config{
			InsecureSkipVerify: true,
			ServerName:         "moq-proof-backend",
			NextProtos:         []string{moqtransport.MOQT18.String()},
		},
		&quic.Config{
			EnableDatagrams:         true,
			InitialPacketSize:       1200,
			DisablePathMTUDiscovery: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	subscriberSession, err := moqtransport.NewSession(
		quicmoq.NewClient(subscriberConnection),
		"subscriber",
		moqtransport.WithHandler(&proofHandler{subscriptions: make(chan *moqtransport.IncomingSubscribeRequest, 1)}),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer subscriberSession.CloseWithError(0, "proof complete")
	downstream, err := subscriberSession.Subscribe(
		ctx,
		[][]byte{[]byte("qortal"), []byte("apps"), []byte("proof")},
		"objects",
	)
	if err != nil {
		t.Fatal(err)
	}

	payload := make([]byte, 600)
	if _, err = rand.Read(payload); err != nil {
		t.Fatal(err)
	}
	if datagrams {
		if err = sendProofObject(publication, moqtransport.Object{GroupID: 1, ObjectID: 0, Payload: payload}, true); err != nil {
			t.Fatal(err)
		}
	}
	if err = sendProofObject(publication, moqtransport.Object{GroupID: 1, ObjectID: 1, Payload: payload}, datagrams); err != nil {
		t.Fatal(err)
	}

	var relayedObject *moqtransport.Object
	select {
	case object := <-serverObjects:
		relayedObject = object
		if !bytes.Equal(object.Payload, payload) {
			t.Fatal("backend changed the opaque MOQT payload")
		}
	case <-ctx.Done():
		t.Fatal("backend did not receive the MoQT object")
	}
	received, err := downstream.ReadObject(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if datagrams {
		if received.ForwardingPreference != moqtransport.ObjectForwardingPreferenceDatagram || received.ObjectID != 1 || publisherConnection.sends.Load() != 2 {
			t.Fatal("lost object was retried or delivery changed to a stream")
		}
		if err := publication.SendDatagram(moqtransport.Object{GroupID: 2, Payload: make([]byte, 65536)}); err == nil {
			t.Fatal("oversized datagram falsely reported success")
		}
	}
	if !bytes.Equal(received.Payload, relayedObject.Payload) {
		t.Fatal("subscriber received a different opaque object")
	}

	for range 2 {
		var observedBackendSource, observedRelayEgress string
		select {
		case observedBackendSource = <-serverRemoteAddress:
		case <-ctx.Done():
			t.Fatal("backend did not observe a source address")
		}
		select {
		case observedRelayEgress = <-relayEgress:
		case <-ctx.Done():
			t.Fatal("relay did not report its egress address")
		}
		if observedBackendSource != observedRelayEgress {
			t.Fatalf(
				"backend source %q was not the relay egress %q",
				observedBackendSource,
				observedRelayEgress,
			)
		}
	}
}

func testCertificate(t *testing.T, name string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(now.UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		DNSNames:     []string{name},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(
		rand.Reader,
		template,
		template,
		&key.PublicKey,
		key,
	)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func certificatePin(t *testing.T, certificate tls.Certificate) string {
	t.Helper()
	parsed, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(parsed.Raw)
	return hex.EncodeToString(digest[:])
}
