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

## Call: 2026-05-05 15:56Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T15-56-59-433Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T15-56-56-210Z.json`

User symptom:
- New paired call after the selector/playout-ready changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and non-clean profiles.

High-level verdict:
- Mixed/bad.
- Correctness paths remain clean, and both playout snapshots are now ready, but both sides still show under-target pressure, negative playout delta, and missing-frame growth. Mac is misclassified as `buffered-not-ready` after readiness has returned; Linux is plausibly weak but not clean.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Startup hidden playout: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Failover: root/cluster promotion counts are `0` on both sides.
- Collapse profile strength: neither side is in `collapse-recovery`.

Primary next target:
- Selector.
- First fix the `buffered-not-ready` clear/escape path: Mac exports `buffered-not-ready` even though `jitterHasReadyFrame=true`, reserve is `37.192 ms`, and the live mode has already fallen back to low-latency.
- Do not raise baseline yet. Linux’s `steady-weak-listener` classification is defensible, but Mac’s wrong ready-state profile means selector/hold cleanup should come before profile strength or baseline changes.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `buffered-not-ready` | yes | 37.192 | 729 | 72 | 0.105 | 0.081 | low-latency | Classification is wrong/partly: playout is ready with 5 buffered jitter frames, but the profile is still ready-failure shaped. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | partly | 48.970 | 431 | 26 | 0.063 | 0.028 | low-latency | Classification mostly matches a moderate weak-listener path: ready, buffered, but still under target with missing-frame growth. |

### Side A

Expected profile from symptom:
- `repair-heavy-connected` or `steady-weak-listener`

Actual exported profile:
- `buffered-not-ready`

Did classification match?
- Partly/no.

If no:
- `jitterHasReadyFrame=true`, `jitterBufferedFrames=5`, `avgPcmBufferedMs=37.192`, and `jitterBufferDepthFramesMean=1.885`, so this no longer fits a not-ready profile.
- The bad symptoms are real: `playoutUnderTargetFraction=0.105`, `playoutRateFractionBelow097=0.081`, `avgPlayoutDeltaMs=-96.983`, `missingFrames=729`, and `concealmentTicks=72`.
- Tune selector clear/hold priority so ready buffered damage moves to `steady-weak-listener` or `repair-heavy-connected`, not `buffered-not-ready`.

### Side B

Expected profile from symptom:
- `steady-weak-listener`, possibly bordering `repair-heavy-connected` if missing-frame pressure keeps growing.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Yes/partly.

Notes:
- `avgPcmBufferedMs=48.970`, `jitterHasReadyFrame=true`, and `concealmentTicks=26` keep this out of collapse or buffered-not-ready.
- `playoutUnderTargetFraction=0.063`, `avgPlayoutDeltaMs=-84.554`, `missingFrames=431`, and a brief `entered-recovery` trend justify a weak-listener profile.
- This side is not enough evidence for baseline tuning until the Mac selector error is fixed.

## Trend Read

Side A:
- Gradual weak/repair damage with a late low-latency exit despite continuing pressure.
- Reasons seen:
  - `missingFrames` increases from `607` to `729`.
  - `concealmentTicks` increases from `56` to `72`.
  - `playoutUnderTargetFraction` stays around `0.10`.
  - adaptive mode exits recovery to low-latency near the end while the exported profile remains `buffered-not-ready`.

Side B:
- Mostly steady weak-listener path with one brief recovery entry.
- Reasons seen:
  - `entered-recovery` appears once.
  - `missingFrames` increases from `333` to `431`.
  - `concealmentTicks` stays modest at `23` to `26`.
  - buffer gradually improves from about `45.9` to `49.0 ms`.

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
| `2026-05-05T15:56Z group-812` | A / Mac standby | `buffered-not-ready` | yes | partly/no | selector / readiness hold | Tune `buffered-not-ready` clear/escape when `jitterHasReadyFrame=true`; ready buffered damage should classify as weak/repair, not not-ready. |
| `2026-05-05T15:56Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | selector / weak-listener | Keep as evidence after Mac selector fix; do not tune baseline from this side alone. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: make `buffered-not-ready` clear immediately, or lose priority, once `jitterHasReadyFrame=true`; ready buffered damage should fall through to `steady-weak-listener` or `repair-heavy-connected`.
- Secondary watch item: after the Mac selector fix, decide whether `steady-weak-listener` needs more target/floor for the Linux-style moderate under-target path.
- Keep `collapse-recovery` strength and global baseline unchanged for the next patch.

## Call: 2026-05-05 16:48Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T16-48-33-310Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T16-48-31-124Z.json`

User symptom:
- New paired call after the latest selector/readiness changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, not-ready state, and non-clean profiles.

High-level verdict:
- Bad/mixed.
- Correctness paths remain clean, but classification is still not aligned with the exported symptoms: Mac is buffered-but-not-ready and shallow while classified as `steady-weak-listener`, and Linux is ready with many buffered jitter frames while classified as `collapse-recovery`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are low (`1`/`1` on Mac, `2`/`1` on Linux) with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Startup hidden playout nodes: both sides have active playback and scheduler nodes.

Primary next target:
- Selector / readiness priority.
- Mac is the clearest current target: `jitterBufferedFrames=9` with `jitterHasReadyFrame=false`, `avgPcmBufferedMs=11.997`, `avgPlayoutDeltaMs=-159.095`, and live mode `low-latency` should not export as ordinary `steady-weak-listener`.
- Linux does need protection because reserve is shallow, but `collapse-recovery` is probably too strong for `jitterHasReadyFrame=true`, `jitterBufferedFrames=22`, `concealmentTicks=36`, and modest rate pressure. It fits `persistent-lean` / `silent-lean` / weaker recovery better than a full collapse profile.
- Do not raise baseline or profile strength from this call. Per the template decision rules, classification is wrong/partly wrong on both sides, so selector/readiness logic comes first.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | yes | 11.997 | 493 | 12 | 0.024 | 0.005 | low-latency | Classification is too mild and misses the not-ready symptom: 9 jitter frames buffered, `jitterHasReadyFrame=false`, and very negative delta. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `collapse-recovery` | yes/partly | 12.416 | 500 | 36 | 0.040 | 0.021 | recovery | Classification is partly too strong: reserve is shallow, but the playout is ready with 22 jitter frames, low concealment, and modest rate pressure. |

### Side A

Expected profile from symptom:
- `buffered-not-ready` or `silent-lean`

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- No/partly.

If no:
- The side is clearly shallow and not ready: `avgPcmBufferedMs=11.997`, `jitterBufferDepthFramesMean=0.608`, `avgPlayoutDeltaMs=-159.095`, and the playout snapshot reports `jitterBufferedFrames=9` with `jitterHasReadyFrame=false`.
- Damage counters are real but not huge: `missingFrames=493`, `concealmentTicks=12`, `playoutUnderTargetFraction=0.024`, and `playoutRateFractionBelow097=0.005`.
- This should select a readiness/lean profile and drive protective mode, not stay in live `low-latency` as an ordinary weak listener.

### Side B

Expected profile from symptom:
- `persistent-lean` or `silent-lean`, possibly a lighter recovery profile.

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Partly/no.

If no:
- The shallow reserve is real: `avgPcmBufferedMs=12.416`, `jitterBufferDepthFramesMean=0.630`, `avgPlayoutDeltaMs=-113.001`, and `missingFrames=500`.
- But the collapse classification is too aggressive for `jitterHasReadyFrame=true`, `jitterBufferedFrames=22`, `concealmentTicks=36`, `playoutUnderTargetFraction=0.040`, and `playoutRateFractionBelow097=0.021`.
- This argues for selector priority/threshold cleanup before touching `collapse-recovery` strength or the global baseline.

## Trend Read

Side A:
- Gradual shallow/not-ready path with mode exiting recovery too early.
- Reasons seen:
  - `missingFrames` increases from `351` to `493`.
  - `concealmentTicks` only rises from `10` to `12`.
  - buffer slowly improves from about `11.1` to `12.0 ms` but remains shallow.
  - adaptive mode exits recovery to `low-latency` early and stays there even though the playout snapshot is not ready.

Side B:
- Oscillating mode over a shallow but ready path.
- Reasons seen:
  - `entered-recovery` appears three times.
  - adaptive mode flips between recovery and low-latency.
  - `missingFrames` increases from `360` to `500`.
  - `concealmentTicks` only rises from `30` to `36`, while the playout snapshot is ready with 22 buffered jitter frames.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T12:57Z group-812` | A / Mac standby | `persistent-lean` | yes | yes | receive policy strength | Keep as evidence, but do not tune first. |
| `2026-05-05T12:57Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector | Done: added stale severe-hold escape for ready buffered low-concealment paths. |
| `2026-05-05T13:13Z group-812` | A / Mac standby | `collapse-recovery` | yes | yes | receive policy strength | Done: raised `collapse-recovery` target/floor and collapse-only hold headroom. |
| `2026-05-05T13:13Z group-812` | B / Linux root | `collapse-recovery` | yes | partly/yes | receive policy strength | Done for strength; watch whether low-concealment shallow paths need a later selector split. |
| `2026-05-05T13:34Z group-812` | A / Mac standby | `collapse-recovery` | yes | partly/no | startup/playout-ready | Buffered-but-not-ready state still recurs in later calls; keep readiness selector as active target. |
| `2026-05-05T13:34Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | decode/session | Decode failures are gone in later calls; keep watching but do not tune from this old blocker now. |
| `2026-05-05T14:14Z group-812` | A / Mac standby | `repair-heavy-connected` | partly | partly | selector / repair hold | Keep as evidence for selector cleanup around healthy-buffer repair holds. |
| `2026-05-05T14:14Z group-812` | B / Linux root | `repair-heavy-connected` | partly/no | partly/no | selector / repair hold | Keep as evidence for healthy-reserve escapes from over-protective repair profiles. |
| `2026-05-05T14:53Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | selector / playout-ready | Recurring bad-side pattern; readiness/mode should align with `silent-lean` or buffered-not-ready protection. |
| `2026-05-05T14:53Z group-812` | B / Linux root | `steady-weak-listener` | no/partly | partly/no | selector | Keep as evidence for healthy-reserve weak-listener escape. |
| `2026-05-05T15:56Z group-812` | A / Mac standby | `buffered-not-ready` | yes | partly/no | selector / readiness hold | Prior target was clear/escape after readiness returns; the new call shows the opposite miss, so tune both entry and clear priority. |
| `2026-05-05T15:56Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | selector / weak-listener | Keep as evidence after Mac selector fix; do not tune baseline from this side alone. |
| `2026-05-05T16:48Z group-812` | A / Mac standby | `steady-weak-listener` | yes | no/partly | selector / readiness priority | Fix not-ready entry/priority: 9 buffered jitter frames with no ready frame should not remain ordinary weak-listener/low-latency. |
| `2026-05-05T16:48Z group-812` | B / Linux root | `collapse-recovery` | yes/partly | partly/no | selector / collapse priority | Add/tighten ready-buffered low-concealment escape from `collapse-recovery` into lean/weak recovery, not stronger collapse or baseline. |

## Next Fix Target

Current patched target:
- Selector / readiness priority.
- Primary fix: make `buffered-not-ready` / `silent-lean` entry win when `jitterHasReadyFrame=false` with buffered jitter frames and shallow reserve, even if damage counters are modest and live mode has fallen back to `low-latency`.
- Secondary fix: keep the ready-buffered escape from `collapse-recovery` strict enough that Linux-style `jitterHasReadyFrame=true`, many buffered frames, low concealment, and modest rate pressure lands in lean/weak recovery instead of full collapse.
- Keep global baseline and profile strength unchanged for the next patch; this batch is dominated by classification mismatches, not evidence that a correctly selected profile is too weak.

## Call: 2026-05-05 17:10Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T17-10-08-202Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T17-10-06-530Z.json`

User symptom:
- New paired call after the selector/readiness patch; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and exported profiles.

High-level verdict:
- Bad, but diagnostically useful.
- The previous 16:48Z selector misses improved: the not-ready side now lands in `buffered-not-ready`, and the ready-buffered side no longer lands in `collapse-recovery`. The remaining bad classification is Mac: it is catastrophically shallow and concealment-heavy, but only exported as `persistent-lean`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: Reticulum bridge/binary high-water values are low (`4`/`1` on Mac, `2`/`0` on Linux) with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Startup hidden playout nodes: both sides have active playback and scheduler nodes.

Primary next target:
- Selector.
- Specifically, make high-concealment tiny-reserve paths beat `persistent-lean`: Mac has `avgPcmBufferedMs=1.877`, `jitterBufferDepthFramesMean=0.095`, `avgPlayoutDeltaMs=-118.673`, and `concealmentTicks=1847`, which fits `repair-collapse` or `collapse-recovery`, not ordinary `persistent-lean`.
- Do not raise baseline yet. Linux’s current `buffered-not-ready` classification is correct for `jitterBufferedFrames=9` with `jitterHasReadyFrame=false`, and Mac is a wrong-profile problem before it is a profile-strength problem.
- Secondary watch item: Mac also shows a bursty ingress shape (`maxIncomingPacketMs=2196.115`, `maxReticulumAudioBridgeToRendererIngressMs=2074`), but there are no decode/key/queue drops, so fix selector escalation first.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | yes | 1.877 | 452 | 1847 | 0.028 | 0.027 | recovery | Classification is too weak: tiny reserve plus huge concealment should escalate to `repair-collapse` or `collapse-recovery`. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `buffered-not-ready` | yes | 27.560 | 1255 | 87 | 0.062 | 0.040 | recovery | Classification matches the not-ready buffered state: 9 jitter frames buffered, no ready frame, and ongoing under-target pressure. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`

Actual exported profile:
- `persistent-lean`

Did classification match?
- No.

If no:
- This is not just a quiet lean path. The side has `avgPcmBufferedMs=1.877`, `jitterBufferDepthFramesMean=0.095`, `avgPlayoutDeltaMs=-118.673`, and `concealmentTicks=1847`.
- `jitterHasReadyFrame=true` with `jitterBufferedFrames=19` means this is not the buffered-not-ready state from the previous call.
- The selector should let active concealment plus tiny reserve outrank `persistent-lean`; retune selector priority/entry before changing persistent-lean strength.

### Side B

Expected profile from symptom:
- `buffered-not-ready`

Actual exported profile:
- `buffered-not-ready`

Did classification match?
- Yes.

Notes:
- `jitterBufferedFrames=9` with `jitterHasReadyFrame=false` is the exact readiness failure shape targeted after 16:48Z.
- `avgPcmBufferedMs=27.560`, `avgPlayoutDeltaMs=-102.196`, `playoutUnderTargetFraction=0.062`, and `missingFrames=1255` support a protective profile.
- This side is evidence that the readiness selector fix moved in the right direction; the next patch should not weaken `buffered-not-ready`.

## Trend Read

Side A:
- Flat-bad collapse/repair path.
- Reasons seen:
  - `avgPcmBufferedMs` stays pinned around `1.88 ms`.
  - `concealmentTicks` climbs steadily from `1581` to `1847`.
  - `missingFrames` increases from `395` to `452`.
  - adaptive mode stays in recovery throughout, but the exported profile remains `persistent-lean`.

Side B:
- Oscillating mode over a not-ready buffered path.
- Reasons seen:
  - `entered-recovery` appears three times.
  - adaptive mode flips between low-latency and recovery.
  - `missingFrames` increases from `1100` to `1255`.
  - `jitterHasReadyFrame=false` with 9 buffered jitter frames supports `buffered-not-ready`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T12:57Z group-812` | A / Mac standby | `persistent-lean` | yes | yes | receive policy strength | Keep as evidence, but do not tune first. |
| `2026-05-05T12:57Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector | Done: added stale severe-hold escape for ready buffered low-concealment paths. |
| `2026-05-05T13:13Z group-812` | A / Mac standby | `collapse-recovery` | yes | yes | receive policy strength | Done: raised `collapse-recovery` target/floor and collapse-only hold headroom. |
| `2026-05-05T13:13Z group-812` | B / Linux root | `collapse-recovery` | yes | partly/yes | receive policy strength | Done for strength; watch whether low-concealment shallow paths need a later selector split. |
| `2026-05-05T13:34Z group-812` | A / Mac standby | `collapse-recovery` | yes | partly/no | startup/playout-ready | Buffered-but-not-ready state still recurs in later calls; keep readiness selector as active target. |
| `2026-05-05T13:34Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | decode/session | Decode failures are gone in later calls; keep watching but do not tune from this old blocker now. |
| `2026-05-05T14:14Z group-812` | A / Mac standby | `repair-heavy-connected` | partly | partly | selector / repair hold | Keep as evidence for selector cleanup around healthy-buffer repair holds. |
| `2026-05-05T14:14Z group-812` | B / Linux root | `repair-heavy-connected` | partly/no | partly/no | selector / repair hold | Keep as evidence for healthy-reserve escapes from over-protective repair profiles. |
| `2026-05-05T14:53Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | selector / playout-ready | Recurring bad-side pattern; readiness/mode should align with `silent-lean` or buffered-not-ready protection. |
| `2026-05-05T14:53Z group-812` | B / Linux root | `steady-weak-listener` | no/partly | partly/no | selector | Keep as evidence for healthy-reserve weak-listener escape. |
| `2026-05-05T15:56Z group-812` | A / Mac standby | `buffered-not-ready` | yes | partly/no | selector / readiness hold | Prior target was clear/escape after readiness returns; later calls show both entry and clear priority now improving. |
| `2026-05-05T15:56Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | selector / weak-listener | Keep as evidence; not enough for baseline tuning. |
| `2026-05-05T16:48Z group-812` | A / Mac standby | `steady-weak-listener` | yes | no/partly | selector / readiness priority | Improved in 17:10Z: the analogous not-ready buffered side now exports `buffered-not-ready`. |
| `2026-05-05T16:48Z group-812` | B / Linux root | `collapse-recovery` | yes/partly | partly/no | selector / collapse priority | Improved in 17:10Z: ready-buffered low-concealment no longer exports as `collapse-recovery`. |
| `2026-05-05T17:10Z group-812` | A / Mac standby | `persistent-lean` | yes | no | selector / repair escalation | Fix high-concealment tiny-reserve priority so this lands in `repair-collapse` or `collapse-recovery`. |
| `2026-05-05T17:10Z group-812` | B / Linux root | `buffered-not-ready` | yes | yes | selector / readiness | Keep current readiness selector; do not weaken `buffered-not-ready`. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: make active high concealment with near-empty reserve outrank `persistent-lean`, even when `jitterHasReadyFrame=true`; this should classify as `repair-collapse` or `collapse-recovery`.
- Keep `buffered-not-ready`, global baseline, and profile strength unchanged for the next patch.
- Watch the Mac ingress-burst metrics after classification is corrected; if the side still collapses under the correct heavy profile, then inspect transport/ingress pacing as a separate subsystem.

## Call: 2026-05-05 17:49Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T17-49-47-712Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T17-49-54-656Z.json`

User symptom:
- The call was left running for minutes, but neither side could hear the other.

High-level verdict:
- Catastrophic media-path/key-establishment failure.
- This call never reached receive-profile territory: both sides exported `packetsReceived=0`, `packetsDecoded=0`, no playouts, no jitter buffers, and no live policy profiles.

Not the problem:
- Receive selector/profile strength/baseline: no side received any audio to classify.
- Decode: `packetsDroppedDecodeFailure=0` on both sides because no inbound audio reached decode.
- Jitter/playout policy: no playout nodes or source profiles existed on either side.
- Linux sender capture: Linux had a running sender, `15195` encoded frames, `15195` send attempts, and `15195` send successes.

Primary next target:
- Another subsystem: room-key distribution / media-path establishment.
- Mac stayed `awaitingAuthoritativeKey=true`, `roomKeyPresent=false`, sender engine stopped, and outbound counters remained zero. It repeatedly requested the room key from Linux (`60` recent `room-key-requested` events) but never applied a key.
- Linux owned and minted the room key and sent thousands of encrypted packets to Mac, but the root diagnostics did not show `targeted-room-key-sent`; this points at root-side key distribution/encryption/recipient roster handling rather than receive policy.
- Fix applied after this review: preserve known non-empty participant public keys when hydrating/merging rosters and when building root key recipients, so a stale main roster with an empty public key cannot erase the usable key learned from participant events. Added `room-key-rotate-sent`, `room-key-distribution-skipped`, and `targeted-room-key-skipped` diagnostics.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` | none / no receive source | yes | 0 | 0 | 0 | 0 | 0 | low-latency | Sender was alive and sent `15195` frames to Mac; inbound audio stayed at zero. Root owned the key, but no key-send success was visible in diagnostics. |
| B | standby-forwarder / Mac / `QaU2XU...Jh91` | none / no receive source | yes | 0 | 0 | 0 | 0 | 0 | low-latency | No room key, no mic sender, no outbound packets, no inbound packets. It repeatedly requested the root key and stayed `awaitingAuthoritativeKey=true`. |

### Side A

Expected profile from symptom:
- No receive profile; media/key path did not establish.

Actual exported profile:
- None.

Did classification match?
- Yes, in the sense that absence of a profile matches the symptom better than any receive-profile classification.

If no:
- Not applicable. The failure happened before receive classification.

### Side B

Expected profile from symptom:
- No receive profile; waiting for authoritative key.

Actual exported profile:
- None.

Did classification match?
- Yes.

Notes:
- `pipelineMode.roomKeyPresent=false`, `awaitingAuthoritativeKey=true`, `senderEngine.hasMicStream=false`, `encodedFrameCallbacks=0`, and repeated `room-key-requested` events explain why Mac never sent or decoded audio.
- This is a correctness/path setup failure, not a weak listener.

## Trend Read

Side A:
- Flat zero-inbound with active outbound sender.
- Reasons seen:
  - `reticulumAudioPacketPathTimeouts=55`.
  - outbound packet sends continued, but inbound samples stayed `0`.
  - recent events were dominated by topology heartbeats.

Side B:
- Flat key-wait state.
- Reasons seen:
  - recent events were dominated by repeated `retained-key-replay-requested` and `room-key-requested`.
  - metrics were stale because no receive-engine updates occurred in the zero-media state.
  - no sender startup occurred because no room key was applied.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T16:48Z group-812` | A / Mac standby | `steady-weak-listener` | yes | no/partly | selector / readiness priority | Done: not-ready buffered state now promotes correctly. |
| `2026-05-05T16:48Z group-812` | B / Linux root | `collapse-recovery` | yes/partly | partly/no | selector / collapse priority | Done: ready-buffered low-concealment escape added. |
| `2026-05-05T17:10Z group-812` | A / Mac standby | `persistent-lean` | yes | no | selector / repair escalation | Done: near-empty high-concealment paths latch out of persistent lean. |
| `2026-05-05T17:10Z group-812` | B / Linux root | `buffered-not-ready` | yes | yes | selector / readiness | Keep current readiness selector. |
| `2026-05-05T17:49Z group-812` | A / Linux root | none / no receive source | yes | yes | key/media-path establishment | Done: preserve non-empty public keys during roster merge and root recipient selection; add key distribution diagnostics. |
| `2026-05-05T17:49Z group-812` | B / Mac standby | none / no receive source | yes | yes | key/media-path establishment | Done: same root key-distribution fix; next export should show `room-key-rotate-sent` or explicit skip reasons. |

## Next Fix Target

Current patched target:
- Room-key distribution / media-path establishment.
- This batch is not evidence for selector, profile strength, or baseline changes. The key symptom is that the standby never got an authoritative room key, so it never started sending and never decoded the root.
- The next diagnostic checkpoint is explicit: if this recurs, inspect the new `room-key-distribution-skipped`, `targeted-room-key-skipped`, and `room-key-rotate-sent` events before touching receive policy again.

## Call: 2026-05-05 18:11Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T18-11-27-779Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T18-11-31-300Z.json`

User symptom:
- The same no-audio symptom recurred after the key-distribution fix.

High-level verdict:
- Bad one-way media delivery, but not the same failure as 17:49Z.
- The key path recovered: Mac received and applied the root key, started its sender, and decoded Linux audio. Linux still received zero packets from Mac.

Not the problem:
- Room-key distribution: Linux logged `room-key-rotate-sent` twice and `targeted-room-key-sent` once; Mac logged `gcall-key-received` and `room-key-applied`.
- Mac sender startup: Mac had `1361` encoded frames, `1361` send attempts, and `1361` send successes.
- Linux sender startup: Linux had `1310` encoded frames, `1310` send attempts, and `1310` send successes.
- Decode/key mismatch on Linux: Linux had no pending-decrypt or decode drops because no Mac audio reached it at all.

Primary next target:
- Another subsystem: one-way Reticulum packet media delivery / recovery.
- Linux root had `packetsReceived=0`, no playouts, and no receive profiles while continuously sending to Mac.
- Mac standby had `packetsReceived=1379`, `packetsDecoded=1379`, `roomKeyPresent=true`, and a live sender, but Linux inbound packet samples stayed zero.
- Fix applied after this review: add an audio-surface zero-inbound watchdog. When connected with a room key and sustained outbound successes but zero inbound media, it calls `requestPeerMediaRecovery(roomId, peer, 'path-degraded-warm')`, which uses the existing main-process recovery path to warm the packet route and force link fallback for the peer.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` | none / no receive source | yes | 0 | 0 | 0 | 0 | 0 | low-latency | Sent successfully to Mac but received zero packets from Mac. No receive profile can activate without inbound media. |
| B | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `silent-lean` | yes/partly | 11.926 | 294 | 0 | 0.005 | 0 | low-latency | Key applied and audio decoded, but playout stayed shallow/not-ready: `jitterBufferedFrames=10`, `jitterHasReadyFrame=false`. |

### Side A

Expected profile from symptom:
- No receive profile; zero inbound packet delivery.

Actual exported profile:
- None.

Did classification match?
- Yes.

Notes:
- This side is the fix target. It needs media-path recovery before selector/profile tuning can matter.

### Side B

Expected profile from symptom:
- `silent-lean` / readiness protection.

Actual exported profile:
- `silent-lean`

Did classification match?
- Yes/partly.

Notes:
- The classification is plausible for shallow, not-ready playout with low visible damage counters.
- This side is not the immediate fix target because it proved the key path and root-to-standby media path were alive.

## Trend Read

Side A:
- Flat zero-inbound while outbound succeeded.
- Reasons seen:
  - `reticulumAudioOutboundPacketSamples` rose from `710` to `1267`.
  - `reticulumAudioInboundPacketSamples` stayed `0`.
  - `packetsReceived`, `packetsDecoded`, playouts, and profiles stayed `0` / empty.

Side B:
- One-way receive with shallow/not-ready playout.
- Reasons seen:
  - `packetsReceived=1379`, `packetsDecoded=1379`.
  - `missingFrames` rose from `174` to `294`.
  - `jitterHasReadyFrame=false` with 10 buffered jitter frames.
  - outbound packet samples rose, but Linux still saw no inbound media.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T17:49Z group-812` | A / Linux root | none / no receive source | yes | yes | key/media-path establishment | Improved in 18:11Z: key rotate and targeted key send succeeded. |
| `2026-05-05T17:49Z group-812` | B / Mac standby | none / no receive source | yes | yes | key/media-path establishment | Improved in 18:11Z: key was received/applied and sender started. |
| `2026-05-05T18:11Z group-812` | A / Linux root | none / no receive source | yes | yes | one-way packet media delivery | Done: add zero-inbound media watchdog to request `path-degraded-warm` / link fallback. |
| `2026-05-05T18:11Z group-812` | B / Mac standby | `silent-lean` | yes/partly | yes/partly | readiness / secondary | Watch after one-way media fix; do not tune selector first from this side. |

## Next Fix Target

Current patched target:
- One-way Reticulum packet media delivery recovery.
- The next export should show `zero-inbound-media-recovery-requested` on any side that is sending successfully but has no inbound media. If the fallback works, the main-process send diagnostics should move from packet-only toward link fallback for that peer.
- Do not change baseline or receive profile strength from this call; Linux had no receive source, and Mac’s `silent-lean` classification was not the primary blocker.

## Call: 2026-05-05 18:28Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T18-28-17-213Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T18-28-21-202Z.json`

User symptom:
- New paired call after the zero-inbound media recovery change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, not-ready state, and exported profiles.

High-level verdict:
- Bad/mixed, but improved versus 18:11Z.
- The media path is now alive in both directions: both sides received and decoded packets. The remaining failure is receive-policy application, especially on Mac, where the exported profile correctly says `repair-collapse` but live playout has fallen back to `low-latency` while reserve is almost empty.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have inbound packets and decoded frames, unlike the 17:49Z and 18:11Z failures.
- Queue/backpressure: Reticulum bridge/binary high-water values are low enough and there are no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Baseline: this is not broad evidence that every clean call needs a larger target; one side is correctly in a heavy collapse profile and the other is a shallow weak-listener path.

Primary next target:
- Another subsystem: profile-to-playout/adaptive-mode application.
- Mac is correctly classified as `repair-collapse` (`avgPcmBufferedMs=1.339`, `jitterBufferDepthFramesMean=0.068`, `missingFrames=1478`, `concealmentTicks=339`), but `adaptiveNetworkMode` and `lastJitterAdaptiveMode` are both `low-latency`, and the trend exits recovery exactly as missing frames spike.
- Do not tune selector first: the worst side selected the right family. Do not raise baseline first: the bad side is already in a heavy profile. The next fix should make `repair-collapse` hold/apply recovery-mode playout protection until reserve and readiness actually recover.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | partly | 16.605 | 170 | 82 | 0.032 | 0.026 | low-latency | Classification is acceptable/partly mild for a ready but shallow weak-listener path. |
| B | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `repair-collapse` | yes | 1.339 | 1478 | 339 | 0.039 | 0.038 | low-latency | Classification matches severe repair collapse, but the selected protection is not reflected in live playout mode. |

### Side A

Expected profile from symptom:
- `steady-weak-listener` or `persistent-lean`

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly/yes.

Notes:
- `avgPcmBufferedMs=16.605`, `jitterBufferDepthFramesMean=0.843`, `avgPlayoutDeltaMs=-106.123`, and `concealmentTicks=82` are not clean.
- `jitterHasReadyFrame=true` with `jitterBufferedFrames=12`, low decode/key errors, and modest rate pressure keep this out of `buffered-not-ready` or full collapse.
- This side is secondary evidence that weak/lean paths may still be too close to low-latency, but it is not the first fix target while Mac has a correctly classified heavy profile that is not being applied.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`

Actual exported profile:
- `repair-collapse`

Did classification match?
- Yes.

Notes:
- The side is nearly empty and repair-heavy: `avgPcmBufferedMs=1.339`, `jitterBufferDepthFramesMean=0.068`, `avgPlayoutDeltaMs=-137.913`, `missingFrames=1478`, and `concealmentTicks=339`.
- The playout snapshot also reports `jitterBufferedFrames=10` with `jitterHasReadyFrame=false`, so readiness is still bad.
- The mismatch is not profile classification; it is that `repair-collapse` ended the export with `adaptiveNetworkMode=low-latency` / `lastJitterAdaptiveMode=low-latency`.

## Trend Read

Side A:
- Gradual weak-listener path with shallow but ready playout.
- Reasons seen:
  - `missingFrames` increases from `135` to `170`.
  - `concealmentTicks` stays flat at `82`.
  - buffer improves slightly from about `16.1` to `16.6 ms`.
  - playout remains ready and low-latency throughout.

Side B:
- Discrete late collapse while recovery exits too early.
- Reasons seen:
  - adaptive mode stays in recovery early, then switches to `low-latency` near the end.
  - `missingFrames` jumps from `271` to `1478` after the low-latency exit.
  - `concealmentTicks` rises early from `313` to `339`, then stays flat while missing frames explode.
  - buffer remains near-empty, only moving from about `0.6` to `1.3 ms`, and the final playout snapshot is not ready.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T17:49Z group-812` | A / Linux root | none / no receive source | yes | yes | key/media-path establishment | Improved by 18:11Z: key rotate and targeted key send succeeded. |
| `2026-05-05T17:49Z group-812` | B / Mac standby | none / no receive source | yes | yes | key/media-path establishment | Improved by 18:11Z: key was received/applied and sender started. |
| `2026-05-05T18:11Z group-812` | A / Linux root | none / no receive source | yes | yes | one-way packet media delivery | Improved by 18:28Z: Linux now receives and decodes Mac audio. |
| `2026-05-05T18:11Z group-812` | B / Mac standby | `silent-lean` | yes/partly | yes/partly | readiness / secondary | Still relevant: Mac remains shallow/not-ready, but now classifies heavier as `repair-collapse`. |
| `2026-05-05T18:28Z group-812` | A / Linux root | `steady-weak-listener` | partly | partly/yes | weak-listener / secondary | Watch after the Mac application fix; not enough to justify baseline tuning. |
| `2026-05-05T18:28Z group-812` | B / Mac standby | `repair-collapse` | yes | yes | profile application / adaptive-mode sync | Fix `repair-collapse` application/hold so recovery-mode playout remains active until reserve/readiness recover. |

## Next Fix Target

Current patched target:
- Profile application / adaptive-mode synchronization.
- Primary fix: when the live source profile is `repair-collapse`, keep the jitter/playout adaptive mode in recovery protection and prevent a low-latency exit while reserve is near empty or `jitterHasReadyFrame=false`.
- Secondary watch item: Linux’s `steady-weak-listener` path is still shallow, but classification is not obviously wrong. Revisit weak-listener target/floor only after the heavy-profile application mismatch is fixed.
- Keep selector thresholds, global baseline, and profile target strength unchanged for the next patch unless code inspection shows that the only way to enforce the recovery hold is inside the `repair-collapse` profile configuration itself.

## Call: 2026-05-05 20:21Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T20-21-01-644Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T20-20-58-248Z.json`

User symptom:
- New paired call after the profile application / adaptive-mode synchronization change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and heavy recovery profiles.

High-level verdict:
- Bad, but improved diagnostically.
- The previous profile-to-playout mismatch is no longer the primary failure: both sides export `repair-collapse`, both playout snapshots are active and ready, and both `adaptiveNetworkMode` / `lastJitterAdaptiveMode` are `recovery`. The remaining problem is that recovery protection is not rebuilding enough reserve, especially on Linux.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have inbound packets, decoded frames, playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Failover: root/cluster promotion counts are `0` on both sides.
- Selector/profile application: classification is plausible on both sides, and recovery mode is now actually applied.

Primary next target:
- `repair-collapse` profile strength.
- Per the decision rules, classification is correct and the heavy profile is active, but immediate quality is still bad: Mac stays around `2 ms` buffered with `371` concealment ticks, and Linux stays around `6.7 ms` buffered with `0.172` under-target and `0.161` rate-below-0.97.
- Do not tune selector first from this call. Do not raise global baseline first. The failure is concentrated in a correctly selected heavy profile that is now being applied but is still too weak to rebuild reserve.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `repair-collapse` | yes | 1.998 | 144 | 371 | 0.011 | 0.011 | recovery | Classification matches near-empty repair collapse; recovery is applied, but reserve remains pinned around `2 ms`. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `repair-collapse` | yes | 6.652 | 25 | 255 | 0.172 | 0.161 | recovery | Classification matches shallow reserve plus high concealment/under-target pressure; profile strength is not enough to stabilize playout. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`

Actual exported profile:
- `repair-collapse`

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs=1.998`, `jitterBufferDepthFramesMean=0.101`, `avgPlayoutDeltaMs=-118.715`, and `concealmentTicks=371` fit the repair-collapse shape.
- `jitterHasReadyFrame=true` with `jitterBufferedFrames=21` means this is not the previous buffered-not-ready selector/application problem.
- `adaptiveNetworkMode=recovery` and `lastJitterAdaptiveMode=recovery` show the profile is reaching playout mode; the remaining miss is insufficient reserve rebuilding.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`

Actual exported profile:
- `repair-collapse`

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs=6.652`, `jitterBufferDepthFramesMean=0.338`, `avgPlayoutDeltaMs=-126.306`, `concealmentTicks=255`, `playoutUnderTargetFraction=0.172`, and `playoutRateFractionBelow097=0.161` are a strong shallow repair-collapse signature.
- `missingFrames=25` is low, but WASM PLC is doing work (`wasmFecPlcFrames=95`) and concealment/under-target pressure are high, so a heavy recovery profile is justified.
- This side is the clearest evidence for strengthening `repair-collapse` target/floor behavior.

