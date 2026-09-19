package main

import (
	"context"
	"os"

	"qortal.org/qortal-hub/private-transport/internal/protocol"
)

func main() {
	server := protocol.NewServer()
	if err := server.Serve(context.Background(), os.Stdin, os.Stdout); err != nil {
		os.Exit(1)
	}
}
