# Group Call Audio V2 — Post-Cutover Upgrade Roadmap

This document tracks architectural improvements that become available AFTER the
v2 architecture (control plane, receive engine, policy FSM, decode service, replay
harness) is fully in production and all legacy paths have been deleted.

These are NOT blockers for the cutover. They are evaluated after the v2 baseline
is stable and the regression fixture suite passes.

---

## 1. Native Reticulum-level improvements

**Motivation:** Phil had `reticulumAudioPacketPathTimeouts` = 11.9% (vs Kenny's 3.9%).
Path resolution failures at the Reticulum layer cannot be fixed by the v2 policy FSM —
they require changes at the network/routing level.

**Candidates:**
- Reticulum path pre-caching: resolve and cache paths for known group call peers
  before they are needed, so the first post-join packet doesn't trigger resolution.
- Reduce path resolution timeout from the current default to 2s for audio peers.
- Evaluate Reticulum-native multicast for group audio fanout to eliminate the
  application-level fanout hop.

**Gate:** Requires Reticulum Python daemon changes. Out of scope for the JavaScript
v2 architecture; file separate issues against `reticulum-daemon.ts`.

---

## 2. Native Opus decode via WASM / Emscripten

**Motivation:** The current `WebCodecs AudioDecoder` path does not expose PLC (packet
loss concealment) beyond silence fill. The WASM Opus decoder has a proper `decode_loss`
API that produces plausible audio for gaps.

**Plan:**
- Integrate the WASM libopus decoder as a `IDecodeService` implementation alongside
  `WebCodecsDecodeService`.
- The `DecodeService` factory selects WASM when `AudioDecoder` is not available, or
  when the caller requests the WASM path explicitly (e.g. for PLC quality).
- Evaluate whether `gcall-opus-fec.worker.ts` can be retired in favor of the unified
  `IDecodeService` interface.

---

## 3. Opaque relay / fanout optimization

**Motivation:** Root forwarders today decrypt-and-reencrypt. For large rooms this is
wasteful: the forwarder could relay the already-encrypted bytes opaquely.

**Plan:**
- The `ReticulumSessionController` should emit a `canRelayOpaque` flag per stream
  once the topology is stable. When true, the forwarder skips decrypt/reencrypt and
  forwards the wire bytes directly.
- The `ReceiveEngine` should accept opaque relay packets and dispatch them without
  involving the `DecodeService`.
- This requires the wire format to carry enough routing metadata outside the secretbox
  so the forwarder can route without decrypting.

---

## 4. SharedArrayBuffer playout bridge

**Motivation:** The current PCM ring lives on the main thread. The playout worklet
reads from it via `postMessage`, which adds one message-queue hop of latency.

**Plan:**
- Export the `PerSourcePcmRing`'s internal `Float32Array` as a `SharedArrayBuffer`.
- The playout worklet reads directly from the SAB with `Atomics`-based fill tracking.
- Eliminates the main-thread ↔ worklet round trip for PCM delivery.

**Gate:** Requires COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`). Verify Electron's context isolation
configuration supports this.

---

## 5. Multi-party jitter and FEC tuning

**Motivation:** The `DEFAULT_POLICY_CONFIG` targets 1:1 calls (the call-63 scenario).
For 3+ participants, `targetBufferMs` should be higher and `backlogDrainTriggerRatio`
may need adjustment.

**Plan:**
- The `GcallV2Session` or `ReceivePolicyEngine` should accept a `participantCount`
  signal and scale `targetBufferMs` accordingly.
- For N ≥ 3, consider enabling WASM FEC in the `DecodeService` factory.

---

## 6. Replay harness CI integration

**Motivation:** The regression fixture tests currently run in Jest with simulated
time. They should also run in a headless Electron instance to catch Electron-specific
scheduling artifacts (the tick budget breaches from the Phil scenario are
Electron/WebAudio scheduling artifacts).

**Plan:**
- Add a `npm run replay:ci` target that runs `replayHarness.test.ts` in a headless
  Electron context.
- Use `electron-mocha` or `playwright` with `@playwright/test`'s Electron driver.
- Make this a required CI step before any group-call PR merges.

---

## 7. Paired export upload / comparison tool

**Motivation:** Today, comparing paired exports requires manual JSON archaeology.
The `PairedExportAnalyzer` automates classification, but the exports still need to
be collected manually.

**Plan:**
- Add an in-app "Share call diagnostics" button that exports a bundle and optionally
  uploads it to a diagnostics endpoint.
- The endpoint stores paired exports keyed by `roomId + exportedAtMs` so the analyzer
  can fetch both peers' exports automatically.
- Surface the `PairedAnalysisResult.callSummary` in the UI for QA triage.
