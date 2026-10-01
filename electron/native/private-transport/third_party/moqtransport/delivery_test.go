package moqtransport

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDeliveryFairPriorityAndOrder(t *testing.T) {
	d := newDeliveryScheduler(context.Background(), nil, nil)
	// Multiple opaque tracks, not application-specific labels.
	for i := 0; i < 40; i++ {
		for key := uint64(1); key <= 4; key++ {
			p := DeliveryPolicy{Priority: 0, MaxQueueAgeMillis: 1000}
			if key == 3 {
				p.Priority = 1
			}
			if key == 4 {
				p.Priority = 2
			}
			if err := d.enqueue(key, []byte{byte(key), byte(i)}, p); err != nil {
				t.Fatal(err)
			}
		}
	}
	d.tokens = 100000
	count := map[byte]int{}
	for i := 0; i < 26; i++ {
		item, ok := d.take(time.Now())
		if !ok {
			t.Fatal("missing item")
		}
		if int(item.data[1]) != count[item.data[0]] {
			t.Fatal("per-track order changed")
		}
		count[item.data[0]]++
	}
	if count[1] != 8 || count[2] != 8 || count[3] != 8 || count[4] != 2 {
		t.Fatalf("unfair service: %v", count)
	}
}
func TestDeliveryBoundsExpiryAndReuse(t *testing.T) {
	d := newDeliveryScheduler(context.Background(), nil, nil)
	p := DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 10}
	done := make(chan error, 1)
	if err := d.enqueue(1, make([]byte, deliveryMaxTrackBytes), p, done); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(d.enqueue(1, []byte{1}, p), ErrDeliveryQueueFull) {
		t.Fatal("track limit bypassed")
	}
	// Another track retains independent capacity.
	if err := d.enqueue(2, []byte{2}, p); err != nil {
		t.Fatal(err)
	}
	d.expire(time.Now().Add(time.Second))
	if !errors.Is(<-done, ErrDeliveryExpired) {
		t.Fatal("expiry not reported")
	}
	if d.metrics.QueuedBytes != 0 || len(d.lanes) != 0 || d.metrics.Expired != 2 {
		t.Fatal(d.metrics)
	}
	for i := 0; i < 300; i++ {
		if err := d.enqueue(uint64(i), []byte{1}, p); err != nil {
			t.Fatal(err)
		}
		d.expire(time.Now().Add(time.Second))
	}
	if err := d.enqueue(1, []byte{1}, DeliveryPolicy{Priority: -1, MaxQueueAgeMillis: 10}); !errors.Is(err, ErrDeliveryPolicy) {
		t.Fatal(err)
	}
}
func TestDeliverySessionCap(t *testing.T) {
	d := newDeliveryScheduler(context.Background(), nil, nil)
	p := DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 1000}
	for i := 0; i < 3; i++ {
		if err := d.enqueue(uint64(i), make([]byte, deliveryMaxTrackBytes), p); err != nil {
			t.Fatal(err)
		}
	}
	if !errors.Is(d.enqueue(5, []byte{1}, p), ErrDeliveryQueueFull) {
		t.Fatal("session limit bypassed")
	}
	if err := d.enqueue(6, make([]byte, 32*1024), DeliveryPolicy{Priority: 0, MaxQueueAgeMillis: 1000}); err != nil {
		t.Fatal("urgent reserve consumed", err)
	}
	if err := d.enqueue(7, make([]byte, 32*1024), DeliveryPolicy{Priority: 2, MaxQueueAgeMillis: 1000}); err != nil {
		t.Fatal("background reserve consumed", err)
	}
}
func TestDeliveryPacingDoesNotAccumulateIdleBurst(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sent := make(chan time.Time, 32)
	d := newDeliveryScheduler(ctx, func([]byte) error { sent <- time.Now(); return nil }, nil)
	d.rate = 10000
	for i := 0; i < 8; i++ {
		if err := d.enqueue(1, make([]byte, 1000), DeliveryPolicy{Priority: 1, MaxQueueAgeMillis: 2000}); err != nil {
			t.Fatal(err)
		}
	}
	go d.run()
	start := time.Now()
	select {
	case <-sent:
		if time.Since(start) < 60*time.Millisecond {
			t.Fatal("unpaced burst")
		}
	case <-time.After(time.Second):
		t.Fatal("no progress")
	}
	cancel()
}
func TestDeliveryCongestionAndRecovery(t *testing.T) {
	var stats DeliveryNetworkStats
	d := newDeliveryScheduler(context.Background(), nil, func() DeliveryNetworkStats { return stats })
	now := time.Now()
	for i := 1; i <= 3; i++ {
		stats = DeliveryNetworkStats{RTT: 100 * time.Millisecond, MinRTT: 30 * time.Millisecond, PacketsSent: uint64(i * 100), PacketsLost: uint64(i * 10)}
		d.sample(now.Add(time.Duration(i) * time.Second))
	}
	if d.rate >= 1_000_000 {
		t.Fatal("no congestion response")
	}
	low := d.rate
	d.metrics.QueuedBytes = 1000
	stats = DeliveryNetworkStats{RTT: 30 * time.Millisecond, MinRTT: 30 * time.Millisecond, PacketsSent: 400, PacketsLost: 30}
	d.sample(now.Add(4 * time.Second))
	if d.rate <= low || d.rate > low*1.051 {
		t.Fatal("unsafe recovery", d.rate)
	}
}
func TestDeliverySlowRecipientIsolationAndClose(t *testing.T) {
	slowCtx, stop := context.WithCancel(context.Background())
	entered := make(chan struct{})
	slow := newDeliveryScheduler(slowCtx, func([]byte) error { close(entered); <-slowCtx.Done(); return slowCtx.Err() }, nil)
	fastCtx, closeFast := context.WithCancel(context.Background())
	defer closeFast()
	fast := newDeliveryScheduler(fastCtx, func([]byte) error { return nil }, nil)
	slowDone := make(chan error, 1)
	fastDone := make(chan error, 1)
	p := DeliveryPolicy{Priority: 0, MaxQueueAgeMillis: 100}
	_ = slow.enqueue(1, []byte{1}, p, slowDone)
	_ = fast.enqueue(1, []byte{1}, p, fastDone)
	go slow.run()
	go fast.run()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("slow not started")
	}
	select {
	case err := <-fastDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("slow recipient blocked fast one")
	}
	stop()
	select {
	case <-slowDone:
	case <-time.After(time.Second):
		t.Fatal("close did not release send")
	}
	if !errors.Is(slow.enqueue(1, []byte{1}, p), context.Canceled) {
		t.Fatal("accepted after close")
	}
}
