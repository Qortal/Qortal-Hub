# GCall Call Review Summary

This file records reviewed group-call diagnostics using the checklist in
[docs/gcall-call-review-template.md](/home/qortal/Desktop/desktop-app-official/qortal-desktop/docs/gcall-call-review-template.md).

## Call: 2026-05-05 12:57Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T12-57-34-020Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T12-57-29-656Z.json`

User symptom:
- New paired call after the latest receive-policy changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and recovery profiles.

High-level verdict:
- Mixed/bad.
- Correctness paths are clean, but both sides are still policy-dominated, with one side near-empty and repair-heavy and the other over-classified into the strongest recovery profile.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are `0` on both sides.
- Startup playout: both playouts are active, `jitterHasReadyFrame` is `true`, playback/scheduler nodes are active, and audio contexts are running.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Selector.
- Specifically, prevent `collapse-recovery` from winning when reserve is materially healthy and concealment pressure is low; that Linux/root side fits a buffered missing-frame/repair shape better than true collapse.
- Code target: `selectSingleSourceReceiveProfile` in `src/lib/group-call/groupCallAudioReceiveEngine.ts`, where `severeSingleSourceHold` currently returns `collapse-recovery` before the repair profiles unless `buffered-not-ready` is active.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | yes | 11.596 | 363 | 478 | 0.066 | 0.062 | recovery | Classification matches the shallow-buffer, ongoing roughness shape. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `collapse-recovery` | partly | 31.361 | 783 | 18 | 0.050 | 0.014 | recovery | Profile looks too strong for the exported symptom: reserve is not collapsed and concealment is mild. |

### Side A

Expected profile from symptom:
- `persistent-lean`, possibly bordering `repair-collapse` because concealment is high.

Actual exported profile:
- `persistent-lean`

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs` is only `11.596`, `jitterBufferDepthFramesMean` is `0.587`, `avgPlayoutDeltaMs` is `-112.212`, and concealment is high at `478`.
- This is a real weak-listener policy case, not key, queue, failover, or startup.

### Side B

Expected profile from symptom:
- `repair-heavy-connected` or a lighter repair/missing-frame profile.

Actual exported profile:
- `collapse-recovery`

Did classification match?
- No/partly.

If no:
- The side has high `missingFrames` (`783`) but very low `concealmentTicks` (`18`), healthy-ish `avgPcmBufferedMs` (`31.361`), low `playoutRateFractionBelow097` (`0.014`), and only moderate under-target pressure (`0.050`).
- Retune selector entry/priority for `collapse-recovery` before increasing its target or floor.

## Trend Read

Side A:
- Flat-bad with gradual counter growth.
- Reasons seen:
  - `missingFrames` increases from `307` to `363`.
  - `concealmentTicks` increases from `388` to `478`.
  - buffer stays shallow around `11.3` to `11.6` ms.
  - no decrypt/decode/transport reasons.

Side B:
- Oscillating selector/mode behavior over a buffered repair path.
- Reasons seen:
  - `entered-recovery` appears twice.
  - adaptive mode flips from recovery to low-latency and back to recovery.
  - `missingFrames` increases from `669` to `783`, while concealment only increases from `14` to `18`.
  - buffer stays around `31` to `33` ms rather than collapsing.

## Call: 2026-05-05 13:13Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T13-13-16-416Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T13-13-13-521Z.json`

User symptom:
- New paired call after the selector escape change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and recovery profiles.

High-level verdict:
- Bad.
- Correctness paths remain clean, but both sides are still policy-dominated and exported as `collapse-recovery`; the remaining problem is no longer the previous healthy-buffer overclassification.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are `0` on both sides.
- Startup playout: both playouts are active, `jitterHasReadyFrame` is `true`, playback/scheduler nodes are active, and audio contexts are running.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- `collapse-recovery` profile strength.
- The selector now lands both sides in a defensible severe/near-severe profile, but the profile is not rebuilding reserve enough: Mac stays around `7 ms`, Linux stays around `19 ms`, and both remain in recovery with strongly negative playout delta.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `collapse-recovery` | yes | 7.290 | 180 | 611 | 0.059 | 0.054 | recovery | Classification matches true severe collapse: tiny reserve, high concealment, very negative delta. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `collapse-recovery` | yes | 18.891 | 899 | 13 | 0.027 | 0.005 | recovery | Classification is acceptable/partly correct: reserve is under the lean floor and delta is very negative, though concealment is low. |

### Side A

Expected profile from symptom:
- `collapse-recovery`

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs` is only `7.290`, `jitterBufferDepthFramesMean` is `0.370`, `avgPlayoutDeltaMs` is `-115.466`, and `concealmentTicks` is `611`.
- This is exactly the class that should receive the strongest collapse target/floor.

### Side B

Expected profile from symptom:
- `collapse-recovery` or `silent-lean`

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Partly/yes.

Notes:
- This side is no longer the previous healthy-buffer false positive. `avgPcmBufferedMs` is `18.891`, under the low-reserve band, and `avgPlayoutDeltaMs` is `-139.200`.
- Low `concealmentTicks` (`13`) and low `playoutRateFractionBelow097` (`0.005`) make it less obviously repair-collapse, but the tiny reserve plus high `missingFrames` (`899`) still justify a strong recovery path.

## Trend Read

Side A:
- Flat-bad with gradual counter growth.
- Reasons seen:
  - `missingFrames` increases from `144` to `180`.
  - `concealmentTicks` increases from `523` to `611`.
  - buffer stays pinned around `6.9` to `7.3` ms.
  - no decrypt/decode/transport reasons.

Side B:
- Oscillating mode over a still-shallow path.
- Reasons seen:
  - `entered-recovery` appears three times.
  - adaptive mode flips between recovery and low-latency.
  - `missingFrames` increases from `715` to `899`.
  - buffer only rebuilds from `18.1` to `18.9` ms, still below the low-reserve threshold.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T12:57Z group-812` | A / Mac standby | `persistent-lean` | yes | yes | receive policy strength | Keep as evidence, but do not tune first. |
| `2026-05-05T12:57Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector | Done: added stale severe-hold escape for ready buffered low-concealment paths. |
| `2026-05-05T13:13Z group-812` | A / Mac standby | `collapse-recovery` | yes | yes | receive policy strength | Done: raised `collapse-recovery` target/floor and collapse-only hold headroom. |
| `2026-05-05T13:13Z group-812` | B / Linux root | `collapse-recovery` | yes | partly/yes | receive policy strength | Done for strength; watch whether low-concealment shallow paths need a later selector split. |

## Next Fix Target

Current patched target:
- `collapse-recovery` now has a stronger target/floor and collapse-only extra-hold headroom.
- Keep the selector escape from the 12:57 review; the 13:13 call no longer showed the same healthy-buffer false positive.
- Next logs should verify whether Mac-side reserve climbs out of the `7 ms` range and whether Linux low-concealment shallow paths remain appropriately classified.