## Trend Read

Side A:
- Flat-bad repair-collapse path.
- Reasons seen:
  - `avgPcmBufferedMs` stays pinned around `2.0 ms`.
  - `concealmentTicks` climbs steadily from `283` to `371`.
  - `missingFrames` increases from `109` to `144`.
  - adaptive mode remains `recovery` throughout, so the issue is not a low-latency exit.

Side B:
- Gradual collapse/repair degradation under active recovery.
- Reasons seen:
  - `avgPcmBufferedMs` falls from about `7.5` to `5.6 ms`, then ends at `6.652 ms`.
  - `concealmentTicks` increases from `176` to `255`.
  - `playoutUnderTargetFraction` stays high around `0.17`.
  - `playoutRateFractionBelow097` stays high around `0.16`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T17:49Z group-812` | A / Linux root | none / no receive source | yes | yes | key/media-path establishment | Improved by 18:11Z: key rotate and targeted key send succeeded. |
| `2026-05-05T17:49Z group-812` | B / Mac standby | none / no receive source | yes | yes | key/media-path establishment | Improved by 18:11Z: key was received/applied and sender started. |
| `2026-05-05T18:11Z group-812` | A / Linux root | none / no receive source | yes | yes | one-way packet media delivery | Improved by 18:28Z: Linux now receives and decodes Mac audio. |
| `2026-05-05T18:11Z group-812` | B / Mac standby | `silent-lean` | yes/partly | yes/partly | readiness / secondary | Still relevant historically, but the new call has ready playouts on both sides. |
| `2026-05-05T18:28Z group-812` | A / Linux root | `steady-weak-listener` | partly | partly/yes | weak-listener / secondary | Superseded by 20:21Z as the primary target; Linux now correctly classifies as heavy recovery. |
| `2026-05-05T18:28Z group-812` | B / Mac standby | `repair-collapse` | yes | yes | profile application / adaptive-mode sync | Improved by 20:21Z: recovery mode now stays applied when `repair-collapse` is selected. |
| `2026-05-05T20:21Z group-812` | A / Mac standby | `repair-collapse` | yes | yes | profile strength | Tune `repair-collapse` target/floor so near-empty ready playout can rebuild above the collapse band. |
| `2026-05-05T20:21Z group-812` | B / Linux root | `repair-collapse` | yes | yes | profile strength | Same target, stronger evidence because under-target and slow-rate fractions remain high under active recovery. |

## Next Fix Target

Current patched target:
- `repair-collapse` profile strength.
- Primary fix: increase `repair-collapse` target/floor behavior, or its recovery reserve headroom, so a correctly selected and applied profile can rebuild from the `2 ms` to `7 ms` collapse band instead of staying near empty.
- Keep selector thresholds unchanged from this batch: both sides classified correctly.
- Keep global baseline unchanged for the next patch: the evidence is profile-specific, not a broad clean-call baseline problem.

## Call: 2026-05-05 20:47Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T20-47-21-373Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T20-47-18-388Z.json`

User symptom:
- New paired call after the `repair-collapse` strength change; user reported the call was horrible.
- Clarification after initial review: Linux could almost hear nothing from the Mac side, while Mac hearing Linux was much better.

High-level verdict:
- Bad one-way/asymmetric media quality, with Mac-to-Linux delivery/sender targeting now the primary suspect.
- Both sides export `repair-collapse` and both playouts are active/ready in recovery mode, but the user symptom is asymmetric: Linux barely hears Mac, while Mac hears Linux much better. That matches the packet imbalance better than generic profile strength: Linux received only `678` packets from Mac, while Mac received `3395` from Linux, and Mac had `571` outbound no-target skips.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Key/media establishment: both sides have inbound packets, decoded frames, playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Failover: root/cluster promotion counts are `0` on both sides.
- Global baseline: Mac hearing Linux was much better and Mac is already heavily buffered, so a larger baseline would not explain the asymmetric symptom.

Primary next target:
- Another subsystem: Mac-to-Linux media send/targeting path, with decode/session diagnostics as a secondary check.
- The best symptom match is not Mac’s large decode-failure counter, because Mac sounded much better despite `packetsDroppedDecodeFailure=776`. The worse side is Linux receiving Mac: only `678` packets received, `avgPcmBufferedMs=15.730`, `concealmentTicks=293`, `playoutUnderTargetFraction=0.271`, and `playoutRateFractionBelow097=0.253`.
- Investigate why Mac skipped `571` outbound frames for no target and why Linux received so much less media from Mac than Mac received from Linux. Keep decode-failure instrumentation too, but do not make decode alone the next target from this clarified symptom.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `repair-collapse` | partly/no | 67.017 | 567 | 44 | 0.050 | 0.042 | recovery | User said this direction was much better; classification is too severe for a healthy-buffer, ready playout. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `repair-collapse` | yes | 15.730 | 35 | 293 | 0.271 | 0.253 | recovery | Classification matches the bad direction: Linux barely hears Mac, with shallow reserve and heavy under-target/rate pressure. |

### Side A

Expected profile from symptom:
- `clean-low-latency` or at most `repair-heavy-connected`.

Actual exported profile:
- `repair-collapse`

Did classification match?
- No.

If no:
- `avgPcmBufferedMs=67.017`, `jitterBufferDepthFramesMean=3.390`, `jitterBufferedFrames=23`, and `jitterHasReadyFrame=true` do not fit a reserve-collapse profile.
- The clarified symptom says this direction was much better, even with `packetsDroppedDecodeFailure=776`.
- Treat this as evidence that decode failures need instrumentation, but not as the main audible blocker for this call. The profile selector is too pessimistic for Mac’s current receive state.

### Side B

Expected profile from symptom:
- `repair-collapse`

Actual exported profile:
- `repair-collapse`

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs=15.730`, `jitterBufferDepthFramesMean=0.798`, `avgPlayoutDeltaMs=-125.936`, `concealmentTicks=293`, `playoutUnderTargetFraction=0.271`, and `playoutRateFractionBelow097=0.253` fit a horrible repair-collapse call.
- Linux only received `678` packets from Mac, while Mac received `3395` from Linux. That asymmetry matches “Linux almost heard nothing” better than a pure receive-profile strength failure.
- `packetsDroppedDecodeFailure=66` may contribute, but it is smaller than Mac’s decode-failure count despite Linux being the much worse listener.

## Trend Read

Side A:
- Better audible direction with over-severe receive classification and decode failures flat across the sampled window.
- Reasons seen:
  - `packetsDroppedDecodeFailure` is `776` in every trend sample.
  - `missingFrames` increases from `385` to `567`.
  - `avgPcmBufferedMs` stays healthy around `67` to `69 ms`.
  - `entered-recovery` appears once and adaptive mode remains `recovery`.

Side B:
- Flat-bad Mac-to-Linux receive path under active recovery.
- Reasons seen:
  - `packetsDroppedDecodeFailure` is `66` in every trend sample.
  - `concealmentTicks` increases from `257` to `293`.
  - `playoutUnderTargetFraction` remains very high around `0.27` to `0.30`.
  - `playoutRateFractionBelow097` remains very high around `0.25` to `0.28`.
  - Linux received far fewer packets than Mac did in the opposite direction.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T18:28Z group-812` | A / Linux root | `steady-weak-listener` | partly | partly/yes | weak-listener / secondary | Superseded by later calls; not the current blocker. |
| `2026-05-05T18:28Z group-812` | B / Mac standby | `repair-collapse` | yes | yes | profile application / adaptive-mode sync | Improved by 20:21Z: recovery mode stayed applied. |
| `2026-05-05T20:21Z group-812` | A / Mac standby | `repair-collapse` | yes | yes | profile strength | Done: raised `repair-collapse` target/floor and allowed collapse-level extra hold. |
| `2026-05-05T20:21Z group-812` | B / Linux root | `repair-collapse` | yes | yes | profile strength | Done: same `repair-collapse` strength patch. |
| `2026-05-05T20:47Z group-812` | A / Mac standby | `repair-collapse` | partly/no | no | selector / secondary decode diagnostics | Mac heard Linux much better; do not use this side to justify more collapse strength. |
| `2026-05-05T20:47Z group-812` | B / Linux root | `repair-collapse` | yes | yes | Mac-to-Linux media delivery / sender targeting | Investigate Mac outbound no-target skips and the packet imbalance before more receive-profile tuning. |

## Next Fix Target

Current patched target:
- Mac-to-Linux media delivery / sender targeting.
- Primary fix: instrument and fix why Mac skipped `571` outbound frames for no target and why Linux received only `678` packets while Mac received `3395`. Capture recipient roster/target availability, selected transport, path warm/fallback state, and per-peer send eligibility at each no-target skip.
- Secondary diagnostics: keep decode/session instrumentation because both sides report decode failures, but the clarified audible symptom says decode count alone is not the primary selector for this batch.
- Keep `repair-collapse` strength and global baseline unchanged for the next patch. Linux’s bad receive profile matches the symptom, but the larger asymmetry points upstream of receive policy.

## Call: 2026-05-05 21:27Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-05T21-27-34-330Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-05T21-27-31-309Z.json`

User symptom:
- New paired call after the media sender/targeting diagnostics change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and correctness counters.

High-level verdict:
- Mixed, and improved versus 20:47Z.
- Both sides now have room keys, live senders, inbound packets, decoded frames, active playouts, ready jitter frames, and low-latency playout mode. The previous catastrophic Mac-to-Linux imbalance is reduced, but Mac now has a hard decode correctness signal while Linux still looks like a moderate weak-listener path.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Key/media establishment: both sides have `roomKeyPresent=true`, live mic senders, inbound packets, decoded frames, playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`3`/`3` on Mac, `2`/`1` on Linux), with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Global baseline: Mac has a healthy `69.597 ms` receive reserve, so this is not a broad low baseline problem.

Primary next target:
- Another subsystem: decode/session correctness first, then continue watching Mac-to-Linux media delivery.
- Mac exports `packetsDroppedDecodeFailure=241` while still classifying the receive source as `clean-low-latency`. Per the triage rules, decode failures are a correctness/path signal and should be explained before selector, profile strength, or baseline tuning.
- Linux's `steady-weak-listener` classification mostly matches its metrics (`avgPcmBufferedMs=33.369`, `concealmentTicks=212`, `playoutUnderTargetFraction=0.083`, `playoutRateFractionBelow097=0.071`), but it is not enough by itself to justify baseline or profile-strength changes while a decode failure is present on the paired side.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `clean-low-latency` | partly/unknown | 69.597 | 341 | 0 | 0.024 | 0.000 | low-latency | Reserve/playout profile looks clean, but `packetsDroppedDecodeFailure=241` is a correctness blocker that the receive profile does not represent. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | partly | 33.369 | 339 | 212 | 0.083 | 0.071 | low-latency | Classification matches a moderate weak-listener/repair path; not collapse, not startup, and decode is clean on this side. |

### Side A

Expected profile from symptom:
- `clean-low-latency` by receive reserve/playout metrics, but no receive profile can account for the decode failures.

Actual exported profile:
- `clean-low-latency`

Did classification match?
- Partly/unknown.

If no:
- The profile matches the healthy live receive metrics: `avgPcmBufferedMs=69.597`, `jitterBufferDepthFramesMean=3.547`, `jitterHasReadyFrame=true`, `concealmentTicks=0`, and `playoutRateFractionBelow097=0`.
- It does not match the correctness signal: `packetsDroppedDecodeFailure=241` and `packetsDropped=241`.
- Do not tune `clean-low-latency`; inspect decode/session/FEC failure causes and keep the new decode diagnostics active.

### Side B

Expected profile from symptom:
- `steady-weak-listener`

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Yes/partly.

Notes:
- `avgPcmBufferedMs=33.369`, `jitterBufferDepthFramesMean=1.694`, `avgPlayoutDeltaMs=-100.605`, `concealmentTicks=212`, `playoutUnderTargetFraction=0.083`, and `playoutRateFractionBelow097=0.071` fit an understandable-but-not-clean weak listener.
- This is not a collapse profile: playout is ready with `jitterBufferedFrames=12`, reserve is not near empty, and decode/key counters are clean.
- Revisit weak-listener target/floor only after decode correctness is clean in a paired call.

## Trend Read

Side A:
- Flat healthy-buffer receive path with a persistent decode-failure correctness counter.
- Reasons seen:
  - `packetsDroppedDecodeFailure` is `241` in every trend sample.
  - `avgPcmBufferedMs` stays around `69.5` to `69.7 ms`.
  - `concealmentTicks` stays `0`.
  - `missingFrames` grows mildly from `303` to `341`.

Side B:
- Gradual moderate weak-listener path.
- Reasons seen:
  - `missingFrames` grows from `292` to `339`.
  - `concealmentTicks` stays flat at `212`.
  - `playoutUnderTargetFraction` improves slightly from `0.092` to `0.083`.
  - `playoutRateFractionBelow097` improves from `0.081` to `0.071`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T20:21Z group-812` | A / Mac standby | `repair-collapse` | yes | yes | profile strength | Done: raised `repair-collapse` target/floor and allowed collapse-level extra hold. |
| `2026-05-05T20:21Z group-812` | B / Linux root | `repair-collapse` | yes | yes | profile strength | Done: same `repair-collapse` strength patch. |
| `2026-05-05T20:47Z group-812` | A / Mac standby | `repair-collapse` | partly/no | no | selector / secondary decode diagnostics | Improved in 21:27Z: Mac now has healthy reserve and `clean-low-latency`, but decode failures still need investigation. |
| `2026-05-05T20:47Z group-812` | B / Linux root | `repair-collapse` | yes | yes | Mac-to-Linux media delivery / sender targeting | Improved in 21:27Z: Linux now receives `3512` packets, but remains `steady-weak-listener`. |
| `2026-05-05T21:27Z group-812` | A / Mac standby | `clean-low-latency` | partly/unknown | partly/unknown | decode/session correctness | Investigate `packetsDroppedDecodeFailure=241`; do not tune receive profiles from this side. |
| `2026-05-05T21:27Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Keep as evidence, but wait for a decode-clean paired call before tuning weak-listener strength or baseline. |

## Next Fix Target

Current patched target:
- Decode/session correctness.
- Primary fix: explain and instrument the Mac-side `packetsDroppedDecodeFailure=241` path in a call where reserve/playout otherwise look clean. This is the strongest template triage signal in the new export.
- Secondary watch item: Linux still has a valid `steady-weak-listener` receive profile with moderate under-target and concealment pressure. If the next decode-clean call still sounds weak in this shape, tune `steady-weak-listener` target/floor or application hold.
- Do not change selector, `repair-collapse` strength, or global baseline from this batch. Classification is mostly aligned on Linux, Mac's receive profile is not the audible policy problem, and the remaining hard signal is outside receive policy.

## Call: 2026-05-06 11:56Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T11-56-34-277Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T11-56-30-808Z.json`

User symptom:
- New paired call after the decode/session diagnostics change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and profile mismatch.

High-level verdict:
- Mixed/bad, but improved versus the previous decode-blocked batch.
- Decode correctness is clean again on both sides, both media paths are alive, and both playouts are active/ready. The remaining issue is receive classification: Linux exports `clean-low-latency` despite moderate under-target/missing-frame pressure, while Mac exports only `persistent-lean` despite a shallow, concealment-heavy path.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`1`/`2` on Mac, `7`/`2` on Linux), with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Selector.
- Linux should not remain `clean-low-latency` with `missingFrames=608`, `concealmentTicks=83`, `playoutUnderTargetFraction=0.077`, `playoutRateFractionBelow097=0.053`, and `avgPlayoutDeltaMs=-92.208`.
- Mac's `persistent-lean` classification is directionally right for shallow reserve, but likely too mild for `avgPcmBufferedMs=9.650`, `concealmentTicks=286`, `missingFrames=462`, and `avgPlayoutDeltaMs=-122.162`; this should be allowed to escalate toward a repair profile when concealment is active.
- Do not tune baseline first: both sides are not clean, but the exported profiles do not yet match the symptoms. Do not tune profile strength first: at least one side is not entering a protective profile at all.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | yes | 9.650 | 462 | 286 | 0.052 | 0.046 | low-latency | Classification partly matches shallow reserve, but is too mild for active concealment and a strongly negative delta. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `clean-low-latency` | partly/yes | 42.823 | 608 | 83 | 0.077 | 0.053 | low-latency | Classification is too optimistic: reserve is usable, but under-target, rate, missing-frame, and concealment pressure are not clean. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `repair-heavy-connected`, with `persistent-lean` as the weaker fallback.

Actual exported profile:
- `persistent-lean`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs=9.650`, `jitterBufferDepthFramesMean=0.489`, and `avgPlayoutDeltaMs=-122.162` match a persistent shallow-listener shape.
- But `concealmentTicks=286`, `missingFrames=462`, `playoutUnderTargetFraction=0.052`, and `playoutRateFractionBelow097=0.046` make this more repair-heavy than ordinary lean.
- Retune selector escalation from `persistent-lean` when shallow reserve and active concealment coexist; do not only raise the persistent-lean target yet.

### Side B

Expected profile from symptom:
- `steady-weak-listener` or `repair-heavy-connected`.

Actual exported profile:
- `clean-low-latency`

Did classification match?
- No/partly.

If no:
- `avgPcmBufferedMs=42.823`, `jitterBufferDepthFramesMean=2.170`, `jitterBufferedFrames=9`, and `jitterHasReadyFrame=true` explain why this avoided collapse/not-ready profiles.
- But the side is not clean: `missingFrames=608`, `concealmentTicks=83`, `playoutUnderTargetFraction=0.077`, `playoutRateFractionBelow097=0.053`, and `avgPlayoutDeltaMs=-92.208`.
- Tighten the clean escape/clear conditions so ready buffered paths with sustained damage land in `steady-weak-listener` or `repair-heavy-connected`.

## Trend Read

Side A:
- Gradual shallow repair/lean path with early recovery exit.
- Reasons seen:
  - `avgPcmBufferedMs` improves only from about `7.5` to `9.65 ms`, still shallow.
  - `missingFrames` increases from `332` to `462`.
  - `concealmentTicks` stays high at `286`.
  - adaptive mode exits `recovery` to `low-latency` halfway through while the profile remains `persistent-lean`.

Side B:
- Gradual moderate weak/repair pressure with early recovery exit.
- Reasons seen:
  - `avgPcmBufferedMs` improves from about `39.7` to `42.8 ms`.
  - `missingFrames` increases from `507` to `608`.
  - `concealmentTicks` stays at `83`.
  - adaptive mode exits `recovery` to `low-latency` while under-target and rate-below-0.97 pressure remain elevated.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T20:47Z group-812` | A / Mac standby | `repair-collapse` | partly/no | no | selector / secondary decode diagnostics | Improved by 21:27Z and 11:56Z: Mac receive reserve recovered from the over-severe collapse classification, and decode failures are gone. |
| `2026-05-05T20:47Z group-812` | B / Linux root | `repair-collapse` | yes | yes | Mac-to-Linux media delivery / sender targeting | Improved by 21:27Z and 11:56Z: Linux now receives thousands of packets, but classification is now too optimistic. |
| `2026-05-05T21:27Z group-812` | A / Mac standby | `clean-low-latency` | partly/unknown | partly/unknown | decode/session correctness | Improved in 11:56Z: decode failures are now `0`, so decode/session is no longer the next target. |
| `2026-05-05T21:27Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Still relevant, but 11:56Z regressed to `clean-low-latency` under similar moderate pressure. |
| `2026-05-06T11:56Z group-812` | A / Mac standby | `persistent-lean` | yes | partly/no | selector / repair escalation | Escalate shallow active-concealment paths out of ordinary `persistent-lean` toward repair-heavy/collapse protection. |
| `2026-05-06T11:56Z group-812` | B / Linux root | `clean-low-latency` | partly/yes | no/partly | selector / clean escape | Tighten clean-low-latency clear/entry so sustained missing-frame, concealment, under-target, and slow-rate pressure cannot remain clean. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: make sustained damage counters and under-target/rate pressure disqualify `clean-low-latency`, even when the ready buffer is not collapsed.
- Secondary fix: let `persistent-lean` escalate when shallow reserve is accompanied by meaningful concealment and missing-frame growth.
- Keep decode/session, media-path, global baseline, and heavy-profile strength unchanged for the next patch. This export is clean on correctness and media establishment; the active failure is that profile classification is too mild for the symptoms.

## Call: 2026-05-06 12:19Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T12-19-09-566Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T12-19-06-336Z.json`

User symptom:
- New paired call after the sustained-damage selector change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, packet imbalance, and exported profiles.

High-level verdict:
- Bad/mixed, but selector classification improved versus 11:56Z.
- The previous selector miss is mostly gone: Mac now exports `steady-weak-listener` instead of a clean/misleading profile, and Linux exports `collapse-recovery` for a truly shallow/not-ready path. The remaining blocker is asymmetric media delivery into Linux: Linux received only `330` packets from Mac while Mac received `2060` packets from Linux.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment in the broad sense: both sides have inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes.
- Queue/backpressure: bridge/binary high-water values are low (`2`/`1` on Mac, `7`/`0` on Linux), with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides, although Mac trend advances from topology epoch `3` to `4` at the end.

Primary next target:
- Another subsystem: Mac-to-Linux media delivery / packet-route reliability.
- Linux classification is correct and recovery is applied, but it is starving on very little inbound media: `packetsReceived=330`, `avgPcmBufferedMs=4.771`, `jitterHasReadyFrame=false`, `concealmentTicks=239`, `playoutUnderTargetFraction=0.145`, and `playoutRateFractionBelow097=0.136`.
- Mac sent successfully with `outboundSendFailures=0` and `outboundNoTargetSkips=0`, yet Linux received far fewer packets than Mac received in the opposite direction. That points upstream of receive profile strength.
- Do not tune baseline from this call. Do not raise `collapse-recovery` strength first; the bad side has an upstream delivery imbalance and not-ready playout.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | partly | 32.155 | 309 | 3 | 0.015 | 0.003 | low-latency | Classification is acceptable: ready playout, moderate reserve, sustained missing-frame growth, but low concealment/under-target pressure. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `collapse-recovery` | yes | 4.771 | 38 | 239 | 0.145 | 0.136 | recovery | Classification matches severe collapse/not-ready symptoms, but the packet imbalance points upstream of profile tuning. |

### Side A

Expected profile from symptom:
- `steady-weak-listener`

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Yes/partly.

Notes:
- This side matches the new selector intent: `missingFrames=309` prevents a clean profile, while `avgPcmBufferedMs=32.155`, `jitterHasReadyFrame=true`, `concealmentTicks=3`, and `playoutRateFractionBelow097=0.003` keep it out of heavy repair/collapse.
- It is not clean, but it is not the primary blocker in this call.

### Side B

Expected profile from symptom:
- `collapse-recovery` or `repair-collapse`

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Yes.

Notes:
- The side is shallow and not ready: `avgPcmBufferedMs=4.771`, `jitterBufferDepthFramesMean=0.242`, `jitterBufferedFrames=9`, `jitterHasReadyFrame=false`, and `avgPlayoutDeltaMs=-126.022`.
- `concealmentTicks=239`, `playoutUnderTargetFraction=0.145`, and `playoutRateFractionBelow097=0.136` justify the severe profile.
- But Linux only received `330` packets from Mac, while Mac received `2060` from Linux. Treat that delivery asymmetry as the next root-cause target before profile strength.

## Trend Read

Side A:
- Gradual moderate weak-listener path.
- Reasons seen:
  - `missingFrames` increases from `232` to `309`.
  - `concealmentTicks` stays low at `3`.
  - `avgPcmBufferedMs` improves from about `29.6` to `32.2 ms`.
  - adaptive mode remains `low-latency`, with exported profile `steady-weak-listener`.

Side B:
- Flat-bad/degrading collapse path under active recovery.
- Reasons seen:
  - `avgPcmBufferedMs` falls from `6.790` to `4.771 ms`.
  - `concealmentTicks` climbs steadily from `151` to `239`.
  - `playoutUnderTargetFraction` rises from `0.136` to `0.145`.
  - `playoutRateFractionBelow097` rises from `0.123` to `0.136`.
  - final playout is not ready despite `9` buffered jitter frames.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-05T21:27Z group-812` | A / Mac standby | `clean-low-latency` | partly/unknown | partly/unknown | decode/session correctness | Improved by 11:56Z and 12:19Z: decode failures are now `0`. |
| `2026-05-05T21:27Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Still relevant historically, but not the current blocker. |
| `2026-05-06T11:56Z group-812` | A / Mac standby | `persistent-lean` | yes | partly/no | selector / repair escalation | Improved in 12:19Z: analogous Mac side is now `steady-weak-listener`, not persistent lean. |
| `2026-05-06T11:56Z group-812` | B / Linux root | `clean-low-latency` | partly/yes | no/partly | selector / clean escape | Improved in 12:19Z: Linux no longer stays clean under damage; it now selects `collapse-recovery`. |
| `2026-05-06T12:19Z group-812` | A / Mac standby | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Keep as acceptable selector result; do not tune first. |
| `2026-05-06T12:19Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | Mac-to-Linux media delivery / not-ready collapse | Investigate packet-route/delivery asymmetry before tuning `collapse-recovery` strength. |

## Next Fix Target

Current patched target:
- Another subsystem: Mac-to-Linux media delivery / packet-route reliability.
- Primary fix: instrument and recover the path where Mac reports successful outbound sends, but Linux receives a much smaller packet count and collapses into not-ready recovery.
- Secondary watch item: if the next call has balanced inbound packet counts and Linux still stays near empty while correctly classified as `collapse-recovery`, then tune `collapse-recovery` or `repair-collapse` strength/hold.
- Keep selector, baseline, decode/session, and global profile strength unchanged for the next patch. This batch says the selector fix worked; the remaining bad side is correctly classified but underfed.

## Call: 2026-05-06 12:34Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T12-34-56-851Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T12-34-53-905Z.json`

User symptom:
- New paired call after the media delivery / packet-route reliability change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, packet imbalance, readiness state, and exported profiles.

High-level verdict:
- Bad/mixed.
- Correctness remains clean and both sides receive/decode audio, but the call is still not diagnostically clean: Mac is shallow and not-ready while classified too mildly as `steady-weak-listener`, and Linux is ready with usable reserve while classified too severely as `collapse-recovery`. The packet imbalance also flipped direction versus 12:19Z: Mac received only `688` packets from Linux while Linux received `2208` packets from Mac.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment in the broad sense: both sides have inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes.
- Queue/backpressure: bridge/binary high-water values are low (`1`/`2` on Mac, `2`/`0` on Linux), with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Selector / readiness priority, with packet-route asymmetry as a secondary subsystem watch.
- Mac should not stay ordinary `steady-weak-listener` with `avgPcmBufferedMs=10.134`, `jitterBufferedFrames=9`, `jitterHasReadyFrame=false`, `concealmentTicks=123`, and `playoutUnderTargetFraction=0.063`; this should enter a readiness/lean protection profile such as `buffered-not-ready` or `silent-lean`.
- Linux should not stay `collapse-recovery` with `avgPcmBufferedMs=30.995`, `jitterBufferedFrames=20`, `jitterHasReadyFrame=true`, low/moderate concealment, and live mode already back to `low-latency`; this fits `steady-weak-listener` or `repair-heavy-connected` better than full collapse.
- Do not tune profile strength or baseline from this call. The exported profiles do not match the symptoms, so selector priority/escape logic comes before target/floor changes. Keep watching the flipped packet imbalance because Mac is the underfed side in this export.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | yes | 10.134 | 86 | 123 | 0.063 | 0.058 | low-latency | Classification is too mild: playout is shallow and not-ready with active concealment, yet mode/profile remain weak/low-latency. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `collapse-recovery` | partly | 30.995 | 219 | 57 | 0.076 | 0.059 | low-latency | Classification is too severe: playout is ready with 20 buffered frames and usable reserve, so this should clear toward weak/repair, not full collapse. |

### Side A

Expected profile from symptom:
- `buffered-not-ready` or `silent-lean`, possibly `repair-collapse` if active concealment is weighted heavily.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- No/partly.

If no:
- `avgPcmBufferedMs=10.134`, `jitterBufferDepthFramesMean=0.513`, `avgPlayoutDeltaMs=-116.729`, and `jitterHasReadyFrame=false` with `9` buffered jitter frames are a readiness/lean failure shape.
- `concealmentTicks=123`, `playoutUnderTargetFraction=0.063`, and `playoutRateFractionBelow097=0.058` make the side more damaged than an ordinary weak listener.
- The selector should promote this into readiness/lean protection and keep recovery mode applied until ready/reserve recovers.

### Side B

Expected profile from symptom:
- `steady-weak-listener` or `repair-heavy-connected`.

Actual exported profile:
- `collapse-recovery`

Did classification match?
- No/partly.

If no:
- `avgPcmBufferedMs=30.995`, `jitterBufferDepthFramesMean=1.573`, `jitterBufferedFrames=20`, and `jitterHasReadyFrame=true` do not fit reserve collapse.
- The damage counters are real but moderate: `missingFrames=219`, `concealmentTicks=57`, `playoutUnderTargetFraction=0.076`, and `playoutRateFractionBelow097=0.059`.
- Tighten the ready-buffered escape from `collapse-recovery` so this shape lands in weak/repair recovery instead of the strongest collapse profile.

## Trend Read

Side A:
- Gradual shallow/not-ready path with recovery exiting too early.
- Reasons seen:
  - `avgPcmBufferedMs` improves from about `2.7` to `10.1 ms`, but remains shallow.
  - `concealmentTicks` stays high at `123`.
  - `missingFrames` grows from `25` to `86`.
  - adaptive mode exits `recovery` to `low-latency` while final playout is still not ready.

Side B:
- Gradual moderate weak/repair pressure with an over-severe exported profile.
- Reasons seen:
  - `avgPcmBufferedMs` improves from about `27.7` to `31.0 ms`.
  - `missingFrames` grows from `135` to `219`.
  - `concealmentTicks` stays flat at `57`.
  - adaptive mode exits `recovery` to `low-latency`, and final playout is ready with `20` buffered jitter frames.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T11:56Z group-812` | A / Mac standby | `persistent-lean` | yes | partly/no | selector / repair escalation | Improved in 12:19Z, but 12:34Z shows Mac still needs readiness/lean promotion when not-ready. |
| `2026-05-06T11:56Z group-812` | B / Linux root | `clean-low-latency` | partly/yes | no/partly | selector / clean escape | Improved in later calls: Linux no longer stays clean under damage, but 12:34Z over-corrects to collapse. |
| `2026-05-06T12:19Z group-812` | A / Mac standby | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Still acceptable for ready/moderate pressure, but 12:34Z is not-ready and needs a stronger readiness profile. |
| `2026-05-06T12:19Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | Mac-to-Linux media delivery / not-ready collapse | The severe profile was correct there; 12:34Z has the opposite ready-buffered shape and should escape collapse. |
| `2026-05-06T12:34Z group-812` | A / Mac standby | `steady-weak-listener` | yes | no/partly | selector / readiness priority | Promote shallow buffered-not-ready state into `buffered-not-ready` / `silent-lean` and prevent low-latency exit while not ready. |
| `2026-05-06T12:34Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector / collapse escape | Tighten ready-buffered low/moderate-concealment escape from `collapse-recovery` into weak/repair. |

## Next Fix Target

Current patched target:
- Selector / readiness priority.
- Primary fix: make not-ready shallow playout win over ordinary `steady-weak-listener`, especially when `jitterHasReadyFrame=false` with buffered jitter frames and active concealment.
- Secondary fix: make ready-buffered moderate-damage playout escape `collapse-recovery` into `steady-weak-listener` or `repair-heavy-connected`.
- Keep baseline and profile strength unchanged for the next patch. The classification is wrong/partly wrong on both sides, and the remaining packet imbalance is a watch item rather than enough evidence for another media-path-only patch.

## Call: 2026-05-06 12:50Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T12-50-22-139Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T12-50-18-689Z.json`

User symptom:
- New paired call after the link-lifecycle / heartbeat-liveness changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, packet imbalance, and exported profiles.

High-level verdict:
- Bad/asymmetric.
- Correctness and queue paths are clean, and selector behavior is mostly defensible. The bad side is Mac receiving Linux/root: Mac is correctly in `repair-collapse`, has tiny reserve, and only received `420` packets while Linux/root reports `2681` successful sends toward Mac. Linux/root receiving Mac is much healthier and exports `clean-low-latency`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/state: both sides are connected, have topology epoch `2`, participant count `2`, active room keys, and `awaitingAuthoritativeKey=false`.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes, `jitterHasReadyFrame=true`, and running audio contexts.
- Queue/backpressure: bridge/binary high-water values are low (`1`/`0` on Mac, `2`/`1` on Linux), with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Another subsystem: Linux/root-to-Mac media delivery after packet/link fallback.
- The selector is not the first target: Mac is correctly classified as `repair-collapse`, and Linux is plausibly clean/low-latency despite missing-frame growth because reserve and concealment are low-risk.
- The root problem is that Linux reports clean outbound success (`sendSuccesses=2681`, `sendFailures=0`, `skippedNoTargets=0`, `lastMainDiagnostics.transport=link`, `linkFallbackActive=true`), while Mac only receives `420` packets and repeatedly requests low-inbound media recovery with inbound/outbound ratios around `0.14` to `0.22`.
- Next patch should instrument and fix the main/Reticulum delivery path where link-fallback enqueue succeeds locally but the peer receives too little audio.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `repair-collapse` | yes | 3.579 | 19 | 276 | 0.095 | 0.090 | recovery | Classification matches: tiny reserve, active concealment, under-target pressure, and recovery mode. The upstream signal is low inbound from Linux/root. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `clean-low-latency` | no/partly | 54.329 | 399 | 18 | 0.031 | 0.018 | low-latency | Classification is acceptable/partly optimistic: missing-frame count is high, but reserve is strong and concealment/under-target pressure are low. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`

Actual exported profile:
- `repair-collapse`

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs=3.579`, `jitterBufferDepthFramesMean=0.182`, `avgPlayoutDeltaMs=-138.067`, `concealmentTicks=276`, `playoutUnderTargetFraction=0.095`, and `playoutRateFractionBelow097=0.090` fit a severe repair/collapse listener.
- The playout itself is not hidden: `jitterBufferedFrames=22`, `jitterHasReadyFrame=true`, `playbackNodeActive=true`, and `schedulerNodeActive=true`.
- Mac repeatedly emits `low-inbound-media-recovery-requested`; packet count stalls around `286` for much of the sampled window and ends at only `420`.

### Side B

Expected profile from symptom:
- `clean-low-latency` or `steady-weak-listener`

Actual exported profile:
- `clean-low-latency`

Did classification match?
- Yes/partly.

If no:
- The only suspicious signal is sustained `missingFrames=399`.
- But the side has `avgPcmBufferedMs=54.329`, `jitterBufferedFrames=11`, `jitterHasReadyFrame=true`, `concealmentTicks=18`, `playoutUnderTargetFraction=0.031`, and `playoutRateFractionBelow097=0.018`.
- This is not the first profile to tune from this call; at most, keep watching whether high missing-frame counts with strong reserve should select `steady-weak-listener`.

## Trend Read

Side A:
- Flat-bad/degrading receive starvation.
- Reasons seen:
  - `avgPcmBufferedMs` falls from about `3.19` to `2.55 ms`, then only recovers to `3.58 ms`.
  - `concealmentTicks` climbs from `207` to `276`.
  - `playoutUnderTargetFraction` stays near `0.095` to `0.100`.
  - repeated `low-inbound-media-recovery-requested` events show inbound/outbound ratio around `0.14` to `0.22`.

