package main

import (
	"bufio"
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
)

type fixture struct {
	mu            sync.Mutex
	echoConn      *net.UDPConn
	relayConn     *net.UDPConn
	server        *http3.Server
	proxy         masque.Proxy
	targetAddress string
	relayEgress   string
	echoSource    string
	echoCount     int
}

func main() {
	f, startup, err := startFixture()
	if err != nil {
		os.Exit(1)
	}
	defer f.close()
	encoder := json.NewEncoder(os.Stdout)
	_ = encoder.Encode(startup)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var command struct {
			Operation string `json:"operation"`
		}
		if json.Unmarshal(scanner.Bytes(), &command) != nil {
			continue
		}
		switch command.Operation {
		case "stats":
			f.mu.Lock()
			response := map[string]interface{}{"echoCount": f.echoCount, "echoSource": f.echoSource, "relayEgress": f.relayEgress}
			f.mu.Unlock()
			_ = encoder.Encode(response)
		case "stopRelay":
			f.stopRelay()
			_ = encoder.Encode(map[string]bool{"relayStopped": true})
		case "shutdown":
			_ = encoder.Encode(map[string]bool{"shuttingDown": true})
			return
		}
	}
}

func startFixture() (*fixture, map[string]string, error) {
	echoConn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		return nil, nil, err
	}
	f := &fixture{echoConn: echoConn, targetAddress: echoConn.LocalAddr().String()}
	go f.echoLoop()

	cert, der, err := testCertificate()
	if err != nil {
		f.close()
		return nil, nil, err
	}
	relayConn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		f.close()
		return nil, nil, err
	}
	f.relayConn = relayConn
	relayAddress := relayConn.LocalAddr().String()
	template := uritemplate.MustNew("https://" + relayAddress + "/.well-known/masque/udp/{target_host}/{target_port}/")
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/masque/udp/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Qortal-Relay-Control") == "authorize" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		req, parseErr := masque.ParseProxyRequest(r, template)
		if parseErr != nil || req.Target != f.targetAddress {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		target, resolveErr := net.ResolveUDPAddr("udp", f.targetAddress)
		if resolveErr != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		egress, dialErr := net.DialUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)}, target)
		if dialErr != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		f.mu.Lock()
		f.relayEgress = egress.LocalAddr().String()
		f.mu.Unlock()
		_ = f.proxy.ProxyConnectedSocket(w, req, egress)
	})
	f.server = &http3.Server{
		TLSConfig:  &tls.Config{Certificates: []tls.Certificate{cert}, NextProtos: []string{http3.NextProtoH3}},
		QUICConfig: &quic.Config{EnableDatagrams: true}, EnableDatagrams: true, Handler: mux,
	}
	go func() { _ = f.server.Serve(relayConn) }()
	pin := sha256.Sum256(der)
	return f, map[string]string{
		"relayAddress": relayAddress, "relayServerName": "qortal-test-relay",
		"relayCertSha256": hex.EncodeToString(pin[:]), "targetAddress": f.targetAddress,
	}, nil
}

func (f *fixture) echoLoop() {
	buf := make([]byte, 1500)
	for {
		n, addr, err := f.echoConn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		f.mu.Lock()
		f.echoCount++
		f.echoSource = addr.String()
		f.mu.Unlock()
		_, _ = f.echoConn.WriteToUDP(buf[:n], addr)
	}
}

func (f *fixture) stopRelay() {
	if f.server != nil {
		_ = f.server.Close()
		f.server = nil
	}
	if f.relayConn != nil {
		_ = f.relayConn.Close()
		f.relayConn = nil
	}
}
func (f *fixture) close() {
	f.stopRelay()
	_ = f.proxy.Close()
	if f.echoConn != nil {
		_ = f.echoConn.Close()
	}
}

func testCertificate() (tls.Certificate, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "qortal-test-relay"},
		DNSNames: []string{"qortal-test-relay"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	cert, err := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}),
	)
	return cert, der, err
}
