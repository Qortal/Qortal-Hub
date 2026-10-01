package protocol

import (
	"context"
	"errors"
	masqueclient "qortal.org/qortal-hub/private-transport/internal/masque"
	"strings"
)

func relayErrorCode(err error) string {
	for _, code := range []string{"RELAY_ACCESS_DENIED", "RELAY_PROOF_INVALID", "RELAY_AUTH_REQUIRED", "RELAY_MEMBERSHIP_UNAVAILABLE", "RELAY_TARGET_DENIED", "RELAY_FULL", "RELAY_AUTH_RATE_LIMITED", "RELAY_AUTH_UNAVAILABLE", "RELAY_CERTIFICATE_INVALID", "RELAY_PROTOCOL_UNSUPPORTED", "RELAY_CONNECTION_CLOSED", "RELAY_POOL_FULL", "RELAY_CONNECT_FAILED"} {
		if strings.Contains(err.Error(), code) {
			return code
		}
	}
	return ""
}
func (s *Server) relayOperation(ctx context.Context, req Request) Response {
	var p struct {
		RelayAddress    string                        `json:"relayAddress"`
		RelayServerName string                        `json:"relayServerName"`
		RelayCertSHA256 string                        `json:"relayCertSha256"`
		Handle          string                        `json:"handle"`
		Proof           string                        `json:"proof"`
		Renew           bool                          `json:"renew"`
		LegacyRelay     bool                          `json:"legacyRelay"`
		Descriptor      masqueclient.TicketDescriptor `json:"descriptor"`
		Signatures      []string                      `json:"signatures"`
	}
	if decodeParams(req.Params, &p) != nil {
		return failure(req.RequestID, "INVALID_PARAMS", "invalid relay request")
	}
	var result masqueclient.PreparedRelay
	var err error
	if req.Operation == "prepareRelayTickets" || req.Operation == "finalizeRelayTickets" {
		var value map[string]any
		if req.Operation == "prepareRelayTickets" {
			value, err = masqueclient.PrepareTickets(p.Descriptor)
		} else {
			value, err = masqueclient.FinalizeTickets(p.Handle, p.Signatures)
		}
		if err != nil {
			return failure(req.RequestID, "RELAY_PROOF_INVALID", "invalid relay ticket")
		}
		return success(req.RequestID, value)
	}
	switch req.Operation {
	case "prepareRelay":
		result, err = masqueclient.BeginRelay(ctx, masqueclient.Config{RelayAddress: p.RelayAddress, RelayServerName: p.RelayServerName, RelayCertSHA256: p.RelayCertSHA256, LegacyRelay: p.LegacyRelay})
	case "authorizeRelay":
		result, err = masqueclient.AuthorizeRelay(ctx, p.Handle, p.Proof, p.Renew)
	case "closeRelay":
		masqueclient.CloseRelay(p.Handle)
	case "clearRelays":
		masqueclient.CloseAllRelays()
	default:
		err = errors.New("invalid relay operation")
	}
	if err != nil {
		code := relayErrorCode(err)
		if code == "" {
			code = "RELAY_CONNECT_FAILED"
		}
		return failure(req.RequestID, code, code)
	}
	return success(req.RequestID, result)
}