Side B:
- Mostly buffered/usable with moderate missing-frame growth.
- Reasons seen:
  - `avgPcmBufferedMs` stays strong around `54` to `56 ms`.
  - `missingFrames` grows from `311` to `399`.
  - `concealmentTicks` stays low at `18`.
  - adaptive mode briefly enters `recovery` and returns to `low-latency`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T12:19Z group-812` | A / Mac standby | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Still acceptable for ready/moderate pressure; not the current blocker. |
| `2026-05-06T12:19Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | Mac-to-Linux media delivery / not-ready collapse | Packet imbalance made this an upstream delivery case, not profile strength. |
| `2026-05-06T12:34Z group-812` | A / Mac standby | `steady-weak-listener` | yes | no/partly | selector / readiness priority | Improved in 12:50Z: Mac now selects severe repair/collapse when it is truly shallow and damaged. |
| `2026-05-06T12:34Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector / collapse escape | Improved in 12:50Z: analogous Linux side now clears to `clean-low-latency` with ready buffer and low concealment. |
| `2026-05-06T12:50Z group-812` | A / Mac standby | `repair-collapse` | yes | yes | Linux-to-Mac media delivery / receive starvation | Instrument/fix link-fallback delivery where Linux reports successful outbound sends but Mac receives too little. |
| `2026-05-06T12:50Z group-812` | B / Linux root | `clean-low-latency` | no/partly | yes/partly | secondary missing-frame watch | No profile-strength change first; only watch high missing-frame counts under strong reserve. |

## Next Fix Target

Current patched target:
- Another subsystem: Linux/root-to-Mac media delivery during packet/link fallback.
- Primary fix: add delivery diagnostics around the successful enqueue path, link fallback dwell/probe exits, and peer receive evidence so we can distinguish “queued to bridge” from “arrived at peer”.
- Secondary fix candidate: if diagnostics show link fallback is selected but not delivering, prefer packet path or reopen/reselect the canonical link faster for that peer.
- Keep selector, profile strength, and baseline unchanged for the next patch. In this call, classification mostly matches the symptoms; the bad side is correctly classified but underfed.

## Call: 2026-05-06 14:30Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T14-30-36-970Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T14-30-34-292Z.json`

User symptom:
- New paired call after the latest media delivery / link-fallback changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, readiness state, and exported profiles.

High-level verdict:
- Mixed/bad, but improved versus 12:50Z delivery starvation.
- Both directions now have inbound packets, decoded frames, live profiles, and active playouts. Correctness and queue paths are clean. The remaining failures are receive-side: Mac is correctly classified as `silent-lean` but the final playout mode has fallen back to `low-latency` while still not ready, and Linux is over-classified as `repair-collapse` despite usable reserve and a ready playout.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment in the broad sense: both sides have inbound packets, decoded frames, active playouts, and live policy profiles.
- Queue/backpressure: bridge/binary high-water values are low (`2`/`1` on Mac, `4`/`1` on Linux), with no queue-pressure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Baseline: this is not evidence for a global target increase; the profiles/modes are not aligned enough to tune baseline first.

Primary next target:
- Another subsystem: profile-to-playout / adaptive-mode application, with selector cleanup as the secondary target.
- Mac is the clearest bad-side signal: `silent-lean` matches `avgPcmBufferedMs=6.573`, `jitterBufferedFrames=10`, `jitterHasReadyFrame=false`, and `avgPlayoutDeltaMs=-128.184`, but both exported live mode and final jitter mode are `low-latency`. A correctly selected lean/not-ready profile is not holding recovery-mode protection.
- Linux should also not be `repair-collapse` with `avgPcmBufferedMs=39.408`, `jitterBufferedFrames=21`, `jitterHasReadyFrame=true`, and only moderate concealment. That is a selector/escape issue, but it is secondary to the Mac application mismatch because the worst-looking side selected the right profile family and then exited protection.
- Do not tune profile strength first. Do not tune baseline first. This call says the next fix is to make selected protective profiles actually drive/hold the playout mode, then tighten the ready-buffered escape from `repair-collapse`.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `silent-lean` | yes | 6.573 | 235 | 68 | 0.015 | 0.011 | low-latency | Classification matches the tiny-reserve not-ready shape, but protection is not applied/held: final playout has 10 buffered jitter frames, no ready frame, and low-latency mode. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `repair-collapse` | partly | 39.408 | 185 | 55 | 0.087 | 0.077 | recovery | Classification is too severe for a ready, usable-reserve path; this fits `steady-weak-listener` or `repair-heavy-connected` better than collapse. |

### Side A

Expected profile from symptom:
- `silent-lean` or `buffered-not-ready`

Actual exported profile:
- `silent-lean`

Did classification match?
- Yes for profile family, no/partly for applied playout behavior.

Notes:
- `avgPcmBufferedMs=6.573`, `jitterBufferDepthFramesMean=0.333`, `avgPlayoutDeltaMs=-128.184`, and `jitterHasReadyFrame=false` with `10` buffered jitter frames match the silent-lean/readiness blind spot.
- Damage counters are present but not explosive: `missingFrames=235`, `concealmentTicks=68`, `playoutUnderTargetFraction=0.015`, and `playoutRateFractionBelow097=0.011`.
- The bad part is that the trend exits from `recovery` to `low-latency` at the end while the final playout snapshot is still not ready. That points at profile application/hold, not profile strength.

### Side B

Expected profile from symptom:
- `steady-weak-listener` or `repair-heavy-connected`

Actual exported profile:
- `repair-collapse`

Did classification match?
- No/partly.

If no:
- `avgPcmBufferedMs=39.408`, `jitterBufferDepthFramesMean=1.996`, `jitterBufferedFrames=21`, and `jitterHasReadyFrame=true` do not fit a reserve-collapse profile.
- The side is still not clean: `playoutUnderTargetFraction=0.087`, `playoutRateFractionBelow097=0.077`, `avgPlayoutDeltaMs=-94.443`, `missingFrames=185`, and `concealmentTicks=55`.
- Tighten the ready-buffered escape from `repair-collapse` into weak/repair recovery, but do that after fixing the selected-profile-to-mode mismatch on Mac.

## Trend Read

Side A:
- Gradual shallow/not-ready path with recovery exiting too early.
- Reasons seen:
  - `avgPcmBufferedMs` improves only from about `6.16` to `6.57 ms`, still very shallow.
  - `missingFrames` increases from `204` to `235`.
  - `concealmentTicks` stays at `68`.
  - adaptive mode switches from `recovery` to `low-latency` in the final sample while `jitterHasReadyFrame=false`.

Side B:
- Gradual moderate weak/repair pressure under recovery, with over-severe collapse classification.
- Reasons seen:
  - `avgPcmBufferedMs` improves from about `38.26` to `39.41 ms`.
  - `missingFrames` increases from `154` to `185`.
  - `concealmentTicks` stays at `55`.
  - `playoutUnderTargetFraction` and `playoutRateFractionBelow097` improve but remain elevated around `0.087` / `0.077`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T12:19Z group-812` | A / Mac standby | `steady-weak-listener` | partly | yes/partly | weak-listener / secondary | Still acceptable for ready/moderate pressure; not the current blocker. |
| `2026-05-06T12:19Z group-812` | B / Linux root | `collapse-recovery` | yes | yes | Mac-to-Linux media delivery / not-ready collapse | Packet imbalance made this an upstream delivery case; later calls show both directions alive again. |
| `2026-05-06T12:34Z group-812` | A / Mac standby | `steady-weak-listener` | yes | no/partly | selector / readiness priority | Improved in 14:30Z: analogous Mac side now selects `silent-lean`, but mode still exits recovery too early. |
| `2026-05-06T12:34Z group-812` | B / Linux root | `collapse-recovery` | partly | no/partly | selector / collapse escape | Still relevant: 14:30Z again over-classifies a ready buffered Linux side, now as `repair-collapse`. |
| `2026-05-06T12:50Z group-812` | A / Mac standby | `repair-collapse` | yes | yes | Linux-to-Mac media delivery / receive starvation | Improved in 14:30Z: Mac received/decoded `1443` packets and the failure is no longer zero/low inbound delivery. |
| `2026-05-06T12:50Z group-812` | B / Linux root | `clean-low-latency` | no/partly | yes/partly | secondary missing-frame watch | Superseded by 14:30Z: Linux now has moderate pressure but is over-classified as `repair-collapse`. |
| `2026-05-06T14:30Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | profile application / adaptive-mode hold | Make `silent-lean` / not-ready protection keep recovery mode until ready/reserve recovers; do not let final mode fall to `low-latency`. |
| `2026-05-06T14:30Z group-812` | B / Linux root | `repair-collapse` | partly | no/partly | selector / repair-collapse escape | Tighten ready-buffered escape so this lands in `steady-weak-listener` or `repair-heavy-connected`, not collapse. |

## Next Fix Target

Current patched target:
- Profile-to-playout / adaptive-mode application first; selector cleanup second.
- Primary fix: when a live source profile is `silent-lean` or another not-ready lean protection profile, keep jitter/playout in recovery protection while `jitterHasReadyFrame=false` or reserve remains in the collapse band. The Mac side selected the right profile family but still ended in `low-latency`.
- Secondary fix: tighten the ready-buffered escape from `repair-collapse` for Linux-style paths with `jitterHasReadyFrame=true`, many buffered frames, usable reserve, and only moderate concealment.
- Keep baseline and profile strength unchanged for the next patch. The issue is not that a correctly applied profile is too weak; it is that one correctly selected profile is not being applied/held, and the other side is over-selected into a collapse profile.

## Call: 2026-05-06 18:39Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T18-39-13-366Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T18-39-09-213Z.json`

User symptom:
- New paired call after the latest changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, packet imbalance, readiness state, and exported profiles.

High-level verdict:
- Bad/asymmetric.
- The worst side is Linux/root receiving Mac: it is correctly classified as `repair-collapse`, recovery mode is applied, but it only received `617` packets while Mac/standby received `6632` packets from Linux. Linux is not-ready for most of the sampled window and shows extreme under-target/slow-rate pressure.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Key/media establishment in the broad sense: both sides have inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes, although both final playout snapshots report buffered frames with `jitterHasReadyFrame=false`.
- Failover: root/cluster promotion counts are `0` on both sides.
- Baseline: Mac has a moderate `32.241 ms` receive reserve and Linux is already in a heavy recovery profile, so this is not broad evidence for raising the global baseline.

Primary next target:
- Another subsystem: Mac-to-Linux media delivery / packet-route reliability, with decode/session diagnostics as a secondary check.
- Linux/root is the bad side and the receive profile matches the symptom: `repair-collapse`, `concealmentTicks=390`, `playoutUnderTargetFraction=0.867`, `playoutRateFractionBelow097=0.843`, `avgPlayoutDeltaMs=-153.297`, and `jitterHasReadyFrame=false` with `11` buffered jitter frames.
- The profile is selected and recovery mode is applied, but Linux is underfed: its trend only grows from `527` to `617` received packets over the sampled window, while Mac received thousands of packets from Linux. That points upstream of profile tuning.
- Linux also has `packetsDroppedDecodeFailure=5`, so keep decode/session instrumentation active, but the larger symptom match is receive starvation from Mac to Linux.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | partly | 32.241 | 326 | 2 | 0.048 | 0.005 | low-latency | Classification is acceptable/mildly suspicious: reserve is usable and concealment is tiny, but final playout is not ready with 9 buffered jitter frames and missing frames keep growing. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `repair-collapse` | yes | 30.508 | 95 | 390 | 0.867 | 0.843 | recovery | Classification matches the bad symptom: not-ready playout, heavy concealment, severe under-target and slow-rate pressure. The upstream issue is very low Mac-to-Linux packet arrival. |

### Side A

Expected profile from symptom:
- `steady-weak-listener` or `buffered-not-ready` if the final not-ready state is persistent.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly.

Notes:
- `avgPcmBufferedMs=32.241`, `jitterBufferDepthFramesMean=1.633`, `concealmentTicks=2`, and `playoutRateFractionBelow097=0.005` are not a collapse profile.
- The suspicious part is readiness: final playout has `jitterBufferedFrames=9` with `jitterHasReadyFrame=false`, while `missingFrames` grows from `243` to `326`.
- This is not the first fix target because this side receives plenty of Linux audio and has low audible damage counters compared with Linux.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`

Actual exported profile:
- `repair-collapse`

Did classification match?
- Yes.

Notes:
- The bad profile matches the exported symptom: `concealmentTicks=390`, `playoutUnderTargetFraction=0.867`, `playoutRateFractionBelow097=0.843`, `jitterNotReadyFraction=0.867`, and final `jitterHasReadyFrame=false`.
- `avgPcmBufferedMs=30.508` is not near-empty, but the readiness and playout-rate counters dominate; this is a not-ready repair/collapse receive path.
- Do not tune selector or heavy-profile strength first from this side because the classifier and applied mode are already protective. The bigger failure is that Linux receives far too little Mac audio.

## Trend Read

Side A:
- Gradual moderate weak-listener path with one recovery entry and a final not-ready playout snapshot.
- Reasons seen:
  - `entered-recovery` appears once.
  - `missingFrames` increases from `243` to `326`.
  - `concealmentTicks` stays low at `1` to `2`.
  - `avgPcmBufferedMs` stays around `31` to `32 ms`.

Side B:
- Flat-bad/degrading not-ready repair-collapse path under active recovery.
- Reasons seen:
  - `concealmentTicks` climbs from `315` to `390`.
  - `playoutUnderTargetFraction` stays extreme around `0.856` to `0.877`.
  - `playoutRateFractionBelow097` stays extreme around `0.831` to `0.857`.
  - `packetsReceived` only increases from `527` to `617`, showing sustained Mac-to-Linux under-delivery.
  - `packetsDroppedDecodeFailure=5` persists across the trend and should stay instrumented.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T12:50Z group-812` | A / Mac standby | `repair-collapse` | yes | yes | Linux-to-Mac media delivery / receive starvation | Improved in later calls: both directions now receive/decode, but asymmetry can still flip sides. |
| `2026-05-06T12:50Z group-812` | B / Linux root | `clean-low-latency` | no/partly | yes/partly | secondary missing-frame watch | Still secondary; not the current blocker. |
| `2026-05-06T14:30Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | profile application / adaptive-mode hold | Improved for the new worst side: Linux has recovery mode applied when classified heavy. |
| `2026-05-06T14:30Z group-812` | B / Linux root | `repair-collapse` | partly | no/partly | selector / repair-collapse escape | Not the current Linux shape; 18:39Z Linux is legitimately bad and correctly heavy. |
| `2026-05-06T18:39Z group-812` | A / Mac standby | `steady-weak-listener` | partly | partly | readiness / secondary | Watch final buffered-not-ready state, but do not tune first from this side. |
| `2026-05-06T18:39Z group-812` | B / Linux root | `repair-collapse` | yes | yes | Mac-to-Linux media delivery / decode watch | Investigate why Linux receives very little Mac audio despite active media; keep `packetsDroppedDecodeFailure=5` diagnostics active. |

## Next Fix Target

Current patched target:
- Another subsystem: Mac-to-Linux media delivery / packet-route reliability.
- Primary fix: instrument and recover the direction where Mac appears to be sending but Linux receives only a small packet count and remains not-ready under an already-correct heavy profile.
- Secondary watch item: explain Linux `packetsDroppedDecodeFailure=5`, but do not make decode the only target unless the packet delivery imbalance is resolved and decode failures remain.
- Keep selector, profile strength, and baseline unchanged for the next patch. Classification matched the bad Linux symptom, and recovery mode was applied; the missing piece is enough inbound media reaching that receiver.

### Follow-up Correction: 2026-05-06 18:39Z

After re-checking the transport logic, the stronger next target is narrower:
- Sender-side fallback exit / link-fallback request-window handling.
- The earlier route/identity replay theory is not the best match. Linux did receive some Mac audio over the established link, so the route was not simply missing.
- The important asymmetry is that Mac exited link fallback after a short local packet-path probe dwell even though Linux still reported low inbound media. In code, `requestReticulumPacketLinkFallback()` set a 15s fallback request window, but `activateReticulumAudioLinkFallback()` immediately cleared it; this allowed the fallback to leave after the 3s probe dwell.
- Patch target: preserve `packetLinkFallbackRequestedUntilMs` / `packetLinkFallbackReason` when activating fallback, require the request window and peer-RX-missing hold to expire before leaving fallback, and let peer RX-missing heartbeats refresh the hold while fallback is active.
- This remains “another subsystem,” not selector/profile strength/baseline. The Linux receive profile matched the symptom; the receiver was underfed because the sender did not stay on the working fallback path long enough.

## Call: 2026-05-06 21:56Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T21-56-49-017Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T21-56-44-758Z.json`

User symptom:
- New paired call after the packet/link fallback policy changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics, profiles, and transport balance.

High-level verdict:
- Mixed/improved.
- The earlier sender-side fallback/underfed-link problem is much improved: both directions received thousands of packets, both sides ended on `packet`, packet send failures are `0`, decode/key/queue paths are clean, and the packet/link sample mix is mostly packet. The remaining issue is moderate receive-policy quality: Mac is in `persistent-lean` under recovery, while Linux is in `steady-weak-listener` but exits back to low-latency despite sustained missing-frame and under-target pressure.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have room keys, live mic senders, inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`2`/`2` on Mac, `4`/`2` on Linux), with no queue-pressure or stale drops.
- Packet media path: packet send failures are `0`, packet fresh sends are high, and both sides ended with last transport `packet`.
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Profile strength / hold for the moderate weak/lean receive profiles.
- This is not primarily selector: Mac’s `persistent-lean` is directionally plausible for `avgPcmBufferedMs=20.437`, low jitter depth, negative playout delta, and persistent under-target pressure. Linux’s `steady-weak-listener` is also plausible for sustained missing-frame/concealment pressure with moderate under-target/rate pressure.
- This is not another transport subsystem first: unlike 18:39Z, packet arrival is balanced enough for both sides to decode thousands of frames, and both sides ended on packet.
- This is not a global baseline change yet: the evidence is concentrated in non-clean weak/lean profiles rather than clean-low-latency sounding bad.
- Next patch should tune the weak/lean family first: make `persistent-lean` and `steady-weak-listener` hold recovery/protection a little longer, or give them slightly stronger target/floor behavior, so they do not oscillate back to low-latency while under-target/missing-frame pressure is still present.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | partly | 20.437 | 274 | 5 | 0.089 | 0.008 | recovery | Classification mostly matches a persistent lean/under-target listener: ready playout and low concealment, but low reserve, negative delta, and recovery mode. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | partly | 49.016 | 647 | 63 | 0.048 | 0.035 | low-latency | Classification is plausible for buffered weak-listener pressure; reserve is healthy enough to avoid collapse, but missing/concealment counters keep it non-clean. |

### Side A

Expected profile from symptom:
- `persistent-lean` or `steady-weak-listener`

Actual exported profile:
- `persistent-lean`

Did classification match?
- Yes/partly.

Notes:
- `avgPcmBufferedMs=20.437`, `jitterBufferDepthFramesMean=1.040`, and `avgPlayoutDeltaMs=-118.118` fit a persistent shallow/lean listener more than a clean call.
- `jitterHasReadyFrame=true` with `21` buffered jitter frames, `concealmentTicks=5`, and `playoutRateFractionBelow097=0.008` keep this out of repair-collapse or buffered-not-ready.
- The profile family is plausible; if the side still sounded rough, tune `persistent-lean` strength/hold rather than selector priority.

### Side B

Expected profile from symptom:
- `steady-weak-listener`

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Yes/partly.

Notes:
- `avgPcmBufferedMs=49.016`, `jitterBufferDepthFramesMean=2.478`, `jitterBufferedFrames=12`, and `jitterHasReadyFrame=true` make this a ready buffered listener, not collapse or startup.
- `missingFrames=647`, `concealmentTicks=63`, `playoutUnderTargetFraction=0.048`, `playoutRateFractionBelow097=0.035`, and `avgPlayoutDeltaMs=-81.571` justify keeping it out of `clean-low-latency`.
- The final adaptive mode is `low-latency` despite repeated recovery entries and sustained missing-frame growth, so weak-listener hold/clear behavior is the likely tuning point.

## Trend Read

Side A:
- Gradual moderate lean path with one recovery re-entry.
- Reasons seen:
  - `missingFrames` increases from `238` to `274`.
  - `concealmentTicks` stays flat at `5`.
  - `avgPcmBufferedMs` stays around `20.4` to `21.0 ms`, never rebuilding into a clearly healthy reserve.
  - adaptive mode briefly exits to `low-latency`, then re-enters `recovery`.

Side B:
- Gradual buffered weak-listener path with oscillating recovery entries.
- Reasons seen:
  - `entered-recovery` appears twice.
  - `missingFrames` increases from `545` to `647`.
  - `concealmentTicks` increases from `58` to `63`.
  - `avgPcmBufferedMs` improves from about `47.5` to `49.0 ms`, but under-target and rate-below-0.97 pressure persist.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T14:30Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | profile application / adaptive-mode hold | Improved in 21:56Z: Mac now has ready playout and recovery mode applied under a lean profile. |
| `2026-05-06T14:30Z group-812` | B / Linux root | `repair-collapse` | partly | no/partly | selector / repair-collapse escape | Improved in 21:56Z: Linux now selects `steady-weak-listener`, not collapse, for a ready buffered path. |
| `2026-05-06T18:39Z group-812` | A / Mac standby | `steady-weak-listener` | partly | partly | readiness / secondary | Improved in 21:56Z: Mac playout is ready and receives thousands of frames. |
| `2026-05-06T18:39Z group-812` | B / Linux root | `repair-collapse` | yes | yes | sender-side fallback exit / underfed receiver | Improved in 21:56Z: Linux receives `3956` packets and ends on packet transport; underfed-link failure is no longer dominant. |
| `2026-05-06T21:56Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | weak/lean profile strength | Tune `persistent-lean` target/floor or hold so reserve can rebuild above the lean band. |
| `2026-05-06T21:56Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | weak-listener hold/strength | Tune weak-listener hold/clear so recovery does not exit while missing-frame and under-target pressure persist. |

## Next Fix Target

Current patched target:
- Profile strength / hold for moderate weak/lean receive profiles.
- Primary fix: strengthen `persistent-lean` and/or `steady-weak-listener` protection modestly, especially hold/clear behavior after recovery entry, so ready-but-stressed listeners do not fall back to low-latency before missing-frame and under-target pressure quiet down.
- Keep selector thresholds mostly unchanged from this batch: classification is no longer obviously wrong on either side.
- Keep packet/link fallback and media-path delivery unchanged for the next patch: the new call shows packet recovery and balanced inbound media compared with the earlier underfed-link failures.
- Keep global baseline unchanged for now. This batch is evidence for non-clean profile tuning, not clean-call baseline failure.

## Call: 2026-05-06 23:26Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-06T23-26-32-953Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-06T23-26-28-059Z.json`

User symptom:
- New paired call after the weak/lean receive-policy changes; user reported the call was pretty bad.

High-level verdict:
- Bad.
- Correctness, startup, and broad media establishment are clean, but both sides remain in ready stressed receive paths. The exported profiles are both `steady-weak-listener`; Mac is a plausible weak-listener, while Linux looks too damaged for ordinary weak-listener and should be promoted toward a repair profile.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`3`/`0` on Mac, `4`/`1` on Linux), with no queue-pressure or stale drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Baseline: neither side is `clean-low-latency`; this is not evidence that the global clean baseline is too low.

Primary next target:
- Selector.
- Specifically, tune the boundary between `steady-weak-listener` and `repair-heavy-connected` for ready-buffered but audibly bad paths. Linux has usable reserve and ready playout, but `missingFrames=689`, `concealmentTicks=74`, `playoutUnderTargetFraction=0.086`, `playoutRateFractionBelow097=0.074`, and `avgPlayoutDeltaMs=-92.283`; that is closer to buffered repair pressure than ordinary weak-listener.
- Do not tune baseline first. Do not jump to another transport subsystem first: packet arrival is reasonably balanced (`2526` packets on Mac, `2412` on Linux), both directions decode, and there are no send/decode/key drops. Keep Linux `reticulumAudioPacketPathTimeouts=98` as a secondary watch item, but the next receive-policy fix is classification strength/priority into repair-heavy.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | yes | 23.397 | 443 | 45 | 0.044 | 0.021 | recovery | Classification partly matches a weak/lean path: ready playout, low reserve, negative delta, and moderate damage. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | yes | 41.742 | 689 | 74 | 0.086 | 0.074 | recovery | Classification is too mild for the reported bad call and sustained under-target/slow-rate pressure; this should border `repair-heavy-connected`. |

### Side A

Expected profile from symptom:
- `steady-weak-listener` or `repair-heavy-connected`.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly/yes.

Notes:
- `avgPcmBufferedMs=23.397`, `jitterBufferDepthFramesMean=1.185`, and `avgPlayoutDeltaMs=-105.875` fit a persistent weak-listener shape.
- `jitterHasReadyFrame=true` with `21` buffered jitter frames keeps this out of buffered-not-ready or collapse.
- The damage is still real: `missingFrames=443`, `concealmentTicks=45`, and recovery mode is active. If this direction sounded bad, it is evidence for either a stronger weak-listener hold or promotion when damage persists.

### Side B

Expected profile from symptom:
- `repair-heavy-connected`, with `steady-weak-listener` only as the weaker fallback.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly/no.

If no:
- The side is ready and not collapsed: `avgPcmBufferedMs=41.742`, `jitterBufferDepthFramesMean=2.113`, `jitterBufferedFrames=23`, and `jitterHasReadyFrame=true`.
- But the bad-call symptom and damage counters are stronger than ordinary weak-listener: `missingFrames=689`, `concealmentTicks=74`, `playoutUnderTargetFraction=0.086`, `playoutRateFractionBelow097=0.074`, and `avgPlayoutDeltaMs=-92.283`.
- Tune selector escalation into `repair-heavy-connected` before raising global baseline or making another broad profile-strength increase.

## Trend Read

Side A:
- Gradual weak-listener path under recovery.
- Reasons seen:
  - `missingFrames` increases from `410` to `443`.
  - `concealmentTicks` stays flat at `45`.
  - `avgPcmBufferedMs` stays around `23.1` to `23.4 ms`.
  - adaptive mode remains `recovery`, so this is not a low-latency exit problem.

Side B:
- Gradual buffered repair/weak path with oscillating recovery.
- Reasons seen:
  - `entered-recovery` appears twice.
  - adaptive mode exits to `low-latency` for much of the middle of the window, then re-enters `recovery`.
  - `missingFrames` increases from `552` to `689`.
  - `concealmentTicks` rises from `69` to `74`.
  - `playoutUnderTargetFraction` and `playoutRateFractionBelow097` remain elevated around `0.086` / `0.074` at the end.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T14:30Z group-812` | A / Mac standby | `silent-lean` | yes | yes/partly | profile application / adaptive-mode hold | Improved by 21:56Z and 23:26Z: Mac playout is ready and recovery mode is applied when non-clean. |
| `2026-05-06T14:30Z group-812` | B / Linux root | `repair-collapse` | partly | no/partly | selector / repair-collapse escape | Improved in later calls: Linux no longer over-selects collapse for ready buffered paths. |
| `2026-05-06T18:39Z group-812` | B / Linux root | `repair-collapse` | yes | yes | sender-side fallback exit / underfed receiver | Improved in later calls: Linux receives thousands of packets, so underfed-link is not the dominant 23:26Z issue. |
| `2026-05-06T21:56Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | weak/lean profile strength | Improved/shifted in 23:26Z: Mac now selects `steady-weak-listener` and stays in recovery, but still has moderate damage. |
| `2026-05-06T21:56Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | weak-listener hold/strength | Still relevant, but 23:26Z suggests the boundary should escalate worse ready-buffered damage into repair-heavy. |
| `2026-05-06T23:26Z group-812` | A / Mac standby | `steady-weak-listener` | yes | partly/yes | weak-listener / secondary | Keep as evidence; do not tune baseline from this side alone. |
| `2026-05-06T23:26Z group-812` | B / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Promote ready-buffered paths with sustained missing/concealment plus under-target/slow-rate pressure into `repair-heavy-connected`. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: strengthen the `steady-weak-listener` to `repair-heavy-connected` escalation when a ready buffered listener has sustained missing-frame growth, active concealment, elevated under-target fraction, elevated slow-rate fraction, and a user-bad symptom.
- Secondary watch item: Linux has `reticulumAudioPacketPathTimeouts=98`, so keep packet-route diagnostics visible, but do not make transport the first patch from this call because both sides received and decoded comparable packet counts.
- Keep global baseline unchanged. Keep collapse/repair-collapse strength unchanged. This batch is not a clean-call baseline failure and not a correctly selected heavy-profile weakness; the miss is that the worse side stayed in an ordinary weak-listener profile.

## Call: 2026-05-07 14:07Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-07T14-07-27-221Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T14-07-23-457Z.json`

User symptom:
- New paired call after the `steady-weak-listener` to `repair-heavy-connected` selector change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and non-clean profiles.

High-level verdict:
- Mixed/bad, but the selector moved in the intended direction.
- Correctness, key/media establishment, startup playout nodes, and queue paths are clean. Mac is a plausible `persistent-lean` path that is slowly rebuilding reserve under recovery. Linux now escalates to `repair-heavy-connected`, matching the prior target, but still has high not-ready, under-target, and slow-rate pressure while recovery is active.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have room keys, live mic senders, inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and final `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`2`/`0` on Mac, `4`/`1` on Linux), with no queue-pressure, stale, link-unready, or send-failure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Baseline: neither side is `clean-low-latency`, so this is not evidence for raising the global clean baseline.

Primary next target:
- `repair-heavy-connected` profile strength / hold.
- The selector target from 23:26Z appears improved: Linux no longer stays in `steady-weak-listener`; it now exports `repair-heavy-connected`.
- Per the decision rules, classification is mostly correct but immediate quality is still bad on Linux: `avgPcmBufferedMs=16.033`, `jitterNotReadyFraction=0.268`, `concealmentTicks=85`, `playoutUnderTargetFraction=0.268`, and `playoutRateFractionBelow097=0.245` while recovery mode is active.
- Do not tune selector first from this call. Do not raise baseline first. The current evidence is profile-specific: a correctly selected buffered repair profile is not strong or sticky enough to stabilize playout.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | partly | 14.193 | 45 | 3 | 0.023 | 0.009 | recovery | Classification is plausible: reserve is still shallow with strongly negative delta, but damage counters are low and reserve is improving. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `repair-heavy-connected` | yes | 16.033 | 43 | 85 | 0.268 | 0.245 | recovery | Classification matches the improved selector target, but recovery is not rebuilding enough reserve or readiness. |

### Side A

Expected profile from symptom:
- `persistent-lean` or `steady-weak-listener`

Actual exported profile:
- `persistent-lean`

Did classification match?
- Yes/partly.

Notes:
- `avgPcmBufferedMs=14.193`, `jitterBufferDepthFramesMean=0.720`, and `avgPlayoutDeltaMs=-120.868` fit a lean listener more than a clean call.
- `jitterHasReadyFrame=true` with `21` buffered jitter frames, `concealmentTicks=3`, `missingFrames=45`, and `playoutRateFractionBelow097=0.009` keep it out of repair-heavy or collapse.
- This side is secondary: its trend improves from about `6 ms` to `14 ms` reserve while staying in recovery.

### Side B

Expected profile from symptom:
- `repair-heavy-connected`, possibly bordering `repair-collapse` if not-ready pressure persists.

Actual exported profile:
- `repair-heavy-connected`

Did classification match?
- Yes/partly.

Notes:
- This is the shape the last selector patch was meant to catch: ready final playout, not full collapse, but sustained repair pressure and poor playout timing.
- `jitterNotReadyFraction=0.268`, `concealmentTicks=85`, `playoutUnderTargetFraction=0.268`, `playoutRateFractionBelow097=0.245`, and `avgPlayoutDeltaMs=-124.907` make this a user-bad repair profile despite only `43` missing frames.
- Since recovery mode is already active and the profile is plausible, the next patch should tune `repair-heavy-connected` target/floor/hold or clear conditions, not selector priority.

## Trend Read

Side A:
- Gradual lean recovery.
- Reasons seen:
  - `entered-recovery` appears once with `packet-path-timeouts-started`.
  - `avgPcmBufferedMs` improves from about `6.2` to `14.2 ms`.
  - `missingFrames` only grows from `23` to `45` after topology epoch `3`.
  - `concealmentTicks` stays low at `3`.

Side B:
- Early severe repair/not-ready pressure with partial reserve rebuild under recovery.
- Reasons seen:
  - `avgPcmBufferedMs` starts around `5.1 ms`, falls near `2.4 ms`, then rebuilds to `16.0 ms`.
  - `concealmentTicks` rises from `34` to `85`.
  - `playoutUnderTargetFraction` remains high at `0.268`.
  - `playoutRateFractionBelow097` remains high at `0.245`.
  - final playout is ready with `15` buffered jitter frames, so this is not a pure buffered-not-ready selector miss.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T21:56Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | weak/lean profile strength | Still relevant; 14:07Z Mac remains lean but is improving and not the primary bad side. |
| `2026-05-06T21:56Z group-812` | B / Linux root | `steady-weak-listener` | partly | yes/partly | weak-listener hold/strength | Superseded by 23:26Z and 14:07Z: the worse Linux shape now escalates past weak-listener. |
| `2026-05-06T23:26Z group-812` | A / Mac standby | `steady-weak-listener` | yes | partly/yes | weak-listener / secondary | Keep as evidence, but not the current first target. |
| `2026-05-06T23:26Z group-812` | B / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Improved in 14:07Z: Linux now selects `repair-heavy-connected` for the worse ready-buffered repair path. |
| `2026-05-07T14:07Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | lean profile / secondary | Watch; do not tune first because damage counters are low and reserve is rebuilding. |
| `2026-05-07T14:07Z group-812` | B / Linux root | `repair-heavy-connected` | yes | yes/partly | repair-heavy profile strength / hold | Tune `repair-heavy-connected` target/floor/hold or stricter clear conditions so active recovery can rebuild reserve and reduce under-target/slow-rate pressure. |

## Next Fix Target

Current patched target:
- `repair-heavy-connected` profile strength / hold.
- Primary fix: strengthen or lengthen `repair-heavy-connected` protection after escalation from weak-listener, especially while `jitterNotReadyFraction`, `playoutUnderTargetFraction`, and `playoutRateFractionBelow097` remain high.
- Secondary watch item: Mac `persistent-lean` still has shallow reserve, but low concealment and improving reserve make it a lower-priority profile-strength signal.
- Keep selector, baseline, key/media delivery, and decode/session unchanged for the next patch. This call says classification has mostly caught up; the correctly selected repair profile now needs to do more work.

## Call: 2026-05-07 17:25Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-07T17-25-28-379Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T17-25-25-085Z.json`

User symptom:
- New paired call after the latest receive-policy changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and non-clean profiles.

High-level verdict:
- Mixed/bad.
- Correctness, startup playout, queue/backpressure, and failover paths are clean. Both sides are ready and in recovery, but both are still near-empty with strongly negative playout delta. The exported profile is `persistent-lean` on both sides, while the metric shape now looks closer to the existing `silent-lean` blind spot.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`2`/`1` on Mac, `4`/`1` on Linux), with no queue-pressure, stale, link-unready, or send-failure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Baseline: neither side is `clean-low-latency`, so this is not a clean-call baseline failure.

Primary next target:
- Selector.
- Specifically, tune the `persistent-lean` versus `silent-lean` boundary. Both sides have tiny reserve (`4.907 ms` Mac, `7.181 ms` Linux), very low jitter-depth mean (`0.249` / `0.366` frames), strongly negative playout delta (`-136.111 ms` / `-151.507 ms`), and low obvious damage pressure (`concealmentTicks=0` / `56`, `playoutRateFractionBelow097=0.001` / `0.012`).
- Per `docs/gcall-receive-profiles.md`, that is the `silent-lean` blind spot more than ordinary `persistent-lean`: bad/fragile audibility can exist before concealment and slow-rate counters explode.
- Do not tune `repair-heavy-connected` from this call. The latest repair-heavy target is not active here. Do not raise baseline or move to another subsystem first.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | yes/partly | 4.907 | 152 | 0 | 0.005 | 0.001 | recovery | Classification is too mild/specific: this is ready but almost empty, with low damage counters, matching `silent-lean` better. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `persistent-lean` | yes | 7.181 | 135 | 56 | 0.022 | 0.012 | recovery | Classification partly matches lean behavior, but reserve and delta are severe enough to prefer `silent-lean` over ordinary persistent lean. |

