package main

import (
	"runtime"
	"testing"
)

// stopRelay may arrive immediately after the startup JSON, before the serving
// goroutine has run. Exercise that ordering as well as repeated shutdown.
func TestStopRelayImmediatelyAfterStartup(t *testing.T) {
	previous := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(previous)
	for i := 0; i < 100; i++ {
		f, _, err := startFixture()
		if err != nil {
			t.Fatal(err)
		}
		f.stopRelay()
		runtime.Gosched()
		f.close()
	}
}
