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

## Call: 2026-05-05 13:34Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T13-34-46-268Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T13-34-43-094Z.json`

User symptom:
- New paired call after the `collapse-recovery` strength change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and recovery profiles.

High-level verdict:
- Bad/mixed.
- Receive policy still reports `collapse-recovery` on both sides, but this call introduces non-policy blockers: Linux/root has decode failures, and Mac/standby has a ready-state contradiction with buffered jitter frames but no ready frame.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are `0` on both sides.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Another subsystem: decode/session path first, then playout readiness/mode synchronization.
- Do not tune receive profile strength or baseline from this call until `packetsDroppedDecodeFailure=33` on Linux/root and the Mac `jitterBufferedFrames=12` / `jitterHasReadyFrame=false` state are explained.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `collapse-recovery` | yes | 9.484 | 617 | 7 | 0.024 | 0.003 | recovery | Classification is suspicious: low reserve and very negative delta, but low concealment/under-target and `jitterHasReadyFrame=false` with 12 buffered frames points at readiness/mode sync. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `collapse-recovery` | yes | 13.914 | 370 | 425 | 0.113 | 0.101 | recovery | Classification matches collapse symptoms, but `packetsDroppedDecodeFailure=33` makes decode/session correctness the first target. |

### Side A

Expected profile from symptom:
- `buffered-not-ready` or `silent-lean`

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs` is only `9.484` and `avgPlayoutDeltaMs` is `-132.257`, so a severe path is understandable.
- But `concealmentTicks` is only `7`, `playoutUnderTargetFraction` is `0.024`, `playoutRateFractionBelow097` is `0.003`, and the playout snapshot says `jitterBufferedFrames=12` with `jitterHasReadyFrame=false`.
- This should be treated as a playout readiness/mode synchronization issue before selector or strength tuning.

### Side B

Expected profile from symptom:
- `collapse-recovery`

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Yes for the receive symptom, but root cause is not cleanly receive-policy.

Notes:
- `avgPcmBufferedMs` is `13.914`, `avgPlayoutDeltaMs` is `-153.318`, `concealmentTicks` is `425`, and `playoutRateFractionBelow097` is `0.101`, so the collapse profile fits the audible damage.
- `packetsDroppedDecodeFailure=33` is a quick-triage correctness signal and should be investigated before another receive-policy patch.

## Trend Read

Side A:
- Oscillating mode with suspicious readiness state.
- Reasons seen:
  - adaptive mode flips low-latency to recovery near the end.
  - `missingFrames` increases from `477` to `617`.
  - `concealmentTicks` stays almost flat from `6` to `7`.
  - buffer stays near `9 ms`, and playout snapshot has buffered frames but `jitterHasReadyFrame=false`.

Side B:
- Flat-bad/degrading with decode failures.
- Reasons seen:
  - `packetsDroppedDecodeFailure` is `33` for the entire sampled trend.
  - `concealmentTicks` increases from `295` to `425`.
  - `missingFrames` jumps from `135` to `370`.
  - buffer falls from about `15.1` to `13.9` ms and remains shallow.

## Call: 2026-05-05 14:53Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T14-53-12-293Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T14-53-14-926Z.json`

User symptom:
- New paired call after the repair-heavy selector/hold change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and exported profiles.

High-level verdict:
- Mixed/bad.
- Correctness paths are clean and `collapse-recovery` no longer dominates, but classification is now split: Mac is a true extremely shallow `silent-lean` path with a buffered-but-not-ready playout snapshot, while Linux is over-classified as weak despite a very healthy reserve.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are low (`3`/`2` on Mac, `2`/`1` on Linux) with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Selector / playout readiness, not baseline or profile strength.
- Mac needs the selector/readiness path to treat `avgPcmBufferedMs=2.366`, `jitterBufferedFrames=10`, and `jitterHasReadyFrame=false` as the dominant failure shape instead of letting the runtime remain in low-latency while the exported profile says `silent-lean`.
- Linux needs a healthy-reserve escape from `steady-weak-listener`: `avgPcmBufferedMs=73.273`, `jitterHasReadyFrame=true`, low concealment, and low under-target pressure do not match a user-bad weak listener.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `silent-lean` | yes | 2.366 | 802 | 2 | 0.002 | 0.000 | low-latency | Classification matches the tiny-reserve blind spot, but runtime mode/readiness does not: 10 jitter frames are buffered while no ready frame is reported. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | no/partly | 73.273 | 328 | 10 | 0.016 | 0.007 | recovery | Classification is too pessimistic for a healthy-reserve, low-concealment side; only late recovery entry and moderate missing frames support a weak label. |