### Side A

Expected profile from symptom:
- `silent-lean`

Actual exported profile:
- `persistent-lean`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs=4.907`, `jitterBufferDepthFramesMean=0.249`, and `avgPlayoutDeltaMs=-136.111` are more severe than ordinary persistent lean.
- `concealmentTicks=0`, `playoutUnderTargetFraction=0.005`, and `playoutRateFractionBelow097=0.001` are exactly why this should use the `silent-lean` blind-spot profile instead of waiting for repair-heavy damage signals.
- The playout snapshot is ready (`jitterBufferedFrames=24`, `jitterHasReadyFrame=true`), so this is not the buffered-not-ready/startup path.

### Side B

Expected profile from symptom:
- `silent-lean`, possibly `persistent-lean` as the weaker fallback.

Actual exported profile:
- `persistent-lean`

Did classification match?
- Partly.

If no:
- This side has slightly more visible damage than Mac (`concealmentTicks=56`, `missingFrames=135`), but the dominant shape is still tiny reserve plus strongly negative delta: `avgPcmBufferedMs=7.181`, `jitterBufferDepthFramesMean=0.366`, and `avgPlayoutDeltaMs=-151.507`.
- Final playout is ready with `23` buffered jitter frames, and decode/key paths are clean, so selector tuning should come before subsystem work.

## Trend Read

Side A:
- Flat tiny-reserve lean path under recovery.
- Reasons seen:
  - `avgPcmBufferedMs` only improves from `4.755` to `4.907 ms`.
  - `missingFrames` increases from `117` to `152`.
  - `concealmentTicks` remains `0`, so the failure is hidden from repair-heavy/collapse damage counters.
  - adaptive mode remains `recovery`; this is not an early low-latency exit.

Side B:
- Flat tiny-reserve lean path with mild damage.
- Reasons seen:
  - `avgPcmBufferedMs` only improves from `6.197` to `7.181 ms`.
  - `missingFrames` increases from `100` to `135`.
  - `concealmentTicks` stays flat at `56`.
  - `playoutUnderTargetFraction` and `playoutRateFractionBelow097` ease slightly but remain non-clean.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-06T23:26Z group-812` | A / Mac standby | `steady-weak-listener` | yes | partly/yes | weak-listener / secondary | Superseded as first target by later calls. |
| `2026-05-06T23:26Z group-812` | B / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Improved in 14:07Z: Linux escalated to `repair-heavy-connected`. |
| `2026-05-07T14:07Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | lean profile / secondary | Still relevant; 17:25Z shows this lean/tiny-reserve shape recurring. |
| `2026-05-07T14:07Z group-812` | B / Linux root | `repair-heavy-connected` | yes | yes/partly | repair-heavy profile strength / hold | Not active in 17:25Z, so do not continue repair-heavy tuning from the new call alone. |
| `2026-05-07T17:25Z group-812` | A / Mac standby | `persistent-lean` | yes/partly | partly/no | selector / silent-lean escalation | Promote ready, near-empty, low-damage paths into `silent-lean`. |
| `2026-05-07T17:25Z group-812` | B / Linux root | `persistent-lean` | yes | partly | selector / silent-lean escalation | Promote tiny-reserve, very negative-delta paths into `silent-lean` before profile-strength or baseline changes. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: strengthen `silent-lean` entry/priority over `persistent-lean` when reserve is extremely low and playout delta is strongly negative, even if concealment, under-target, and slow-rate counters are still mild.
- Keep `repair-heavy-connected` strength/hold as a previous improvement, but pause further repair-heavy tuning until another call actually selects that profile and still sounds bad.
- Keep global baseline, key/decode/session, startup readiness, and transport paths unchanged for the next patch. This batch points at an existing profile selector miss, not a new subsystem or baseline problem.

## Call: 2026-05-07 18:57Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-07T18-57-26-268Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T18-57-31-301Z.json`

User symptom:
- New paired call after the ready `silent-lean` selector change; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and profile mismatch.

High-level verdict:
- Mixed/bad.
- Correctness, key/media establishment, startup playout nodes, queue/backpressure, and failover paths are clean. Mac remains a plausible lean recovery path, but Linux is a clear false-clean classification: it exported `clean-low-latency` while carrying sustained missing-frame, concealment, under-target, and slow-rate pressure.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: bridge/binary high-water values are low (`2`/`2` on Mac, `1`/`3` on Linux), with no queue-pressure, stale, link-unready, or send-failure drops.
- Failover: root/cluster promotion counts are `0` on both sides.
- Transport: packet path is active in both directions with thousands of inbound packet samples and no send failures; packet path timeouts are present but not the dominant blocker in this export.

Primary next target:
- Selector.
- Specifically, prevent `clean-low-latency` from winning on ready buffered repair-pressure paths. Linux has `avgPcmBufferedMs=47.367`, `jitterHasReadyFrame=true`, and `jitterBufferedFrames=10`, so it is not collapsed or startup-blocked, but it also has `missingFrames=278`, `concealmentTicks=90`, `playoutUnderTargetFraction=0.132`, `playoutRateFractionBelow097=0.082`, and `avgPlayoutDeltaMs=-88.342`.
- That shape fits `repair-heavy-connected` or at least `steady-weak-listener`, not `clean-low-latency`.
- Do not tune baseline first. This is not a clean healthy listener sounding bad; it is an exported clean profile despite non-clean metrics. Do not tune `silent-lean` first from this call: Mac did not cross the new tiny-reserve ready gate, and Linux is buffered/damaged rather than silent/tiny.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | partly | 16.920 | 154 | 0 | 0.014 | 0.002 | recovery | Classification mostly matches: ready, low reserve, low jitter depth, strongly negative delta, and low damage counters. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `clean-low-latency` | yes | 47.367 | 278 | 90 | 0.132 | 0.082 | low-latency | Classification is wrong: ready/buffered but damaged and under-target; should promote to `repair-heavy-connected` or `steady-weak-listener`. |

### Side A

Expected profile from symptom:
- `persistent-lean`, possibly bordering `silent-lean` only if reserve falls further.

Actual exported profile:
- `persistent-lean`

Did classification match?
- Yes/partly.

Notes:
- `avgPcmBufferedMs=16.920`, `jitterBufferDepthFramesMean=0.858`, and `avgPlayoutDeltaMs=-129.074` fit a persistent lean path.
- `concealmentTicks=0`, `playoutUnderTargetFraction=0.014`, and `playoutRateFractionBelow097=0.002` keep this out of repair-heavy.
- The side is already in recovery and its reserve is slowly improving from `16.535` to `16.920 ms`, so it is not the first next-fix target.

### Side B

Expected profile from symptom:
- `repair-heavy-connected`, with `steady-weak-listener` as the weaker fallback.

Actual exported profile:
- `clean-low-latency`

Did classification match?
- No.

If no:
- The side is not shallow-collapse: `avgPcmBufferedMs=47.367`, `jitterBufferDepthFramesMean=2.406`, `jitterBufferedFrames=10`, and `jitterHasReadyFrame=true`.
- But it is also not clean: `missingFrames=278`, `concealmentTicks=90`, `playoutUnderTargetFraction=0.132`, `playoutRateFractionBelow097=0.082`, and `avgPlayoutDeltaMs=-88.342`.
- Tune selector entry/priority for ready buffered damage before changing profile strength or baseline.

## Trend Read

Side A:
- Flat/slowly improving lean recovery.
- Reasons seen:
  - `avgPcmBufferedMs` improves slightly from `16.535` to `16.920 ms`.
  - `missingFrames` increases from `120` to `154`.
  - `concealmentTicks` remains `0`.
  - adaptive mode remains `recovery`.

Side B:
- Oscillating false-clean buffered repair path.
- Reasons seen:
  - starts and ends in `low-latency` despite non-clean metrics.
  - `entered-recovery` appears once, then the side exits back to `low-latency`.
  - `missingFrames` increases from `181` to `278`.
  - `concealmentTicks` rises from `86` to `90`.
  - `playoutUnderTargetFraction` remains high at `0.132`, and `playoutRateFractionBelow097` remains high at `0.082`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T14:07Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | lean profile / secondary | Still watch, but not the first target. |
| `2026-05-07T14:07Z group-812` | B / Linux root | `repair-heavy-connected` | yes | yes/partly | repair-heavy profile strength / hold | Superseded as first target by the 18:57Z false-clean selector miss. |
| `2026-05-07T17:25Z group-812` | A / Mac standby | `persistent-lean` | yes/partly | partly/no | selector / silent-lean escalation | Partly improved by the ready `silent-lean` selector change, but 18:57Z Mac is no longer tiny-reserve enough to be the primary miss. |
| `2026-05-07T17:25Z group-812` | B / Linux root | `persistent-lean` | yes | partly | selector / silent-lean escalation | Current batch shifted: Linux is now buffered/damaged and incorrectly clean, not silent/tiny lean. |
| `2026-05-07T18:57Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | persistent-lean / secondary | Keep as evidence; no selector change first from this side. |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Promote ready buffered listeners with sustained missing/concealment plus under-target/slow-rate pressure into `repair-heavy-connected` or `steady-weak-listener`. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: add or strengthen a false-clean escape for ready buffered listeners with sustained damage and playout pressure: missing-frame growth, active concealment, high under-target fraction, slow-rate pressure, and strongly negative delta should not remain `clean-low-latency`.
- Preferred destination is `repair-heavy-connected` when both damage and under-target/slow-rate pressure are present; otherwise `steady-weak-listener` is the weaker fallback.
- Keep global baseline unchanged. Keep key/decode/session, startup readiness, transport, and `silent-lean` strength unchanged for the next patch. This batch points at a selector false negative, not baseline or another subsystem.

## Call: 2026-05-07 19:25Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T19-25-22-670Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T19-25-23-220Z.json`

User symptom:
- New paired call after the latest selector changes; subjective symptom was not included with the export, so user-bad is inferred from receive metrics and profile mismatch.

High-level verdict:
- Mixed/bad.
- Correctness, key/media establishment, startup playout nodes, queue/backpressure, and failover paths are clean enough to keep this in receive-policy territory. Root still exports `clean-low-latency` despite sustained repair pressure, while standby remains in a tiny-buffer lean shape that is closer to the existing `silent-lean` blind spot than ordinary `persistent-lean`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, no link-unready drops, and no send failures. Bridge/binary high-water values are modest (`7`/`5` on root, `2`/`4` on standby).
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Selector.
- The first target remains the false-clean escape for ready buffered repair pressure. Side A has a healthy-looking reserve (`avgPcmBufferedMs=59.879`, `jitterBufferDepthFramesMean=3.036`) but non-clean damage and pressure (`missingFrames=2965`, `concealmentTicks=192`, `playoutUnderTargetFraction=0.086`, `playoutRateFractionBelow097=0.024`, `avgPlayoutDeltaMs=-73.182`) while still classified as `clean-low-latency`.
- Side B is a secondary selector miss: it is ready but almost empty (`avgPcmBufferedMs=9.506`, `jitterBufferDepthFramesMean=0.482`, `avgPlayoutDeltaMs=-139.744`) with mild obvious damage, which still fits `silent-lean` better than ordinary `persistent-lean`.
- Do not tune global baseline first. This is not a clean healthy listener sounding bad; the exported classifications are missing existing bad-profile shapes. Do not move to another subsystem first because the quick-triage correctness paths are clean.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QiNKXR...RHHo` receiving `QP9Jj4...i6rP` | `clean-low-latency` | yes | 59.879 | 2965 | 192 | 0.086 | 0.024 | low-latency | Classification is wrong: ready and buffered, but damaged and under-target enough to leave clean mode. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QiNKXR...RHHo` | `persistent-lean` | yes/partly | 9.506 | 2354 | 51 | 0.002 | 0.001 | recovery | Classification is partly too mild/specific: ready, near-empty, strongly negative delta, and low damage counters fit `silent-lean` better. |

### Side A

Expected profile from symptom:
- `repair-heavy-connected`, with `steady-weak-listener` as the weaker fallback.

Actual exported profile:
- `clean-low-latency`

Did classification match?
- No.

If no:
- The side is ready and buffered (`jitterBufferedFrames=10`, `jitterHasReadyFrame=true`, `avgPcmBufferedMs=59.879`), so this is not collapse or startup readiness.
- It is also not clean: `missingFrames` rose from `2922` to `2965` during the sampled window, `concealmentTicks=192`, `playoutUnderTargetFraction=0.086`, and `avgPlayoutDeltaMs=-73.182`.
- Tune selector entry/priority so buffered listeners with sustained missing-frame/concealment pressure and under-target pressure cannot remain `clean-low-latency`.

### Side B

Expected profile from symptom:
- `silent-lean`, with `persistent-lean` as the weaker fallback.

Actual exported profile:
- `persistent-lean`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs=9.506`, `jitterBufferDepthFramesMean=0.482`, and `avgPlayoutDeltaMs=-139.744` are severe lean signals.
- `concealmentTicks=51`, `playoutUnderTargetFraction=0.002`, and `playoutRateFractionBelow097=0.001` explain why repair/collapse profiles should not win, but they also match the `silent-lean` blind spot: very shallow reserve before obvious damage counters explode.
- Playout is ready (`jitterBufferedFrames=23`, `jitterHasReadyFrame=true`), so this is not the buffered-not-ready/startup path.

## Trend Read

Side A:
- Flat false-clean buffered repair path.
- Reasons seen:
  - adaptive mode remains `low-latency` for the whole sampled trend.
  - `missingFrames` increases from `2922` to `2965`.
  - `concealmentTicks` stays at `192`.
  - `avgPcmBufferedMs` stays near `59.7` to `59.9 ms`, so the problem is not a collapsed reserve.

Side B:
- Flat tiny-reserve lean recovery.
- Reasons seen:
  - adaptive mode remains `recovery` for the whole sampled trend.
  - `avgPcmBufferedMs` is pinned around `9.503` to `9.506 ms`.
  - `missingFrames` increases from `2316` to `2354`.
  - `concealmentTicks` stays at `51`, with very low under-target and slow-rate pressure.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T17:25Z group-812` | A / Mac standby | `persistent-lean` | yes/partly | partly/no | selector / silent-lean escalation | Still relevant as secondary evidence for near-empty ready listeners. |
| `2026-05-07T17:25Z group-812` | B / Linux root | `persistent-lean` | yes | partly | selector / silent-lean escalation | Still relevant as secondary evidence, but current first target is false-clean repair pressure. |
| `2026-05-07T18:57Z group-812` | A / Mac standby | `persistent-lean` | partly | yes/partly | persistent-lean / secondary | Watch only; not the first target. |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Repeats in 19:25Z; selector escape is still insufficient. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Promote ready buffered listeners with sustained missing/concealment plus under-target/negative-delta pressure into `repair-heavy-connected` or `steady-weak-listener`. |
| `2026-05-07T19:25Z group-937` | B / Linux standby | `persistent-lean` | yes/partly | partly/no | selector / silent-lean escalation | Secondary: promote ready near-empty, low-damage paths into `silent-lean`, but do this after the repeated false-clean escape. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: strengthen the false-clean escape for ready buffered repair pressure. The repeated miss is now clearer because Side A is not shallow, not startup-blocked, not decode/key broken, and not transport-backed up; it is simply damaged enough that `clean-low-latency` should not win.
- Preferred destination remains `repair-heavy-connected` when missing-frame/concealment pressure combines with under-target or strongly negative playout delta; otherwise use `steady-weak-listener` as the weaker fallback.
- Secondary selector fix: after the false-clean escape, tighten `silent-lean` priority over `persistent-lean` for ready near-empty listeners with very negative playout delta and low obvious damage counters.
- Keep profile strength, global baseline, startup readiness, key/decode/session, and transport unchanged for the next patch. The batch points at selector false negatives, not profile strength or another subsystem.

## Call: 2026-05-07 19:48Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-109.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T19-48-09-713Z.json`

User symptom:
- Another group call from before the latest selector patch. Subjective symptom was not included with the export, so user-bad is inferred from receive metrics and profile mismatch.

High-level verdict:
- Bad.
- Correctness, key/media establishment, startup playout nodes, queue/backpressure, and failover paths are clean. This is receive-policy dominated, but it is not just the previous false-clean case: root is already in `steady-weak-listener` and still looks too mild for the damage, while standby is classified as `silent-lean` even though the damage counters are far beyond the low-damage silent-lean shape.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, and live policy profiles.
- Startup hidden playout nodes: both sides have active playback/scheduler nodes and `jitterHasReadyFrame=true`.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, no link-unready drops, and no send failures. Bridge/binary high-water values are modest (`13`/`5` on root, `2`/`4` on standby).
- Failover: root/cluster promotion counts are `0` on both sides.

Primary next target:
- Selector, with a broader repair-damage escalation after the false-clean patch.
- Side A says the selector should not stop at `steady-weak-listener` when a ready listener has shallow/moderate reserve plus sustained missing/concealment damage and very negative delta.
- Side B says `silent-lean` should be reserved for near-empty low-damage paths. Near-empty plus exploding missing/concealment should escalate to `repair-collapse` or `collapse-recovery`, not remain `silent-lean`.
- This does not change the immediate patch already made for the repeated false-clean miss, but it should be the next selector refinement if another post-fix call still sounds bad.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | yes | 28.707 | 1695 | 248 | 0.029 | 0.023 | recovery | Classification is too mild: ready, shallow/moderate reserve, high damage, and very negative delta fit `repair-heavy-connected` better. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `silent-lean` | yes | 4.140 | 2612 | 3882 | 0.052 | 0.051 | recovery | Classification is wrong/too weak for damage: this is near-empty repair collapse, not low-damage silent-lean. |

### Side A

Expected profile from symptom:
- `repair-heavy-connected`, with `steady-weak-listener` as the weaker fallback only if damage pressure is mild.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs=28.707`, `jitterBufferDepthFramesMean=1.455`, and `avgPlayoutDeltaMs=-101.850` show a ready but shallow/moderate reserve.
- `missingFrames=1695` and `concealmentTicks=248` are too damaged for ordinary weak-listener behavior, even though `playoutUnderTargetFraction=0.029` and `playoutRateFractionBelow097=0.023` are only moderate.
- Tune selector escalation from `steady-weak-listener` to `repair-heavy-connected` for sustained ready damage with strongly negative delta.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`.

Actual exported profile:
- `silent-lean`

Did classification match?
- No.

If no:
- `avgPcmBufferedMs=4.140`, `jitterBufferDepthFramesMean=0.210`, and `avgPlayoutDeltaMs=-141.553` are severe reserve-collapse signals.
- The usual damage counters are not mild: `missingFrames=2612`, `concealmentTicks=3882`, `playoutUnderTargetFraction=0.052`, and `playoutRateFractionBelow097=0.051`.
- This should not be handled as the silent-lean blind spot. Tune selector priority so high-concealment near-empty ready paths promote into `repair-collapse` or `collapse-recovery`.

## Trend Read

Side A:
- Flat bad repair path under recovery.
- Reasons seen:
  - adaptive mode remains `recovery`.
  - `avgPcmBufferedMs` stays around `28.6` to `28.7 ms`.
  - `missingFrames` increases from `1656` to `1695`.
  - `concealmentTicks` stays high at `248`.

Side B:
- Flat severe near-empty repair collapse.
- Reasons seen:
  - adaptive mode remains `recovery`.
  - `avgPcmBufferedMs` stays pinned around `4.1 ms`.
  - `missingFrames` increases from `2495` to `2612`.
  - `concealmentTicks` increases from `3700` to `3882`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by latest code change: ready buffered damage now escapes clean. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by latest code change for moderate-reserve false-clean repair pressure. |
| `2026-05-07T19:25Z group-937` | B / Linux standby | `persistent-lean` | yes/partly | partly/no | selector / silent-lean escalation | Partly covered by latest code change: ready near-empty low-damage paths get `silent-lean`. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Next refinement: promote ready shallow/moderate-reserve damage from weak-listener into `repair-heavy-connected`. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Next refinement: high-concealment near-empty ready paths should promote from `silent-lean` into `repair-collapse` or `collapse-recovery`. |

## Next Fix Target

Current patched target:
- Selector.
- The latest code change still addresses the most repeated pre-fix miss: false-clean ready buffered repair pressure.
- This additional pre-fix call suggests the next selector refinement if post-fix diagnostics remain bad: repair-damage escalation above weak/lean profiles. `steady-weak-listener` should not hold when sustained damage and very negative delta are present, and `silent-lean` should not hold when concealment/missing counters are already severe.
- Do not tune baseline or another subsystem from this call. The paths are established and correctness counters are clean.

## Call: 2026-05-07 20:30Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-110.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T20-30-11-392Z.json`

User symptom:
- New call after the latest changes; user reported it was a horrible call.

High-level verdict:
- Catastrophic.
- This call is not primarily a baseline or profile-strength failure. Both sides are already in recovery-class receive behavior, but the paired exports show authority/topology divergence and send-target symptoms: Side A says root is `QTSzRS...9jMn` at epoch `3` with `QP9Jj4...i6rP` as standby, while Side B says root is `QP9Jj4...i6rP` at epoch `4` with no standby. Side B also has `outboundNoTargetSkips=4407` and `forwardRecipientCount=0`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt` is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure` and `packetsDroppedDecoderThrow` are `0` on both sides.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, no link-unready drops, and no send failures. Bridge/binary high-water values are modest (`7`/`7` on Side A, `4`/`3` on Side B).
- Basic media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, playback nodes, scheduler nodes, and live policy profiles.
- Baseline: neither side is healthy-looking or `clean-low-latency`; this is not a low-latency baseline sounding bad.

Primary next target:
- Another subsystem: authority/topology convergence and send-target selection after root/standby transition.
- The receive profiles are not the first thing to tune from this call. The paired snapshots disagree on root authority, Side B has no standby and no forward recipients, and outbound no-target skips keep increasing during the sampled window. Fixing profile strength cannot repair a side that is not consistently targeting the peer.
- Secondary follow-up after topology/send-target correctness: selector priority for `buffered-not-ready` should be checked, because Side B exports `buffered-not-ready` even though its current playout says `jitterHasReadyFrame=true`.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `collapse-recovery` | yes | 13.502 | 710 | 2172 | 0.190 | 0.185 | recovery | Profile mostly matches severe collapse, but current playout has `jitterBufferedFrames=8` and `jitterHasReadyFrame=false`, so readiness is also implicated. |
| B | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `buffered-not-ready` | yes | 6.484 | 1608 | 518 | 0.019 | 0.016 | recovery | Profile does not match the current readiness snapshot: `jitterHasReadyFrame=true`; metrics fit near-empty repair collapse better than buffered-not-ready. |

### Side A

Expected profile from symptom:
- `collapse-recovery`, with a possible `buffered-not-ready` secondary because current playout has buffered frames but no ready frame.

Actual exported profile:
- `collapse-recovery`

Did classification match?
- Partly/yes.

Notes:
- `avgPcmBufferedMs=13.502`, `jitterBufferDepthFramesMean=0.684`, `avgPlayoutDeltaMs=-114.588`, `playoutUnderTargetFraction=0.190`, `playoutRateFractionBelow097=0.185`, and `concealmentTicks=2172` fit a real collapse symptom.
- The readiness snapshot is still suspicious: `jitterBufferedFrames=8` while `jitterHasReadyFrame=false`.
- This side alone would support collapse-profile strength/readiness investigation, but the paired topology mismatch makes authority/send-target correctness the first target.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`.

Actual exported profile:
- `buffered-not-ready`

Did classification match?
- No/partly.

If no:
- `avgPcmBufferedMs=6.484`, `jitterBufferDepthFramesMean=0.328`, `avgPlayoutDeltaMs=-148.967`, `missingFrames=1608`, and `concealmentTicks=518` are too damaged for a pure buffered-not-ready label.
- Current playout says `jitterBufferedFrames=15` and `jitterHasReadyFrame=true`, so the exported profile is stale or winning for the wrong reason.
- However, do not tune selector first from this side because the same export also reports `topologyStandbyForwarder=null`, `forwardRecipientCount=0`, flat `outboundSendAttempts=7593`, and `outboundNoTargetSkips` rising from `3855` to `4407`.

## Trend Read

Side A:
- Flat-bad/degrading recovery collapse.
- Reasons seen:
  - `avgPcmBufferedMs` falls from `14.336` to `13.502 ms`.
  - `concealmentTicks` rises from `1997` to `2172`.
  - `playoutUnderTargetFraction` rises from `0.186` to `0.190`.
  - `playoutRateFractionBelow097` rises from `0.181` to `0.185`.
  - `outboundNoTargetSkips` is already high at `1423`, though outbound sends still increase.

Side B:
- Flat severe near-empty recovery with send-target failure signs.
- Reasons seen:
  - `avgPcmBufferedMs` stays pinned around `6.3` to `6.5 ms`.
  - `missingFrames` rises from `1493` to `1608`.
  - `concealmentTicks` rises from `513` to `518`.
  - `outboundSendAttempts` stays flat at `7593` across the whole sampled trend.
  - `outboundNoTargetSkips` rises from `3855` to `4407`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by latest selector work; not the current post-change failure shape. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by latest selector work; not the current post-change failure shape. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid selector refinement, but superseded by the 20:30Z topology/send-target failure. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Still a valid selector refinement, but superseded by the 20:30Z topology/send-target failure. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Inspect topology convergence and readiness after root transition before profile strength. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Fix root/standby convergence and outbound target selection; `outboundNoTargetSkips` is the strongest next signal. |

## Next Fix Target

Current patched target:
- Another subsystem.
- Primary fix: authority/topology convergence and outbound target selection after root/standby transition. The key evidence is the paired split-brain snapshot: both sides claim `root-forwarder`, they disagree on `topologyRootForwarder`, Side B has `topologyStandbyForwarder=null`, Side B has `forwardRecipientCount=0`, and Side B's `outboundNoTargetSkips` grows while `outboundSendAttempts` stays flat.
- Secondary after that: selector priority around `buffered-not-ready` versus repair collapse, because Side B was currently ready but still labeled `buffered-not-ready`.
- Do not tune baseline next. Do not tune profile strength first. The horrible symptom aligns better with topology/send-target failure plus severe receive collapse than with a too-weak receive profile.

## Call: 2026-05-07 21:23Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-111.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T21-23-20-156Z.json`

User symptom:
- New call following the latest changes. No separate subjective symptom text was included with the export, so user-bad is inferred from the severe receive metrics and recovery profiles.

High-level verdict:
- Bad.
- The previous authority/topology split is not reproduced here: both exports agree on epoch `3`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, and both sides have forward recipients. The remaining failure shape is receive-policy dominated: one side is correctly in `collapse-recovery`, while the other is still classified as `silent-lean` despite meaningful missing/concealment damage.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, playback nodes, scheduler nodes, and live policy profiles.
- Startup hidden playout nodes: both sides currently have `jitterHasReadyFrame=true` with active playback and scheduler nodes.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, no link-unready drops, and no packet send failures. Queue high waters are bounded (`48`/`8` on Side A, `2`/`14` on Side B).
- Authority/topology convergence: unlike the 20:30Z call, both sides agree on root/standby at epoch `3`. Side B has `outboundNoTargetSkips=0`; Side A has historical `outboundNoTargetSkips=815`, but it is flat across the sampled window while sends continue succeeding.

Primary next target:
- Profile strength, with a secondary selector cleanup.
- Side B says `collapse-recovery` classification is now correct, but the listener still lives around `7 ms` buffered with heavy missing/concealment and sustained recovery mode. That points at collapse/recovery target boost, floor, and hold strength before baseline changes.
- Side A says the selector should still escalate high-damage near-empty `silent-lean` into a collapse-class profile when missing/concealment counters are no longer mild. This is secondary because the paired call already proves the collapse profile itself is active on the worse side and still not sufficient.
- Do not return to baseline first. Do not prioritize authority/send-target first from this sample.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `silent-lean` | yes | 3.991 | 931 | 473 | 0.025 | 0.014 | recovery | Near-empty and very negative delta fit `silent-lean`, but the damage counters are too high for the low-damage blind-spot shape. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `collapse-recovery` | yes | 7.163 | 2628 | 1962 | 0.051 | 0.048 | recovery | Classification matches severe near-empty collapse, but quality remains bad under recovery protection. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`, with `silent-lean` only if damage counters are mild.

Actual exported profile:
- `silent-lean`

Did classification match?
- Partly/no.

If no:
- `avgPcmBufferedMs=3.991`, `jitterBufferDepthFramesMean=0.203`, and `avgPlayoutDeltaMs=-178.908` fit the near-empty `silent-lean` family.
- However, `missingFrames=931`, `concealmentTicks=473`, and recovery mode mean this is no longer just a quiet low-damage lean blind spot.
- Selector priority should promote near-empty ready paths out of `silent-lean` once repair damage is sustained.

### Side B

Expected profile from symptom:
- `collapse-recovery`.

Actual exported profile:
- `collapse-recovery`.

Did classification match?
- Yes.

Notes:
- `avgPcmBufferedMs=7.163`, `jitterBufferDepthFramesMean=0.363`, `avgPlayoutDeltaMs=-149.232`, `missingFrames=2628`, `concealmentTicks=1962`, `playoutUnderTargetFraction=0.051`, and `playoutRateFractionBelow097=0.048` fit severe receive collapse.
- Because classification matched but quality still appears bad, tune collapse/recovery strength before changing baseline policy.

## Trend Read

Side A:
- Flat near-empty recovery with slow damage growth.
- Reasons seen:
  - `avgPcmBufferedMs` stays pinned around `4.0 ms`.
  - `missingFrames` rises from `918` to `931`.
  - `concealmentTicks` rises from `468` to `473`.
  - `outboundNoTargetSkips` remains flat at `815` while outbound successes increase, so this is not the 20:30Z no-target failure shape.

Side B:
- Flat severe collapse under recovery.
- Reasons seen:
  - `avgPcmBufferedMs` stays around `7.15` to `7.16 ms`.
  - `missingFrames` rises from `2619` to `2628`.
  - `concealmentTicks` rises from `1930` to `1962`.
  - `outboundNoTargetSkips` remains `0` and outbound sends continue succeeding.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by latest selector work; not the current post-change failure shape. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by latest selector work; not the current post-change failure shape. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid selector refinement, but no longer the strongest target after the 21:23Z call. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Still valid as the secondary selector cleanup for high-damage lean paths. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Topology/send-target was the best target for that call, but the 21:23Z pair does not reproduce the split. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Superseded as primary by the converged 21:23Z call; keep as a regression watch. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Secondary: promote near-empty ready `silent-lean` into collapse when missing/concealment damage is sustained. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Primary: strengthen collapse/recovery target, floor, and hold behavior. |

## Next Fix Target

Current patched target:
- Profile strength.
- Primary fix: strengthen `collapse-recovery` behavior. The new call has converged topology, clean decrypt/decode/queue counters, active ready playouts, and a correctly classified collapse side that still remains near-empty with heavy repair damage.
- Secondary fix: selector escalation from `silent-lean` to collapse-class profiles when near-empty ready paths have sustained missing/concealment counters. This should be done after or alongside collapse strength only if the change is tightly scoped.
- Keep baseline unchanged. The evidence is not that normal low-latency baseline is bad; both sides are already in recovery-class behavior. Keep authority/send-target as a regression watch, but it is not the next fix target from this call.

## Call: 2026-05-07 21:50Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T21-50-46-095Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-07T21-50-42-339Z.json`

User symptom:
- New call following the latest changes. User reported the first ~2 minutes were bad, then the call became better.

High-level verdict:
- Mixed / improving, but not clean.
- The paired exports agree on topology: root `QeJW96...j5W9`, standby `QP9Jj4...i6rP`, epoch `3`, both with forward recipients and no no-target growth. The final sampled window is structurally healthy but still receive-policy dominated. Side A looks like residual weak-listener recovery; Side B is the miss: it reports `clean-low-latency` while its receive metrics still look near-empty and heavily repaired.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playouts, playback nodes, scheduler nodes, and live policy profiles.
- Startup hidden playout nodes: both current playouts have `jitterHasReadyFrame=true` and active playback/scheduler nodes.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, no link-unready drops, and no packet send failures. Queue high waters are bounded (`7`/`5` on Side A, `2`/`8` on Side B), though decoded-queue old-age high water shows historical bursts (`1685 ms` on Side A, `684 ms` on Side B).
- Authority/topology/send-target: both sides agree on root/standby at epoch `3`; outbound sends continue increasing; `outboundNoTargetSkips=0` throughout the sampled window on both sides.

Primary next target:
- Selector.
- Side B is a current false-clean classification: `clean-low-latency` does not match `avgPcmBufferedMs=5.636`, `jitterBufferDepthFramesMean=0.287`, `avgPlayoutDeltaMs=-147.227`, `missingFrames=3314`, `concealmentTicks=6499`, `playoutUnderTargetFraction=0.042`, and `playoutRateFractionBelow097=0.040`.
- Because the bad first minutes later improved, do not tune baseline broadly. The next fix should ensure ready near-empty/high-damage recovery paths cannot be surfaced as `clean-low-latency`; they should remain in `repair-collapse`/`collapse-recovery` or at least `steady-weak-listener` until reserve and damage actually clear.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QeJW96...j5W9` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | partly/early | 23.969 | 3396 | 220 | 0.008 | 0.006 | recovery | Classification is plausible for the later better phase: reserve is still shallow/moderate and missing grows slowly, but concealment and under-target pressure are low. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QeJW96...j5W9` | `clean-low-latency` | yes/early, partly current | 5.636 | 3314 | 6499 | 0.042 | 0.040 | recovery | Classification is wrong: live profile says clean, but the path is near-empty with heavy repair damage and still in recovery. |

### Side A

Expected profile from symptom:
- `steady-weak-listener` or possibly `repair-heavy-connected` during the early bad phase; `steady-weak-listener` is reasonable for the later improved phase.

Actual exported profile:
- `steady-weak-listener`

Did classification match?
- Partly/yes.

