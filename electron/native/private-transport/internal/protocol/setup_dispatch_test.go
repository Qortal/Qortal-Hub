package protocol

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestSlowOpenDoesNotBlockUnrelatedHealthRequest(t *testing.T) {
	socket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer socket.Close()
	params, _ := json.Marshal(map[string]any{
		"relayAddress": socket.LocalAddr().String(), "relayServerName": "audit-relay",
		"relayCertSha256": strings.Repeat("ab", 32), "backendAddress": "127.0.0.1:9999",
		"backendServerName": "audit-backend", "backendCertSha256": strings.Repeat("cd", 32),
		"logicalSessionId": "audit", "attachToken": strings.Repeat("a", 32),
		"nonce": "audit", "purpose": "game", "ownerBindingHash": strings.Repeat("ef", 32), "timeoutMs": 3000,
	})
	first, _ := json.Marshal(Request{Version: Version, RequestID: "slow", Operation: "openPrivateSession", Params: params})
	second, _ := json.Marshal(Request{Version: Version, RequestID: "health", Operation: "health", Params: json.RawMessage(`{}`)})
	input, commands := io.Pipe()
	reader, writer := io.Pipe()
	defer reader.Close()
	defer commands.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer writer.Close()
		_ = NewServer().Serve(context.Background(), input, writer)
	}()
	responses := make(chan Response, 4)
	go func() {
		defer close(responses)
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var response Response
			_ = json.Unmarshal(scanner.Bytes(), &response)
			responses <- response
		}
	}()
	_, _ = commands.Write(append(first, '\n'))
	// Prove the first operation is actually dialing, not cancelled by input EOF.
	_ = socket.SetReadDeadline(time.Now().Add(2 * time.Second))
	packet := make([]byte, 2048)
	if _, _, err := socket.ReadFromUDP(packet); err != nil {
		t.Fatalf("open never dialed: %v", err)
	}
	go func() { _, _ = commands.Write(append(second, '\n')) }()
	select {
	case response := <-responses:
		if response.RequestID != "health" || !response.OK {
			t.Fatalf("slow open completed before independent health: %+v", response)
		}
	case <-time.After(time.Second):
		t.Fatal("health blocked behind network setup")
	}
	_ = commands.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel pending network setup")
	}
}
