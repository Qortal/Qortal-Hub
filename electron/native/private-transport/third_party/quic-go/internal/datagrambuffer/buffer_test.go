package datagrambuffer

import (
	"bytes"
	"sync"
	"testing"
	"time"
)

func TestLimitsOrderCopyAndCleanup(t *testing.T) {
	base := used.Load()
	q := New(32)
	now := time.Now()
	defer func() {
		q.Close()
		if used.Load() != base {
			t.Fatal("budget leak", used.Load(), base)
		}
	}()
	for i := 0; i < 32; i++ {
		b := []byte{byte(i)}
		if !q.Push(b, now) {
			t.Fatal("early reject")
		}
		b[0] = 255
	}
	if q.Push([]byte{1}, now) || q.Stats().DroppedFull != 1 {
		t.Fatal("unauthorized cap")
	}
	q.EnableBurst()
	for i := 32; i < 1024; i++ {
		if !q.Push([]byte{byte(i)}, now) {
			t.Fatal("burst", i)
		}
	}
	if q.Push([]byte{1}, now) {
		t.Fatal("packet cap")
	}
	for i := 0; i < 1024; i++ {
		b, ok := q.Pop(now)
		if !ok || b[0] != byte(i) {
			t.Fatal("order/copy", i)
		}
	}
	if len(q.items) != 0 {
		t.Fatal("large empty ring retained")
	}
	q.Close()
	q.Close()
	if q.Push([]byte{1}, now) {
		t.Fatal("accepted after close")
	}
}

func TestExpiryAndByteBound(t *testing.T) {
	base := used.Load()
	q := New(32)
	q.EnableBurst()
	defer q.Close()
	now := time.Now()
	if q.Push(make([]byte, BurstBytes), now) {
		t.Fatal("missing bookkeeping in cap")
	}
	if !q.Push([]byte{1}, now) {
		t.Fatal("push")
	}
	if _, ok := q.Pop(now.Add(BurstAge + time.Nanosecond)); ok {
		t.Fatal("stale delivery")
	}
	if q.Stats().DroppedExpired != 1 {
		t.Fatal("expiry counter")
	}
	q.Close()
	if used.Load() != base {
		t.Fatal("expiry leaked budget")
	}
}

func TestGlobalBoundAndConcurrentQueues(t *testing.T) {
	base := used.Load()
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			q := New(32)
			q.EnableBurst()
			defer q.Close()
			for j := 0; j < 500; j++ {
				q.Push(bytes.Repeat([]byte{1}, 1200), time.Now())
				if used.Load() > GlobalLimit {
					t.Error("global bound")
				}
			}
		}()
	}
	wg.Wait()
	if used.Load() != base {
		t.Fatal("concurrent leak")
	}
	// Deterministically fill the shared budget, then verify rejection / recovery.
	var qs []*Queue
	defer func() {
		for _, q := range qs {
			q.Close()
		}
		if used.Load() != base {
			t.Fatal("budget leak")
		}
	}()
	for i := 0; i < 40; i++ {
		q := New(32)
		q.EnableBurst()
		qs = append(qs, q)
		for j := 0; j < 800; j++ {
			q.Push(make([]byte, 1200), time.Now())
		}
	}
	q := New(32)
	qs = append(qs, q)
	if q.Push(make([]byte, 60000), time.Now()) {
		t.Fatal("global budget not enforced")
	}
	if q.Stats().DroppedBudget != 1 {
		t.Fatal("missing budget counter")
	}
	for _, other := range qs[:len(qs)-1] {
		other.Close()
	}
	if !q.Push([]byte{1}, time.Now()) {
		t.Fatal("budget not reusable")
	}
}