Notes:
- The final sampled window is not clean, but it is much better than the previous collapse shape: `avgPcmBufferedMs=23.969`, `jitterBufferDepthFramesMean=1.215`, `concealmentTicks=220`, `playoutUnderTargetFraction=0.008`, and `playoutRateFractionBelow097=0.006`.
- `missingFrames` is still high cumulatively and rises from `3360` to `3396` across the final ~11 seconds, so this is still weak/residual recovery rather than clean-low-latency.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`; `steady-weak-listener` would be the weakest acceptable fallback only after reserve rebuilds.

Actual exported profile:
- `clean-low-latency`

Did classification match?
- No.

If no:
- `avgPcmBufferedMs=5.636`, `jitterBufferDepthFramesMean=0.287`, and `avgPlayoutDeltaMs=-147.227` are near-empty collapse signals.
- `missingFrames=3314`, `concealmentTicks=6499`, `playoutUnderTargetFraction=0.042`, and `playoutRateFractionBelow097=0.040` are not compatible with a clean profile.
- Tune selector/clear logic so a ready but near-empty high-damage recovery path cannot clear to `clean-low-latency` until reserve and repair pressure have actually recovered.

## Trend Read

Side A:
- Flat weak recovery in the sampled end window.
- Reasons seen:
  - `avgPcmBufferedMs` stays around `23.97 ms`.
  - `concealmentTicks` stays flat at `220`.
  - `missingFrames` rises slowly from `3360` to `3396`.
  - `outboundNoTargetSkips` remains `0`.

Side B:
- Flat near-empty recovery despite clean profile.
- Reasons seen:
  - `avgPcmBufferedMs` stays pinned around `5.64 ms`.
  - `missingFrames` rises from `3280` to `3314`.
  - `concealmentTicks` rises from `6411` to `6499`.
  - `playoutUnderTargetFraction` and `playoutRateFractionBelow097` remain elevated at `0.042` and `0.040`.
  - `outboundNoTargetSkips` remains `0`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid secondary selector refinement. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Covered by the high-damage lean escalation target. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Keep as regression watch; not reproduced in later converged calls. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Keep as regression watch; later calls have converged topology and no no-target growth. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Addressed by promoting high-damage near-empty ready paths out of `silent-lean`. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Addressed by strengthening collapse target/floor/hold; verify with later exports. |
| `2026-05-07T21:50Z group-937` | A / Linux root epoch 3 | `steady-weak-listener` | partly/early | partly/yes | receive / residual weak recovery | Watch; no immediate profile-strength change from this side. |
| `2026-05-07T21:50Z group-937` | B / Linux standby epoch 3 | `clean-low-latency` | yes/early, partly current | no | selector / false-clean near-empty repair collapse | Primary: prevent clean-low-latency while ready near-empty damage and recovery pressure remain active. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: tighten `clean-low-latency` clear/entry so it cannot win for ready near-empty listeners with strong negative delta, ongoing recovery mode, and sustained missing/concealment pressure. The 21:50Z standby export is the clearest signal: the call subjectively improved, but the profile exported as clean while the buffer and damage metrics still describe repair collapse.
- Secondary: keep the recent collapse-strength patch and high-damage `silent-lean` escalation; this call does not argue for a broader baseline increase because one side improved to a plausible `steady-weak-listener` shape and the infrastructure/path counters are clean.
- Do not prioritize authority/topology, key/decode, startup, or global baseline from this pair.

## Call: 2026-05-08 10:48Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-08T10-48-20-638Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-08T10-48-23-113Z.json`

User symptom:
- New call following the latest changes. No separate subjective symptom text was included with the export, so user-bad is inferred from the receive metrics, recovery mode, and profile churn.

High-level verdict:
- Mixed / still not clean.
- The previous topology and no-target failures are not present: both exports agree on room `gcall-qortal-812`, root `QP9Jj4...i6rP`, standby `QaU2XU...Jh91`, and epoch `3`; both sides have active ready playouts, decoded packets, room keys, forward recipients, and no outbound no-target growth. The remaining shape is receive-policy instability: the Linux root is mostly weak/recovery but briefly clears to low-latency while still under target, and the Mac standby lives in lean profiles with recovery still active.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playback nodes, active scheduler nodes, and live receive-policy profiles.
- Startup hidden playout nodes: current playouts are active and ready on both sides; Side A has `jitterHasReadyFrame=true`, and Side B exports `jitterHasReadyFrame=true` with only one recent not-ready trend sample.
- Queue/backpressure: no bridge drain wait, queue-pressure drops, stale drops, link-unready drops, or packet send failures. Queue high waters are bounded (`7`/`2` on Side A, `2`/`44` on Side B).
- Authority/topology/send-target: both sides agree on root/standby at epoch `3`; outbound sends keep succeeding; `outboundNoTargetSkips=0` throughout the sampled window on both sides.

Primary next target:
- Selector.
- More specifically, profile stability / clean-clear gating. Side A oscillates between `steady-weak-listener`, `repair-heavy-connected`, `persistent-lean`, `buffered-not-ready`, and even `clean-low-latency` while `playoutUnderTargetFraction=0.115`, `playoutRateFractionBelow097=0.075`, recovery keeps re-entering, and missing frames continue growing. Side B is dominated by lean profiles with a very shallow buffer (`11.542 ms`) and recovery mode still active.
- Do not tune baseline next. This is not evidence that ordinary low-latency baseline is too small; the receive engine is already detecting weak/lean/recovery conditions most of the time. Do not return to authority/topology or key/decode from this pair.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | partly/inferred | 35.493 | 689 | 131 | 0.115 | 0.075 | recovery | Dominant profile is plausible for weak recovery, but recent trends show premature low-latency clears and rapid profile oscillation while under-target pressure remains high. |
| B | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | partly/inferred | 11.542 | 535 | 47 | 0.011 | 0.007 | recovery | Lean classification is mostly plausible: buffer is shallow, delta is strongly negative, and recovery remains active; damage is moderate rather than collapse-heavy. |

### Side A

Expected profile from symptom:
- `steady-weak-listener` or `repair-heavy-connected`, with no `clean-low-latency` until under-target and recovery pressure clear.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener`.
- Current exported profile: `persistent-lean`.
- Recent trends also include `buffered-not-ready`, `repair-heavy-connected`, and one `clean-low-latency` sample.

Did classification match?
- Partly.

If no:
- The dominant profile is directionally right: `avgPcmBufferedMs=35.493`, `missingFrames=689`, `concealmentTicks=131`, and recovery mode fit weak/repaired audio rather than a clean path.
- The miss is selector stability and clear logic. A side with `playoutUnderTargetFraction=0.115`, `playoutRateFractionBelow097=0.075`, repeated `entered-recovery`, and growing missing frames should not briefly clear to `clean-low-latency`, and it should not flip between weak/repair/lean profiles every few dozen milliseconds.

### Side B

Expected profile from symptom:
- `persistent-lean` or `silent-lean`; possibly `repair-collapse` only during short near-empty damage bursts.

Actual exported profile:
- Dominant sampled profile: `persistent-lean`.
- Current exported profile: `silent-lean`.

Did classification match?
- Mostly/partly.

Notes:
- `avgPcmBufferedMs=11.542`, `jitterBufferDepthFramesMean=0.584`, `avgPlayoutDeltaMs=-119.279`, and recovery mode fit lean-listener behavior.
- `missingFrames=535` is no longer a completely quiet blind-spot shape, but `concealmentTicks=47`, `playoutUnderTargetFraction=0.011`, and `playoutRateFractionBelow097=0.007` are milder than the earlier collapse samples. This does not justify a new profile or a broad baseline change.

## Trend Read

Side A:
- Oscillating weak recovery.
- Reasons seen:
  - Profile samples include `clean-low-latency`, `collapse-recovery`, `steady-weak-listener`, `repair-heavy-connected`, `repair-collapse`, `persistent-lean`, and `buffered-not-ready`.
  - Recent window flips from `buffered-not-ready` to `steady-weak-listener`, briefly to `clean-low-latency`, then back through `repair-heavy-connected` / `steady-weak-listener`.
  - `missingFrames` rises from `599` to `689` in the final sampled window, with `entered-recovery` appearing twice.
  - `outboundNoTargetSkips` remains `0`, so this is not a send-target failure.

Side B:
- Gradual/flat lean recovery with a late not-ready blip.
- Reasons seen:
  - `avgPcmBufferedMs` stays around `11.35` to `11.58 ms`.
  - `missingFrames` rises from `492` to `535`; `concealmentTicks` is nearly flat from `46` to `47`.
  - Profile stays mostly `persistent-lean`, then flips to `silent-lean` near the end.
  - One recent trend has `jitterHasReadyFrame=false`, but the export currently has ready playout and no startup/path failure.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid secondary selector refinement. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Covered by the high-damage lean escalation target. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Keep as regression watch; not reproduced in later converged calls. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Keep as regression watch; later calls have converged topology and no no-target growth. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Addressed by promoting high-damage near-empty ready paths out of `silent-lean`. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Addressed by strengthening collapse target/floor/hold; verify with later exports. |
| `2026-05-07T21:50Z group-937` | A / Linux root epoch 3 | `steady-weak-listener` | partly/early | partly/yes | receive / residual weak recovery | Watch; no immediate profile-strength change from this side. |
| `2026-05-07T21:50Z group-937` | B / Linux standby epoch 3 | `clean-low-latency` | yes/early, partly current | no | selector / false-clean near-empty repair collapse | Primary: prevent clean-low-latency while ready near-empty damage and recovery pressure remain active. |
| `2026-05-08T10:48Z group-812` | A / Linux root epoch 3 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Primary: add hysteresis/clear gating so weak or repair-heavy recovery cannot briefly clear to clean while under-target/rate pressure remains high. |
| `2026-05-08T10:48Z group-812` | B / Mac standby epoch 3 | `persistent-lean` | partly/inferred | mostly/partly | receive / lean recovery | Watch; no baseline or new-profile change from this side. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: stabilize receive-profile selection and clean-clear gating. The latest pair no longer shows dominant false-clean collapse, topology split, key/decode failure, or startup failure. It shows the selector still bouncing between profiles and occasionally allowing `clean-low-latency` during active under-target/recovery pressure.
- Target the clear/hold logic around `steady-weak-listener`, `repair-heavy-connected`, `persistent-lean`, and `clean-low-latency`: once recovery is active and under-target/rate pressure remains elevated, require a sustained quiet window before clearing to clean, and avoid per-tick oscillation between weak/repair/lean profiles.
- Keep profile strength and baseline unchanged from this call. Side B's lean classification mostly matches its metrics, and Side A's problem is not that one profile is too weak; it is that the selector does not stay in the appropriate recovery class long enough.

## Call: 2026-05-08 12:06Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-08T12-06-52-922Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-08T12-06-55-383Z.json`

User symptom:
- New call following the latest changes. No separate subjective symptom text was included with the export, so user-bad is inferred from receive metrics, recovery mode, and profile churn.

High-level verdict:
- Mixed / still weak, with better classification than earlier false-clean calls.
- Both exports agree on room `gcall-qortal-812`, root `QP9Jj4...i6rP`, standby `QaU2XU...Jh91`, and epoch `1`. There is no key/decode/startup/send-target failure. The Linux root still shows selector oscillation and one brief clean clear, but the Mac standby is now classified into lean/recovery profiles while remaining almost empty for the whole sampled window.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Key/media establishment: both sides have room keys, inbound packets, decoded frames, active playback nodes, active scheduler nodes, and live receive-policy profiles.
- Startup hidden playout nodes: current playouts are active and ready on both sides; `jitterHasReadyFrame=true` in the current playouts.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, no link-unready drops, and no packet send failures. Queue high waters are bounded.
- Authority/topology/send-target: both sides agree on root/standby at epoch `1`; outbound sends keep succeeding; `outboundNoTargetSkips=0` throughout both sampled windows.

Primary next target:
- Profile strength, focused on `persistent-lean` / lean recovery behavior.
- Side B is the clearest new evidence: classification is mostly correct, but `persistent-lean` dominates 47 of 59 samples while `avgPcmBufferedMs` only reaches `2.243 ms`, `avgPlayoutDeltaMs=-182.757`, recovery mode remains active, and missing frames rise steadily to `160`. The profile applied strong target/floor values (`lastAppliedTargetMs=204`, `lastAppliedFloorMs=192`), but the listener still did not build usable PCM reserve.
- Selector stability is still a secondary issue on Side A because it briefly clears to `clean-low-latency` while under-target/rate pressure and missing-frame growth continue. This new pair does not point to baseline, key/decode, startup, authority, or a new profile.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` | partly/inferred | 33.524 | 302 | 54 | 0.135 | 0.053 | recovery | Directionally plausible weak/repaired classification, but the selector still oscillates and briefly clears to clean while pressure remains active. |
| B | standby-forwarder / Mac / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` | yes/inferred | 2.243 | 160 | 0 | 0.002 | 0.000 | recovery | Classification matches a lean listener, but the profile is not strong enough or not effective enough to rebuild reserve. |

### Side A

Expected profile from symptom:
- `steady-weak-listener`, `repair-heavy-connected`, or short `repair-collapse` during the worst windows; no sustained `clean-low-latency` until under-target/rate pressure clears.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener`.
- Current exported profile: `steady-weak-listener`.
- Recent trends also include `clean-low-latency`, `repair-collapse`, and `repair-heavy-connected`.

Did classification match?
- Partly.

If no:
- The dominant profile is directionally right: `avgPcmBufferedMs=33.524`, `missingFrames=302`, `concealmentTicks=54`, `playoutUnderTargetFraction=0.135`, `playoutRateFractionBelow097=0.053`, and recovery mode fit weak/repaired audio rather than a clean path.
- The miss is still selector stability. At `1778242004446`, the side reports `clean-low-latency` while `playoutUnderTargetFraction=0.135`, `playoutRateFractionBelow097=0.058`, and `missingFramesDelta=10`; one second later it re-enters recovery and then repair profiles.

### Side B

Expected profile from symptom:
- `persistent-lean` or `silent-lean`; `repair-collapse` is acceptable only for short missing-frame bursts.

Actual exported profile:
- Dominant sampled profile: `persistent-lean`.
- Current exported profile: `persistent-lean`.
- Recent summary also includes short `silent-lean` and `repair-collapse` periods.

Did classification match?
- Mostly/yes.

Notes:
- `avgPcmBufferedMs=2.243`, `jitterBufferDepthFramesMean=0.114`, `avgPlayoutDeltaMs=-182.757`, and recovery mode are exactly lean-listener signals.
- This is no longer a false-clean classification. The problem is that the correct lean profile stays active but does not produce enough reserve; `missingFrames` rises by about 3 per second in the final trend samples even though `concealmentTicks=0`.
- The very fast transitions between `persistent-lean`, `silent-lean`, `steady-weak-listener`, and occasional `repair-collapse` are worth watching, but the dominant symptom is profile effectiveness rather than selector recognition.

## Trend Read

Side A:
- Oscillating weak recovery with a premature low-latency clear.
- Reasons seen:
  - Final window includes `steady-weak-listener`, `clean-low-latency`, `repair-collapse`, and `repair-heavy-connected`.
  - `missingFrames` rises from `240` to `302` in the final ~11 seconds.
  - `playoutUnderTargetFraction` remains around `0.135` and `playoutRateFractionBelow097` around `0.053`.
  - `entered-recovery` appears immediately after the clean/low-latency blip.

Side B:
- Flat persistent lean.
- Reasons seen:
  - `avgPcmBufferedMs` stays around `2.18` to `2.24 ms` through the final sampled window.
  - `missingFrames` rises from `126` to `160` in the final ~11 seconds.
  - `concealmentTicks` stays at `0`, so this is lean/missing-frame pressure rather than repair-heavy concealment.
  - `persistent-lean` dominates the export, with recovery mode active for 58 of 59 samples.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid secondary selector refinement. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Covered by the high-damage lean escalation target. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Keep as regression watch; not reproduced in later converged calls. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Keep as regression watch; later calls have converged topology and no no-target growth. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Addressed by promoting high-damage near-empty ready paths out of `silent-lean`. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Addressed by strengthening collapse target/floor/hold; verify with later exports. |
| `2026-05-07T21:50Z group-937` | A / Linux root epoch 3 | `steady-weak-listener` | partly/early | partly/yes | receive / residual weak recovery | Watch; no immediate profile-strength change from this side. |
| `2026-05-07T21:50Z group-937` | B / Linux standby epoch 3 | `clean-low-latency` | yes/early, partly current | no | selector / false-clean near-empty repair collapse | Primary: prevent clean-low-latency while ready near-empty damage and recovery pressure remain active. |
| `2026-05-08T10:48Z group-812` | A / Linux root epoch 3 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Primary: add hysteresis/clear gating so weak or repair-heavy recovery cannot briefly clear to clean while under-target/rate pressure remains high. |
| `2026-05-08T10:48Z group-812` | B / Mac standby epoch 3 | `persistent-lean` | partly/inferred | mostly/partly | receive / lean recovery | Watch; no baseline or new-profile change from this side. |
| `2026-05-08T12:06Z group-812` | A / Linux root epoch 1 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Secondary: keep clean-clear gating and profile hysteresis work, but do not make this the primary target from this pair. |
| `2026-05-08T12:06Z group-812` | B / Mac standby epoch 1 | `persistent-lean` | yes/inferred | mostly/yes | receive profile strength / persistent lean | Primary: strengthen or fix effective reserve-building for `persistent-lean` / lean recovery; classification is no longer the main miss. |

## Next Fix Target

Current patched target:
- Profile strength, specifically `persistent-lean` / lean recovery effectiveness.
- Primary fix: make a correctly classified lean listener actually accumulate usable reserve. This pair shows the Mac standby stuck near empty (`avgPcmBufferedMs=2.243`, `avgPlayoutDeltaMs=-182.757`) while `persistent-lean` dominates and recovery mode is active almost the whole export. That argues for stronger lean target/floor/hold behavior or a bug in how lean targets translate into downstream PCM reserve.
- Secondary fix: keep tightening selector hysteresis/clean-clear gating. The Linux root still briefly clears to `clean-low-latency` while under-target and missing-frame pressure remain active, but the dominant new failure is not a false-clean side.
- Keep baseline unchanged. This is not evidence that ordinary low-latency baseline is too small; both sides are in recovery/weak/lean logic most of the time.
- Do not prioritize key/decode, startup, authority/topology, send-target, or a new profile from this pair.

## Call: 2026-05-08 21:17Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-113.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-08T21-17-05-597Z.json`

User symptom:
- Call was good at times, but choppy at other times.

High-level verdict:
- Mixed / intermittently choppy, but structurally cleaner than the previous broken-link sample.
- Both exports agree on room `gcall-qortal-937`, call session `04ea73fc-6b3c-40b2-8d0b-e5492139a0bc`, topology epoch `4`, root `QTSzRS...9jMn`, and standby `QP9Jj4...i6rP`. Both sides are on established Reticulum `link` transport at export. The call had good stretches, but recurring missing-frame and concealment bursts caused audible chop; the remaining failure is receive-policy behavior after those bursts.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Link collapse: both sides export `reticulumAudioOutboundTransportLast=link`, `reticulumAudioInboundTransportLast=link`, `linkEstablished=true`, and `packetSendFailures=0`.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no link-unready drops, and small binary high waters (`2` on both sides). Root bridge high water reaches `14`, but without drain wait or drops.
- Startup hidden playout: both sides have active playback/scheduler nodes, shared rings, active jitter, and current `jitterHasReadyFrame=true`.
- Authority/topology: both sides agree on epoch `4`, root/standby, room key state, and participant count.
- Baseline: neither side is spending meaningful time in `clean-low-latency`; both are already in recovery/weak/lean/collapse logic.

Primary next target:
- Selector, specifically damage-hold / escalation hysteresis between `steady-weak-listener`, `silent-lean`, `repair-collapse`, and `collapse-recovery`.
- The previous `persistent-lean` strength target is less supported by this pair: neither side is the near-empty `2 ms` reserve shape from the prior Mac sample. Instead, both sides have moderate current reserve (`16.353 ms` and `12.397 ms`) but suffer repeated large missing-frame/concealment bursts while the dominant profile drops back to `silent-lean` or `steady-weak-listener`.
- Do not change the global baseline from this call. Do not add a new profile yet; this still fits existing repair/collapse/lean classes, but the selector is not latching the damage class consistently after bursts.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `silent-lean` | yes/inferred | 16.353 | 1833 | 454 | 0.035 | 0.029 | recovery | Current profile is `silent-lean`, but the window includes heavy collapse/repair evidence and large late missing-frame bursts. Classification is only partly correct. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `steady-weak-listener` | yes/inferred | 12.397 | 2840 | 344 | 0.030 | 0.024 | recovery | Current profile is `repair-collapse`, but dominant window profile is `steady-weak-listener`; that under-holds the damage class after repeated spikes. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery` during concealment runs; `repair-heavy-connected` or `steady-weak-listener` only after a sustained quiet window. `silent-lean` fits some current low-damage/lean windows, but not the whole sampled symptom.

Actual exported profile:
- Dominant sampled profile: `silent-lean` (`87` samples).
- Other significant samples: `steady-weak-listener` (`61`), `collapse-recovery` (`56`), `buffered-not-ready` (`11`), `repair-collapse` (`9`).
- Current exported profile: `silent-lean`.

Did classification match?
- Partly/no.

Notes:
- The side is no longer false-clean, which is good.
- But `missingFrames=1833`, `concealmentTicks=454`, and a late burst from `1112` to `1762` missing frames over about three seconds are too damaged to let `silent-lean` dominate without a stronger damage hold.
- Final ready state is healthy enough to avoid startup classification: `jitterBufferedFrames=22`, `jitterHasReadyFrame=true`, playback and scheduler active.

### Side B

Expected profile from symptom:
- `repair-collapse` during the worst missing-frame spikes, with a held repair/collapse class until the damage quiets. `steady-weak-listener` is reasonable only for the quieter intervals.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener` (`110` samples).
- Other significant samples: `collapse-recovery` (`51`), `repair-heavy-connected` (`9`), `repair-collapse` (`8`).
- Current exported profile: `repair-collapse`.

Did classification match?
- Partly.

Notes:
- Current classification is right: live state is `repair-collapse`, with `bufferedMsEma=1.390`, `deltaMsEma=-183.610`, and repair/collapse holds active.
- Dominant classification is too weak for the whole call: the side reaches `missingFrames=2840`, `concealmentTicks=344`, and has a major final-window spike of `385` missing frames followed by `249`, `29`, and `49`.
- This argues for selector/hold behavior, not a new profile: the existing repair/collapse labels are appearing, but not winning consistently enough across burst aftermath.

## Trend Read

Side A:
- Oscillating damage recovery with late burst.
- Reasons seen:
  - The window moves through `collapse-recovery`, `silent-lean`, and `steady-weak-listener`.
  - Concealment climbs steadily by about `8` ticks per second during a collapse run from `1778274988989` to `1778275001112`.
  - Immediately afterward, missing frames jump `126`, then `294`, then `230` while profiles are `silent-lean` / `steady-weak-listener`.
  - Final seconds look quieter but still add small missing-frame deltas while current profile remains `silent-lean`.

Side B:
- Oscillating weak/collapse recovery with repeated missing-frame bursts.
- Reasons seen:
  - `steady-weak-listener` dominates, but `collapse-recovery` repeatedly appears around concealment runs.
  - The largest late spike is `385` missing frames, followed by `249`, then smaller bursts.
  - Current profile ends at `repair-collapse`, which matches the live damaged state, but it arrived late relative to the dominant sampled behavior.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid secondary selector refinement. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Covered by the high-damage lean escalation target. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Keep as regression watch; not reproduced in later converged calls. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Keep as regression watch; later calls have converged topology and no no-target growth. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Addressed by promoting high-damage near-empty ready paths out of `silent-lean`. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Addressed by strengthening collapse target/floor/hold; verify with later exports. |
| `2026-05-07T21:50Z group-937` | A / Linux root epoch 3 | `steady-weak-listener` | partly/early | partly/yes | receive / residual weak recovery | Watch; no immediate profile-strength change from this side. |
| `2026-05-07T21:50Z group-937` | B / Linux standby epoch 3 | `clean-low-latency` | yes/early, partly current | no | selector / false-clean near-empty repair collapse | Primary: prevent clean-low-latency while ready near-empty damage and recovery pressure remain active. |
| `2026-05-08T10:48Z group-812` | A / Linux root epoch 3 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Primary: add hysteresis/clear gating so weak or repair-heavy recovery cannot briefly clear to clean while under-target/rate pressure remains high. |
| `2026-05-08T10:48Z group-812` | B / Mac standby epoch 3 | `persistent-lean` | partly/inferred | mostly/partly | receive / lean recovery | Watch; no baseline or new-profile change from this side. |
| `2026-05-08T12:06Z group-812` | A / Linux root epoch 1 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Secondary: keep clean-clear gating and profile hysteresis work, but do not make this the primary target from this pair. |
| `2026-05-08T12:06Z group-812` | B / Mac standby epoch 1 | `persistent-lean` | yes/inferred | mostly/yes | receive profile strength / persistent lean | Prior primary target; this new call weakens it as the next single fix because the latest failure is not near-empty persistent lean. |
| `2026-05-08T21:17Z group-937` | A / Linux root epoch 4 | `silent-lean` | yes/inferred | partly/no | selector / damage hold after collapse burst | Primary: keep repair/collapse damage latched after concealment and large missing-frame bursts; do not let `silent-lean` dominate until quiet. |
| `2026-05-08T21:17Z group-937` | B / Linux standby epoch 4 | `steady-weak-listener` | yes/inferred | partly | selector / repair-collapse escalation hold | Primary: hold `repair-collapse` or `collapse-recovery` through burst aftermath instead of falling back to `steady-weak-listener` too quickly. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: add damage hysteresis so recent large `missingFramesDelta` bursts keep the side in `repair-collapse` or `repair-heavy-connected` for a sustained quiet window before allowing `steady-weak-listener` or `silent-lean`. Keep relying on the existing concealment/collapse gates for concealment-only runs.
- This is not the old false-clean problem: `clean-low-latency` is essentially gone from this pair. It is the neighboring-profile problem: the engine recognizes damage briefly, then lets weaker lean/steady profiles win too soon.
- Keep profile strength as secondary. If the selector holds repair/collapse correctly and the call still sounds bad with those profiles dominant, then tune target/floor/hold strength next.
- Keep baseline unchanged and do not prioritize key/decode/startup/authority/link transport from this pair.

## Call: 2026-05-08 22:10Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-114.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-08T22-09-59-546Z.json`

User symptom:
- New post-change call for validation. No explicit subjective symptom was included with the export; classify as residual badness if profiles and window deltas still show choppy/repaired audio.

High-level verdict:
- Mixed / still policy-damaged, but cleaner than the previous burst-heavy export.
- Both exports agree on room `gcall-qortal-937`, call session `805e2ff1-6b01-4ec1-9d96-b8919b2005d6`, topology epoch `10`, root `QTSzRS...9jMn`, and standby `QP9Jj4...i6rP`. There is no false-clean profile and no correctness/startup failure, but both sides remain in recovery for all 300 recent samples while missing frames continue to accumulate.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Link collapse: both sides export link transport for inbound and outbound audio, with `reticulumAudioPacketSendFailures=0`.
- Queue/backpressure: `reticulumAudioBridgeWaitingForDrain=false`, no queue-pressure drops, no stale drops, no link-unready drops, and binary queue high water is only `2` on both sides. Side A bridge high water reaches `15`, but without drain wait or drops.
- Startup hidden playout: both sides have active playback/scheduler nodes, shared rings, active jitter, and current `jitterHasReadyFrame=true`.
- Authority/topology: both sides agree on epoch `10`, root/standby, room key state, participant count, and call session.
- Baseline: neither side is classified as `clean-low-latency`; both are already in recovery/lean/repair logic.

Primary next target:
- Selector, specifically lean/repair damage classification and hold behavior.
- This call reinforces the previous selector target rather than shifting to baseline or generic profile strength. Side A ends in `repair-collapse` and has many repair/collapse samples, but `silent-lean` is still the dominant window profile. Side B is more clearly under-classified: `silent-lean` dominates 224 of 300 samples despite `missingFrames=3940`, `concealmentTicks=220`, `totalMissingFramesDelta=1187`, and several recent missing-frame bursts.
- The correct profiles are present, so this is not a new-profile case. The issue is that `silent-lean` and `persistent-lean` still win too often between damage bursts, especially when concealment is low but missing-frame damage keeps rising.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `silent-lean` | yes/inferred | 9.274 | 2340 | 267 | 0.013 | 0.005 | recovery | Current profile is `repair-collapse`; dominant window profile is still too lean for sustained repair damage. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `silent-lean` | yes/inferred | 13.345 | 3940 | 220 | 0.006 | 0.004 | recovery | `silent-lean` dominates even though missing-frame damage remains high and recent bursts continue. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery` during shallow/damaged windows, with `repair-heavy-connected` acceptable when buffered but still repaired. `silent-lean` should only dominate after a sustained quiet window.

Actual exported profile:
- Dominant sampled profile: `silent-lean` (`103` samples).
- Other significant samples: `repair-collapse` (`64`), `persistent-lean` (`60`), `steady-weak-listener` (`48`), `collapse-recovery` (`17`), `repair-heavy-connected` (`7`).
- Current exported profile: `repair-collapse`.

Did classification match?
- Partly.

Notes:
- Current classification is right: live state is `repair-collapse`, with `bufferedMsEma=4.621`, `deltaMsEma=-180.379`, `lastAppliedTargetMs=240`, and repair/collapse holds still active.
- The dominant profile is still too weak for the whole window. The side has `missingFrames=2340`, `concealmentTicks=267`, `totalMissingFramesDelta=987`, and `totalConcealmentTicksDelta=85`.
- Final trend is less explosive than the prior call, but it is not clean: missing frames continue to climb by small deltas almost every second, with a final `missingFramesDelta=10`, while recovery remains active.

### Side B

Expected profile from symptom:
- `repair-collapse` during missing-frame bursts, or `persistent-lean` only as a secondary lean state once damage is quiet. `silent-lean` should not dominate a window with this much accumulated and ongoing missing-frame damage.

Actual exported profile:
- Dominant sampled profile: `silent-lean` (`224` samples).
- Other samples: `repair-collapse` (`61`), `persistent-lean` (`13`), `collapse-recovery` (`2`).
- Current exported profile: `silent-lean`.

Did classification match?
- No/partly.

Notes:
- The side is not false-clean, but `silent-lean` is too soft for `missingFrames=3940`, `concealmentTicks=220`, and `totalMissingFramesDelta=1187`.
- Several bad one-second windows are still classified below the damage class: `missingFramesDelta=32` under `silent-lean`, `54` under `persistent-lean`, then later `21` and `27` under `repair-collapse`.
- Current state has `lastAppliedTargetMs=204` and `lastAppliedFloorMs=192`, which is weaker than Side A's `repair-collapse` target/floor even though Side B's accumulated missing-frame damage is larger.

## Trend Read

Side A:
- Oscillating lean/repair recovery, now with smaller late deltas.
- Reasons seen:
  - `recoverySamples=300`; no clean-low-latency samples.
  - Profiles rotate through `silent-lean`, `persistent-lean`, `steady-weak-listener`, `repair-collapse`, and `collapse-recovery`.
  - Three sampled concealment spikes remain (`concealmentTicksDelta=7`, `9`, `8`), while final seconds mostly add small missing-frame deltas.
  - Current state ends correctly in `repair-collapse`, but the whole sampled window still lets weaker lean profiles dominate.

Side B:
- Flat-ish but still damaged, with intermittent missing-frame bursts.
- Reasons seen:
  - `silent-lean` dominates 224 of 300 samples while `totalMissingFramesDelta=1187`.
  - Significant bursts include `missingFramesDelta=32` under `silent-lean`, `54` under `persistent-lean`, and later `21`/`27` under `repair-collapse`.
  - Final window settles into smaller `3-4` missing-frame deltas, but never leaves recovery and remains on `silent-lean`.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid secondary selector refinement. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Covered by the high-damage lean escalation target. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Keep as regression watch; not reproduced in later converged calls. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Keep as regression watch; later calls have converged topology and no no-target growth. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Addressed by promoting high-damage near-empty ready paths out of `silent-lean`. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Addressed by strengthening collapse target/floor/hold; verify with later exports. |
| `2026-05-07T21:50Z group-937` | A / Linux root epoch 3 | `steady-weak-listener` | partly/early | partly/yes | receive / residual weak recovery | Watch; no immediate profile-strength change from this side. |
| `2026-05-07T21:50Z group-937` | B / Linux standby epoch 3 | `clean-low-latency` | yes/early, partly current | no | selector / false-clean near-empty repair collapse | Primary: prevent clean-low-latency while ready near-empty damage and recovery pressure remain active. |
| `2026-05-08T10:48Z group-812` | A / Linux root epoch 3 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Primary: add hysteresis/clear gating so weak or repair-heavy recovery cannot briefly clear to clean while under-target/rate pressure remains high. |
| `2026-05-08T10:48Z group-812` | B / Mac standby epoch 3 | `persistent-lean` | partly/inferred | mostly/partly | receive / lean recovery | Watch; no baseline or new-profile change from this side. |
| `2026-05-08T12:06Z group-812` | A / Linux root epoch 1 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Secondary: keep clean-clear gating and profile hysteresis work, but do not make this the primary target from this pair. |
| `2026-05-08T12:06Z group-812` | B / Mac standby epoch 1 | `persistent-lean` | yes/inferred | mostly/yes | receive profile strength / persistent lean | Prior primary target; this new call weakens it as the next single fix because the latest failure is not near-empty persistent lean. |
| `2026-05-08T21:17Z group-937` | A / Linux root epoch 4 | `silent-lean` | yes/inferred | partly/no | selector / damage hold after collapse burst | Primary: keep repair/collapse damage latched after concealment and large missing-frame bursts; do not let `silent-lean` dominate until quiet. |
| `2026-05-08T21:17Z group-937` | B / Linux standby epoch 4 | `steady-weak-listener` | yes/inferred | partly | selector / repair-collapse escalation hold | Primary: hold `repair-collapse` or `collapse-recovery` through burst aftermath instead of falling back to `steady-weak-listener` too quickly. |
| `2026-05-08T22:10Z group-937` | A / Linux root epoch 10 | `silent-lean` | yes/inferred | partly | selector / lean-vs-repair oscillation | Keep the selector target: hold `repair-collapse`/`collapse-recovery` until missing-frame and concealment deltas are quiet for a sustained window. |
| `2026-05-08T22:10Z group-937` | B / Linux standby epoch 10 | `silent-lean` | yes/inferred | no/partly | selector / missing-frame damage under-classified as silent lean | Primary: promote/hold repair-collapse when large recent missing-frame deltas occur, even with low current concealment and modest under-target fractions. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: strengthen the damage selector and hold gates between `silent-lean` / `persistent-lean` and `repair-collapse` / `collapse-recovery`. Recent large `missingFramesDelta` bursts should latch a repair/collapse class until both missing-frame and concealment deltas stay quiet for a sustained window.
- This call is not evidence for a baseline change: no side is spending time in `clean-low-latency`, and both sides already use recovery mode.
- This call is not primarily profile strength either. Side A's current `repair-collapse` target/floor is strong (`240`/`224`) and active; the remaining miss is that weaker lean profiles still dominate the sampled window. Tune profile strength only after repair/collapse classification stays dominant during damaged windows.
- Do not prioritize key/decode/startup/authority/link transport, and do not add a new profile from this pair.

## Call: 2026-05-08 23:55Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-115.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-08T23-55-02-779Z.json`

User symptom:
- New post-change call for validation. No explicit subjective symptom was included; infer residual badness from the diagnostic damage and startup/session signals.

High-level verdict:
- Bad / mixed, with a new correctness-startup signal on top of remaining receive-policy damage.
- Both exports agree on room `gcall-qortal-937`, topology epoch `2`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, room key presence, and participant count. They do not agree on call session: Side A exports `7cb2512a-b5fa-4509-98dd-e24a862290ed`, while Side B exports `cdd764cb-a011-4fe9-a441-6d4b42394d99`. Side A also records `totalNoTargetSkipsDelta=601` early in the sampled window before any receive playout exists.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Link transport once active: both sides export link inbound/outbound transport and `reticulumAudioPacketSendFailures=0`.
- Queue/backpressure: no bridge drain wait, no queue-pressure drops, no stale drops, and no link-unready drops. Side A bridge high water reaches `24`, but binary high water is `1` and there are no drops.
- Room authority/topology: both sides agree on root/standby and epoch `2`.
- Baseline: this is not a clean-low-latency tuning problem; both sides spend nearly all active sampled time in recovery or repair/lean profiles.

Primary next target:
- Another subsystem: session/send-target startup correctness.
- The new pair has two red flags outside receive-profile tuning: mismatched call session IDs across the same room/topology and a root-side startup run of `outboundNoTargetSkipsDelta=601` while no receive playouts exist. Per the review rules, this should be fixed or explained before further profile strength or selector tuning.
- Secondary target remains selector damage-hold. Side B is still under-classified for much of the bad window: `steady-weak-listener` dominates despite `missingFrames=2786`, `concealmentTicks=324`, and repeated `missingFramesDelta` spikes up to `139`.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | yes/inferred | 16.218 | 621 | 167 | 0.026 | 0.016 | recovery | Early `outboundNoTargetSkipsDelta=601`; active receive later oscillates across weak/lean/repair/collapse. Current profile is `silent-lean`. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `steady-weak-listener` | yes/inferred | 5.125 | 2786 | 324 | 0.015 | 0.013 | recovery | Current profile is `collapse-recovery`, but dominant window profile is too weak for repeated large missing-frame bursts and near-empty reserve. |

