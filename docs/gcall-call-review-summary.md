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
