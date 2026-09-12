// Package datagrambuffer implements bounded receive-side burst absorption.
// Callers serialize access to a Queue. Accounting is shared across all QUIC
// and HTTP/3 receive queues in this process, including unauthenticated queues.
package datagrambuffer

import (
	"sync/atomic"
	"time"
)

const GlobalLimit = 32 * 1024 * 1024
const packetOverhead = 64 // conservatively charge slice / ring bookkeeping
const BurstPackets = 1024
const BurstBytes = 1024 * 1024
const BurstAge = 50 * time.Millisecond

type Stats struct {
	QueuedBytes        int64
	PeakBytes          int64
	DroppedFull        uint64
	DroppedBudget      uint64
	DroppedExpired     uint64
	MaxResidenceMicros uint64
	RawPacketDrops     uint64
}

var used atomic.Int64
var peak atomic.Int64
var full, budget, expired atomic.Uint64
var rawPacketDrops atomic.Uint64

func RecordRawPacketDrop() { rawPacketDrops.Add(1) }

func reserve(charge int64) bool {
	for {
		n := used.Load()
		if n+charge > GlobalLimit {
			return false
		}
		if used.CompareAndSwap(n, n+charge) {
			for p := peak.Load(); n+charge > p; p = peak.Load() {
				if peak.CompareAndSwap(p, n+charge) {
					break
				}
			}
			return true
		}
	}
}

func GlobalStats() Stats {
	return Stats{QueuedBytes: used.Load(), PeakBytes: peak.Load(), DroppedFull: full.Load(), DroppedBudget: budget.Load(), DroppedExpired: expired.Load(), RawPacketDrops: rawPacketDrops.Load()}
}

type entry struct {
	data []byte
	at   time.Time
}
type Queue struct {
	items              []entry
	head, count, bytes int
	ringCharge         int
	limit              int
	maxAge             time.Duration
	closed             bool
	stats              Stats
}

func New(limit int) *Queue { return &Queue{limit: limit} }
func (q *Queue) EnableBurst() {
	q.limit = BurstPackets
	q.maxAge = BurstAge
}

// Push takes its own compact copy: a small datagram must not retain a larger
// decrypted packet backing array. Reserve globally before allocating that copy.
func (q *Queue) Push(data []byte, now time.Time) bool {
	if q.closed {
		return false
	}
	q.expire(now)
	charge := len(data) + packetOverhead
	if q.count >= q.limit || q.bytes+charge > BurstBytes {
		q.stats.DroppedFull++
		full.Add(1)
		return false
	}
	if !reserve(int64(charge)) {
		q.stats.DroppedBudget++
		budget.Add(1)
		return false
	}
	if q.count == len(q.items) {
		n := min(q.limit, max(8, len(q.items)*2))
		// Reserve the full replacement while the old ring still exists, not just
		// the difference. This bounds transient growth allocations as well.
		if !reserve(int64(n * 64)) {
			used.Add(-int64(charge))
			q.stats.DroppedBudget++
			budget.Add(1)
			return false
		}
		items := make([]entry, n)
		for i := 0; i < q.count; i++ {
			items[i] = q.items[(q.head+i)%len(q.items)]
		}
		used.Add(-int64(q.ringCharge))
		q.ringCharge = n * 64
		q.items, q.head = items, 0
	}
	q.items[(q.head+q.count)%len(q.items)] = entry{data: append([]byte{}, data...), at: now}
	q.count++
	q.bytes += charge
	q.stats.PeakBytes = max(q.stats.PeakBytes, int64(q.bytes+q.ringCharge))
	return true
}

func (q *Queue) remove(now time.Time) []byte {
	e := q.items[q.head]
	q.items[q.head] = entry{} // release backing storage immediately
	q.head = (q.head + 1) % len(q.items)
	q.count--
	charge := len(e.data) + packetOverhead
	q.bytes -= charge
	used.Add(-int64(charge))
	if q.count == 0 && len(q.items) > 32 {
		used.Add(-int64(q.ringCharge))
		q.ringCharge = 0
		q.items = nil
		q.head = 0
	}
	if age := now.Sub(e.at); age > 0 {
		q.stats.MaxResidenceMicros = max(q.stats.MaxResidenceMicros, uint64(age/time.Microsecond))
	}
	return e.data
}
func (q *Queue) expire(now time.Time) {
	for q.count > 0 && q.maxAge > 0 && now.Sub(q.items[q.head].at) > q.maxAge {
		q.remove(now)
		q.stats.DroppedExpired++
		expired.Add(1)
	}
}
func (q *Queue) Pop(now time.Time) ([]byte, bool) {
	q.expire(now)
	if q.count == 0 {
		return nil, false
	}
	return q.remove(now), true
}
func (q *Queue) Close() {
	if q.closed {
		return
	}
	q.closed = true
	used.Add(-int64(q.bytes + q.ringCharge))
	q.ringCharge = 0
	q.items = nil
	q.count = 0
	q.bytes = 0
	q.head = 0
}
func (q *Queue) Stats() Stats { s := q.stats; s.QueuedBytes = int64(q.bytes + q.ringCharge); return s }
