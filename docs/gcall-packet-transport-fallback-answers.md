# Group Call Packet Transport and Link Fallback Answers

This note answers the packet-vs-link audio questions against the current Qortal Desktop group-call implementation. It separates confirmed behavior from inference where the code does not expose enough runtime data.

## Short conclusion

The implementation does have a packet media path and a link media fallback path. Packet audio is sent as Reticulum packets to individual peer destinations, while group-call fanout is handled by the application-level forwarding topology.

The current diagnostics point to packet transport being at least partly usable, not catastrophically broken. The stronger suspicion is that the criteria for considering packet mode fresh enough, plus fallback evidence handling, can push calls into link mode sooner or keep them there longer than realtime voice strictly requires.

## Packet transport implementation

Audio packets are not sent as Reticulum broadcast or group destinations.

For packet mode, the Python Reticulum bridge builds a single outbound destination for the target peer and sends one `RNS.Packet` containing the encrypted group-call audio wire payload. The send does not request a packet receipt, so the media path does not get a per-audio-packet ACK.

For link mode, the same encrypted group-call audio payload is sent over a Reticulum link instead of the packet destination. Link fallback changes the Reticulum transport carrier, not the group-call audio codec or encryption format.

Group calls use an application-level forwarding overlay:

- A small call can have a root forwarder and standby forwarder.
- Larger calls can add cluster forwarders.
- Non-root participants send upstream to their assigned forwarder.
- Forwarders fan out to downstream peers according to the topology.

Forwarders do not decode Opus and do not decrypt/re-encrypt the media. They forward opaque encrypted group audio bytes. They do re-wrap the same encrypted media payload into separate Reticulum sends for each outbound recipient, because each recipient has its own packet or link transport path.

So the most accurate description is:

`Opus frame -> encrypted group audio payload -> app topology fanout -> per-peer Reticulum packet or link send`

## Packet timing

The voice frame duration is 20 ms.

Confirmed audio constants:

- Sample rate: 48 kHz
- Channels: mono
- Frame size: 960 samples
- Frame duration: 20 ms

The active audio profile controls bitrate. The known profiles are:

- Low latency: 24 kbps Opus target bitrate
- High stability: 32 kbps Opus target bitrate

The default profile is high stability unless local settings select otherwise.

Approximate media payload size:

- 24 kbps at 20 ms is about 60 bytes of Opus data before codec variance.
- 32 kbps at 20 ms is about 80 bytes of Opus data before codec variance.
- The encrypted group-call v2 wrapper adds roughly `49 + sourceAddressLength` bytes around the Opus frame.
- With a typical source address around 34-35 bytes, the encrypted group audio payload is roughly 143-165 bytes before JSON/base64 and Reticulum overhead.

That is an estimate. The exact packet size varies with Opus VBR behavior, source address length, JSON/base64 wrapping, Reticulum headers, and whether the v3 multi-frame format is used.

## Jitter buffer behavior

The receiver does reorder packets before playout.

The jitter buffer inserts received frames by sequence number, rejects duplicates, and rejects frames that are already older than the last played sequence. It waits for a minimum number of buffered frames before becoming primed, then pops frames in sequence order for playback.

The jitter buffering is adaptive, not purely fixed:

- Low-latency profile starts smaller.
- High-stability profile starts larger.
- Recovery conditions can raise the buffering floor.
- Burst recovery can hold extra frames.
- The receiver posts adaptive target playout delay values to the audio worklet.

Known profile targets:

- Low latency adaptive max target: about 120 ms
- Low latency severe max target: about 170 ms
- High stability adaptive max target: about 145 ms
- High stability severe max target: about 185 ms

The buffer does not wait indefinitely for missing packets. Realtime voice favors deadline-based playback, PLC/FEC, and dropping stale media over retransmission.

One important distinction: jitter buffer health is mostly separate from packet fallback health. A jitter spike or a few reordered frames do not directly prove the Reticulum packet path is unusable. They affect audio quality, but fallback is driven mostly by packet path freshness, send failures, path warmups, and peer receive reports.

## Freshness criteria

