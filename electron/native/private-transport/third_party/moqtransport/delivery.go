package moqtransport

import (
	"context"
	"errors"
	"sync"
	"time"
)

// DeliveryPolicy is local scheduling policy, not authorization or payload metadata.
// Priority 0 is latency-sensitive, 1 is live, 2 is background. Lower classes
// receive a reserved share even when a higher class is continuously busy.
type DeliveryPolicy struct {
	Priority          int `json:"priority"`
	MaxQueueAgeMillis int `json:"maxQueueAgeMillis"`
}

func (p DeliveryPolicy) Valid() bool {
	return p.Priority >= 0 && p.Priority <= 2 && p.MaxQueueAgeMillis >= 10 && p.MaxQueueAgeMillis <= 2000
}

var ErrDeliveryQueueFull = errors.New("MOQ_QUEUE_LIMIT")
var ErrDeliveryPolicy = errors.New("INVALID_MOQ_CONFIG")
var ErrDeliveryExpired = errors.New("MOQ_OBJECT_EXPIRED")

type DeliveryMetrics struct {
	ReliableLeasedBytes  int64  `json:"reliableLeasedBytes"`
	ReceiveQueuedBytes   int64  `json:"receiveQueuedBytes"`
	QueuedBytes          int    `json:"deliveryQueuedBytes"`
	Sent                 uint64 `json:"deliverySent"`
	Expired              uint64 `json:"deliveryExpired"`
	Rejected             uint64 `json:"deliveryRejected"`
	SendErrors           uint64 `json:"deliverySendErrors"`
	QueueDelayMillis     int64  `json:"deliveryQueueDelayMillis"`
	PacingBytesPerSecond int64  `json:"deliveryPacingBytesPerSecond"`
}
type DeliveryNetworkStats struct {
	RTT, MinRTT              time.Duration
	PacketsSent, PacketsLost uint64
}
type deliveryNetwork interface{ DeliveryNetworkStats() DeliveryNetworkStats }
type deliveryItem struct {
	result           chan error
	data             []byte
	queued, deadline time.Time
}
type deliveryLane struct {
	key      uint64
	priority int
	items    []deliveryItem
	bytes    int
}
type deliveryScheduler struct {
	mu                   sync.Mutex
	ctx                  context.Context
	send                 func([]byte) error
	network              func() DeliveryNetworkStats
	lanes                []*deliveryLane
	cursor               [3]int
	slot                 int
	metrics              DeliveryMetrics
	wake                 chan struct{}
	rate                 float64
	tokens               float64
	lastTick, lastSample time.Time
	previous             DeliveryNetworkStats
	bad                  int
	lastQueueSample      time.Time
}

const deliveryMaxTrackBytes = 64 * 1024
const deliveryMaxSessionBytes = 256 * 1024

// Weighted fair service, with round-robin within each class.
var deliverySlots = [...]int{0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 2}

