package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/yosida95/uritemplate/v3"
	"qortal.org/qortal-hub/private-transport/internal/innerquic"
)

const (
	logicalSessionID = "logical-test-session"
	attachToken      = "single-use-test-attach-token-00000001"
	nonce            = "test-bootstrap-nonce-0000000000000001"
	purpose          = "realtime"
	ownerBindingHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)

type benchmarkConnectionKey struct{}

type fixture struct {
	mu               sync.Mutex
	backendUDP       *net.UDPConn
	backendListener  *quic.Listener
	relayUDP         *net.UDPConn
	relayServer      *http3.Server
	proxy            masque.Proxy
	backendAddress   string
	backendSource    string
	relayEgress      string
	reliableCount    int
	datagramCount    int
	tokenUsed        bool
	dropNextDatagram bool
	connections      map[*quic.Conn]struct{}
}

func main() {
	f, startup, err := startFixture()
	if err != nil {
		os.Exit(1)
	}
	defer f.close()
	enc := json.NewEncoder(os.Stdout)
	_ = enc.Encode(startup)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var cmd struct {
			Operation string `json:"operation"`
		}
		if json.Unmarshal(scanner.Bytes(), &cmd) != nil {
			continue
		}
		switch cmd.Operation {
		case "stats":
			f.mu.Lock()
			v := map[string]interface{}{"backendSource": f.backendSource, "relayEgress": f.relayEgress, "reliableCount": f.reliableCount, "datagramCount": f.datagramCount, "tokenUsed": f.tokenUsed}
			f.mu.Unlock()
			v["receiveBuffers"] = quic.GlobalDatagramReceiveBufferStats()
			_ = enc.Encode(v)
		case "stopRelay":
			f.stopRelay()
			_ = enc.Encode(map[string]bool{"relayStopped": true})
		case "stopBackend":
			f.stopBackend()
			_ = enc.Encode(map[string]bool{"backendStopped": true})
		case "dropNextDatagram":
			f.mu.Lock()
			f.dropNextDatagram = true
			f.mu.Unlock()
			_ = enc.Encode(map[string]bool{"willDrop": true})
		case "shutdown":
			_ = enc.Encode(map[string]bool{"shuttingDown": true})
			return
		}
	}
}

func startFixture() (*fixture, map[string]interface{}, error) {
	backendCert, backendDER, err := certificate("qortal-test-backend")
	if err != nil {
		return nil, nil, err
	}
	backendUDP, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		return nil, nil, err
	}
	backendALPN := innerquic.ALPN
	if os.Getenv("QORTAL_STEP3_TEST_WRONG_ALPN") == "1" {
		backendALPN = "qortal-private/unsupported"
	}
	listener, err := quic.Listen(backendUDP, &tls.Config{Certificates: []tls.Certificate{backendCert}, NextProtos: []string{backendALPN}}, &quic.Config{EnableDatagrams: true, InitialPacketSize: innerquic.InnerPacketSize, DisablePathMTUDiscovery: true})
	if err != nil {
		return nil, nil, err
	}
	f := &fixture{backendUDP: backendUDP, backendListener: listener, backendAddress: backendUDP.LocalAddr().String(), connections: make(map[*quic.Conn]struct{})}
	go f.acceptBackend()
	relayCert, relayDER, err := certificate("qortal-test-relay")
	if err != nil {
		f.close()
		return nil, nil, err
	}
	relayUDP, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		f.close()
		return nil, nil, err
	}
	f.relayUDP = relayUDP
	relayAddress := relayUDP.LocalAddr().String()
	template := uritemplate.MustNew("https://" + relayAddress + "/.well-known/masque/udp/{target_host}/{target_port}/")
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/masque/udp/", func(w http.ResponseWriter, r *http.Request) {
		// The opt-in delay benchmark forwards through a local UDP proxy.
		if os.Getenv("QORTAL_STEP3_TEST_ACK_ONLY") == "1" {
			r.Host = relayAddress
			r.URL.Host = relayAddress
		}
		req, e := masque.ParseProxyRequest(r, template)
		if e != nil || req.Target != f.backendAddress {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		target, e := net.ResolveUDPAddr("udp", f.backendAddress)
		if e != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		egress, e := net.DialUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)}, target)
		if e != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		f.mu.Lock()
		f.relayEgress = egress.LocalAddr().String()
		f.mu.Unlock()
		w.(http3.HTTPStreamer).HTTPStream().EnableDatagramReceiveBuffer()
		if c, ok := r.Context().Value(benchmarkConnectionKey{}).(*quic.Conn); ok {
			c.EnableDatagramReceiveBuffer()
		}
		_ = f.proxy.ProxyConnectedSocket(w, req, egress)
	})
	f.relayServer = &http3.Server{ConnContext: func(ctx context.Context, c *quic.Conn) context.Context {
		return context.WithValue(ctx, benchmarkConnectionKey{}, c)
	}, TLSConfig: &tls.Config{Certificates: []tls.Certificate{relayCert}, NextProtos: []string{http3.NextProtoH3}}, QUICConfig: &quic.Config{EnableDatagrams: true}, EnableDatagrams: true, Handler: mux}
	go func() { _ = f.relayServer.Serve(relayUDP) }()
	relayPin := sha256.Sum256(relayDER)
	backendPin := sha256.Sum256(backendDER)
	return f, map[string]interface{}{"relayAddress": relayAddress, "relayServerName": "qortal-test-relay", "relayCertSha256": hex.EncodeToString(relayPin[:]), "backendAddress": f.backendAddress, "backendServerName": "qortal-test-backend", "backendCertSha256": hex.EncodeToString(backendPin[:]), "logicalSessionId": logicalSessionID, "attachToken": attachToken, "nonce": nonce, "purpose": purpose, "ownerBindingHash": ownerBindingHash, "expiresAt": time.Now().Add(time.Minute).UnixMilli(), "backendRnsDestination": "0123456789abcdef0123456789abcdef", "transport": "quic-masque-inner-v1"}, nil
}