This is the most important part.

`pathState === "fresh"` is not based on RTT, packet-loss percentage, jitter variance, or subjective audio quality.

The Reticulum bridge classifies a call media packet path as fresh when:

- Reticulum reports that it has a path to the destination hash.
- There was a recent successful packet send, or recent inbound media from that destination.
- There was no very recent packet send failure.

The key timing windows are short:

- Packet path fresh window: 3 seconds
- Inbound freshness window: 3 seconds
- Recent failure window: 2 seconds
- Active path await window: about 120 ms
- Consecutive warmup timeouts before failing: 2

That means packet mode can become non-fresh even if the route is basically usable but temporarily quiet, delayed, asymmetric, or imperfect. It is a route-and-recent-signal test, not a realtime voice quality test.

Confirmed examples of what does not directly make `pathState === "fresh"` true:

- RTT below a threshold
- A measured packet-loss percentage below a threshold
- Low jitter
- A full bidirectional ACK exchange for media packets
- Consecutive successful Opus decodes

Confirmed examples of what can make it fresh:

- Reticulum has a path and a recent packet send succeeded.
- Reticulum has a path and recent inbound packet media was observed.
- A warmup/path request resolves the path and no recent failure blocks freshness.

## Packet fallback trigger conditions

The TypeScript fallback layer has a higher-level evidence system above the Reticulum bridge path state.

Known constants:

- Evidence threshold: 4
- Minimum degraded window: 6000 ms
- Link fallback request window: 15000 ms
- Minimum link fallback dwell: 3000 ms
- Peer receive missing window: 6000 ms
- Local send recent window: 12000 ms
- Fallback reactivation cooldown: 15000 ms
- Peer receive loss tolerance: 2000 ms

The main evidence sources are:

- Packet path warmup reports that are not ready or not fresh.
- Packet send failures such as path request timeout, packet send false, or exception.
- Renderer media recovery events that ask for packet path degradation handling.
- Peer heartbeat reports saying the peer has not recently received packet media from us, when we recently sent actual packet audio.

The following are not direct fallback evidence by themselves:

- Reordered packets
- A jitter spike
- Opus PLC usage
- Individual late packets
- An RTT threshold
- A measured packet-loss percentage
- Missing ACKs for every audio packet

Missing inbound media can indirectly contribute if the renderer raises a recovery/path-degraded signal, but the fallback system is not a full network quality estimator.

## System for returning to packet mode

The code does have a return-to-packet system.

While link fallback is active, Electron schedules packet fallback probes. Those probes ask the Reticulum bridge to warm or check the packet path. If the packet path becomes ready and fresh, and the minimum fallback dwell/cooldown conditions allow it, Electron can deactivate link fallback and resume packet sends.

The important condition is that the packet path must become fresh enough according to the bridge and TypeScript fallback checks. In the supplied diagnostics, probes were happening, but fallback exit count stayed at zero. That means the return path existed, but the call did not satisfy the exit criteria during the captured window.

## Network topology

At the application layer, the topology is direct-to-forwarder or direct-to-peer depending on the participant role.

At the Reticulum layer, the actual route can be direct, multi-hop, over Internet transports, over WiFi mesh, or over any available Reticulum path. The group-call code generally does not know the physical route, geographic distribution, or exact hop count of the Reticulum path.

The group-call topology can choose root, standby, and cluster forwarder roles, but those are application roles. They are not the same thing as Reticulum network hops.

For diagnosing packet fallback, this matters because an app-level forwarder can be healthy while one recipient's Reticulum packet path is stale, asymmetric, or slow to resolve.

## Forwarder behavior

Forwarders primarily fan out encrypted packets. They do not decode, transcode, or retransmit old audio frames.

Known behavior:

- Forwarders select recipients based on the group-call topology.
- Forwarders send the same encrypted media payload onward.
- Per-peer pending queues are bounded.
- Stale or overloaded audio frames can be dropped.
- Queue flushing is paced/fair rather than unbounded.
- Audio is realtime; the app does not try to reliably retransmit late media.

