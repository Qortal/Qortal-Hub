# Private upload throughput investigation — 2026-09-12

## Confirmed in the local transport fixture

quic-go's HTTP/3 `stateTrackingStream.enqueueDatagram` silently drops received
datagrams once its per-stream queue contains 32 packets. The outer QUIC layer
can already have acknowledged these packets, so outer packet-loss statistics
do not expose this discard. Inner QUIC must recover the missing tunnel packets.

A test-only Go workspace and overlay instrumented that exact discard branch.
The module cache, running Hub, and VPS binaries were not modified.

The opt-in `QORTAL_BULK_BENCH=1` test in
`electron/src/private-channel-step3.test.ts` sends 64 opaque 524,886-byte messages
over one keyed reliable stream with two concurrent native submissions. The
fixture returns small acknowledgements. A local UDP proxy adds 60 ms in each
direction. It does not intentionally drop packets; its explicit drop counter
does not measure OS socket drops or packet reordering.

| HTTP/3 receive queue | Seconds for 33,592,704 bytes | MB/s (decimal) | Instrumented relay queue drops | Inner reported loss | Outer reported loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| 32, run 1 | 6.297 | 5.33 | 25 | 25 | 0 |
| 32, run 2 | 9.803 | 3.43 | 194 | 194 | 0 |
| 1024, run 1 | 2.416 | 13.91 | 0 | 191 | 13 |
| 1024, run 2 | 3.664 | 9.17 | 0 | 972 | 458 |

The larger queue is an experiment, not a proposed production default. It removes
this discard point but does not remove all loss or reproduce a real network
perfectly. The exact match between the instrumented discard count and inner loss
in both stock-queue runs establishes a concrete loss mechanism in this fixture.

## Production applicability and limits

The VPS relay checkout at inspection was `8cbdaf3`, declaring quic-go v0.60.0
and masque-go v0.4.0. v0.60.0 has the same 32-packet discard branch as the Hub
fixture's v0.62.0. This identifies a relevant production risk, not a direct
measurement of the running VPS relay's discard count.

Earlier real-upload diagnostics showed inner loss with no outer loss and little
time spent in encryption or backend disk synchronization. Those observations are
consistent with this mechanism, but do not prove it accounts for all slow upload
time. The fixture uses a Go receiver, not the production Python backend, and
does not include QApp encryption, browser work, or storage.

## Follow-up

- Add bounded, observable tunnel receive buffering, with per-tunnel and aggregate
  memory limits; do not replace the cap with unbounded queues.
- Check receive draining, burst handling and loss at the other queue boundaries.
- Measure throughput and media latency together before choosing production bounds.
- Validate on the actual relay/backend path before claiming a production speed fix.

## Implemented validation

The final implementation uses bounded rings at both DATAGRAM receive layers,
not the experimental constant-only change. Large limits are enabled after
admission, shared accounting is capped at 32 MiB, and packets older than 50 ms
are discarded when processed. Upstream raw packet safety limits remain intact.

With small datagrams every 20 ms on the same inner connection:

| Transfer | Simulated RTT | Elapsed | MB/s | Small datagrams received | Small datagram p95 RTT |
| --- | ---: | ---: | ---: | ---: | ---: |
| 33,592,704 bytes | 120 ms | 2.174 s | 15.45 | 104 / 104 | 181 ms |
| 134,370,816 bytes | 120 ms | 6.128 s | 21.93 | 294 / 294 | 170 ms |

Both runs reported zero full/budget/expiry drops at the new receive queues.
The longer run's new raw-packet counter reported 58 drops at QUIC's existing
256-packet unprocessed-packet cap. Inner loss was 57 packets and outer loss 18;
these numbers measure different points and must not be subtracted to infer
another exact loss count. The raw cap remains unchanged for flood protection.
This local fixture is not evidence that the VPS has those exact raw drops.

Validation passed: queue bounds/order/ownership/expiry/close/global-budget tests
under the race detector; upstream QUIC and HTTP/3 race tests; Hub native race
tests; 42 Electron transport tests; relay race tests; TypeScript checking; the
relay Docker build stage; real Hub-sidecar/relay membership, renewal, replay and
logout integration using isolated loopback Reticulum and generated test accounts.

The VPS services were not modified by this implementation. Real deployment and
a live-path measurement are still required to establish the user-visible speed.

## Production Python receiver reproduction

After deploying the relay and restarting Hub 0.10.1, a real upload still delivered
about 84 MB in 40 s. Encryption consumed only 0.227 s of measured cumulative time;
file reads 3.334 s. Native sends averaged 458 ms and acknowledgements 593 ms per
roughly 512 KiB batch. These are overlapping request times, not additive durations.
No receive-pressure reports appeared from the updated relay. The backend socket
had `rb212992` and 3869 cumulative kernel drops (not attributable to one upload).

The Step 4 opt-in benchmark now exercises the real Python QUIC server, parser,
signed session authentication, bootstrap and attachment through the patched relay
and sidecar. It sends the same 64 x 524886-byte reliable messages with two native
sends in flight and 120 ms simulated RTT. A benchmark-only binary handler returns
a small acknowledgement; storage, file encryption and browser work are excluded.

| Receiver variant | Effective Linux socket receive buffer | Seconds | MB/s | Kernel drops / inner loss |
| --- | ---: | ---: | ---: | ---: |
| Production asyncio, default socket | 212992 bytes | 12.591 | 2.67 | 772 / 772 |
| Production asyncio, 4 MiB SO_RCVBUF request | 8388608 bytes | 5.993 | 5.61 | 0 / 0 |
| Test-only uvloop, same buffer | 8388608 bytes | 4.162 | 8.07 | 0 / 0 |
| Test-only uvloop + coalesced transmit scheduling | 8388608 bytes | 3.392 | 9.90 | 238 / 238 |

Linux reports doubled SO_RCVBUF accounting. Changing this setting is not itself
a complete fix: inner RTT rose to 336 ms in the larger-buffer asyncio run and
235 ms with uvloop, versus roughly 120 ms at the unchanged outer connection.
The coalescing experiment still overflowed. These are diagnostic experiments,
not approved production settings or a claim that buffering alone resolves this.

Without profiling, the larger-buffer asyncio receiver consumed 4.98 CPU seconds
for its 5.99-second transfer. A separate cProfile run (not a throughput result)
recorded about 28900 UDP callbacks and transmit checks. Major costs were QUIC
packet receive/send preparation, repeated header parsing, event-loop dispatch,
and framing. AEAD decryption was about 0.16 s self-time in that profiled run.

This reproduces the low-throughput symptom with the actual Python transport
without any storage involvement. The socket drop count exactly matching inner
loss establishes a second loss point. It also establishes substantial per-packet
processing cost even when socket drops are eliminated. The remaining work is
the backend receive path, including a bounded buffer and efficient processing /
scheduling, with mixed-traffic latency validation—not another relay-only tweak.

Reproduce from Hub's root with Go and uv available:

```
QORTAL_PYTHON_BENCH=1 npx vitest run electron/src/private-channel-step4.test.ts -t 'benchmarks real Python'
```

Diagnostic-only environment switches: `QORTAL_STEP4_PROFILE=1`,
`QORTAL_STEP4_UVLOOP=1` (uses `uv run --with uvloop`, no production dependency
change), and `QORTAL_STEP4_COALESCE=1`. These affect only the isolated fixture.

Upstream implementation:
https://github.com/quic-go/quic-go/blob/v0.60.0/http3/state_tracking_stream.go
