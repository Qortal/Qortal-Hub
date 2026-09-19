package masqueclient

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	masque "github.com/quic-go/masque-go"
	"github.com/quic-go/quic-go"
	"github.com/yosida95/uritemplate/v3"
)

type PreparedRelay struct {
	Handle    string          `json:"handle"`
	Ready     bool            `json:"ready"`
	Challenge json.RawMessage `json:"challenge,omitempty"`
	ExpiresAt int64           `json:"expiresAt,omitempty"`
}
type pooledRelay struct {
	mu        sync.Mutex
	config    Config
	conn      *quic.Conn
	client    *masque.ClientConn
	ready     bool
	expiresAt int64
	touched   time.Time
	refs      int
}

var relayPool = struct {
	sync.Mutex
	entries map[string]*pooledRelay
	epoch   uint64
}{entries: map[string]*pooledRelay{}}

// BeginRelay connects without forwarding any destination traffic. Its handle
// is private IPC state; account authorization remains in the wallet process.
func BeginRelay(ctx context.Context, cfg Config) (PreparedRelay, error) {
	relayPool.Lock()
	epoch := relayPool.epoch
	relayPool.Unlock()
	tlsConfig, relayAddress, err := pinnedRelayTLS(cfg)
	if err != nil {
		return PreparedRelay{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	conn, err := quic.DialAddr(ctx, relayAddress, tlsConfig, tunnelQUICConfig())
	if err != nil {
		return PreparedRelay{}, fmt.Errorf("RELAY_CONNECT_FAILED: %w", err)
	}
	tr := &masque.Transport{}
	client, err := tr.NewClientConn(conn)
	if err != nil {
		conn.CloseWithError(0, "")
		return PreparedRelay{}, errors.New("RELAY_PROTOCOL_UNSUPPORTED")
	}
	id := make([]byte, 24)
	if _, err = rand.Read(id); err != nil {
		conn.CloseWithError(0, "")
		return PreparedRelay{}, err
	}
	handle := hex.EncodeToString(id)
	p := &pooledRelay{config: cfg, conn: conn, client: client, touched: time.Now()}
	relayPool.Lock()
	if epoch != relayPool.epoch {
		relayPool.Unlock()
		conn.CloseWithError(0, "account changed")
		return PreparedRelay{}, errors.New("RELAY_CONNECTION_CLOSED")
	}
	if len(relayPool.entries) >= 32 {
		relayPool.Unlock()
		conn.CloseWithError(0, "")
		return PreparedRelay{}, errors.New("RELAY_POOL_FULL")
	}
	relayPool.entries[handle] = p
	relayPool.Unlock()
	context.AfterFunc(conn.Context(), func() { relayPool.Lock(); delete(relayPool.entries, handle); relayPool.Unlock() })
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-conn.Context().Done():
				return
			case <-ticker.C:
				p.mu.Lock()
				idle := p.refs == 0 && time.Since(p.touched) > 30*time.Second
				p.mu.Unlock()
				if idle {
					CloseRelay(handle)
					return
				}
			}
		}
	}()
	if cfg.LegacyRelay {
		p.mu.Lock()
		p.ready = true
		p.mu.Unlock()
		return PreparedRelay{Handle: handle, Ready: true}, nil
	}
	result, err := AuthorizeRelay(ctx, handle, "", false)
	if err != nil {
		CloseRelay(handle)
	}
	return result, err
}

