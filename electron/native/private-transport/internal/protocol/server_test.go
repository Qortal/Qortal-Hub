package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestServeDispatchUsesCompleteSendSchemas(t *testing.T) {
	tests := []struct{ name, operation, params, want string }{
		{"legacy reliable", "sendPrivateReliable", `{"sessionId":"missing","messageId":"request-1"}`, "TRANSPORT_CLOSED"},
		{"keyed reliable", "sendPrivateReliable", `{"sessionId":"missing","messageId":"request-1","streamKey":"file-control","endStream":false}`, "TRANSPORT_CLOSED"},
		{"final reliable", "sendPrivateReliable", `{"sessionId":"missing","messageId":"request-1","streamKey":"upload-1","endStream":true}`, "TRANSPORT_CLOSED"},
		{"legacy moq", "publishMoqObject", `{"moqSessionId":"missing"}`, "MOQ_SESSION_CLOSED"},
		{"batch moq", "publishMoqObject", `{"moqSessionId":"missing","trackName":"opaque","batched":true}`, "MOQ_SESSION_CLOSED"},
		{"scheduled moq", "publishMoqObject", `{"moqSessionId":"missing","trackName":"opaque","batched":true,"delivery":{"priority":0,"maxQueueAgeMillis":120}}`, "MOQ_SESSION_CLOSED"},
		{"unknown reliable field", "sendPrivateReliable", `{"sessionId":"missing","messageId":"request-1","typo":true}`, "INVALID_PARAMS"},
		{"unknown moq field", "publishMoqObject", `{"moqSessionId":"missing","trackName":"opaque","typo":true}`, "INVALID_PARAMS"},
		{"unknown delivery field", "publishMoqObject", `{"moqSessionId":"missing","delivery":{"priority":0,"maxQueueAgeMillis":120,"typo":true}}`, "INVALID_PARAMS"},
		{"wrong reliable type", "sendPrivateReliable", `{"sessionId":"missing","messageId":"request-1","endStream":"true"}`, "INVALID_PARAMS"},
		{"wrong moq type", "publishMoqObject", `{"moqSessionId":"missing","batched":"true"}`, "INVALID_PARAMS"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Use the actual line+binary IPC reader, not Handle(), which bypasses the
			// dispatcher. Missing sessions prove valid requests reached execution while
			// keeping this test independent of network availability and credentials.
			req := Request{Version: Version, RequestID: "test", Operation: tt.operation, Params: json.RawMessage(tt.params), BinaryLength: 3}
			line, err := json.Marshal(req)
			if err != nil {
				t.Fatal(err)
			}
			input := append(append(line, '\n'), 0, 1, 42)
			var output bytes.Buffer
			if err := NewServer().Serve(context.Background(), bytes.NewReader(input), &output); err != nil {
				t.Fatal(err)
			}
			var response Response
			if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &response); err != nil {
				t.Fatal(err, string(output.Bytes()))
			}
			if response.Error == nil || response.Error.Code != tt.want {
				t.Fatalf("got %#v; want %s", response, tt.want)
			}
		})
	}
}

func TestMalformedAndUnsupportedRequestsFailSafely(t *testing.T) {
	tests := []struct {
		name string
		line string
		code string
	}{
		{"malformed JSON", "{", "MALFORMED_JSON"},
		{"missing request ID", `{"version":2,"operation":"health"}`, "MISSING_REQUEST_ID"},
		{"unsupported version", `{"version":1,"requestId":"v1","operation":"health"}`, "UNSUPPORTED_VERSION"},
		{"unknown operation", `{"version":2,"requestId":"unknown","operation":"exec"}`, "UNKNOWN_OPERATION"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response, shutdown := NewServer().Handle(context.Background(), []byte(tt.line))
			if shutdown || response.OK || response.Error == nil || response.Error.Code != tt.code {
				t.Fatalf("unexpected response: %#v", response)
			}
		})
	}
}

func TestMoqBatchValidation(t *testing.T) {
	objects, err := parseMoqBatch([]byte{0, 2, 1, 2, 0, 1, 3})
	if err != nil || len(objects) != 2 || !bytes.Equal(objects[0], []byte{1, 2}) {
		t.Fatal("valid batch rejected", err)
	}
	for _, invalid := range [][]byte{nil, {0}, {0, 0}, {0, 2, 1}, {4, 1}, bytes.Repeat([]byte{0, 1, 42}, 9)} {
		if _, err = parseMoqBatch(invalid); err == nil {
			t.Fatal("invalid batch accepted", invalid)
		}
	}
}