### Side A

Expected profile from symptom:
- During active receive damage: `repair-collapse`, `repair-heavy-connected`, or `collapse-recovery` for bursts; `steady-weak-listener` only for quieter recovery intervals. During the opening no-target window, no receive profile can explain the send failure.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener` (`45` samples).
- Other significant samples: `silent-lean` (`33`), `persistent-lean` (`29`), `collapse-recovery` (`25`), `repair-collapse` (`14`), `repair-heavy-connected` (`6`), `buffered-not-ready` (`4`).
- Current exported profile: `silent-lean`.

Did classification match?
- Partly for receive symptoms; no for the opening no-target/session symptom.

Notes:
- Side A's active receive damage is lighter than Side B's but still not clean: `missingFrames=621`, `concealmentTicks=167`, `avgPlayoutDeltaMs=-168.759`, and recovery is active.
- The first sampled no-target period is not a receive-profile issue. It has `outboundNoTargetSkipsDelta` of `52`, `51`, `50`, etc. while `receivePlayouts=[]`, then receive profiles appear only after that startup window.
- Later classification is mixed: some repair/collapse classifications appear at burst points, but the profile still oscillates quickly back into lean/weak classes.

### Side B

Expected profile from symptom:
- `collapse-recovery` while `jitterHasReadyFrame=false` with continuing concealment, and `repair-collapse` or `repair-heavy-connected` during large missing-frame bursts once ready returns. `steady-weak-listener` should only cover quieter intervals.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener` (`64` samples).
- Other significant samples: `collapse-recovery` (`45`), `persistent-lean` (`17`), `repair-heavy-connected` (`5`), `silent-lean` (`3`), `repair-collapse` (`1`).
- Current exported profile: `collapse-recovery`.

Did classification match?
- Partly/no.

Notes:
- Current classification is right: live state is `collapse-recovery`, with `bufferedMsEma=0.002`, `deltaMsEma=-184.998`, `lastJitterHasReadyFrame=false`, target/floor `304`/`280`, and severe/repair/buffered holds active.
- Dominant classification is too weak for the sampled call: `steady-weak-listener` wins 64 samples while the side reaches `missingFrames=2786`, `concealmentTicks=324`, `avgPcmBufferedMs=5.125`, and repeated large missing-frame bursts (`116`, `89`, `104`, `139`, `95`, `92`).
- This still supports selector damage-hold as a secondary issue, but the call-session mismatch and root no-target startup should be handled first.

## Trend Read

Side A:
- Discrete startup no-target window followed by oscillating receive recovery.
- Reasons seen:
  - From `1778284339146` through `1778284350825`, Side A accumulates `outboundNoTargetSkipsDelta=601` while `receivePlayouts=[]`.
  - After receive starts, it enters recovery and cycles through `repair-collapse`, `repair-heavy-connected`, `collapse-recovery`, `persistent-lean`, `silent-lean`, and `steady-weak-listener`.
  - Later final-window damage is lower-grade but persistent: small missing-frame deltas continue while `avgPcmBufferedMs` sits around `16 ms`.

Side B:
- Flat-bad oscillation between ready missing-frame bursts and not-ready concealment/collapse.
- Reasons seen:
  - Large missing-frame deltas repeatedly occur under `steady-weak-listener`, including `116`, `89`, `104`, `139`, `95`, and `92`.
  - Concealment runs occur under `collapse-recovery` while `jitterHasReadyFrame=false`, often at `6-8` ticks per second.
  - The side ends in `collapse-recovery` with `jitterHasReadyFrame=false`, which matches the current live collapse.

## Batch Scoreboard

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-07T18:57Z group-812` | B / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:25Z group-937` | A / Linux root | `clean-low-latency` | yes | no | selector / false-clean repair pressure | Covered by earlier selector work; keep as historical false-clean baseline. |
| `2026-05-07T19:48Z group-937` | A / Linux root | `steady-weak-listener` | yes | partly/no | selector / repair-heavy escalation | Still a valid secondary selector refinement. |
| `2026-05-07T19:48Z group-937` | B / Linux standby | `silent-lean` | yes | no | selector / repair-collapse escalation | Covered by the high-damage lean escalation target. |
| `2026-05-07T20:30Z group-937` | A / Linux root epoch 3 | `collapse-recovery` | yes | partly/yes | authority/topology plus receive collapse | Keep as regression watch; not reproduced in later converged calls. |
| `2026-05-07T20:30Z group-937` | B / Linux root epoch 4 | `buffered-not-ready` | yes | no/partly | authority/topology and send-target selection | Keep as regression watch; later calls have converged topology and no no-target growth. |
| `2026-05-07T21:23Z group-937` | A / Linux root epoch 3 | `silent-lean` | yes | partly/no | selector / high-damage lean escalation | Addressed by promoting high-damage near-empty ready paths out of `silent-lean`. |
| `2026-05-07T21:23Z group-937` | B / Linux standby epoch 3 | `collapse-recovery` | yes | yes | receive profile strength / collapse recovery | Addressed by strengthening collapse target/floor/hold; verify with later exports. |
| `2026-05-07T21:50Z group-937` | A / Linux root epoch 3 | `steady-weak-listener` | partly/early | partly/yes | receive / residual weak recovery | Watch; no immediate profile-strength change from this side. |
| `2026-05-07T21:50Z group-937` | B / Linux standby epoch 3 | `clean-low-latency` | yes/early, partly current | no | selector / false-clean near-empty repair collapse | Primary: prevent clean-low-latency while ready near-empty damage and recovery pressure remain active. |
| `2026-05-08T10:48Z group-812` | A / Linux root epoch 3 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Primary: add hysteresis/clear gating so weak or repair-heavy recovery cannot briefly clear to clean while under-target/rate pressure remains high. |
| `2026-05-08T10:48Z group-812` | B / Mac standby epoch 3 | `persistent-lean` | partly/inferred | mostly/partly | receive / lean recovery | Watch; no baseline or new-profile change from this side. |
| `2026-05-08T12:06Z group-812` | A / Linux root epoch 1 | `steady-weak-listener` | partly/inferred | partly | selector / profile oscillation and premature clean clear | Secondary: keep clean-clear gating and profile hysteresis work, but do not make this the primary target from this pair. |
| `2026-05-08T12:06Z group-812` | B / Mac standby epoch 1 | `persistent-lean` | yes/inferred | mostly/yes | receive profile strength / persistent lean | Prior primary target; this new call weakens it as the next single fix because the latest failure is not near-empty persistent lean. |
| `2026-05-08T21:17Z group-937` | A / Linux root epoch 4 | `silent-lean` | yes/inferred | partly/no | selector / damage hold after collapse burst | Primary: keep repair/collapse damage latched after concealment and large missing-frame bursts; do not let `silent-lean` dominate until quiet. |
| `2026-05-08T21:17Z group-937` | B / Linux standby epoch 4 | `steady-weak-listener` | yes/inferred | partly | selector / repair-collapse escalation hold | Primary: hold `repair-collapse` or `collapse-recovery` through burst aftermath instead of falling back to `steady-weak-listener` too quickly. |
| `2026-05-08T22:10Z group-937` | A / Linux root epoch 10 | `silent-lean` | yes/inferred | partly | selector / lean-vs-repair oscillation | Keep the selector target: hold `repair-collapse`/`collapse-recovery` until missing-frame and concealment deltas are quiet for a sustained window. |
| `2026-05-08T22:10Z group-937` | B / Linux standby epoch 10 | `silent-lean` | yes/inferred | no/partly | selector / missing-frame damage under-classified as silent lean | Primary: promote/hold repair-collapse when large recent missing-frame deltas occur, even with low current concealment and modest under-target fractions. |
| `2026-05-08T23:55Z group-937` | A / Linux root epoch 2 | `steady-weak-listener` | yes/inferred | partly/no | session/send-target startup plus receive oscillation | Primary: investigate call-session mismatch and root no-target skips before more receive tuning. |
| `2026-05-08T23:55Z group-937` | B / Linux standby epoch 2 | `steady-weak-listener` | yes/inferred | partly/no | selector / under-held damage, plus session mismatch | Secondary after state fix: hold `collapse-recovery`/repair classes through ready/not-ready damage cycles. |

## Next Fix Target

Current patched target:
- Another subsystem: session/send-target startup correctness.
- Primary fix: explain and eliminate the same-room call-session mismatch and the root-side startup no-target run. This pair has different `callSessionId` values on the two sides and `totalNoTargetSkipsDelta=601` on Side A before receive playouts exist. That is outside receive profile tuning and should be handled first.
- Secondary fix: selector damage-hold still needs attention after the state/session issue is cleared. Side B repeatedly reports large missing-frame bursts under `steady-weak-listener`; the current end state is correctly `collapse-recovery`, but the dominant profile is too weak for the call.
- Keep baseline unchanged and do not add a new receive profile from this pair.

## Call: 2026-05-09 19:30Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-116.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T19-30-19-007Z.json`

User symptom:
- New post-change call. Subjectively good for roughly the first 1-2 minutes, then progressively worse.

High-level verdict:
- Bad, but more narrowly policy-dominated than the previous pair.
- The retained 300-sample trend window starts after the likely good opening. Inside that window both sides are already in recovery and keep accumulating repair damage. The prior call-session mismatch is gone: both sides agree on room `gcall-qortal-937`, topology epoch `2`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, and call session `5c236dbf-31a0-4256-9194-92bd825527b2`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Link collapse: both sides use link transport for inbound and outbound audio, with `reticulumAudioPacketSendFailures=0`.
- Queue/backpressure: `reticulumAudioBridgeWaitingForDrain=false`, no queue-pressure drops, no stale drops, no link-unready drops, and binary queue high water is only `2` on both sides. Side A bridge high water reaches `17`, but without drain wait or drops.
- Startup/send-target: unlike the previous pair, `totalNoTargetSkipsDelta=0` on both sides during the sampled window. Side A has historical cumulative no-target skips, but none are growing in this review window.
- Authority/topology/session: both sides agree on epoch `2`, root/standby, room key state, participant count, media session generation `1`, and call session.

Primary next target:
- Selector.
- The previous session/send-target target should move to regression watch for this pair. The current failure is receive-policy classification and damage hold: Side B spends `218/300` samples in `silent-lean` despite `missingFrames=4277`, `concealmentTicks=386`, `avgPcmBufferedMs=5.243`, and repeated large missing-frame bursts. Side A is less collapsed but still lets `clean-low-latency` appear `29/300` samples while damage keeps accumulating.
- This is not a baseline fix yet. Baseline is not dominating the bad side, and both sides are already in recovery mode. It is also not primarily profile strength: the strong `collapse-recovery` target/floor exists and is correct when selected, but the selector keeps falling back to `silent-lean`, `steady-weak-listener`, or even `clean-low-latency` between bursts.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `steady-weak-listener` | yes | 37.219 | 2457 | 193 | 0.114 | 0.031 | recovery | Current profile is `steady-weak-listener`; window includes `repair-collapse` and `repair-heavy-connected`, but also `29` false-clean samples while missing frames continue. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `silent-lean` | yes | 5.243 | 4277 | 386 | 0.005 | 0.004 | recovery | Current profile is correctly `collapse-recovery`, but dominant window profile is far too weak for near-empty reserve plus repeated missing-frame and concealment bursts. |

### Side A

Expected profile from symptom:
- `repair-heavy-connected` or `repair-collapse` during ready missing-frame bursts, and `collapse-recovery` during not-ready concealment runs. `steady-weak-listener` is acceptable only for quieter recovery intervals. `clean-low-latency` should not appear while recent repair damage is still active.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener` (`131` samples).
- Other significant samples: `repair-collapse` (`71`), `repair-heavy-connected` (`50`), `clean-low-latency` (`29`), `collapse-recovery` (`15`), `persistent-lean` (`3`), `buffered-not-ready` (`1`).
- Current exported profile: `steady-weak-listener`.

Did classification match?
- Partly/no.

Notes:
- Side A has enough buffered reserve on paper (`avgPcmBufferedMs=37.219`) that it does not look like the near-empty Side B collapse, but it still accumulates `totalMissingFramesDelta=2108` and `totalConcealmentTicksDelta=81` in the sampled window.
- The strongest mismatch is the reappearance of `clean-low-latency` while damage is still ongoing: examples include `missingFramesDelta=14`, `11`, `8`, later `8`, `16`, and then `70` under `clean-low-latency`.
- Current live state is weaker than the damage history suggests: `bufferedMsEma=50.430`, `deltaMsEma=-132.084`, `missingFrameEma=0.172`, target/floor `172`/`172`, and only `postRecovery` hold remains.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery` should dominate after the call becomes bad. `silent-lean` can explain shallow reserve with low current concealment, but it should not dominate a window with thousands of missing frames, hundreds of concealment ticks, and repeated large missing-frame bursts.

Actual exported profile:
- Dominant sampled profile: `silent-lean` (`218` samples).
- Other significant samples: `collapse-recovery` (`36`), `repair-collapse` (`34`), `persistent-lean` (`7`), `buffered-not-ready` (`5`).
- Current exported profile: `collapse-recovery`.

Did classification match?
- No for the sampled bad window; yes for the final current state.

Notes:
- Current state is correctly severe: `collapse-recovery`, `bufferedMsEma=0.00009`, `deltaMsEma=-185.000`, `lastJitterHasReadyFrame=false`, target/floor `304`/`280`, with severe/repair/buffered/lean holds all active.
- The dominant sampled profile is wrong for the symptom and metrics. Side B reaches `missingFrames=4277`, `concealmentTicks=386`, `totalMissingFramesDelta=3228`, and `totalConcealmentTicksDelta=311` while `silent-lean` owns most samples.
- Large bursts still happen under weak classes, including `missingFramesDelta=175`, `125`, `98`, `88`, `86`, `80`, `49`, and many smaller ongoing deltas under `silent-lean`.

## Trend Read

Side A:
- Oscillating repair recovery with false-clean dips.
- Reasons seen:
  - `recoverySamples=230`, so this is not a fully baseline call.
  - Repeated repair/collapse stretches are followed by `steady-weak-listener` or `clean-low-latency` before damage is quiet.
  - Late burst sequence includes `collapse-recovery` concealment, then `missingFramesDelta=98`, then `missingFramesDelta=70` under `clean-low-latency`.

Side B:
- Progressive/flat-bad after the retained window begins, with near-empty reserve and repeated burst recovery.
- Reasons seen:
  - `recoverySamples=300`; no clean-low-latency samples.
  - `silent-lean` dominates `218/300` samples despite near-empty `avgPcmBufferedMs` around `5.2-5.7 ms`.
  - Repeated not-ready concealment runs under `collapse-recovery` are followed by large ready bursts that often fall back to `silent-lean`.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-09T19:30Z group-937` | A / Linux root epoch 2 | `steady-weak-listener` | yes | partly/no | selector / false-clean and weak clear during repair damage | Primary: prevent `clean-low-latency` and weak-listener fallback until recent missing-frame/concealment bursts are quiet for a sustained window. |
| `2026-05-09T19:30Z group-937` | B / Linux standby epoch 2 | `silent-lean` | yes | no/current partly yes | selector / high-damage silent-lean under-classification | Primary: promote or hold `repair-collapse`/`collapse-recovery` after large missing-frame bursts and not-ready concealment, even when current under-target/rate fractions look modest. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: strengthen the damage latch between `silent-lean` / `steady-weak-listener` / `clean-low-latency` and the repair/collapse profiles. Recent large `missingFramesDelta` or repeated not-ready concealment should keep a source in `repair-collapse` or `collapse-recovery` until both missing-frame and concealment deltas are quiet for a sustained clear window.
- Keep session/send-target startup as regression watch only. This pair no longer reproduces the mismatched session or growing no-target skip symptom.
- Keep baseline unchanged. Do not add a new profile from this call; the existing repair/collapse profiles match the bad window when selected, but selection and clear timing are still wrong.

## Call: 2026-05-09 19:45Z / group 812 / 3 participants

Room:
- `gcall-qortal-812`

Files:
- Receiver A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T19-45-19-515Z.json`
- Receiver B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T19-45-10-385Z.json`
- Receiver C: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T19-45-24-187Z.json`

User symptom:
- New 3+ participant call. No separate subjective per-listener symptom was included; infer badness from each receiver's window damage and multi-source receive profiles.

High-level verdict:
- Bad / mixed, policy-dominated.
- All three exports agree on room `gcall-qortal-812`, topology epoch `3`, root `QMe6E7...6VFZ`, standby `QeJW96...j5W9`, participant count `3`, media session generation `1`, and call session `61e0a042-3a76-4825-a5ae-dfb6bb41e3d4`. The previous session mismatch and no-target startup failure are not reproduced.
- The new 3+ profile family is too coarse: each receiver applies the same `multi-clean-low-latency` / `multi-protected-recovery` class to both remote sources, then clears both sources together even while missing-frame damage continues.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and pending-decrypt high water is `0` on all three exports.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on all three exports.
- Link transport: all exports use link transport for inbound and outbound audio, with `reticulumAudioPacketSendFailures=0`.
- Queue/backpressure: `reticulumAudioBridgeWaitingForDrain=false`, no queue-pressure drops, no stale drops, and no link-unready drops. Queue high-water values are modest (`3/2`, `15/3`, `3/4` for bridge/binary).
- Startup/send-target: `totalNoTargetSkipsDelta=0` on all three retained windows. Root has historical cumulative `outboundNoTargetSkips=218`, but it is not growing in this review window.
- Authority/session: all three agree on epoch, root/standby, participant count, room key presence, media session generation, and call session.

Primary next target:
- Selector / multi-source profile granularity and clear hysteresis.
- Do not tune the global baseline from this call. The main failure is that `multi-clean-low-latency` becomes dominant while the receivers still accumulate large missing-frame deltas. Do not treat this as single-source profile strength either: the new multi profiles are hiding source-specific damage by clearing both sources as a group.
- The next fix should make 3+ receive classification source-sensitive: near-empty or not-ready damaged sources need a protected/repair class even if another source is buffered, and `multi-clean-low-latency` should not clear while recent missing-frame or concealment bursts remain active for any source.

| Receiver | Role | Remote Sources | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QMe6E7...6VFZ` | `QP9Jj4...i6rP`, `QeJW96...j5W9` | `multi-clean-low-latency` | yes/inferred | 60.926 | 6456 | 553 | 0.134 | 0.075 | low-latency | Both sources split `154` clean / `146` protected samples; final clean clear happens despite late missing-frame deltas `35` and `43`. |
| B | standby-forwarder / Linux / `QeJW96...j5W9` | `QMe6E7...6VFZ`, `QP9Jj4...i6rP` | `multi-clean-low-latency` | yes/inferred | 11.290 | 6060 | 383 | 0.021 | 0.011 | low-latency | Both sources split `153` clean / `147` protected samples; `QP9Jj4` is not-ready in `51/300` samples, but clears with the healthier root source. |
| C | participant / Linux / `QP9Jj4...i6rP` | `QMe6E7...6VFZ`, `QeJW96...j5W9` | `multi-clean-low-latency` | yes/inferred | 5.200 | 4288 | 296 | 0.003 | 0.002 | low-latency | Both sources are clean for `285/300` samples despite near-empty aggregate reserve and large bursts, including `missingFramesDelta=524`. |

### Receiver A / Root `QMe6E7...6VFZ`

Expected profile from symptom:
- Mixed per-source classification: `multi-protected-recovery` or a source-specific repair/collapse class for the damaged source, with `multi-clean-low-latency` only after recent missing-frame and not-ready/concealment bursts are quiet.

Actual exported profile:
- `QP9Jj4...i6rP`: `multi-clean-low-latency` (`154` samples), `multi-protected-recovery` (`146` samples).
- `QeJW96...j5W9`: `multi-clean-low-latency` (`154` samples), `multi-protected-recovery` (`146` samples).
- Current live profile: `multi-clean-low-latency` for both sources.

Did classification match?
- Partly/no.

Notes:
- This receiver has plenty of aggregate reserve (`avgPcmBufferedMs=60.926`) but still has bad playout pressure (`playoutUnderTargetFraction=0.134`, `playoutRateFractionBelow097=0.075`) and high damage (`totalMissingFramesDelta=4250`, `totalConcealmentTicksDelta=252`).
- The final trend rows show `multi-clean-low-latency` clearing while `missingFramesDelta` is still `35` then `43`.
- One source has a live repair hold (`QP9Jj4...i6rP` has `lastAppliedTargetMs=196`, `lastAppliedFloorMs=196`, `repairCollapse=973 ms` remaining), but the exported profile is still `multi-clean-low-latency`.

### Receiver B / Standby `QeJW96...j5W9`

Expected profile from symptom:
- Mixed per-source classification: `multi-protected-recovery` for not-ready or near-empty damaged sources, with clean allowed only for genuinely quiet ready sources.

Actual exported profile:
- `QMe6E7...6VFZ`: `multi-clean-low-latency` (`153` samples), `multi-protected-recovery` (`147` samples).
- `QP9Jj4...i6rP`: `multi-clean-low-latency` (`153` samples), `multi-protected-recovery` (`147` samples).
- Current live profile: `multi-clean-low-latency` for both sources.

Did classification match?
- Partly/no.

Notes:
- This receiver is the clearest source-specific mismatch: `QP9Jj4...i6rP` is not-ready in `51/300` trend samples, while `QMe6E7...6VFZ` is not-ready only once.
- Despite that asymmetry, both sources receive identical profile counts and clear together.
- The aggregate window is still bad: `totalMissingFramesDelta=4146`, `totalConcealmentTicksDelta=260`, and top missing-frame bursts include `107`, `94`, `83`, `72`, and `67`.

### Receiver C / Participant `QP9Jj4...i6rP`

Expected profile from symptom:
- `multi-protected-recovery` or source-specific repair/collapse should dominate because the receiver is near-empty for the whole retained window and still accumulating missing frames.

Actual exported profile:
- `QMe6E7...6VFZ`: `multi-clean-low-latency` (`285` samples), `multi-protected-recovery` (`15` samples).
- `QeJW96...j5W9`: `multi-clean-low-latency` (`285` samples), `multi-protected-recovery` (`15` samples).
- Current live profile: `multi-clean-low-latency` for both sources.

Did classification match?
- No.

Notes:
- This side has `avgPcmBufferedMs=5.200`, `jitterBufferDepthFramesMean=0.135`, `avgPlayoutDeltaMs=-176.299`, `missingFrames=4288`, and `concealmentTicks=296`.
- The window includes a discrete severe burst: top `missingFramesDelta` values are `524`, `142`, and `29`; top concealment deltas are `17`, `17`, `16`, `16`, and `16`.
- `multi-clean-low-latency` dominating `285/300` samples is not compatible with near-empty reserve plus a `524` missing-frame spike.

## Trend Read

Receiver A:
- Oscillating grouped multi-profile with late false-clean clear.
- Reasons seen:
  - `entered-recovery` appears `36` times.
  - both sources alternate together between `multi-clean-low-latency` and `multi-protected-recovery`.
  - late damage continues under clean: final rows include `missingFramesDelta=35` and `43` after clearing back to `multi-clean-low-latency`.

Receiver B:
- Oscillating grouped multi-profile with source asymmetry hidden by the profile.
- Reasons seen:
  - `entered-recovery` appears `40` times.
  - `QP9Jj4...i6rP` is not-ready in `51/300` samples, but both sources have identical profile counts.
  - late clean rows still accumulate `missingFramesDelta=31`, then smaller `6`, `4`, `11`, `12`, `10`, `10`, and `14` deltas.

Receiver C:
- Mostly false-clean near-empty receive, with a discrete severe burst.
- Reasons seen:
  - only `15/300` protected samples despite near-empty aggregate reserve.
  - top missing-frame deltas include `524` and `142`.
  - both sources remain `multi-clean-low-latency` through the final rows while missing frames continue rising by `3-9` frames per second.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-09T19:45Z group-812` | A / Linux root epoch 3 / 3-way | `multi-clean-low-latency` | yes/inferred | partly/no | selector / grouped multi clear during repair damage | Make multi clean-clear source-sensitive and block clean while recent missing-frame/concealment bursts remain active on any source. |
| `2026-05-09T19:45Z group-812` | B / Linux standby epoch 3 / 3-way | `multi-clean-low-latency` | yes/inferred | partly/no | selector / source asymmetry hidden by multi profile | Separate per-source readiness/damage classification; `QP9Jj4` not-ready samples should not clear with the healthier source. |
| `2026-05-09T19:45Z group-812` | C / Linux participant epoch 3 / 3-way | `multi-clean-low-latency` | yes/inferred | no | selector / false-clean near-empty multi receive | Promote/hold protected recovery for near-empty multi receive after large missing-frame bursts; this is the strongest regression target. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: introduce stronger source-sensitive multi-party receive classification and clean-clear hysteresis. `multi-clean-low-latency` must not dominate when one source is near-empty/not-ready or when recent missing-frame/concealment bursts are still active.
- Keep session/send-target startup as regression watch only. This 3-way call has consistent session/topology and no growing no-target skips.
- Keep baseline unchanged and do not add a new profile yet. The existing multi classes are probably enough as names, but their selector/clear logic is currently too coarse for mixed-source 3+ calls.

## Call: 2026-05-09 20:28Z / group 937

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-117.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T20-28-24-337Z.json`

User symptom:
- New post-change two-person group call. No separate subjective quality note was included with the exports; infer badness from the retained-window damage and recovery profiles.

High-level verdict:
- Bad / mixed, with both receive-policy and startup/send-target evidence.
- Both final exports agree on room `gcall-qortal-937`, topology epoch `2`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, participant count `2`, media session generation `1`, and final call session `a47821bf-f52c-4e84-92cf-cb22d6ef7b41`.
- Unlike the previous clean two-person review, Side A again has growing outbound no-target skips during the retained window: `totalNoTargetSkipsDelta=1421`. Side B also bootstrapped from a one-participant cached session `9b4ccfff-6006-497b-8873-043b0996f14c` before settling on the final session.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, pending-decrypt depth/high-water `0`, and `totalPendingDecryptDelta=0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Link transport: both sides use link transport for inbound and outbound audio, with `reticulumAudioPacketSendFailures=0`.
- Authority steady state: final topology/session/root/standby state matches on both sides.
- Baseline: neither side is living in ordinary `clean-low-latency`; both sides are in recovery for almost the whole sampled bad window.

Primary next target:
- Another subsystem first: startup/send-target correctness, then selector/profile-strength follow-up.
- The revived root-side no-target run is outside receive profile tuning and should be fixed before using this pair as clean evidence for receive-only tuning. Side A reports `1421` no-target skips during the retained window while Side B has repeated early `zero-inbound-media-recovery-requested` events before packets arrive.
- After that is cleared, this same pair still supports receive tuning: Side B is under-classified as `persistent-lean`/`silent-lean` while accumulating large missing-frame bursts, and Side A remains audibly bad by metrics even under `collapse-recovery`/`repair-collapse`, which may require stronger collapse profile target/floor behavior.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `collapse-recovery` | yes/inferred | 4.367 | 1211 | 4580 | 0.057 | 0.055 | recovery | Strong profiles dominate (`138` collapse, `86` repair-collapse), but the side still has severe concealment and `1421` outbound no-target skips early in the retained window. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `persistent-lean` | yes/inferred | 5.909 | 1758 | 132 | 0.006 | 0.004 | recovery | Dominant profile is too weak for repeated missing-frame bursts; final/current state is correctly `collapse-recovery`. |

### Side A

Expected profile from symptom:
- `collapse-recovery` or `repair-collapse`, because the listener is near-empty (`avgPcmBufferedMs=4.367`, `avgPlayoutDeltaMs=-177.350`) and has severe concealment (`concealmentTicks=4580`).

Actual exported profile:
- Dominant sampled profile: `collapse-recovery` (`138` samples).
- Other significant samples: `repair-collapse` (`86`), `silent-lean` (`13`), `repair-heavy-connected` (`4`), `persistent-lean` (`4`), `steady-weak-listener` (`2`), `buffered-not-ready` (`1`).
- Current exported profile: `collapse-recovery`.

Did classification match?
- Mostly yes for receive classification, but the call still fails.

Notes:
- This is not the same under-classification shape as the 19:30Z Side B case. Side A spends most profile-tagged samples in strong collapse/repair classes, and those classes carry most damage (`collapse-recovery`: `2381` concealment delta; `repair-collapse`: `1667` concealment delta).
- The mismatch is more profile strength or non-receive-path than selector: the strong class is selected, but the buffer stays near empty and concealment remains high.
- The first `29` trend samples have no receive profile and account for `1421` outbound no-target skips. That startup/send-target signal must be separated from receive profile judgment.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery` after the missing-frame bursts begin. `persistent-lean` can explain low reserve only if current damage is mild, which is not true for this window.

Actual exported profile:
- Dominant sampled profile: `persistent-lean` (`99` samples).
- Other significant samples: `silent-lean` (`53`), `repair-collapse` (`22`), `collapse-recovery` (`17`), `steady-weak-listener` (`3`), `buffered-not-ready` (`3`).
- Current exported profile: `collapse-recovery`.

Did classification match?
- No for the sampled bad window; yes for the final current state.

Notes:
- Side B reaches `missingFrames=1758` with `totalMissingFramesDelta=1758`, while `persistent-lean` owns `686` missing-frame delta and `silent-lean` owns another `317`.
- Large bursts include `missingFramesDelta=261`, `175`, `68`, `65`, `48`, `36`, `35`, `34`, and `33`.
- The low under-target/rate fractions are misleading here. They do not justify weak profile dominance when reserve is near empty and missing frames are accumulating.

## Trend Read

Side A:
- Mixed startup gap followed by flat-bad collapse recovery.
- Reasons seen:
  - `totalNoTargetSkipsDelta=1421` occurs before receive profiles exist in the retained window.
  - After receive begins, the side is mostly in `collapse-recovery`/`repair-collapse`.
  - Damage continues under strong profiles, especially concealment spikes up to `86`, `73`, `67`, `66`, and `62`.

Side B:
- Startup/zero-inbound recovery, then persistent under-classified missing-frame damage.
- Reasons seen:
  - Early events include repeated `zero-inbound-media-recovery-requested` with `packetsReceived=0`.
  - `persistent-lean`/`silent-lean` dominate `152/198` samples despite near-empty reserve.
  - Current live state finally reaches `collapse-recovery` with severe, repair, buffered, lean, and recent-damage holds active.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-09T20:28Z group-937` | A / Linux root epoch 2 | `collapse-recovery` | yes/inferred | mostly yes | startup/send-target plus possible profile strength | Primary: fix renewed root-side no-target startup/send-target path; then test whether `collapse-recovery`/`repair-collapse` need stronger target/floor when correctly selected but still near-empty. |
| `2026-05-09T20:28Z group-937` | B / Linux standby epoch 2 | `persistent-lean` | yes/inferred | no/current yes | selector / lean under-classification after missing-frame bursts | After startup is clean, promote/hold `repair-collapse`/`collapse-recovery` after large missing-frame bursts even when under-target/rate fractions remain low. |

## Next Fix Target

Current patched target:
- Another subsystem: startup/send-target correctness.
- Primary fix: eliminate the revived root-side outbound no-target run and the standby-side early zero-inbound warm recovery. This pair is not clean receive-only evidence while Side A grows `totalNoTargetSkipsDelta=1421` in the retained window.
- Secondary fix: selector damage-hold remains valid after startup is clean. Side B repeats the prior under-classification pattern, with `persistent-lean`/`silent-lean` dominant while missing frames accumulate.
- Tertiary fix: profile strength for `collapse-recovery`/`repair-collapse` may need review, but only after the no-target/startup path is quiet. Side A selected the severe profiles correctly and still stayed near-empty with heavy concealment.
- Keep baseline unchanged and do not add a new profile from this call.

## Call: 2026-05-09 20:41Z / group 812

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T20-41-07-067Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T20-41-02-373Z.json`
- Side C: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T20-40-55-844Z.json`

User symptom:
- New post-change 3+ group call. No separate subjective per-listener symptom was included; infer user-bad status from retained-window damage and receive profiles.

High-level verdict:
- Bad, but improved classification shape versus the previous false-clean multi-source batch.
- All three exports agree on room `gcall-qortal-812`, topology epoch `3`, root `QeJW96...j5W9`, standby `QP9Jj4...i6rP`, participant count `3`, room key presence, and media session generation `1`.
- The strongest remaining failure is not startup/key/queue correctness. The participant side is correctly pinned in `multi-protected-recovery` for both sources for all `300/300` trend samples, but still accumulates `9665` concealment ticks and `2484` missing-frame delta in the retained window.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and retained-window pending decrypt delta is `0` on all three exports.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on all three exports.
- Queue/backpressure: no queue-pressure drops, stale drops, link-unready drops, or bridge drain wait on any side.
- Startup/send-target: retained-window `totalNoTargetSkipsDelta=0` on all three exports.
- Authority/session: topology, root/standby, room key, and media generation are consistent across the batch.

Primary next target:
- Profile strength / application for `multi-protected-recovery`.
- The selector is no longer the sole failure. The worst side's classification matches the damage profile, but the applied protection is not strong enough to stop ongoing concealment. Also inspect why some live `multi-protected-recovery` states report `lastAppliedTargetMs=null`, `lastAppliedFloorMs=null`, and `lastAppliedTargetBoostMs=0`; that looks like a protection-application gap, not a baseline issue.
- Secondary target: selector clear hysteresis for mixed-source sides. Root and standby still show one source protected for the whole retained window while the other source spends most samples in `multi-clean-low-latency`; that may be valid per-source asymmetry, but clean should not survive recent not-ready/missing-frame bursts.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | participant / Linux / `QMe6E7...6VFZ` | `multi-protected-recovery` | yes/inferred | 7.654 | 3206 | 12215 | 0.097 | 0.095 | recovery | Both remotes are protected for `300/300` samples; classification matches, but concealment continues at roughly `32-40` ticks/sec late in the window. |
| B | root-forwarder / Linux / `QeJW96...j5W9` | mixed: `QMe6E7` protected, `QP9Jj4` clean-dominant | yes/inferred | 93.255 | 5349 | 498 | 0.113 | 0.066 | recovery | `QMe6E7` is protected `300/300`; `QP9Jj4` is clean `227/300`, protected `68/300`, recovery `5/300`, with `38` not-ready samples. |
| C | standby-forwarder / Linux / `QP9Jj4...i6rP` | mixed: `QeJW96` protected, `QMe6E7` clean-dominant | yes/inferred | 5.872 | 5234 | 428 | 0.003 | 0.002 | low-latency | `QeJW96` is protected `300/300`; `QMe6E7` is clean `292/300`. Aggregate reserve is near-empty, but the protected source appears to be the likely damaged leg. |

### Side A / Participant `QMe6E7...6VFZ`

Expected profile from symptom:
- `multi-protected-recovery` for both sources. This side is shallow-buffered, under target, rate-chasing, and heavily concealed.

Actual exported profile:
- `QeJW96...j5W9`: `multi-protected-recovery` (`300` samples).
- `QP9Jj4...i6rP`: `multi-protected-recovery` (`300` samples).

Did classification match?
- Yes.

Notes:
- This is the strongest evidence in the batch. The selector did the right thing for the whole retained window, but the side is still bad: `totalConcealmentTicksDelta=9665`, `totalMissingFramesDelta=2484`, `avgPcmBufferedMs=7.654`, and `avgPlayoutDeltaMs=-130.486`.
- Live state shows `QeJW96` receiving target/floor/boost (`192/176/+72`, extra hold `8`), while `QP9Jj4` is also labeled protected but has no applied target/floor/boost. That per-source mismatch should be inspected before changing baseline.

### Side B / Root `QeJW96...j5W9`

Expected profile from symptom:
- Mixed source-sensitive classification: protected for the damaged/slow leg, clean only for a genuinely stable source.