func newDeliveryScheduler(ctx context.Context, send func([]byte) error, network func() DeliveryNetworkStats) *deliveryScheduler {
	return &deliveryScheduler{ctx: ctx, send: send, network: network, wake: make(chan struct{}, 1),
		rate: 1_000_000, lastTick: time.Now(), lastSample: time.Now()}
}
func (d *deliveryScheduler) enqueue(key uint64, data []byte, policy DeliveryPolicy, result ...chan error) error {
	if !policy.Valid() {
		return ErrDeliveryPolicy
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.ctx.Err(); err != nil {
		return err
	}
	now := time.Now()
	d.expire(now)
	var lane *deliveryLane
	for _, l := range d.lanes {
		if l.key == key {
			lane = l
			break
		}
	}
	if lane == nil {
		if len(d.lanes) >= 128 {
			d.metrics.Rejected++
			return ErrDeliveryQueueFull
		}
		lane = &deliveryLane{key: key, priority: policy.Priority}
		d.lanes = append(d.lanes, lane)
	}
	// Do not silently discard dependency fragments to make room for later ones.
	if len(lane.items) > 0 && lane.priority != policy.Priority {
		return ErrDeliveryPolicy
	}
	// Refuse overload immediately so the producer can reduce its rate.
	var classBytes [3]int
	for _, l := range d.lanes {
		classBytes[l.priority] += l.bytes
	}
	reserve := 0
	for class, bytes := range classBytes {
		if class != policy.Priority {
			reserve += max(0, 32*1024-bytes)
		}
	}
	if lane.bytes+len(data) > deliveryMaxTrackBytes || d.metrics.QueuedBytes+len(data) > deliveryMaxSessionBytes-reserve {
		d.metrics.Rejected++
		return ErrDeliveryQueueFull
	}
	lane.priority = policy.Priority
	var completion chan error
	if len(result) > 0 {
		completion = result[0]
	}
	lane.items = append(lane.items, deliveryItem{completion, append([]byte(nil), data...), now, now.Add(time.Duration(policy.MaxQueueAgeMillis) * time.Millisecond)})
	lane.bytes += len(data)
	d.metrics.QueuedBytes += len(data)
	select {
	case d.wake <- struct{}{}:
	default:
	}
	return nil
}
func (d *deliveryScheduler) expire(now time.Time) {
	for i := 0; i < len(d.lanes); {
		l := d.lanes[i]
		kept := l.items[:0]
		for _, item := range l.items {
			if !now.Before(item.deadline) {
				l.bytes -= len(item.data)
				d.metrics.QueuedBytes -= len(item.data)
				d.metrics.Expired++
				if item.result != nil {
					item.result <- ErrDeliveryExpired
				}
			} else {
				kept = append(kept, item)
			}
		}
		clear(l.items[len(kept):])
		l.items = kept
		if len(l.items) == 0 {
			d.lanes = append(d.lanes[:i], d.lanes[i+1:]...)
			continue
		}
		i++
	}
}

// Caller holds mu. Each turn transmits at most one object from one track.
func (d *deliveryScheduler) take(now time.Time) (deliveryItem, bool) {
	d.expire(now)
	if len(d.lanes) == 0 {
		return deliveryItem{}, false
	}
	for n := 0; n < len(deliverySlots); n++ {
		class := deliverySlots[d.slot]
		d.slot = (d.slot + 1) % len(deliverySlots)
		for i := 0; i < len(d.lanes); i++ {
			index := (d.cursor[class] + i) % len(d.lanes)
			l := d.lanes[index]
			if l.priority != class || len(l.items) == 0 {
				continue
			}
			item := l.items[0]
			if float64(len(item.data)) > d.tokens {
				continue
			}
			d.cursor[class] = (index + 1) % len(d.lanes)
			l.items[0] = deliveryItem{}
			l.items = l.items[1:]
			l.bytes -= len(item.data)
			d.metrics.QueuedBytes -= len(item.data)
			d.tokens -= float64(len(item.data))
			d.metrics.QueueDelayMillis = now.Sub(item.queued).Milliseconds()
			d.lastQueueSample = now
			return item, true
		}
	}
	return deliveryItem{}, false
}
func (d *deliveryScheduler) sample(now time.Time) {
	if now.Sub(d.lastSample) < time.Second {
		return
	}
	if d.network != nil {
		s := d.network()
		sent := uint64(0)
		lost := uint64(0)
		if s.PacketsSent >= d.previous.PacketsSent {
			sent = s.PacketsSent - d.previous.PacketsSent
		}
		if s.PacketsLost >= d.previous.PacketsLost {
			lost = s.PacketsLost - d.previous.PacketsLost
		}
		congested := sent >= 20 && (float64(lost)/float64(sent) > 0.03 || (s.MinRTT > 0 && s.RTT-s.MinRTT > max(20*time.Millisecond, s.MinRTT/4)))
		if congested {
			d.bad++
		} else {
			d.bad = 0
		}
		if d.bad >= 2 {
			d.rate = max(32_000, d.rate*0.85)
		} else if !congested && d.metrics.QueuedBytes > 0 {
			d.rate = min(20_000_000, d.rate*1.05)
		}
		d.previous = s
	}
	d.lastSample = now
}
func (d *deliveryScheduler) run() {
	timer := time.NewTimer(time.Hour)
	timer.Stop()
	defer timer.Stop()
	defer func() { d.mu.Lock(); d.lanes = nil; d.metrics.QueuedBytes = 0; d.mu.Unlock() }()
	for {
		d.mu.Lock()
		pending := d.metrics.QueuedBytes > 0
		d.mu.Unlock()
		var tick <-chan time.Time
		if pending {
			timer.Reset(2 * time.Millisecond)
			tick = timer.C
		}
		select {
		case <-d.ctx.Done():
			return
		case <-d.wake:
		case <-tick:
		}
		timer.Stop()
		now := time.Now()
		d.mu.Lock()
		d.sample(now)
		// No idle credit or unbounded catch-up bursts after an event-loop stall.
		d.tokens = min(4096, d.tokens+now.Sub(d.lastTick).Seconds()*d.rate)
		d.lastTick = now
		d.mu.Unlock()
		for burst := 0; burst < 4; burst++ {
			d.mu.Lock()
			item, ok := d.take(time.Now())
			d.mu.Unlock()
			if !ok {
				break
			}
			if d.ctx.Err() != nil {
				return
			}
			start := time.Now()
			err := d.send(item.data)
			if item.result != nil {
				item.result <- err
			}
			elapsed := time.Since(start)
			d.mu.Lock()
			if err != nil {
				d.metrics.SendErrors++
			} else {
				d.metrics.Sent++
			}
			// SendDatagram can block at the QUIC queue. Back off instead of filling it
			// again at the original producer rate. QUIC remains the congestion authority.
			if elapsed > 5*time.Millisecond {
				d.rate = max(32_000, min(d.rate, float64(len(item.data))/elapsed.Seconds()*0.9))
				d.tokens = 0
			}
			d.mu.Unlock()
		}
	}
}
func (d *deliveryScheduler) snapshot() DeliveryMetrics {
	d.mu.Lock()
	defer d.mu.Unlock()
	m := d.metrics
	m.PacingBytesPerSecond = int64(d.rate)
	// Report current queue age too, including periods when sending is stalled.
	for _, l := range d.lanes {
		if len(l.items) > 0 {
			m.QueueDelayMillis = max(m.QueueDelayMillis, time.Since(l.items[0].queued).Milliseconds())
		}
	}
	if m.QueuedBytes == 0 && time.Since(d.lastQueueSample) > time.Second {
		m.QueueDelayMillis = 0
	}
	return m
}
func (s *Session) scheduler() *deliveryScheduler {
	s.deliveryOnce.Do(func() {
		var network func() DeliveryNetworkStats
		if c, ok := s.conn.(deliveryNetwork); ok {
			network = c.DeliveryNetworkStats
		}
		s.delivery = newDeliveryScheduler(s.ctx, s.conn.SendDatagram, network)
		// Context/connection closure terminates both the worker and a blocked send.
		_ = s.goTracked(s.delivery.run)
	})
	return s.delivery
}
func (s *Session) DeliveryMetrics() DeliveryMetrics {
	m := s.scheduler().snapshot()
	m.ReliableLeasedBytes = s.reliableBytes.Load()
	m.ReceiveQueuedBytes = s.receiveBytes.Load()
	return m
}
