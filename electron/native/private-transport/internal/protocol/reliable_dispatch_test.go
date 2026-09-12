package protocol

import (
	"testing"
	"time"
)

func TestReliableQueueSharesLongerBudgetWithoutSendingExpiredWork(t *testing.T) {
	for _, tc := range []struct {
		age   time.Duration
		ready bool
	}{
		{2 * time.Second, true}, {7 * time.Second, false},
	} {
		d := reliableDispatcher{maxQueueAge: 6 * time.Second}
		started, release := make(chan struct{}), make(chan struct{})
		d.submit("bulk", 10, func(bool) { close(started); <-release })
		<-started
		result := make(chan bool, 1)
		d.submit("bulk", 10, func(ready bool) { result <- ready })
		d.mu.Lock()
		d.queues["bulk"][0].enqueued = time.Now().Add(-tc.age)
		d.mu.Unlock()
		control := make(chan bool, 1)
		d.submit("control", 1, func(ready bool) { control <- ready })
		if !<-control {
			t.Fatal("control blocked")
		}
		close(release)
		if got := <-result; got != tc.ready {
			t.Fatalf("age=%v ready=%v", tc.age, got)
		}
		d.workers.Wait()
		if d.bytes != 0 || len(d.queues) != 0 {
			t.Fatal("queue leaked reservations")
		}
	}
}