func (f *fixture) acceptBackend() {
	for {
		conn, err := f.backendListener.Accept(context.Background())
		if err != nil {
			return
		}
		f.mu.Lock()
		f.backendSource = conn.RemoteAddr().String()
		f.connections[conn] = struct{}{}
		f.mu.Unlock()
		go f.handleBackend(conn)
	}
}
func (f *fixture) handleBackend(conn *quic.Conn) {
	defer func() { f.mu.Lock(); delete(f.connections, conn); f.mu.Unlock(); _ = conn.CloseWithError(0, "done") }()
	stream, err := conn.AcceptStream(context.Background())
	if err != nil {
		return
	}
	frame, err := innerquic.ReadFrame(stream)
	if err != nil || frame.Type != innerquic.FrameAttach {
		return
	}
	var attach struct {
		ProtocolVersion  int    `json:"protocolVersion"`
		LogicalSessionID string `json:"logicalSessionId"`
		AttachToken      string `json:"attachToken"`
		Nonce            string `json:"nonce"`
		Purpose          string `json:"purpose"`
		OwnerBindingHash string `json:"ownerBindingHash"`
	}
	_ = json.Unmarshal(frame.Metadata, &attach)
	f.mu.Lock()
	valid := attach.ProtocolVersion == innerquic.ProtocolVersion && attach.LogicalSessionID == logicalSessionID && attach.AttachToken == attachToken && attach.Nonce == nonce && attach.Purpose == purpose && attach.OwnerBindingHash == ownerBindingHash && !f.tokenUsed
	if valid {
		f.tokenUsed = true
	}
	f.mu.Unlock()
	response := map[string]interface{}{"ok": valid, "logicalSessionId": logicalSessionID, "transportGeneration": 1, "reliable": true, "datagrams": true}
	if os.Getenv("QORTAL_STEP3_TEST_BULK") == "1" {
		response["reliableStreams"] = true
		response["maxReliablePayloadBytes"] = innerquic.MaxReliablePayloadBytes
	}
	if !valid {
		response["code"] = "ATTACH_TOKEN_REJECTED"
	}
	metadata, _ := innerquic.Metadata(response)
	_ = innerquic.WriteFrame(stream, innerquic.Frame{Type: innerquic.FrameAttached, Metadata: metadata})
	if !valid {
		_ = stream.Close()
		time.Sleep(20 * time.Millisecond)
		return
	}
	go f.echoDatagrams(conn)
	go func() {
		for {
			keyed, err := conn.AcceptStream(context.Background())
			if err != nil {
				return
			}
			go f.echoReliable(keyed)
		}
	}()
	f.echoReliable(stream)
}

func (f *fixture) echoReliable(stream *quic.Stream) {
	defer stream.Close()
	for {
		message, err := innerquic.ReadFrame(stream)
		if err != nil {
			return
		}
		if message.Type != innerquic.FrameReliable {
			return
		}
		f.mu.Lock()
		f.reliableCount++
		f.mu.Unlock()
		if os.Getenv("QORTAL_STEP3_TEST_ACK_ONLY") == "1" {
			message.Payload = []byte("ack")
		}
		if innerquic.WriteFrame(stream, message) != nil {
			return
		}
	}
}
func (f *fixture) echoDatagrams(conn *quic.Conn) {
	for {
		data, err := conn.ReceiveDatagram(context.Background())
		if err != nil {
			return
		}
		if _, _, err := innerquic.DecodeDatagram(data); err != nil {
			continue
		}
		f.mu.Lock()
		f.datagramCount++
		drop := f.dropNextDatagram
		f.dropNextDatagram = false
		f.mu.Unlock()
		if drop {
			continue
		}
		_ = conn.SendDatagram(data)
	}
}
func (f *fixture) stopRelay() {
	if f.relayServer != nil {
		_ = f.relayServer.Close()
		f.relayServer = nil
	}
	if f.relayUDP != nil {
		_ = f.relayUDP.Close()
		f.relayUDP = nil
	}
}
func (f *fixture) stopBackend() {
	f.mu.Lock()
	connections := make([]*quic.Conn, 0, len(f.connections))
	for conn := range f.connections {
		connections = append(connections, conn)
	}
	f.mu.Unlock()
	for _, conn := range connections {
		_ = conn.CloseWithError(2, "backend stopped")
	}
	if f.backendListener != nil {
		_ = f.backendListener.Close()
		f.backendListener = nil
	}
	if f.backendUDP != nil {
		_ = f.backendUDP.Close()
		f.backendUDP = nil
	}
}
func (f *fixture) close() { f.stopRelay(); _ = f.proxy.Close(); f.stopBackend() }
func certificate(name string) (tls.Certificate, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	now := time.Now()
	template := &x509.Certificate{SerialNumber: big.NewInt(now.UnixNano()), Subject: pkix.Name{CommonName: name}, DNSNames: []string{name}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	cert, err := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}))
	return cert, der, err
}