Actual exported profile:
- `QMe6E7...6VFZ`: `multi-protected-recovery` (`300` samples).
- `QP9Jj4...i6rP`: `multi-clean-low-latency` (`227`), `multi-protected-recovery` (`68`), `multi-recovery` (`5`).
- Current live profile: `multi-protected-recovery` for both sources.

Did classification match?
- Partly.

Notes:
- Aggregate damage is still material: `totalMissingFramesDelta=3191`, `totalConcealmentTicksDelta=120`, `playoutUnderTargetFraction=0.113`, and `playoutRateFractionBelow097=0.066`.
- `QP9Jj4` has `38` not-ready samples and top missing-frame deltas of `103`, `92`, `68`, and `59`; clean-dominant classification for that source is suspicious unless those bursts all belong to the other source.
- The live state has both sources protected at export time, but both show no applied target/floor/boost. That points back to protected-profile application/strength rather than baseline.

### Side C / Standby `QP9Jj4...i6rP`

Expected profile from symptom:
- At least one source should stay protected because the receiver is near-empty and still accumulating missing frames. Clean is plausible only for the source with healthy per-source reserve.

Actual exported profile:
- `QeJW96...j5W9`: `multi-protected-recovery` (`300` samples).
- `QMe6E7...6VFZ`: `multi-clean-low-latency` (`292`), `multi-protected-recovery` (`7`), `multi-recovery` (`1`).

Did classification match?
- Mostly/partly.

Notes:
- The protected `QeJW96` leg looks correctly classified and has active applied protection at export (`240/224/+120`, extra hold `11`).
- The side still has near-empty aggregate reserve (`avgPcmBufferedMs=5.872`) and `totalMissingFramesDelta=2578`, including a single `669` frame burst.
- `QMe6E7` clean-dominant may be valid if it is genuinely the buffered leg (`bufferedMsEma=109.775`), but the large aggregate burst means per-source attribution should be verified before relaxing selector rules.

## Trend Read

Side A:
- Flat-bad protected recovery.
- Reasons seen:
  - `multi-protected-recovery` for both remotes in all `300` samples.
  - no decrypt/decode/startup deltas.
  - late concealment continues steadily with top deltas `40, 40, 40, 40, 40, 39, 39, 38`.

Side B:
- Mixed-source recovery with late protection but suspicious clean dominance on one leg.
- Reasons seen:
  - `entered-recovery` appears `20` times.
  - `QP9Jj4` has `38` not-ready samples.
  - top missing-frame deltas are `103, 92, 68, 59, 43, 43, 35, 35`.

Side C:
- Source-specific protected leg plus mostly clean second leg; one severe discrete missing-frame burst.
- Reasons seen:
  - `QeJW96` protected for all `300` samples.
  - `QMe6E7` clean for `292/300` samples.
  - top missing-frame delta is `669`, followed by much smaller `32, 17, 13, 12, 12, 11, 11`.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-09T20:41Z group-812` | A / Linux participant epoch 3 | `multi-protected-recovery` | yes/inferred | yes | receive profile strength/application | Strengthen or fix application of `multi-protected-recovery`; investigate protected states with no applied target/floor/boost. |
| `2026-05-09T20:41Z group-812` | B / Linux root epoch 3 | mixed protected/clean | yes/inferred | partly | profile application plus selector hysteresis | Keep source-sensitive classification, but block/shorten clean when recent not-ready or missing-frame bursts remain active; inspect missing applied boosts under protected live state. |
| `2026-05-09T20:41Z group-812` | C / Linux standby epoch 3 | mixed protected/clean | yes/inferred | mostly/partly | profile strength with per-source attribution check | Treat `QeJW96` protected classification as correct; verify the `669` missing-frame burst source before changing clean selector for `QMe6E7`. |

## Next Fix Target

Current patched target:
- Profile strength / protection application, specifically `multi-protected-recovery`.
- Primary fix: make protected multi-source policy actually provide enough target/floor/hold on every protected source, and audit cases where the exported profile is `multi-protected-recovery` but `lastAppliedTargetMs`, `lastAppliedFloorMs`, and `lastAppliedTargetBoostMs` are `null`/`0`.
- Secondary fix: selector clear hysteresis for mixed-source legs after not-ready or missing-frame bursts. This is secondary because the worst side in this batch is already correctly protected.
- Keep baseline unchanged and do not add a new profile from this call.

## Call: 2026-05-09 21:43Z / group 937 follow-up two-person

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-118.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T21-43-16-440Z.json`

User symptom:
- New post-change two-person group call. No separate subjective per-side quality note was included; infer badness from retained-window damage and recovery state.

High-level verdict:
- Bad, receive-policy dominated.
- Both exports agree on room `gcall-qortal-937`, topology epoch `2`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, participant count `2`, room key presence, and media session generation `1`.
- This is cleaner than the prior 20:28Z two-person export for subsystem triage: retained-window `totalNoTargetSkipsDelta=0` on both sides, no decrypt/decode drops, and no queue/backpressure signal.
- Both sides still spend the entire retained window in recovery and accumulate large missing-frame deltas (`2619` on Side A, `3835` on Side B). The dominant profiles are too weak for that symptom shape.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, pending-decrypt high-water `0`, and retained-window pending-decrypt delta `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Startup/send-target in the retained window: `totalNoTargetSkipsDelta=0` on both sides.
- Queue/backpressure: bridge waiting-for-drain is `false`; bridge queued-frame high-water is `11` on Side A and `3` on Side B.
- Failover/authority: no promotion/demotion counts, settled matching root/standby/topology/session state.

Primary next target:
- Selector, specifically single-source damage escalation and hold hysteresis.
- Baseline is not the next target: both sides are already in recovery for all `300/300` retained samples.
- Profile strength is secondary. The collapse/repair profiles are selected for bursts, but the selector lets `steady-weak-listener`, `persistent-lean`, and `silent-lean` dominate while missing frames continue. Fix classification/holding before raising the baseline.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `persistent-lean` | yes/inferred | 28.490 | 3668 | 467 | 0.033 | 0.021 | recovery | Dominant retained profile is `persistent-lean` (`166/300`) despite `totalMissingFramesDelta=2619`; late live state is only `steady-weak-listener`. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `steady-weak-listener` | yes/inferred | 5.921 | 5603 | 518 | 0.007 | 0.005 | recovery | Dominant retained profile is `steady-weak-listener` (`103/300`) while reserve is near empty and `totalMissingFramesDelta=3835`; late live state is `silent-lean`. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery` during and after missing-frame bursts. `persistent-lean` can explain sustained low reserve only if damage is mild, which is not true here.

Actual exported profile:
- Dominant sampled profile: `persistent-lean` (`166` samples).
- Other sampled profiles: `steady-weak-listener` (`44`), `collapse-recovery` (`43`), `repair-collapse` (`27`), `repair-heavy-connected` (`14`), `buffered-not-ready` (`4`), `silent-lean` (`2`).
- Current exported profile: `steady-weak-listener`.

Did classification match?
- No.

Notes:
- Side A accumulates `2619` missing frames and `322` concealment ticks during the retained window. The largest missing-frame bursts are `369`, `231`, `219`, and `212`.
- The burst samples do enter repair profiles, but the side quickly falls back to weak/lean profiles while recovery remains active.
- `collapse-recovery` owns most concealment (`268` ticks) and looks appropriate when concealment is active. The main miss is insufficient damage hold after missing-frame spikes.
- Live state shows `lastAppliedTargetMs=172`, `lastAppliedFloorMs=172`, and boost `+48`, which is light for a side still carrying thousands of missing frames.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`. This side is near-empty (`avgPcmBufferedMs=5.921`, jitter depth mean `0.300`) and has the worse missing-frame count.

Actual exported profile:
- Dominant sampled profile: `steady-weak-listener` (`103` samples).
- Other sampled profiles: `silent-lean` (`56`), `collapse-recovery` (`56`), `repair-collapse` (`48`), `persistent-lean` (`25`), `buffered-not-ready` (`6`), `repair-heavy-connected` (`6`).
- Current exported profile: `silent-lean`.

Did classification match?
- No.

Notes:
- Side B accumulates `3835` missing frames and `381` concealment ticks during the retained window. The largest missing-frame bursts are `376`, `251`, `238`, and `127`.
- `steady-weak-listener` owns `1277` missing-frame delta, more than any stronger class. That is the clearest selector mismatch in this pair.
- Under-target and slow-rate fractions are low (`0.007` and `0.005`), so the selector is still relying too much on those calm rate signals while missing frames and near-empty reserve say the listener is bad.
- Live state is `silent-lean` with target/floor/boost `204/192/+84`; this is stronger than Side A but still not the correct damage class for ongoing missing-frame failure.

## Trend Read

Side A:
- Oscillating between weak/lean and repair/collapse, with discrete missing-frame bursts.
- Reasons seen:
  - one explicit `missing-frames-spike`.
  - top missing-frame deltas: `369`, `231`, `219`, `212`, `111`, `76`, `75`, `70`.
  - `37` retained samples report `jitterHasReadyFrame=false`.
  - no retained-window decrypt/decode/no-target deltas.

Side B:
- Flat weak reserve with repeated discrete missing-frame bursts; stronger classes do not hold long enough.
- Reasons seen:
  - one explicit `missing-frames-spike`.
  - top missing-frame deltas: `376`, `251`, `238`, `127`, `114`, `101`, `88`, `81`.
  - `69` retained samples report `jitterHasReadyFrame=false`.
  - no retained-window decrypt/decode/no-target deltas.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-09T21:43Z group-937` | A / Linux root epoch 2 | `persistent-lean` | yes/inferred | no | selector / damage hold | Promote and hold `repair-collapse`/`collapse-recovery` after large missing-frame bursts; do not let `persistent-lean` or `steady-weak-listener` dominate while recovery damage is still accumulating. |
| `2026-05-09T21:43Z group-937` | B / Linux standby epoch 2 | `steady-weak-listener` | yes/inferred | no | selector / damage hold | Escalate near-empty single-source listeners with repeated missing-frame bursts even when under-target and rate fractions are low; hold the stronger class through recovery. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: single-source missing-frame/recent-damage escalation should latch `repair-collapse` or `collapse-recovery` longer, especially when `avgPcmBufferedMs` is near-empty or `jitterHasReadyFrame=false` recurs.
- Secondary fix: profile strength for `repair-collapse`/`collapse-recovery` can be revisited after classification stays correct; Side A's applied `172/172/+48` is likely too light if that remains the live policy after selector fixes.
- Keep baseline unchanged. Do not add a new profile from this call.
## Call: 2026-05-09 21:25Z / group 812 good 3-person follow-up

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T21-25-22-493Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T21-24-53-757Z.json`
- Side C: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-09T21-24-46-348Z.json`

User symptom:
- New post-change 3+ group call. User reported the call was good.

High-level verdict:
- Good, with noisy retained-window receive diagnostics.
- All three exports agree on room `gcall-qortal-812`, topology epoch `3`, root `QeJW96...j5W9`, standby `QP9Jj4...i6rP`, participant count `3`, room key presence, and media session generation `1`.
- This is not a correctness/startup failure. It is a tuning signal: the call sounded good while one side stayed fully protected and the other two sides spent most samples low-latency with continuing missing-frame deltas.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and retained-window pending-decrypt delta `0` on all three exports.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on all three exports.
- Queue/backpressure: no queue-pressure drops, stale drops, link-unready drops, or bridge drain wait on any side.
- Startup/send-target: retained-window `totalNoTargetSkipsDelta=0` on all three exports.
- Authority/session: topology, root/standby, room key, and media generation are consistent across the batch.

Primary next target:
- Selector, specifically multi-source protected/clean exit stability and damage attribution.
- Do not strengthen `multi-protected-recovery` from this batch: the subjective result was good, and the fully protected participant already applied `240/224/+120` with extra hold `8` on both sources.
- Do not change baseline: root and standby were mostly low-latency and still sounded good. The interesting problem is classification/diagnostic alignment, not global target size.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QeJW96...j5W9` | mixed, clean-dominant | no | 79.940 | 4481 | 132 | 0.058 | 0.014 | low-latency | Retained window has `1964` missing-frame delta but only `1` concealment tick; `QP9Jj4` clean `189/300`, protected `111/300`; `QMe6E7` clean `259/300`, protected `41/300`. |
| B | participant / Linux / `QMe6E7...6VFZ` | `multi-protected-recovery` | no | 10.558 | 3545 | 18016 | 0.115 | 0.114 | recovery | Both sources protected `300/300`; retained window still has `9567` concealment ticks, but user symptom was good. Protection may be doing useful work, but diagnostics read harsher than the reported experience. |
| C | standby-forwarder / Linux / `QP9Jj4...i6rP` | mixed, one protected leg | no | 19.037 | 5053 | 74 | 0.012 | 0.003 | low-latency | `QeJW96` protected `300/300`; `QMe6E7` clean `230/300`, protected `70/300`; retained window has `2481` missing-frame delta with only `5` concealment ticks. |

### Side A / Root `QeJW96...j5W9`

Expected profile from symptom:
- Mostly `multi-clean-low-latency`, with brief protected recovery only around real weak-leg events.

Actual exported profile:
- `QP9Jj4...i6rP`: `multi-clean-low-latency` (`189`), `multi-protected-recovery` (`111`).
- `QMe6E7...6VFZ`: `multi-clean-low-latency` (`259`), `multi-protected-recovery` (`41`).
- Current live profile: `QP9Jj4` clean, `QMe6E7` protected.

Did classification match?
- Mostly, but noisy.

Notes:
- Good symptom matches clean-dominant classification and low concealment.
- The retained `1964` missing-frame delta did not become an audible bad call, so missing frames alone should not force stronger protection here.
- The `QP9Jj4` leg flips rapidly between clean and protected near export time, often with `preProcessBufferedFrames` bouncing between `0` and `8-10`. That points to selector exit/entry stability rather than profile strength.

### Side B / Participant `QMe6E7...6VFZ`

Expected profile from symptom:
- Good-user symptom would normally suggest clean or brief recovery, but the metrics support protection because reserve is shallow and concealment remains active.

Actual exported profile:
- `QeJW96...j5W9`: `multi-protected-recovery` (`300`).
- `QP9Jj4...i6rP`: `multi-protected-recovery` (`300`).

Did classification match?
- Partly.

Notes:
- Metrics justify protection: `avgPcmBufferedMs=10.558`, `jitterBufferDepthFramesMean=0.268`, `totalConcealmentTicksDelta=9567`, under-target `0.115`, and rate-below-0.97 `0.114`.
- Symptom does not justify calling this a failed profile. The previous concern that protected recovery was too weak is not supported by this good-call report.
- Both sources applied strong protection at export (`240/224/+120`, extra hold `8`), so this is a case where strong protection may be preserving acceptable audio despite harsh retained-window counters.

### Side C / Standby `QP9Jj4...i6rP`

Expected profile from symptom:
- One protected source can be valid if source-specific reserve is weak; the healthy leg should remain clean.

Actual exported profile:
- `QeJW96...j5W9`: `multi-protected-recovery` (`300`).
- `QMe6E7...6VFZ`: `multi-clean-low-latency` (`230`), `multi-protected-recovery` (`70`).

Did classification match?
- Mostly.

Notes:
- The protected `QeJW96` leg has low source reserve (`bufferedMsEma=5.806`) and applied protection (`192/176/+72`, extra hold `6`), while `QMe6E7` has healthy source reserve (`bufferedMsEma=133.139`) and clean classification.
- This is the best evidence that per-source multi classification is directionally useful.
- The retained `2481` missing-frame delta with only `5` concealment ticks suggests missing-frame severity should be interpreted with concealment/user symptom, not as an automatic escalation input.

## Trend Read

Side A:
- Mostly low-latency, with selector oscillation on one source.
- Reasons seen:
  - only `7/300` retained samples in recovery mode.
  - top missing-frame delta is `30`, with low concealment.
  - late `QP9Jj4` transitions flip clean/protected repeatedly within milliseconds.

Side B:
- Flat protected recovery.
- Reasons seen:
  - recovery mode for `300/300` samples.
  - both sources protected for `300/300` samples.
  - concealment ticks continue steadily around `31-33` on top samples, yet the call was reported good.

Side C:
- Source-specific protected leg plus clean healthy leg.
- Reasons seen:
  - `QeJW96` protected for `300/300` samples.
  - `QMe6E7` clean for `230/300` samples.
  - recovery mode only `36/300` samples, with low concealment.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-09T21:25Z group-812 good` | A / Linux root epoch 3 | mixed clean-dominant | no | mostly | selector stability | Smooth multi-source clean/protected flipping; avoid using missing frames alone as proof of user-bad quality when concealment is near zero. |
| `2026-05-09T21:25Z group-812 good` | B / Linux participant epoch 3 | `multi-protected-recovery` | no | partly | selector/profile interpretation | Keep strong protection available, but do not strengthen it from this call; investigate whether retained concealment counters overstate audible damage during successful protected recovery. |
| `2026-05-09T21:25Z group-812 good` | C / Linux standby epoch 3 | mixed protected/clean | no | mostly | selector attribution | Preserve per-source asymmetry; verify missing-frame attribution before tightening clean exit rules. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: multi-source selector stability and attribution. The root side shows rapid clean/protected flipping, while the standby side shows a plausible protected/clean split. Tune entry/exit hysteresis around `preProcessBufferedFrames`, source reserve, and recent missing-frame deltas so good calls do not look like failed protected recovery.
- Secondary fix: diagnostics/profile interpretation for protected recovery. A fully protected participant can still be a good call; scoreboard logic should treat user symptom plus concealment audibility, not just high retained counters.
- Leave baseline unchanged. Do not add a new profile from this call.

## Call: 2026-05-10 22:44Z / group 937 2-person follow-up

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-119.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-10T22-44-40-652Z.json`

User symptom:
- New two-person group call after the latest changes. Subjective quality was not stated, so user-bad is inferred from the retained-window receive metrics and recovery profiles.

High-level verdict:
- Bad, receive-policy dominated.
- Both exports agree on room `gcall-qortal-937`, topology epoch `2`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, participant count `2`, room key presence, and media session generation `1`.
- Side A is a real severe receive failure: near-empty reserve, heavy concealment, and live `repair-collapse`.
- Side B is still under-classified for the symptom shape: low reserve and repeated missing-frame deltas spend most retained samples in `steady-weak-listener` / `persistent-lean`.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and retained-window pending-decrypt delta `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Queue/backpressure: bridge waiting-for-drain is `false`; bridge queued-frame high-water is `24` on Side A and `2` on Side B, with no queue-pressure drops.
- Failover/authority: no promotion/demotion counts, settled matching root/standby/topology/session state.
- Baseline: both sides are already almost entirely in recovery (`112/134` retained samples on Side A, `60/61` on Side B), so a global baseline increase is not the next lever.

Primary next target:
- Selector.
- Specifically, single-source damage/readiness hysteresis. Side B still lets weak/lean profiles dominate while missing frames continue, and Side A still oscillates between severe profiles and `silent-lean` even with near-zero reserve and high concealment.
- Profile strength is secondary: Side A's live `repair-collapse` classification is correct but still sounds bad on paper, so revisit `repair-collapse` target/floor only after the selector stops dropping damaged sources into lean/weak classes.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | mixed, `silent-lean` / `collapse-recovery` | yes/inferred | 1.170 | 635 | 1587 | 0.043 | 0.040 | recovery | Live profile is `repair-collapse`, but retained samples still spend `48/134` in `silent-lean`; reserve is effectively empty and concealment is severe. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `steady-weak-listener` / `persistent-lean` | yes/inferred | 7.061 | 745 | 55 | 0.013 | 0.009 | recovery | Low concealment, but near-empty reserve and `745` missing frames should not be dominated by weak/lean profiles. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`.

Actual exported profile:
- Current exported profile: `repair-collapse`.
- Retained samples: `silent-lean` (`48`), `collapse-recovery` (`43`), `repair-collapse` (`18`), `buffered-not-ready` (`4`), `steady-weak-listener` (`3`), plus `18` early samples before receive profile export.

Did classification match?
- Partly.

Notes:
- The live profile matches the severe symptom: `avgPcmBufferedMs=1.170`, `jitterBufferDepthFramesMean=0.060`, `avgPlayoutDeltaMs=-183.531`, and `concealmentTicks=1587`.
- The retained window still spends too much time in `silent-lean` despite `635` missing frames and `1587` concealment ticks.
- `collapse-recovery` owns most retained concealment delta (`1091`), while `repair-collapse` owns `243` missing-frame delta and `310` concealment delta.
- There is an early outbound target gap (`totalNoTargetSkipsDelta=60`) before profiles appear, but the late bad state has active playout, active scheduler/playback nodes, and no decrypt/decode failures.

### Side B

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery` during missing-frame bursts; at minimum `silent-lean` should dominate over `steady-weak-listener` when reserve is this shallow.

Actual exported profile:
- Current exported profile: `silent-lean`.
- Retained samples: `steady-weak-listener` (`20`), `persistent-lean` (`19`), `collapse-recovery` (`11`), `silent-lean` (`4`), `repair-collapse` (`4`), `repair-heavy-connected` (`1`), `buffered-not-ready` (`1`).

Did classification match?
- No/partly.

If no:
- `steady-weak-listener` and `persistent-lean` own `681` of the `745` retained missing-frame delta while reserve stays shallow (`avgPcmBufferedMs=7.061`, jitter depth mean `0.358`).
- Low concealment (`55`) explains why this is not a classic concealment-heavy collapse, but it does not justify weak/lean dominance through repeated missing-frame bursts.
- Retune selector entry/hold before changing baseline or adding a new profile.

## Trend Read

Side A:
- Flat-bad after startup, with severe concealment and selector oscillation.
- Reasons seen:
  - `entered-recovery` once near the start of the retained bad window.
  - `jitterHasReadyFrame=false` in `74/134` retained samples.
  - top missing-frame deltas include `38`, `37`, `33`, `33`, `29`, and `27`.
  - top concealment deltas include `49`, `48`, `46`, `45`, `45`, and `43`.
  - no retained-window decrypt/decode deltas.

Side B:
- Low-reserve missing-frame failure with weak/lean under-classification.
- Reasons seen:
  - `entered-recovery` once at the start of the retained window.
  - `jitterHasReadyFrame=false` in `18/61` retained samples.
  - top missing-frame deltas include `64`, `62`, `49`, `39`, `35`, `33`, and `32`.
  - concealment remains low; top concealment deltas are only `6`.
  - no retained-window decrypt/decode/no-target deltas.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-10T22:44Z group-937` | A / Linux root epoch 2 | mixed severe/lean, live `repair-collapse` | yes/inferred | partly | selector, then profile strength | Hold severe classification through near-empty/high-concealment windows; after that, verify whether `repair-collapse` target/floor is strong enough. |
| `2026-05-10T22:44Z group-937` | B / Linux standby epoch 2 | `steady-weak-listener` / `persistent-lean` | yes/inferred | no/partly | selector / damage hold | Escalate repeated missing-frame bursts with shallow reserve even when concealment, under-target, and slow-rate fractions are calm. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: single-source damage/readiness hysteresis. Treat near-empty reserve plus repeated missing-frame deltas or frequent `jitterHasReadyFrame=false` as a reason to hold `repair-collapse` / `collapse-recovery`, not fall back to `steady-weak-listener`, `persistent-lean`, or `silent-lean`.
- Secondary fix: profile strength for `repair-collapse` if Side A remains near-empty after classification holds steady.
- Leave baseline unchanged. Do not add a new profile from this call.

## Call: 2026-05-10 23:51Z / group 937 2-person follow-up

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-120.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-10T23-51-02-953Z.json`

User symptom:
- New two-person group call after the latest changes. Extra report: the root had a harder time hearing the other person.

High-level verdict:
- Bad on the root side, receive-policy dominated.
- Both exports agree on room `gcall-qortal-937`, topology epoch `2`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, participant count `2`, room key presence, and media session generation `1`.
- The reported-bad root side is now correctly classified into severe receive profiles for most retained samples, but the profile protection is still not strong enough to rebuild usable reserve.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and retained-window pending-decrypt delta `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Queue/backpressure: bridge waiting-for-drain is `false`; bridge queued-frame high-water is `22` on Side A and `2` on Side B, with no queue-pressure drops.
- Failover/authority: no promotion/demotion counts, settled matching root/standby/topology/session state.
- Startup/send-target: Side A has retained `totalNoTargetSkipsDelta=58`, but the late window has `outboundNoTargetSkipsDelta=0`, active playout, active scheduler/playback nodes, and continuing receive collapse. This is not the primary next fix.
- Baseline: both sides are already in recovery almost the whole retained window (`94/131` on Side A, `61/62` on Side B), so a global baseline increase is not the next lever.

Primary next target:
- Profile strength.
- Specifically strengthen severe single-source protection for `repair-collapse` / `collapse-recovery`: the reported-bad root spends `84/95` classified retained samples in those two severe profiles, live state is `repair-collapse`, and protection already applies `240/224/+120` with extra hold `11`, yet average PCM reserve is only `2.098ms` with `1052` concealment ticks.
- Selector is now secondary: reduce rapid severe-profile churn, but do not treat this as the main failure because the root is no longer primarily stuck in weak/lean profiles.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `repair-collapse` / `collapse-recovery` | yes | 2.098 | 315 | 1052 | 0.050 | 0.046 | recovery | Reported-bad side. Live profile is `repair-collapse`; retained profile deltas put `112` missing / `243` concealment in `repair-collapse` and `118` missing / `709` concealment in `collapse-recovery`. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | `silent-lean` / `persistent-lean` | no/not reported | 8.253 | 479 | 28 | 0.009 | 0.004 | recovery | Symptom was asymmetric toward the root. Side B has low concealment but repeated missing-frame bursts; this looks like a lean/missing-frame path, not the user-reported hard-hearing side. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`.

Actual exported profile:
- Current exported profile: `repair-collapse`.
- Retained samples: `repair-collapse` (`43`), `collapse-recovery` (`41`), `silent-lean` (`7`), `buffered-not-ready` (`2`), `persistent-lean` (`2`), plus `36` early samples before receive profile export.

Did classification match?
- Yes.

Notes:
- The reported symptom matches the severe receive classification: `avgPcmBufferedMs=2.098`, `jitterBufferDepthFramesMean=0.107`, `avgPlayoutDeltaMs=-182.469`, `missingFrames=315`, and `concealmentTicks=1052`.
- This is the first follow-up where the root-side problem is not primarily under-classification into weak/lean profiles. Severe profiles dominate the classified retained window.
- The failure is still active late in the export: the last retained sample has `missingFramesDelta=16`, `concealmentTicksDelta=27`, `avgPcmBufferedMs=2.098`, and `collapse-recovery`.
- There is rapid `repair-collapse` / `collapse-recovery` switching near export time, but both are severe paths. That churn is secondary to the fact that the severe target/floor is not producing usable reserve.

### Side B

Expected profile from symptom:
- If the standby had no hearing complaint, mostly clean or brief lean recovery would be expected. If unreported weak audio existed, `silent-lean` / `persistent-lean` fits better than repair-heavy collapse because concealment is low.

Actual exported profile:
- Current exported profile: `silent-lean`.
- Retained samples: `silent-lean` (`27`), `persistent-lean` (`17`), `repair-collapse` (`13`), `collapse-recovery` (`3`), `buffered-not-ready` (`1`), plus `1` early sample before receive profile export.

Did classification match?
- Partly / unknown against user symptom.

If no:
- The reported asymmetry was root-hearing-other, not standby-hearing-root. Side B's lean classification may be real metrics pressure, but it is not the reported symptom.
- `silent-lean` and `persistent-lean` own `411` of `479` retained missing-frame delta while concealment stays low (`28` total), so this remains a selector/damage-hold signal for missing-frame bursts if the standby later reports bad audio.
- Do not use Side B to justify strengthening `repair-collapse`; use Side A for that.

## Trend Read

Side A:
- Flat-bad severe recovery after startup.
- Reasons seen:
  - recovery mode for `94/131` retained samples.
  - severe profiles for `84/95` classified retained samples.
  - top missing-frame deltas include `26`, `25`, `20`, `16`, and `12`.
  - top concealment deltas include `36`, `35`, `35`, `31`, `30`, and `28`.
  - no retained-window decrypt/decode deltas.

Side B:
- Lean missing-frame pressure, low concealment, not the reported-bad side.
- Reasons seen:
  - recovery mode for `61/62` retained samples.
  - `silent-lean` / `persistent-lean` for `44/61` classified retained samples.
  - top missing-frame deltas include `74`, `44`, `43`, `28`, `23`, and `22`.
  - concealment remains low; top concealment deltas are `4`, `3`, and `2`.
  - no retained-window decrypt/decode/no-target deltas.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-10T23:51Z group-937` | A / Linux root epoch 2 | `repair-collapse` / `collapse-recovery` | yes | yes | profile strength | Strengthen severe single-source `repair-collapse` / `collapse-recovery` target, floor, accumulation, or hold behavior; classification now matches the root's bad-hearing symptom. |
| `2026-05-10T23:51Z group-937` | B / Linux standby epoch 2 | `silent-lean` / `persistent-lean` | no/not reported | partly/unknown | selector / lean interpretation | Keep as secondary evidence for missing-frame-plus-lean handling; do not make it the primary fix unless standby-side bad audio is reported. |

## Next Fix Target

Current patched target:
- Profile strength.
- Primary fix: severe single-source receive profile strength for `repair-collapse` / `collapse-recovery`. The root-side classification now matches the symptom, but the current `240ms` target, `224ms` floor, `+120ms` boost, and extra hold `11` still leave the listener near empty with heavy concealment.
- Secondary fix: severe-profile selector stability. Smooth the rapid `repair-collapse` / `collapse-recovery` churn, but keep the side in a severe protection path until reserve actually rebuilds.
- Leave baseline unchanged. Do not add a new profile from this call.

## Call: 2026-05-11 00:35Z / group 937 2-person follow-up

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/phil-kenny-one-on-one-121.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-11T00-35-43-714Z.json`

User symptom:
- New two-person group call after the latest changes. Audio was horrible and incomprehensible overall; on root it was spotty, and on standby it was incomprehensible.

High-level verdict:
- Bad/catastrophic, receive-policy dominated.
- Both exports agree on room `gcall-qortal-937`, topology epoch `1`, root `QTSzRS...9jMn`, standby `QP9Jj4...i6rP`, participant count `2`, room key presence, and media session generation `1`.
- The root side remains a true severe collapse: classification mostly matches, but protection is still not enough to rebuild reserve.
- The standby side is the stronger failure signal for the next patch: the reported-incomprehensible side is live `steady-weak-listener`, with large missing-frame damage previously carried by `clean-low-latency` and weak profiles.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and retained-window pending-decrypt delta `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0` and `packetsDroppedDecoderThrow=0` on both sides.
- Queue/backpressure: bridge waiting-for-drain is `false`; bridge queued-frame high-water is `24` on Side A and `1` on Side B, with no queue-pressure drops.
- Failover/authority: no promotion/demotion counts, settled matching root/standby/topology/session state.
- Startup/send-target: retained `totalNoTargetSkipsDelta=0` on both sides, playback/scheduler nodes are active, and both sides have live playouts.
- Baseline: both sides spend most retained samples in recovery (`141/147` on Side A, `71/91` on Side B), so a global baseline increase is not the next lever.

Primary next target:
- Selector.
- Specifically, single-source selector exit/hold around missing-frame bursts, under-target pressure, and slow-rate pressure when reserve looks superficially healthy. The standby side was reported incomprehensible, but live classification is only `steady-weak-listener`, and retained `clean-low-latency` owns `2430` missing-frame delta.
- Profile strength remains secondary for the root side: Side A is correctly severe and still bad, but the worse standby symptom does not match the live profile, so selector correctness should be fixed before another broad severe-profile strength increase.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QTSzRS...9jMn` receiving `QP9Jj4...i6rP` | `repair-collapse` / `collapse-recovery` | yes, spotty | 0.952 | 1071 | 2335 | 0.050 | 0.049 | recovery | Live profile is `collapse-recovery`; retained severe profiles own `124/146` classified samples and most concealment. Classification matches, but reserve remains effectively empty. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving `QTSzRS...9jMn` | mixed, live `steady-weak-listener` | yes, incomprehensible | 59.953 | 4991 | 251 | 0.239 | 0.222 | recovery | Retained count is mixed with `collapse-recovery` highest, but `clean-low-latency` and `steady-weak-listener` own `4178` missing-frame delta. Live weak classification does not match the symptom. |

### Side A

Expected profile from symptom:
- `repair-collapse` or `collapse-recovery`.

Actual exported profile:
- Current exported profile: `collapse-recovery`.
- Retained samples: `repair-collapse` (`66`), `collapse-recovery` (`58`), `silent-lean` (`16`), `buffered-not-ready` (`5`), `repair-heavy-connected` (`1`), plus `1` early sample before receive profile export.

Did classification match?
- Yes for classification; no for outcome.

Notes:
- The root-side symptom was spotty, and the metrics are severe: `avgPcmBufferedMs=0.952`, `jitterBufferDepthFramesMean=0.048`, `avgPlayoutDeltaMs=-181.082`, `missingFrames=1071`, and `concealmentTicks=2335`.
- Severe profiles own most retained damage: `collapse-recovery` has `296` missing / `1553` concealment delta, and `repair-collapse` has `286` missing / `627` concealment delta.
- This repeats the previous finding that severe-profile strength is still insufficient for the root path, but it is not the only or primary signal in this paired call.

### Side B

Expected profile from symptom:
- `collapse-recovery` or `repair-collapse`; at minimum a sustained repair-heavy/recovery profile should dominate while the side is incomprehensible.

Actual exported profile:
- Current exported profile: `steady-weak-listener`.
- Retained samples: `collapse-recovery` (`33`), `clean-low-latency` (`16`), `steady-weak-listener` (`14`), `repair-collapse` (`8`), `buffered-not-ready` (`7`), `repair-heavy-connected` (`1`), plus `12` early samples before receive profile export.

Did classification match?
- No/partly.

If no:
- The exported live profile is too weak for the reported symptom and the retained damage pattern.
- `clean-low-latency` owns `2430` missing-frame delta, and `steady-weak-listener` owns another `1748`, while the side reports incomprehensible audio.
- Reserve looks higher on paper (`avgPcmBufferedMs=59.953`, live `bufferedMsEma=120.276`), but `playoutUnderTargetFraction=0.239`, `playoutRateFractionBelow097=0.222`, `avgPlayoutDeltaMs=-120.907`, `jitterNotReadyFraction=0.239`, and repeated large missing-frame bursts say this should not clear back to clean/weak handling.
- Retune selector entry/exit and damage hold before changing baseline or adding a new profile.

## Trend Read

Side A:
- Flat-bad severe recovery, with rapid severe-profile churn near export time.
- Reasons seen:
  - recovery mode for `141/147` retained samples.
  - severe profiles for `124/146` classified retained samples.
  - top missing-frame deltas include `154`, `95`, `72`, `69`, `50`, and `44`.
  - top concealment deltas include `98`, `92`, `75`, `67`, `63`, and `54`.
  - no retained-window decrypt/decode/no-target deltas.

Side B:
- Mixed selector failure: healthy-looking reserve, but heavy missing-frame bursts and sustained under-target/slow-rate pressure.
- Reasons seen:
  - recovery mode for `71/91` retained samples.
  - `clean-low-latency` alone carries `2430` missing-frame delta; `steady-weak-listener` carries `1748`.
  - top missing-frame deltas include `604`, `269`, `252`, `237`, `236`, and `218`.
  - concealment is comparatively low (`251` total), but under-target and slow-rate fractions are high and the user symptom is incomprehensible.
  - no retained-window decrypt/decode/no-target deltas.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-11T00:35Z group-937` | A / Linux root epoch 1 | `repair-collapse` / `collapse-recovery` | yes, spotty | yes | profile strength, secondary | Keep severe profile strengthening on the list, but do not make this the only patch because the paired standby side is worse and misclassified. |
| `2026-05-11T00:35Z group-937` | B / Linux standby epoch 1 | mixed, live `steady-weak-listener` | yes, incomprehensible | no/partly | selector / damage hold | Prevent clean/weak profiles from carrying large missing-frame bursts under high under-target and slow-rate pressure; hold severe or repair-heavy recovery until pressure clears. |

## Next Fix Target

Current patched target:
- Selector.
- Primary fix: single-source selector damage hold and exit hysteresis. A side with repeated large missing-frame deltas plus high `playoutUnderTargetFraction` / `playoutRateFractionBelow097` should not spend damaging windows in `clean-low-latency` or settle live at `steady-weak-listener`, even if `avgPcmBufferedMs` / reserve EMA looks healthy.
- Secondary fix: severe-profile strength for `repair-collapse` / `collapse-recovery` on the root side, because correct severe classification still leaves root near empty.
- Leave baseline unchanged. Do not add a new profile from this call.

## Call: 2026-05-11 12:33Z / group 812 post-sender-hardening check

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-11T12-33-26-638Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-11T12-33-30-076Z.json`

