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

type relay struct {
	mu         sync.Mutex
	server     *http3.Server
	proxy      masque.Proxy
	udp        *net.UDPConn
	target     string
	lastEgress string
}

type connectionKey struct{}

func main() {
	target := os.Getenv("QORTAL_STEP4_BACKEND_ADDRESS")
	parsedTarget, err := net.ResolveUDPAddr("udp", target)
	if err != nil || parsedTarget.Port == 0 || parsedTarget.IP == nil {
		panic("QORTAL_STEP4_BACKEND_ADDRESS must be a literal UDP endpoint")
	}
	certificate, der, err := testCertificate("qortal-step4-relay")
	if err != nil {
		panic(err)
	}
	udp, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		panic(err)
	}
	r := &relay{udp: udp, target: parsedTarget.String()}
	template := uritemplate.MustNew("https://" + udp.LocalAddr().String() + "/.well-known/masque/udp/{target_host}/{target_port}/")
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/masque/udp/", func(w http.ResponseWriter, request *http.Request) {
		if os.Getenv("QORTAL_STEP4_BULK_BENCH") == "1" {
			request.Host = udp.LocalAddr().String()
			request.URL.Host = request.Host
		}
		proxyRequest, parseErr := masque.ParseProxyRequest(request, template)
		if parseErr != nil || proxyRequest.Target != r.target {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		egress, dialErr := net.DialUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)}, parsedTarget)
		if dialErr != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		r.mu.Lock()
		r.lastEgress = egress.LocalAddr().String()
		r.mu.Unlock()
		w.(http3.HTTPStreamer).HTTPStream().EnableDatagramReceiveBuffer()
		request.Context().Value(connectionKey{}).(*quic.Conn).EnableDatagramReceiveBuffer()
		_ = r.proxy.ProxyConnectedSocket(w, proxyRequest, egress)
	})
	r.server = &http3.Server{
		ConnContext: func(ctx context.Context, c *quic.Conn) context.Context {
			return context.WithValue(ctx, connectionKey{}, c)
		},
		TLSConfig:       &tls.Config{Certificates: []tls.Certificate{certificate}, NextProtos: []string{http3.NextProtoH3}},
		QUICConfig:      &quic.Config{EnableDatagrams: true},
		EnableDatagrams: true,
		Handler:         mux,
	}
	go func() { _ = r.server.Serve(udp) }()
	pin := sha256.Sum256(der)
	write(map[string]interface{}{
		"relayAddress":    udp.LocalAddr().String(),
		"relayServerName": "qortal-step4-relay",
		"relayCertSha256": hex.EncodeToString(pin[:]),
	})
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var command struct {
			Operation string `json:"operation"`
		}
		_ = json.Unmarshal(scanner.Bytes(), &command)
		switch command.Operation {
		case "stats":
			r.mu.Lock()
			write(map[string]string{"relayEgress": r.lastEgress})
			r.mu.Unlock()
		case "shutdown":
			r.close()
			write(map[string]bool{"closed": true})
			return
		default:
			write(map[string]string{"error": "unknown operation"})
		}
	}
	r.close()
}

func (r *relay) close() {
	_ = r.server.Close()
	_ = r.proxy.Close()
	_ = r.udp.Close()
}

func write(value interface{}) { _ = json.NewEncoder(os.Stdout).Encode(value) }

func testCertificate(name string) (tls.Certificate, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
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
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, der, nil
}