### Side A

Expected profile from symptom:
- `silent-lean` or `buffered-not-ready`

Actual exported profile:
- `silent-lean`

Did classification match?
- Yes for profile family, partly for runtime behavior.

Notes:
- `avgPcmBufferedMs` is only `2.366`, `jitterBufferDepthFramesMean` is `0.120`, and `avgPlayoutDeltaMs` is `-118.416`, so this is a real shallow-buffer blind spot.
- `concealmentTicks` is only `2`, `playoutUnderTargetFraction` is only `0.002`, and the playout snapshot says `jitterBufferedFrames=10` with `jitterHasReadyFrame=false`.
- The next patch should make this state drive protective mode/readiness behavior more directly; raising baseline globally would not explain why 10 buffered frames are not ready.

### Side B

Expected profile from symptom:
- `clean-low-latency` or at most `steady-weak-listener` briefly after the late recovery entry.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs` is `73.273`, `jitterBufferDepthFramesMean` is `3.733`, `jitterBufferedFrames=23`, `jitterHasReadyFrame=true`, `concealmentTicks=10`, and `playoutUnderTargetFraction=0.016`.
- This side looks buffered and mostly healthy; tune selector clear/escape conditions for weak-listener classification before touching profile target sizes or baseline policy.

## Trend Read

Side A:
- Flat-bad shallow-buffer state with gradual missing-frame growth.
- Reasons seen:
  - `missingFrames` increases from `666` to `802`.
  - `concealmentTicks` stays nearly flat from `1` to `2`.
  - buffer stays pinned around `2.3 ms`.
  - adaptive mode moves from recovery back to low-latency even though the playout snapshot remains not-ready.

Side B:
- Mostly healthy-buffer with a late discrete recovery entry.
- Reasons seen:
  - `entered-recovery` appears once near the end.
  - `missingFrames` increases from `295` to `328`.
  - `concealmentTicks` only rises from `0` to `10`.
  - buffer stays around `73` to `74 ms`, with ready jitter frames.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T12:57Z group-812` | A / Mac standby | `persistent-lean` | yes | yes | receive policy strength | Keep as evidence, but do not tune first. |
| `2026-05-05T12:57Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector | Done: added stale severe-hold escape for ready buffered low-concealment paths. |
| `2026-05-05T13:13Z group-812` | A / Mac standby | `collapse-recovery` | yes | yes | receive policy strength | Done: raised `collapse-recovery` target/floor and collapse-only hold headroom. |
| `2026-05-05T13:13Z group-812` | B / Linux root | `collapse-recovery` | yes | partly/yes | receive policy strength | Done for strength; watch whether low-concealment shallow paths need a later selector split. |
| `2026-05-05T13:34Z group-812` | A / Mac standby | `collapse-recovery` | yes | partly/no | startup/playout-ready | Investigate buffered-but-not-ready playout state and recovery/low-latency mode sync. |
| `2026-05-05T13:34Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | decode/session | Investigate `packetsDroppedDecodeFailure=33` before more receive-policy tuning. |

## Next Fix Target

Current patched target:
- `collapse-recovery` now has a stronger target/floor and collapse-only extra-hold headroom.
- Keep the selector escape from the 12:57 review; the 13:13 call no longer showed the same healthy-buffer false positive.
- The 13:34 logs shift the next fix away from receive-policy tuning: first inspect the Linux decode/session failure path, then the Mac buffered-but-not-ready playout readiness state.

## Call: 2026-05-05 14:14Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T14-14-50-550Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T14-14-47-842Z.json`

User symptom:
- New paired call after the previous receive-policy changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and non-clean profiles.

High-level verdict:
- Mixed/improved.
- Both sides moved out of `collapse-recovery` into `repair-heavy-connected`, with no decrypt/decode/queue/failover errors and much healthier reserve than the earlier collapse calls, but both are still accumulating missing frames and re-entering recovery.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are `0` on both sides.
- Failover: root/cluster promotion counts are `0` on both sides.
- Collapse profile strength: neither side is now classified as `collapse-recovery`.

Primary next target:
- Selector.
- Specifically, tune the recovery/profile selector and hold behavior around `repair-heavy-connected`: this call has healthy reserve (`45.729 ms` Mac, `64.204 ms` Linux), low concealment (`85` / `20`), and only modest under-target/rate pressure, yet both sides remain non-clean and re-enter recovery.
- Do not raise baseline or `collapse-recovery` strength from this call; the collapse target/floor change appears to have done its job by moving the call into a buffered repair profile.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `repair-heavy-connected` | partly | 45.729 | 1255 | 85 | 0.063 | 0.046 | recovery | Classification partly matches high missing-frame repair, but reserve is healthy and concealment is modest. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `repair-heavy-connected` | partly/no | 64.204 | 687 | 20 | 0.070 | 0.028 | recovery | Classification is more suspicious: very healthy reserve, very low concealment, and only modest rate pressure. |

