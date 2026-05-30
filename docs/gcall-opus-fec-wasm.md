# Group call: WASM Opus FEC / PLC decode path

Receive-side decoding can use **libopus** in a dedicated Worker (`gcall-opus-fec.worker.ts`) so **PLC** (zero-length decode) and **in-band FEC** (`decode_fec = 1`) match the encoder when the browser sends FEC (`useinbandfec` in `useGroupVoiceCall`).

## Build (only if you change the native wrapper)

The app **always tries** the WASM FEC decode path in group calls. The prebuilt bundle is committed at `src/wasm-libopus-fec/libopus-fec.js`. Rebuild only after editing `native/libopus-fec-wasm/` (requires [emsdk](https://emscripten.org/docs/getting_started/downloads.html) at repo root `.emsdk/`):

```bash
./native/libopus-fec-wasm/build.sh
```

If the worker or WASM fails to initialize, the hook **falls back** to **WebCodecs `AudioDecoder`** (no libopus FEC control).

**Emergency disable** (debugging only): `VITE_GCALL_WASM_FEC=0` in `.env`, or `localStorage.setItem('gcallWasmFec','0')` then reload.

## Behaviour

- **+1 frame jitter hold** when the flag is desired (see `JitterBuffer` extra hold), so the next packet is more often present before decode (FEC window).
- **PLC/FEC sequence** per pop matches the plan: PLC for early burst losses, then FEC + normal on the same packet with **separate PCM buffers**.
- **`MAX_PCM_FRAMES_PER_TICK`**: excess PCM is deferred to the next scheduler tick (see `GCALL_WASM_FEC_MAX_PCM_PER_TICK`).
- **Large seq gap** (`> 32`): worker decoder is reset before processing.
- **Metrics**: `GroupCallPerformanceTracker` records `wasmFecPlcFrames`, `wasmFecAttempts`, `wasmFecSuccessCoarse` (coarse heuristic), `wasmFecDeferredPcmTicks` on the snapshot and per-source window metrics.

## Manual verification

1. Two clients on a group call with WASM path enabled.
2. Confirm sender path: `groupCallWindowMetrics` / logs should show encoder FEC when `AudioEncoder.isConfigSupported` accepts `useinbandfec`.
3. Induce loss (throttle network or drop packets in a test build) and compare concealment / missing-frame stats with flag on vs off.
4. Inspect snapshot: `wasmFecAttempts` and `wasmFecSuccessCoarse` should move under loss; `fecSuccessCoarse` is approximate (non-zero energy after FEC decode).

## Files

- `native/libopus-fec-wasm/` — C wrapper + `build.sh`
- `src/wasm-libopus-fec/libopus-fec.js` — generated bundle
- `src/workers/gcall-opus-fec.worker.ts` — decode worker
- `src/hooks/useGroupVoiceCall.ts` — jitter drain, worker wiring, metrics