func AuthorizeRelay(ctx context.Context, handle, proof string, renew bool) (PreparedRelay, error) {
	p := findRelay(handle)
	if p == nil {
		return PreparedRelay{}, errors.New("RELAY_CONNECTION_CLOSED")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.touched = time.Now()
	if p.config.LegacyRelay {
		if p.conn.Context().Err() != nil {
			return PreparedRelay{}, errors.New("RELAY_CONNECTION_CLOSED")
		}
		return PreparedRelay{Handle: handle, Ready: true}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	template := uritemplate.MustNew("https://" + p.config.RelayAddress + "/.well-known/masque/udp/{target_host}/{target_port}/")
	req, err := masque.NewRequest(ctx, template, "0.0.0.0:1")
	if err != nil {
		return PreparedRelay{}, err
	}
	req.Header().Set("Qortal-Relay-Control", "authorize")
	if renew {
		req.Header().Set("Qortal-Relay-Renew", "1")
	}
	if proof != "" {
		if len(proof) > 2048 {
			return PreparedRelay{}, errors.New("RELAY_PROOF_INVALID")
		}
		// Never send account proofs on the IP-visible relay connection.
		var token map[string]json.RawMessage
		if json.Unmarshal([]byte(proof), &token) != nil || len(token) != 4 || token["epoch"] == nil || token["keyId"] == nil || token["message"] == nil || token["signature"] == nil {
			return PreparedRelay{}, errors.New("RELAY_PROOF_INVALID")
		}
		req.Header().Set("Qortal-Relay-Ticket", proof)
	}
	c, response, err := p.client.Dial(req)
	if c != nil {
		c.Close()
	}
	result := PreparedRelay{Handle: handle}
	if response != nil {
		if value := response.Header.Get("Qortal-Relay-Challenge"); response.StatusCode == 401 && len(value) > 0 && len(value) <= 1024 && json.Valid([]byte(value)) {
			if value == `{"type":"masque-ticket-required-v1"}` {
				result.Challenge = json.RawMessage(value)
				return result, nil
			}
			// Old identity-bearing challenges are deliberately unsupported.
			return result, errors.New("RELAY_PROTOCOL_UNSUPPORTED")
		}
		if err != nil {
			return result, responseError(response)
		}
		if response.StatusCode != 204 {
			return result, errors.New("RELAY_PROTOCOL_UNSUPPORTED")
		}
		if v := response.Header.Get("Qortal-Relay-Expires"); v != "" {
			if _, e := fmt.Sscan(v, &p.expiresAt); e != nil {
				return result, errors.New("RELAY_PROTOCOL_UNSUPPORTED")
			}
		}
	}
	if err != nil {
		return result, relayConnectionError(err)
	}
	p.ready = true
	result.Ready = true
	result.ExpiresAt = p.expiresAt
	return result, nil
}

func findRelay(handle string) *pooledRelay {
	relayPool.Lock()
	defer relayPool.Unlock()
	return relayPool.entries[handle]
}
func CloseRelay(handle string) {
	relayPool.Lock()
	p := relayPool.entries[handle]
	delete(relayPool.entries, handle)
	relayPool.Unlock()
	if p != nil {
		p.conn.CloseWithError(0, "relay connection released")
	}
}
func CloseAllRelays() {
	clearTicketStates()
	relayPool.Lock()
	relayPool.epoch++
	entries := relayPool.entries
	relayPool.entries = map[string]*pooledRelay{}
	relayPool.Unlock()
	for _, p := range entries {
		p.conn.CloseWithError(0, "account cleared")
	}
}

func openPrepared(ctx context.Context, cfg Config) (*Tunnel, error) {
	if _, err := parseLiteralAddrPort("targetAddress", cfg.TargetAddress); err != nil {
		return nil, err
	}
	p := findRelay(cfg.PreparedRelay)
	if p == nil {
		return nil, errors.New("RELAY_CONNECTION_CLOSED")
	}
	p.mu.Lock()
	if !p.ready || p.config.RelayAddress != cfg.RelayAddress || p.config.RelayCertSHA256 != cfg.RelayCertSHA256 || p.config.RelayServerName != cfg.RelayServerName {
		p.mu.Unlock()
		return nil, errors.New("RELAY_PROOF_INVALID")
	}
	p.refs++
	p.touched = time.Now()
	p.mu.Unlock()
	release := func() { p.mu.Lock(); p.refs--; p.touched = time.Now(); p.mu.Unlock() }
	template := uritemplate.MustNew("https://" + cfg.RelayAddress + "/.well-known/masque/udp/{target_host}/{target_port}/")
	req, err := masque.NewRequest(ctx, template, cfg.TargetAddress)
	if err != nil {
		release()
		return nil, err
	}
	conn, response, err := p.client.Dial(req)
	if err != nil {
		release()
		if response != nil {
			return nil, responseError(response)
		}
		return nil, relayConnectionError(err)
	}
	conn.EnableDatagramReceiveBuffer()
	p.conn.EnableDatagramReceiveBuffer()
	return &Tunnel{conn: conn, outer: p.conn, onClose: release}, nil
}