### Side A

Expected profile from symptom:
- `repair-heavy-connected` or `steady-weak-listener`

Actual exported profile:
- `repair-heavy-connected`

Did classification match?
- Partly.

Notes:
- `missingFrames` is high at `1255`, so a repair profile is defensible.
- But `avgPcmBufferedMs` is `45.729`, `jitterBufferDepthFramesMean` is `2.318`, `jitterHasReadyFrame` is `true`, and `concealmentTicks` is only `85`.
- This looks like buffered repair/missing-frame pressure, not collapse, startup, decode, or baseline starvation.

### Side B

Expected profile from symptom:
- `steady-weak-listener` or `clean-low-latency` with repair counters watched.

Actual exported profile:
- `repair-heavy-connected`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs` is `64.204`, `jitterBufferDepthFramesMean` is `3.252`, and `concealmentTicks` is only `20`.
- `jitterBufferedFrames=9` with `jitterHasReadyFrame=false` is a small readiness mismatch, but the reserve metrics are otherwise healthy and decode is clean.
- Tune selector entry/hold thresholds for `repair-heavy-connected` before changing profile strength or baseline policy.

## Trend Read

Side A:
- Gradual repair-counter growth with oscillating recovery entry.
- Reasons seen:
  - `entered-recovery` appears twice.
  - `missingFrames` increases from `1104` to `1255`.
  - `concealmentTicks` only increases from `77` to `85`.
  - buffer remains healthy around `44.4` to `45.7` ms.

Side B:
- Gradual repair-counter growth with oscillating recovery entry.
- Reasons seen:
  - `entered-recovery` appears twice.
  - `missingFrames` increases from `571` to `687`.
  - `concealmentTicks` only increases from `18` to `20`.
  - buffer remains healthy around `64` to `65` ms.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T12:57Z group-812` | A / Mac standby | `persistent-lean` | yes | yes | receive policy strength | Keep as evidence, but do not tune first. |
| `2026-05-05T12:57Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector | Done: added stale severe-hold escape for ready buffered low-concealment paths. |
| `2026-05-05T13:13Z group-812` | A / Mac standby | `collapse-recovery` | yes | yes | receive policy strength | Done: raised `collapse-recovery` target/floor and collapse-only hold headroom. |
| `2026-05-05T13:13Z group-812` | B / Linux root | `collapse-recovery` | yes | partly/yes | receive policy strength | Done for strength; watch whether low-concealment shallow paths need a later selector split. |
| `2026-05-05T13:34Z group-812` | A / Mac standby | `collapse-recovery` | yes | partly/no | startup/playout-ready | Investigate buffered-but-not-ready playout state and recovery/low-latency mode sync. |
| `2026-05-05T13:34Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | decode/session | Decode failures are gone in 14:14Z; keep watching but do not tune from this old blocker now. |
| `2026-05-05T14:14Z group-812` | A / Mac standby | `repair-heavy-connected` | partly | partly | selector / repair hold | Tune `repair-heavy-connected` entry/hold/exit so high missing-frame counters do not keep a healthy-reserve low-concealment side over-protected. |
| `2026-05-05T14:14Z group-812` | B / Linux root | `repair-heavy-connected` | partly/no | partly/no | selector / repair hold | Same selector target, with stronger evidence because reserve is `64.204 ms` and concealment is only `20`. |
| `2026-05-05T14:53Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | selector / playout-ready | Treat tiny-reserve buffered-but-not-ready as the next primary bad-side target; align low-latency/recovery mode with `silent-lean` readiness. |
| `2026-05-05T14:53Z group-812` | B / Linux root | `steady-weak-listener` | no/partly | partly/no | selector | Add/tighten healthy-reserve weak-listener escape so this side can clear toward `clean-low-latency`. |

## Next Fix Target

Current patched target:
- Selector / playout-ready.
- Primary bad-side fix: make `silent-lean` plus `jitterBufferedFrames > 0` and `jitterHasReadyFrame=false` hold or enter the protective receive mode instead of falling back to low-latency with only `2.366 ms` reserve.
- Secondary selector fix: add a healthy-reserve escape from `steady-weak-listener` toward `clean-low-latency` when reserve is high, concealment/under-target pressure is low, and jitter has ready frames.
- Keep `collapse-recovery` strength and global baseline unchanged for the next patch.
