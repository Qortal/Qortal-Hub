package masqueclient

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/cloudflare/circl/blindsign/blindrsa"
	"strconv"
	"sync"
	"time"
)

const ticketDomain = "Qortal-MASQUE-Ticket-v1\x00"

type TicketDescriptor struct {
	Epoch     int64  `json:"epoch"`
	ExpiresAt int64  `json:"expiresAt"`
	PublicKey string `json:"publicKey"`
	KeyID     string `json:"keyId"`
	Policy    string `json:"policy"`
	RelayPin  string `json:"relayPin"`
}
type ticketState struct {
	client     blindrsa.Client
	states     []blindrsa.State
	messages   [][]byte
	descriptor TicketDescriptor
	created    time.Time
}

var ticketPending = struct {
	sync.Mutex
	entries map[string]ticketState
}{entries: map[string]ticketState{}}

func PrepareTickets(d TicketDescriptor) (map[string]any, error) {
	ticketPending.Lock()
	defer ticketPending.Unlock()
	for k, s := range ticketPending.entries {
		if time.Since(s.created) > time.Minute {
			delete(ticketPending.entries, k)
		}
	}
	if len(ticketPending.entries) >= 16 {
		return nil, errors.New("RELAY_BUSY")
	}
	der, err := base64.StdEncoding.DecodeString(d.PublicKey)
	if err != nil || len(der) > 1024 {
		return nil, errors.New("RELAY_PROOF_INVALID")
	}
	pk, err := x509.ParsePKCS1PublicKey(der)
	if err != nil || pk.N.BitLen() != 2048 || pk.E != 65537 {
		return nil, errors.New("RELAY_PROOF_INVALID")
	}
	h := sha256.New()
	h.Write([]byte(ticketDomain + d.Policy + d.RelayPin + strconv.FormatInt(d.Epoch, 10)))
	h.Write(der)
	if d.KeyID != hex.EncodeToString(h.Sum(nil)) || d.Epoch != time.Now().Unix()/3600 || d.ExpiresAt != (d.Epoch*3600+43200)*1000 {
		return nil, errors.New("RELAY_PROOF_INVALID")
	}
	client, err := blindrsa.NewClient(blindrsa.SHA384PSSDeterministic, pk)
	if err != nil {
		return nil, err
	}
	state := ticketState{client: client, descriptor: d, created: time.Now()}
	var blinded []string
	for i := 0; i < 3; i++ {
		nonce := make([]byte, 32)
		if _, err = rand.Read(nonce); err != nil {
			return nil, err
		}
		msg := append([]byte(ticketDomain+d.KeyID), nonce...)
		prepared, err := client.Prepare(rand.Reader, msg)
		if err != nil {
			return nil, err
		}
		b, s, err := client.Blind(rand.Reader, prepared)
		if err != nil {
			return nil, err
		}
		state.messages = append(state.messages, prepared)
		state.states = append(state.states, s)
		blinded = append(blinded, base64.StdEncoding.EncodeToString(b))
	}
	id := make([]byte, 24)
	if _, err = rand.Read(id); err != nil {
		return nil, err
	}
	handle := hex.EncodeToString(id)
	ticketPending.entries[handle] = state
	return map[string]any{"handle": handle, "blinded": blinded}, nil
}
func FinalizeTickets(handle string, signatures []string) (map[string]any, error) {
	ticketPending.Lock()
	s, ok := ticketPending.entries[handle]
	delete(ticketPending.entries, handle)
	ticketPending.Unlock()
	if !ok || time.Since(s.created) > time.Minute || len(signatures) != len(s.states) {
		return nil, errors.New("RELAY_PROOF_INVALID")
	}
	tickets := make([]string, 0, len(signatures))
	for i, b := range signatures {
		raw, err := base64.StdEncoding.DecodeString(b)
		if err != nil || len(raw) != 256 {
			return nil, errors.New("RELAY_PROOF_INVALID")
		}
		sig, err := s.client.Finalize(s.states[i], raw)
		if err != nil {
			return nil, errors.New("RELAY_PROOF_INVALID")
		}
		token, _ := json.Marshal(map[string]any{"epoch": s.descriptor.Epoch, "keyId": s.descriptor.KeyID, "message": base64.StdEncoding.EncodeToString(s.messages[i]), "signature": base64.StdEncoding.EncodeToString(sig)})
		tickets = append(tickets, string(token))
	}
	return map[string]any{"tickets": tickets, "expiresAt": s.descriptor.ExpiresAt}, nil
}
func clearTicketStates() {
	ticketPending.Lock()
	ticketPending.entries = map[string]ticketState{}
	ticketPending.Unlock()
}
