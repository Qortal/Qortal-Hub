# Bounded datagram receive queues

Base: upstream quic-go v0.62.0, retaining its MIT license and tests.
This local module replacement is used by both Hub and the standalone relay.
Keep both copies identical. There is no cryptographic or wire-protocol change.

The upstream 32-packet HTTP/3 receive queue can discard packets already
acknowledged by outer QUIC. An inner reliable QUIC connection then retransmits
and reduces its sending rate. Increasing only the HTTP/3 limit can move overflow
to the connection-level DATAGRAM queue instead.

Local changes:

- `internal/datagrambuffer`: lazily grown FIFO ring, compact owned payloads,
  monotonic residence time, byte/packet limits, counters, and atomic global budget.
- `datagram_queue.go`: use that queue; promptly release on close.
- `http3/state_tracking_stream.go`: same queue at HTTP/3 layer; close cleanup.
- `datagram_buffer.go` and `http3/datagram_buffer.go`: opt-in receive profile and
  numeric stats. No peer-controlled queue-size or allocation parameter.
- `connection.go`: count existing raw receive-queue overflow; its cap is unchanged.

Defaults remain 32 packets per HTTP/3 stream and 128 per QUIC DATAGRAM queue.
The application calls `EnableDatagramReceiveBuffer` only for an admitted tunnel
and its connection. The profile allows at most 1024 packets and 1 MiB including
per-packet accounting, plus at most 64 KiB of ring slots per queue. It drops
packets older than 50 ms on enqueue/dequeue; no stale packet is handed onward.
Expiry is lazy, not a timer promising physical reclamation after 50 ms.

All queues, including default/pre-admission ones, share a **32 MiB process-wide
live-allocation budget**. Payloads, packet overhead and ring slots are charged;
ring growth reserves both old and new storage temporarily. This is not an RSS
limit: Go GC, QUIC socket buffers, cryptographic packets and other application
allocations are separate. Empty large rings and consumed payload references are
released immediately; small empty rings stay charged until close.

Overflow drops incoming datagrams, preserving accepted FIFO order. Expiry drops
stale head entries. DATAGRAM remains unreliable; congestion control is unchanged.
The profile absorbs bursts, not sustained overload, and does not promise bandwidth
or priority between opaque encrypted packets. MaxResidenceMicros also counts
expired entries and can therefore exceed 50 ms.

Tests (from this directory):

```
go test -race ./internal/datagrambuffer
go test -race . ./http3
```

On upgrade, rebase these listed changes onto the new pinned upstream release,
retain its license, run upstream tests plus the local bounds/cleanup/race tests,
then run Hub's real MASQUE mixed bulk/datagram fixture and relay access tests.
Never edit the Go module cache or depend on a developer-only build overlay.