func TestInnerErrorCodeDistinguishesRelayAndBackendCertificates(t *testing.T) {
	if got := innerErrorCode(errors.New("MASQUE_TUNNEL_FAILED: relay certificate pin mismatch")); got != "MASQUE_TUNNEL_FAILED" {
		t.Fatalf("relay error mapped to %q", got)
	}
	if got := innerErrorCode(errors.New("INNER_QUIC_FAILED: backend certificate pin mismatch")); got != "BACKEND_IDENTITY_MISMATCH" {
		t.Fatalf("backend error mapped to %q", got)
	}
}

func TestMoqErrorCodeDistinguishesRelayAndBackendCertificates(t *testing.T) {
	if got := moqErrorCode(errors.New("MASQUE_TUNNEL_FAILED: relay certificate pin mismatch")); got != "MASQUE_TUNNEL_FAILED" {
		t.Fatalf("relay error mapped to %q", got)
	}
	if got := moqErrorCode(errors.New("MOQ_QUIC_FAILED: backend certificate pin mismatch")); got != "BACKEND_IDENTITY_MISMATCH" {
		t.Fatalf("backend error mapped to %q", got)
	}
}

func TestMoqOperationsRejectUnknownSessions(t *testing.T) {
	server := NewServer()
	for index, request := range []string{
		`{"version":2,"requestId":"subscribe","operation":"subscribeMoqTrack","params":{"moqSessionId":"missing","subscriptionId":"subscription-1","namespace":["qortal","apps"],"trackName":"realtime"}}`,
		`{"version":2,"requestId":"publish","operation":"publishMoqObject","params":{"moqSessionId":"missing"}}`,
		`{"version":2,"requestId":"metrics","operation":"moqSessionMetrics","params":{"moqSessionId":"missing"}}`,
		`{"version":2,"requestId":"close","operation":"closeMoqSession","params":{"moqSessionId":"missing"}}`,
	} {
		response, shutdown := server.Handle(context.Background(), []byte(request))
		if shutdown || response.OK || response.Error == nil || response.Error.Code != "MOQ_SESSION_CLOSED" {
			t.Fatalf("request %d did not fail closed: %#v", index, response)
		}
	}
}

func TestAudioSpecificMoqOperationsAreNotAvailable(t *testing.T) {
	for _, operation := range []string{
		"openCallMediaSession", "subscribeCallMediaTrack", "publishCallMediaDatagram",
		"setCallMediaSendKey", "setCallMediaReceiveKey", "removeCallMediaReceiveKey",
		"publishCallAudioFrame", "callMediaSessionMetrics", "closeCallMediaSession",
	} {
		request := `{"version":2,"requestId":"old-` + operation + `","operation":"` + operation + `","params":{}}`
		response, shutdown := NewServer().Handle(context.Background(), []byte(request))
		if shutdown || response.OK || response.Error == nil || response.Error.Code != "UNKNOWN_OPERATION" {
			t.Fatalf("operation %q did not fail closed: %#v", operation, response)
		}
	}
}

func TestDuplicateRequestIDFails(t *testing.T) {
	server := NewServer()
	request := []byte(`{"version":2,"requestId":"same","operation":"health"}`)
	first, _ := server.Handle(context.Background(), request)
	second, _ := server.Handle(context.Background(), request)
	if !first.OK || second.OK || second.Error == nil || second.Error.Code != "DUPLICATE_REQUEST_ID" {
		t.Fatalf("unexpected responses: first=%#v second=%#v", first, second)
	}
}

func TestOversizedControlMessageFailsWithoutPanic(t *testing.T) {
	input := strings.NewReader(strings.Repeat("x", MaxControlMessageBytes+1) + "\n")
	var output bytes.Buffer
	if err := NewServer().Serve(context.Background(), input, &output); err != nil {
		t.Fatal(err)
	}
	var response Response
	if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &response); err != nil {
		t.Fatal(err)
	}
	if response.OK || response.Error == nil || response.Error.Code != "CONTROL_MESSAGE_TOO_LARGE" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestMalformedAndOversizedBinaryFramesFailClosed(t *testing.T) {
	for _, input := range []string{
		`{"version":2,"requestId":"truncated","operation":"sendPrivateReliable","params":{},"binaryLength":5}` + "\nxx",
		`{"version":2,"requestId":"oversized","operation":"sendPrivateReliable","params":{},"binaryLength":1048577}` + "\n",
	} {
		var output bytes.Buffer
		if err := NewServer().Serve(context.Background(), strings.NewReader(input), &output); err != nil {
			t.Fatal(err)
		}
		var response Response
		if err := json.Unmarshal(bytes.TrimSpace(output.Bytes()), &response); err != nil {
			t.Fatal(err)
		}
		if response.OK || response.Error == nil {
			t.Fatalf("unexpected response: %#v", response)
		}
	}
}