User symptom:
- New two-person group call after the sender backlog/stale-output/reset changes. User asked whether the previous issue was fixed.

High-level verdict:
- Mixed but materially improved.
- Both exports agree on room `gcall-qortal-812`, connected state, two active senders, active WASM-FEC receive path, active shared PCM ring, active jitter/playback/scheduler nodes, and matching root/standby roles.
- The previous catastrophic sender issue is fixed in this call: both sides have `droppedEncoderBackpressureFrames=0`, `droppedStaleEncodedFrames=0`, `encoderResetCount=0`, `encoderQueueSize=0`, and normal sender main-thread-to-encoder timing. Root improved from the previous bad call's `avg=40.068ms / max=426.91ms` to `avg=0.686ms / max=15.24ms`; standby is `avg=0.633ms / max=6.98ms`.
- Remaining issue is receive-policy churn, not sender backlog. Standby receiving root is now clean enough by the prior symptom bars; root receiving standby still has moderate missing-frame/repair churn.

Not the problem:
- Sender/WebCodecs backlog: both sides have zero backpressure drops, stale drops, and encoder resets.
- Decrypt: `packetsDroppedPendingDecrypt=0`, retained-window pending-decrypt delta `0` on both sides.
- Decode: `packetsDroppedDecodeFailure=0`, retained-window decode-failure delta `0` on both sides.
- Queue/backpressure: both outbound paths show send successes equal attempts, no send failures, bridge waiting-for-drain `false`, no queue-pressure drops, no stale drops, no decoded queue drops, and no packet path timeouts.
- Startup/playout: both sides have active playout, active scheduler/playback nodes, `jitterHasReadyFrame=true`, and no no-target deltas.
- Renderer stalls: standby has no renderer stalls or long tasks. Root has one early renderer stall and one long task from before/at monitor startup, but sender timing stayed healthy and the stall is not the active failure shape.
- Baseline: both sides spend most retained samples in recovery and already apply profile floors/boosts; global baseline is not the next lever.

Primary next target:
- Selector / hysteresis.
- Specifically, smooth single-source receive profile exit/hold and reduce profile churn after recovery. The catastrophic standby-hearing-root failure is gone, but both sides still show profiles oscillating between lean, weak, repair-heavy, and collapse modes after missing-frame bursts.
- Do not tune sender next from this call. Do not increase baseline. Profile strength is secondary only if a future report says a correctly classified `repair-collapse` / `collapse-recovery` side still sounds bad.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | mixed: `steady-weak-listener`, `clean-low-latency`, `collapse-recovery`, `repair-collapse`; live `repair-heavy-connected` | no catastrophic symptom reported; residual receive churn | 25.454 | 1471 | 190 | 0.048 | 0.030 | recovery | Sender path healthy. Receive damage is moderate and much improved versus prior root collapse, but `clean-low-latency` still owns `372` missing-frame delta and weak/repair profiles churn. |
| B | standby-forwarder / macOS / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `persistent-lean` / `silent-lean`; live `repair-collapse` | no; prior standby-incomprehensible symptom appears fixed | 11.216 | 685 | 55 | 0.005 | 0.003 | recovery | This is the important before/after improvement. Standby under-target and slow-rate fractions are now near clean-call levels; no sender backlog, decrypt, decode, or queue issues. Profile is conservative/lean-heavy despite low current pressure. |

### Side A

Expected profile from symptom:
- If no user-bad symptom: mostly `clean-low-latency` with brief `steady-weak-listener` / `repair-heavy-connected` during bursts.
- If residual spotty audio was noticed: `repair-heavy-connected` or brief `repair-collapse` fits better than full collapse.

Actual exported profile:
- Current exported profile: `repair-heavy-connected`.
- Retained profile counts: `steady-weak-listener` (`50`), `clean-low-latency` (`44`), `collapse-recovery` (`33`), `repair-collapse` (`22`), `repair-heavy-connected` (`15`), `buffered-not-ready` (`1`), plus `20` early no-profile samples.

Did classification match?
- Partly.

Notes:
- The sender-side classification is clean: captured and encoded frames match (`8376/8376`), with no backpressure/stale/reset counters.
- Receive classification still exits/enters too often. `repair-collapse` owns the largest retained missing-frame delta (`565`), but `clean-low-latency` still owns `372` missing-frame delta and `steady-weak-listener` owns `343`.
- Late live state looks like a recovery tail rather than active collapse: `bufferedMsEma=181.741`, `lastAppliedTargetMs=196`, `lastAppliedFloorMs=196`, `underTargetEma=0.074`, `missingFrameEma=0.030`, and `repairHeavy` hold remaining about `9.9s`.
- This argues for selector/hysteresis refinement, not another global profile-strength increase.

### Side B

Expected profile from symptom:
- Since the previous standby-incomprehensible symptom appears fixed, expected profile would be mostly `clean-low-latency` or brief lean recovery.

Actual exported profile:
- Current exported profile: `repair-collapse`.
- Retained profile counts: `persistent-lean` (`77`), `silent-lean` (`49`), `repair-collapse` (`27`), `collapse-recovery` (`7`), plus `1` early no-profile sample.

Did classification match?
- Partly / too conservative.

If no:
- Current user-level outcome looks far better than the exported severe/lean labels imply: `playoutUnderTargetFraction=0.005`, `playoutRateFractionBelow097=0.003`, `concealmentTicks=55`, no renderer stalls, and no sender backlog.
- The live `repair-collapse` state is mostly driven by shallow/lean geometry (`bufferedMsEma=3.312`, `deltaMsEma=-181.688`, `preProcessBufferedFrames=0`) and missing-frame EMA, not active under-target or concealment pressure.
- This should not drive profile-strength tuning. It is a selector/exit-hysteresis question: keep protection available for shallow reserve, but avoid making a good-sounding standby look catastrophically classified once current pressure is calm.

## Trend Read

Side A:
- Improved sender, residual receive oscillation.
- Reasons seen:
  - recovery mode for `135/185` retained samples.
  - profile counts are spread across weak, clean, repair-heavy, repair-collapse, and collapse-recovery rather than one stable severe class.
  - retained missing-frame deltas: `repair-collapse=565`, `clean-low-latency=372`, `steady-weak-listener=343`, `repair-heavy-connected=111`, `collapse-recovery=80`.
  - concealment is much lower than the previous root-collapse call (`190` total versus `2335`), but collapse-recovery still owns most concealment (`152`).
  - no retained-window decrypt/decode/no-target deltas.

Side B:
- Fixed prior standby catastrophic symptom; conservative lean/recovery classification remains.
- Reasons seen:
  - recovery mode for `160/161` retained samples.
  - retained missing-frame deltas are mostly `persistent-lean=457`, with low concealment (`55`) and very low under-target/slow-rate fractions.
  - largest missing deltas were `108` and `102` in `persistent-lean`, but late windows settle to small deltas (`2-4`) with `jitterHasReadyFrame=true`.
  - no renderer stalls, decrypt/decode drops, no-target deltas, or bridge pressure.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-11T12:33Z group-812` | A / Linux root epoch unknown | mixed; live `repair-heavy-connected` | no catastrophic symptom reported; residual churn | partly | selector / recovery hysteresis | Keep sender fix; tune receive selector exit/hold so clean/weak profiles do not own missing-frame bursts and recovery tails do not churn. |
| `2026-05-11T12:33Z group-812` | B / macOS standby epoch unknown | `persistent-lean` / `silent-lean`; live `repair-collapse` | no; prior incomprehensible standby symptom fixed | partly / too conservative | selector / lean-clear hysteresis | Do not strengthen severe profiles from this side; refine lean/collapse clear conditions so calm low-under-target windows do not look catastrophically classified. |

## Next Fix Target

Current patched target:
- Selector / hysteresis.
- Primary fix: single-source receive profile stability after recovery. Keep the new sender backlog protection as successful, then tune receive selector entry/exit so:
  - `clean-low-latency` and `steady-weak-listener` do not own meaningful missing-frame bursts on Side A.
  - `persistent-lean` / `silent-lean` / `repair-collapse` clear more coherently on Side B when under-target, slow-rate, concealment, decrypt, decode, sender, and queue signals are calm.
- Profile strength is not the next target from this call. Baseline is not the next target. No new profile is justified.

## Call: 2026-05-11 13:38Z / group 812 3-person multi-source follow-up

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-11T13-38-40-156Z.json`
- Side B: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-11T13-42-52-482Z.json`
- Side C: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-11T13-38-34-883Z.json`

User symptom:
- New 3-person group call after the multi-source changes. Root was not able to hear the third participant, but standby was able to hear the third participant.

High-level verdict:
- Mixed/bad, with one source-specific multi-source playout-readiness failure.
- All three exports agree on room `gcall-qortal-812`, topology epoch `2`, root `QNardT...ZAWL`, standby `QP9Jj4...i6rP`, participant count `3`, room key presence, and media session generation `1`.
- The root-side failure matches the diagnostics directly: root has a playout for third participant `QMe6E7...6VFZ`, but `jitterHasReadyFrame=false` for that source in all `102/102` retained multi-source samples. Standby has the same third participant ready in `300/300` retained samples.
- This is not primarily a profile-strength or baseline miss. The failed root source is already in `multi-protected-recovery` with protected target/floor/boost applied, but it never becomes ready.

Not the problem:
- Decrypt: `packetsDroppedPendingDecrypt=0`, pending-decrypt deltas `0`, and `pendingDecryptDepth=0` on all three exports.
- Decode: `packetsDroppedDecodeFailure=0`, decoder throws `0`, and decode-failure deltas `0` on all three exports.
- Queue/backpressure: bridge waiting-for-drain is `false`, no queue-pressure drops, no stale drops, no link-unready drops, no packet send failures; bridge high-water is low (`4`, `2`, `2`).
- Failover/authority: no promotion/demotion counts, all sides agree on root/standby/topology/session state.
- Sender: all sides have outbound sends succeeding and `outboundNoTargetSkipsDelta=0`; sender worklet-to-encoder timing is normal.
- Baseline: the bad source is already above baseline policy in `multi-protected-recovery`, so a global baseline increase is not the next lever.

Primary next target:
- Another subsystem: multi-source per-source playout readiness / source activation path.
- Specifically inspect why root receiving `QMe6E7...6VFZ` can have an active playout, active decoder/ring/scheduler, `jitterBufferedFrames=12`, `lastAppliedTargetMs=240`, and `lastAppliedFloorMs=224`, but still export `jitterHasReadyFrame=false` for the whole retained multi-source window.
- Do not tune selector first: root classified the unheard source as `multi-protected-recovery`, which is the expected strong profile for a source that is not audibly ready.
- Do not tune profile strength first: stronger targets will not fix a source that never flips ready despite buffered frames.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QNardT...ZAWL` receiving standby `QP9Jj4...i6rP` | `multi-protected-recovery`; earlier single-source churn | no symptom for standby leg | 75.129 | 1664 | 99 | 0.092 | 0.037 | low-latency | Standby leg is ready in `300/300` samples; prior single-source clean/weak churn remains but does not explain the reported third-participant silence. |
| A | root-forwarder / Linux / `QNardT...ZAWL` receiving participant `QMe6E7...6VFZ` | `multi-protected-recovery` | yes, root could not hear this participant | 75.129 | 1664 | 99 | 0.092 | 0.037 | low-latency | Failed leg. Source exists, output count is `2`, protected profile is active, but `jitterHasReadyFrame=false` for `102/102` retained samples. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving root `QNardT...ZAWL` | `multi-protected-recovery` | not reported bad | 13.044 | 3660 | 85 | 0.003 | 0.001 | low-latency | Conservative protected classification for root, but playout is ready in `294/300` retained samples and no user symptom points here. |
| B | standby-forwarder / Linux / `QP9Jj4...i6rP` receiving participant `QMe6E7...6VFZ` | `multi-clean-low-latency` | no, standby could hear this participant | 13.044 | 3660 | 85 | 0.003 | 0.001 | low-latency | This is the control leg. Same third participant is ready in `300/300` retained samples and classified clean. |
| C | participant / Linux / `QMe6E7...6VFZ` receiving root `QNardT...ZAWL` | `multi-protected-recovery` | unknown; metrics bad | 8.997 | 527 | 2066 | 0.077 | 0.075 | recovery | Participant hears root with ready playout after startup, but has heavy concealment and shallow reserve. Classification matches metric severity. |
| C | participant / Linux / `QMe6E7...6VFZ` receiving standby `QP9Jj4...i6rP` | `multi-protected-recovery` | unknown; metrics bad | 8.997 | 527 | 2066 | 0.077 | 0.075 | recovery | Participant hears standby with ready playout after startup, but the side is generally in protected recovery. |

### Side A

Expected profile from symptom:
- For root receiving third participant: `multi-protected-recovery` or a startup/playout-not-ready class. Since the source is present but inaudible, protected recovery is reasonable, but readiness must become true.

Actual exported profile:
- Standby source `QP9Jj4...i6rP`: live `multi-protected-recovery`.
- Third participant source `QMe6E7...6VFZ`: live `multi-protected-recovery`.
- Retained profile counts after the third participant joined: standby source `multi-protected-recovery` (`102`); third participant source `multi-protected-recovery` (`101`) plus one `multi-clean-low-latency` sample.

Did classification match?
- Yes for the bad source, but the subsystem outcome failed.

Notes:
- The third-participant source was not ignored: root has `sourceAddrs=["QP9Jj4...i6rP","QMe6E7...6VFZ"]`, `outputNodeCount=2`, decoder count `2`, playback node count `2`, jitter buffer count `2`, and active WASM-FEC/shared-ring playouts for both sources.
- The failing source never became ready in the retained multi-source window: `jitterHasReadyFrame=false` in `102/102` samples, including the export-time playout with `jitterBufferedFrames=12`.
- That shape fits the template's startup/playout-ready warning more than receive-policy tuning: buffered frames exist, protected profile is selected, but there is no real ready playout.

### Side B

Expected profile from symptom:
- For standby receiving third participant: `multi-clean-low-latency` or brief multi recovery, because standby could hear the third participant.

Actual exported profile:
- Third participant source `QMe6E7...6VFZ`: live `multi-clean-low-latency`, retained `multi-clean-low-latency` for `300/300` samples.
- Root source `QNardT...ZAWL`: live `multi-protected-recovery`, retained `multi-protected-recovery` for `300/300` samples.

Did classification match?
- Yes for the third-participant symptom.
- Partly/too conservative for the root source, but that is not the reported failure.

Notes:
- Standby is the control evidence that the third participant's outbound audio was available and decodable in the room.
- Standby receiving the third participant has `jitterHasReadyFrame=true` for `300/300` retained samples and low current pressure (`playoutUnderTargetFraction=0.003`, `playoutRateFractionBelow097=0.001`, `concealmentTicks=85` total side-wide).

### Side C

Expected profile from symptom:
- No user symptom was reported for what the third participant heard. From metrics alone, `multi-protected-recovery` is expected.

Actual exported profile:
- Root source `QNardT...ZAWL`: live `multi-protected-recovery`, retained `multi-protected-recovery` for `90/92` classified samples after a short `silent-lean` startup.
- Standby source `QP9Jj4...i6rP`: live `multi-protected-recovery`, retained `multi-protected-recovery` for `90/90` classified samples.

Did classification match?
- Yes from metrics; user-level correctness is unknown.

Notes:
- Participant side is shallow and repair-heavy: `avgPcmBufferedMs=8.997`, `concealmentTicks=2066`, `playoutUnderTargetFraction=0.077`, `playoutRateFractionBelow097=0.075`.
- Both playouts are ready in most retained samples (`86` ready samples per source after startup), so this is not the same failure shape as root receiving participant.

## Trend Read

Side A:
- Discrete multi-source join event followed by a stuck not-ready source.
- Reasons seen:
  - topology changes from epoch `1` to epoch `2` when the third participant joins.
  - root's third-participant playout is `jitterHasReadyFrame=false` in all `102` retained multi-source samples.
  - the same source transitions into `multi-protected-recovery` almost immediately, so selector did recognize the bad leg.
  - no decrypt, decode, no-target, send-failure, or queue-pressure deltas.

Side B:
- Stable control side for the reported symptom.
- Reasons seen:
  - third-participant playout is ready for `300/300` retained samples.
  - third-participant profile is `multi-clean-low-latency` for `300/300` retained samples.
  - no decrypt, decode, no-target, send-failure, or queue-pressure deltas.

Side C:
- Startup into protected recovery with heavy repair/concealment.
- Reasons seen:
  - recovery mode for `92/93` retained samples.
  - both remote sources settle into ready playout after the first few startup samples.
  - high concealment (`2066`) and shallow reserve justify protected recovery, but this side was not the reported root-hearing-third failure.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-11T13:38Z group-812 3p` | A / Linux root receiving standby | `multi-protected-recovery` | no symptom for this leg | partly conservative | receive / residual selector churn | Do not target from this symptom; keep observing root/standby protected classification separately. |
| `2026-05-11T13:38Z group-812 3p` | A / Linux root receiving participant | `multi-protected-recovery` | yes, root could not hear third participant | yes | startup/playout-ready subsystem | Fix multi-source per-source readiness/source activation: source is protected and buffered but never ready. |
| `2026-05-11T13:38Z group-812 3p` | B / Linux standby receiving root | `multi-protected-recovery` | not reported bad | partly conservative | receive selector, secondary | Not next target for this symptom; avoid broad profile-strength changes. |
| `2026-05-11T13:38Z group-812 3p` | B / Linux standby receiving participant | `multi-clean-low-latency` | no, standby could hear third participant | yes | no issue for reported symptom | No change. This is the control leg. |
| `2026-05-11T13:38Z group-812 3p` | C / Linux participant receiving root | `multi-protected-recovery` | unknown; metrics bad | yes from metrics | profile strength / recovery quality, secondary | Track separately; not the next fix for root unable to hear participant. |
| `2026-05-11T13:38Z group-812 3p` | C / Linux participant receiving standby | `multi-protected-recovery` | unknown; metrics bad | yes from metrics | profile strength / recovery quality, secondary | Track separately; not the next fix for root unable to hear participant. |

## Next Fix Target

Current patched target:
- Another subsystem: multi-source per-source playout readiness / source activation.
- Primary fix: inspect the receive playout/jitter readiness path for a newly added third source on the root. The failing leg has an active playout and protected profile, but `jitterHasReadyFrame=false` for the entire retained window while the same source is ready on standby.
- Secondary fix: keep profile-strength work for participant-side protected recovery quality on the list, but do not apply it as the next patch from this symptom.
- Selector is not the next target for the reported failure because classification for the unheard source was already strong (`multi-protected-recovery`). Baseline is not the next target. Do not add a new profile from this call.

## Call: 2026-05-12 11:50Z / group 812 2-person latest-code quality check

Room:
- `gcall-qortal-812`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-12T11-50-43-149Z.json`
- Side B: `/home/qortal/Downloads/Telegram Desktop/qortal-gcall-diagnostics-2026-05-12T11-50-45-893Z.json`

User symptom:
- Linux has the latest code. Mac heard Linux very well, but Linux heard Mac choppy.

High-level verdict:
- Mixed/bad, asymmetric receive quality.
- Both senders look healthy on the current capture path: `48000` Hz input, `960` sample frames, no encoder drops, no send failures, and link transport active in both directions.
- Mac receiving Linux is near-clean for the sampled window. Linux receiving Mac is still bad: `628` missing frames, `43` concealment ticks, repeated receive-profile churn, and burst-like inbound timing.

Not the problem:
- Bootstrap/seeding: not involved in this symptom.
- Link establishment: both sides are connected over link transport, with successful outbound sends and inbound link samples.
- Sender/capture: both sides export canonical `48k/960` capture and encode successfully.
- Decrypt/decode: `packetsDroppedPendingDecrypt=0`, `pendingDecryptDepth=0`, and `packetsDroppedDecodeFailure=0` on both sides.
- Queue/backpressure: no queue-pressure drops, stale drops, link-unready drops, packet send failures, or bridge waiting-for-drain pressure in the live window.
- Startup readiness: both sides have active playout, active scheduler/playback nodes, and `jitterHasReadyFrame=true` at export time.
- Global baseline: Mac is good under the same baseline, so baseline is not the first lever.

Primary next target:
- Another subsystem: receive burst absorption / jitter-buffer overflow diagnostics on the Linux receive path.
- The profile selector detects damage, but the profile labels are not the source of the damage. Linux gets missing-frame bursts while its jitter buffer is often already near `20-24` frames and ready, which points to sequence gaps created inside receive buffering rather than starvation, sender failure, or decode failure.
- Add direct jitter push/trim diagnostics and then tune the jitter-buffer capacity/trim behavior if trims confirm the inferred overflow path. Do not tune sender, bootstrap, or baseline from this call.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QP9Jj4...i6rP` receiving `QaU2XU...Jh91` | `steady-weak-listener` dominant; live `silent-lean`; repair/collapse churn | yes, Linux heard Mac choppy | 13.447 | 628 | 43 | 0.013 | 0.008 | recovery | Bad side. Decode and link are clean. Missing-frame deltas recur while `jitterBufferedFrames` is often `20-24`, including `+70`, `+26`, `+21`, `+19`, and `+15` bursts. |
| B | standby-forwarder / macOS / `QaU2XU...Jh91` receiving `QP9Jj4...i6rP` | `clean-low-latency` dominant; live `repair-heavy-connected` | no, Mac heard Linux well | 85.612 | 10 | 0 | 0.055 | 0.000 | recovery | Good side. Mostly clean-low-latency, no concealment, only `10` missing frames total, and no renderer stalls. Late repair-heavy state is conservative relative to the user symptom. |

### Side A

Expected profile from symptom:
- A receive-damage profile is expected because Linux heard Mac choppy.
- The exported bad shape should ideally land in a profile that explains bursty receive damage, not a lean/silent profile that implies mostly reserve geometry.

Actual exported profile:
- Current exported profile: `silent-lean`.
- Retained profile counts: `steady-weak-listener` (`47`), `buffered-not-ready` (`11`), `silent-lean` (`10`), `repair-heavy-connected` (`7`), `collapse-recovery` (`7`), `persistent-lean` (`1`).

Did classification match?
- Partly.

If no:
- The selector correctly sees that the side is damaged and keeps the side in recovery, but the labels churn between lean, buffered-not-ready, repair-heavy, and collapse.
- The actual failure signature is stronger than the live `silent-lean` label: high missing frames with clean transport/decode and ready jitter buffers.
- This is not a simple selector-only bug. The selector is reacting to damage that appears to be produced by the receive buffering path.

### Side B

Expected profile from symptom:
- Mostly `clean-low-latency`, because Mac heard Linux well.

Actual exported profile:
- Current exported profile: `repair-heavy-connected`.
- Retained profile counts: `clean-low-latency` (`56`), `repair-heavy-connected` (`8`), `steady-weak-listener` (`7`), `buffered-not-ready` (`2`), `silent-lean` (`1`).

Did classification match?
- Mostly yes for the retained window; live state is conservative.

If no:
- The late `repair-heavy-connected` label is too strong for the user symptom and the cumulative metrics, but it is not the reported bad direction.
- This should not drive a profile-strength increase.

## Trend Read

Side A:
- Oscillating receive damage with burst-like missing-frame jumps.
- Reasons seen:
  - recovery mode for `77/96` retained samples.
  - total missing-frame delta `628` and concealment delta `43`.
  - repeated missing bursts while jitter has frames and is often ready: examples include `+70` with `jitterBufferedFrames=22`, `+26` with `9`, `+19` with `24`, `+15` with `22`, and `+21` with `22`.
  - no decrypt, decode, send-failure, no-target, link-unready, stale-drop, or queue-pressure deltas.
  - one renderer stall was recorded on Linux, but the active pattern is repeated receive missing bursts, not a single startup stall.

Side B:
- Stable/good receive direction with conservative late recovery.
- Reasons seen:
  - total missing-frame delta `10`, concealment delta `0`.
  - mostly `clean-low-latency` retained samples.
  - no renderer stalls or long tasks.
  - no decrypt, decode, send-failure, no-target, link-unready, stale-drop, or queue-pressure deltas.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-12T11:50Z group-812 2p` | A / Linux root receiving Mac | `steady-weak-listener`; live `silent-lean`; repair/collapse churn | yes | partly | receive jitter-buffer / burst absorption | Add direct jitter push/trim diagnostics, then fix buffer trim/capacity behavior if confirmed. Do not target sender, bootstrap, or baseline. |
| `2026-05-12T11:50Z group-812 2p` | B / macOS standby receiving Linux | `clean-low-latency`; live `repair-heavy-connected` | no | mostly yes; live label conservative | no issue for reported symptom / selector secondary | No profile-strength change from this side. Track late conservative repair-heavy separately. |

## Next Fix Target

Current patched target:
- Another subsystem: receive burst absorption / jitter-buffer overflow visibility.
- Primary fix: expose jitter-buffer push outcomes in diagnostics, especially accepted, stale, duplicate, trimmed count, high-water depth, and last trim event per source.
- If trims line up with Linux missing-frame bursts, tune the jitter-buffer cap/trim policy for single-source recovery so bursty inbound delivery does not discard valid frames and then report the discard as missing audio.
- Selector is secondary because it reacts after the damage. Profile strength is not the next target. Baseline is not the next target. No new profile is justified from this call.

## Call: 2026-05-13 21:40Z / group 937 3-person latest-code multi-source check

Room:
- `gcall-qortal-937`

Files:
- Side A: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-13T21-40-11-400Z.json`
- Side B: `/home/qortal/Downloads/seth-kenny-phil-14.json`
- Side C: `/home/qortal/Downloads/qortal-gcall-diagnostics-2026-05-13T21-39-44-545Z.json`

User symptom:
- New 3+ multi-party group-call check after the recent changes. No side-specific spoken symptom was provided with the exports.
- Metric symptom: all three sides remain in multi-source protected recovery for both remote sources, with repeated missing-frame/concealment bursts while playouts are usually ready and jitter buffers are at or near trim pressure.

High-level verdict:
- Bad/mixed, but improved diagnostic clarity.
- This is not the prior hidden-startup case where a source was buffered but never became ready. In this batch every side has active playouts, active schedulers/playback nodes, and mostly ready samples for both remote sources.
- The common failure shape is jitter trim pressure in multi-source recovery: large missing-frame bursts line up with per-source jitter buffers at high water and `jitterPushTrimmedFrames` increasing.

Not the problem:
- Pending decrypt/key: `packetsDroppedPendingDecrypt=0`, pending-decrypt deltas `0`, and `pendingDecryptDepth=0` on all three exports.
- Current decode path: root has `5` historical decode failures and participant has `40`, but `totalDecodeFailureDelta=0` in all retained windows, so decode/key mismatch is not the active sampled failure.
- Sender/no-target: all retained windows have `totalNoTargetSkipsDelta=0`, outbound sends succeed, and link transport is active.
- Queue/backpressure: no queue-pressure drops, stale drops, link-unready drops, packet send failures, or bridge drain waits. Decoded queue high-water exists, but no transport-queue drops explain the bursts.
- Startup readiness: all six remote playouts are ready in most retained samples and ready at export time; this is not a source-activation/not-ready regression.
- Baseline: every leg is already above baseline in `multi-protected-recovery`, so a global baseline bump is not the first lever.

Primary next target:
- Another subsystem: multi-source jitter-buffer push/trim behavior under recovery.
- The next patch should tune or fix per-source jitter cap/headroom/trim policy and sequence-gap accounting in multi-source recovery. The new trim diagnostics confirm the earlier suspected overflow/trim path: large missing-frame deltas appear when jitter buffers are at `40/40` or have just trimmed.
- Selector is not the next target because all six legs are classified as `multi-protected-recovery`. Profile strength is secondary because stronger targets do not help if valid frames are being trimmed at the jitter cap. Baseline is not the next target.

| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | root-forwarder / Linux / `QeJW96...j5W9` receiving participant `QP9Jj4...i6rP` | `multi-protected-recovery` | unknown; metrics bad | 55.843 | 801 | 205 | 0.014 | 0.006 | low-latency | Ready in `291/300` samples. `+147`, `+97`, and `+226` missing bursts occur with ready jitter buffers and trim pressure; current playout has `925` trimmed frames. |
| A | root-forwarder / Linux / `QeJW96...j5W9` receiving standby `QTSzRS...9jMn` | `multi-protected-recovery` | unknown; metrics bad | 55.843 | 801 | 205 | 0.014 | 0.006 | low-latency | Ready in `292/300` samples. Large bursts at `21:32:09` and `21:38:39` line up with this leg trimming from high-water. |
| B | standby-forwarder / Linux / `QTSzRS...9jMn` receiving root `QeJW96...j5W9` | `multi-protected-recovery` | unknown; metrics bad | 94.173 | 1333 | 209 | 0.018 | 0.012 | low-latency | Ready in `294/300` samples. One burst briefly shows `jitterHasReadyFrame=false`, but most retained samples are ready; current trim total is `287`. |
| B | standby-forwarder / Linux / `QTSzRS...9jMn` receiving participant `QP9Jj4...i6rP` | `multi-protected-recovery` | unknown; metrics bad | 94.173 | 1333 | 209 | 0.018 | 0.012 | low-latency | Ready in `287/300` samples. Heavy trim pressure: current trim total is `1030`, with `+165`, `+218`, `+107`, and `+393` missing bursts. |
| C | participant / Linux / `QP9Jj4...i6rP` receiving root `QeJW96...j5W9` | `multi-protected-recovery` | unknown; metrics bad | 12.200 | 2013 | 318 | 0.003 | 0.002 | low-latency | Ready in `291/300` samples. Very shallow side-wide reserve, but bursts happen while this source is ready and near cap; current trim total is `812`. |
| C | participant / Linux / `QP9Jj4...i6rP` receiving standby `QTSzRS...9jMn` | `multi-protected-recovery` | unknown; metrics bad | 12.200 | 2013 | 318 | 0.003 | 0.002 | low-latency | Ready in `283/300` samples. Strongest trim pressure in this export: current trim total is `1226`, including `+366`, `+488`, `+22`, and `+289` missing bursts. |

### Side A

Expected profile from symptom:
- With no side-specific user symptom, the metric symptom expects a multi-source recovery profile rather than clean-low-latency.

Actual exported profile:
- Participant `QP9Jj4...i6rP`: `multi-protected-recovery` for `300/300` retained samples.
- Standby `QTSzRS...9jMn`: `multi-protected-recovery` for `300/300` retained samples.

Did classification match?
- Yes for the metric symptom.

Notes:
- The selector is not missing the bad state. The root side is already protected for both sources.
- The failure is downstream of classification: missing bursts occur while playouts are ready and the jitter buffers are at/near trim pressure.

### Side B

Expected profile from symptom:
- Multi-source protected recovery is expected from the retained-window metric damage.

Actual exported profile:
- Root `QeJW96...j5W9`: `multi-protected-recovery` for `300/300` retained samples.
- Participant `QP9Jj4...i6rP`: `multi-protected-recovery` for `300/300` retained samples.

Did classification match?
- Yes for the metric symptom.

Notes:
- This side has high reserve on paper (`avgPcmBufferedMs=94.173`) but still has `905` missing-frame delta and `148` concealment delta in the retained window.
- That combination argues against simply raising profile strength; the buffer is not globally empty, yet per-source trims and sequence gaps still create missing audio.

### Side C

Expected profile from symptom:
- Multi-source protected recovery is expected: this is the most damaged side by totals and has shallow side-wide reserve.

Actual exported profile:
- Root `QeJW96...j5W9`: `multi-protected-recovery` for `300/300` retained samples.
- Standby `QTSzRS...9jMn`: `multi-protected-recovery` for `300/300` retained samples.

Did classification match?
- Yes for the metric symptom.

Notes:
- Participant-side metrics are worst overall: `1184` missing-frame delta, `193` concealment delta, `avgPcmBufferedMs=12.2`.
- Even here, the burst evidence points at jitter trimming: both remote playouts are ready in most samples, and large bursts occur with `jitterBufferedFrames` around `39-40` plus trim pressure.

## Trend Read

Side A:
- Oscillating/discrete trim-pressure bursts.
- Reasons seen:
  - retained-window damage: `500` missing-frame delta and `130` concealment delta.
  - large bursts: `+147`, `+97`, `+226`, and `+20`.
  - all retained profile samples are `multi-protected-recovery`.
  - both playouts are mostly ready and current jitter cap/high-water is `40`.

Side B:
- Oscillating/discrete trim-pressure bursts.
- Reasons seen:
  - retained-window damage: `905` missing-frame delta and `148` concealment delta.
  - large bursts: `+165`, `+218`, `+107`, and `+393`.
  - participant leg is heavily trimmed (`1030` current trimmed frames), and root leg also reaches trim-pressure headroom by export time.

Side C:
- Worst burst damage, shallow reserve, but still not a startup-not-ready shape.
- Reasons seen:
  - retained-window damage: `1184` missing-frame delta and `193` concealment delta.
  - large bursts: `+366`, `+488`, `+22`, and `+289`.
  - both source buffers hit high-water `40`; trim totals are `812` and `1226`.

## Batch Scoreboard Update

| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `2026-05-13T21:40Z group-937 3p` | A / Linux root receiving participant | `multi-protected-recovery` | unknown; metrics bad | yes | jitter push/trim subsystem | Tune multi-source jitter cap/headroom/trim behavior; selector/profile strength are not first. |
| `2026-05-13T21:40Z group-937 3p` | A / Linux root receiving standby | `multi-protected-recovery` | unknown; metrics bad | yes | jitter push/trim subsystem | Same multi-source trim target; watch source-specific trim events around missing bursts. |
| `2026-05-13T21:40Z group-937 3p` | B / Linux standby receiving root | `multi-protected-recovery` | unknown; metrics bad | yes | jitter push/trim subsystem | Fix burst handling; one not-ready sample is secondary, not the dominant failure. |
| `2026-05-13T21:40Z group-937 3p` | B / Linux standby receiving participant | `multi-protected-recovery` | unknown; metrics bad | yes | jitter push/trim subsystem | Highest trim pressure on this side; prioritize per-source trim/cap behavior. |
| `2026-05-13T21:40Z group-937 3p` | C / Linux participant receiving root | `multi-protected-recovery` | unknown; metrics bad | yes | jitter push/trim subsystem | Fix trim-induced sequence gaps before changing profile targets. |
| `2026-05-13T21:40Z group-937 3p` | C / Linux participant receiving standby | `multi-protected-recovery` | unknown; metrics bad | yes | jitter push/trim subsystem | Strongest evidence: large bursts with `40/40` buffers and `1226` current trimmed frames. |

## Next Fix Target

Current patched target:
- Another subsystem: multi-source jitter-buffer push/trim behavior under recovery.
- Primary fix: tune per-source jitter cap/headroom/trim policy so recovery-mode burst absorption does not trim valid near-future frames and then surface the gap as missing audio.
- Secondary fix: check missing-frame accounting against trim events so intentionally trimmed-old frames are not misclassified as unexpected sequence gaps.
- Selector is not the next target. Profile strength is not the next target until trim behavior is corrected. Baseline is not the next target. No new profile is justified from this batch.