So forwarders can drop stale media under pressure, but they are not acting like reliable message brokers. That is the right bias for voice, because a late audio frame is usually worse than a lost one.

## Link mode characteristics

The code and diagnostics can show that link mode was used, but they cannot fully answer whether it sounded better.

From the two supplied diagnostics:

- Both peers used link mode for almost all audio.
- Link fallback was active.
- Packet fallback probes were running.
- Link fallback exit count was zero.
- There were no obvious packet send failures or link-unready drops in the captured summary.

That suggests link mode was stable enough to keep audio flowing.

What the logs do not prove:

- Whether users perceived better quality on link mode.
- Whether link mode only masked mild packet instability.
- Whether latency increased enough to make people talk over each other.
- Whether packet mode would have sounded acceptable with more tolerant freshness rules.

The receiver playout-related numbers in the diagnostics looked relatively high, so link mode should not automatically be treated as a low-latency win. It may be more stable while also adding delay.

## Opus settings

The sender configures Opus for voice.

Known settings:

- Codec: Opus
- Application: voip
- Signal: voice
- Frame duration: 20 ms
- In-band FEC: requested/enabled
- DTX: disabled
- Expected packet loss: profile dependent
- Bitrate: profile dependent

Known profile values:

- Low latency: 24 kbps, expected packet loss about 10%
- High stability: 32 kbps, expected packet loss about 14%

The receiver has jitter buffering and late/loss handling, and the audio pipeline is designed around realtime playout. Proper Opus FEC/PLC behavior means the packet path can tolerate some loss and jitter without needing immediate link fallback.

That supports the suspicion that "fresh enough for packet mode" should not be stricter than what Opus plus the jitter buffer can realistically survive.

## Packet sequence handling

Receivers use sequence numbers.

The receiver:

- Inserts frames in sequence order.
- Reorders before playout.
- Drops duplicate frames.
- Drops frames that arrive after their playout position has already passed.
- Tracks expected sequence progression.
- Counts gaps as missing frames.
- Uses buffering and recovery behavior instead of waiting indefinitely.

The receiver should not aggressively wait for missing packets in a voice call. Waiting too long converts packet loss into latency, and latency is usually more harmful than short PLC-covered gaps.

## What the supplied diagnostics imply

The diagnostics showed mostly link transport, but not a dead packet system.

Observed pattern:

- Packet sends were rare compared with link sends.
- Packet fallback probes were frequent.
- Link fallback remained active.
- Link fallback exit count stayed zero.
- Packet send failure counters were not the obvious explanation.
- Link-unready drops were not the obvious explanation.

That points toward this interpretation:

Packet transport was considered not fresh or not trustworthy enough for exit, even though there was evidence that packet transport could sometimes work.

The phrase "usable but imperfect packet transport" fits better than "catastrophic packet failure" for these captures.

## Main risk

The single most important risk is that packet freshness is stricter than realtime voice requires.

A 3-second freshness window plus short warmup waits can be reasonable for a clean fast path, but it can also punish:

- asymmetric packet visibility,
- temporary route quietness,
- slow Reticulum path resolution,
- mild jitter,
- low-rate media during silence/VAD behavior,
- and forwarder topology changes.

If packet mode can deliver most frames with tolerable jitter, Opus FEC/PLC and the jitter buffer should be allowed to absorb some imperfection before link fallback takes over.

## Data still needed

To decide whether fallback is too aggressive or packet mode is truly bad, the most useful added data would be:

- Packet-mode receive rate per peer over time.
- Packet-mode late/drop/reorder rate before fallback.
- Packet-mode jitter buffer underruns before fallback.
- Opus PLC/FEC usage before fallback.
- Time spent in packet mode before each fallback activation.
- Exact fallback evidence events leading to each activation.
- Subjective audio notes for packet mode vs link mode.
- One-way or round-trip latency estimates by transport mode.
- Forwarder queue depth and stale-drop counts per recipient.

The best next diagnostic improvement would be to log the exact fallback evidence timeline: what evidence incremented, when the degraded window started, what requested link fallback, and what specific exit condition failed during each packet probe.
