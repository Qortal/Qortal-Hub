# GCall Call Review Template

Use this file as the repeatable checklist and logging format for new group-call diagnostics exports.

Related docs:
- [docs/gcall-receive-profiles.md](/home/qortal/Desktop/desktop-app-official/qortal-desktop/docs/gcall-receive-profiles.md)
- [docs/group-call-audio-roadmap.md](/home/qortal/Desktop/desktop-app-official/qortal-desktop/docs/group-call-audio-roadmap.md)

Primary runtime fields:
- `audioSurfaceRuntimeDiagnostics.receiveEngine.livePolicyProfilesBySource`
- `audioSurfaceRuntimeDiagnostics.receiveEngine.livePolicyStateBySource`
- `audioSurfaceRuntimeDiagnostics.receiveEngine.profileTransitions`
- `recentWindowTrends`
- `recentWindowSummary`
- `liveMetricsSnapshot`
- `audioSurfaceRuntimeDiagnostics.receiveEngine.playouts`

## Purpose

Use this template to answer the same questions for every new call:
- What profile was each side in?
- Did that profile match the actual user symptom?
- Was the call bad because of:
  - state/key/authority correctness
  - startup playout readiness
  - or receive-policy quality
- What single profile or subsystem should be tuned next?

This is meant to stop ad hoc analysis and make profile tuning cumulative.

## Review Workflow

For each new call:
1. Confirm both exports belong to the same room.
2. Record user-reported symptom first.
3. Record what each side’s dominant profile was.
4. Check whether classification matched the symptom.
5. Decide whether the next fix belongs to:
   - a specific receive profile
   - startup playout path
   - failover/key/state correctness
   - or baseline policy
6. Only propose a new profile if the call does not fit existing ones cleanly.

## Quick Triage

Use this before deeper tuning:

- `packetsDroppedPendingDecrypt > 0`
  - likely decrypt/key path issue
- `packetsDroppedDecodeFailure > 0`
  - likely decode/key/session mismatch
- `transportTriadSnapshot.*HighWater > 0`
  - possible queue/backpressure issue
- `jitterBufferedFrames > 0` and `jitterHasReadyFrame: false` with no real playout
  - likely startup/playout-ready issue
- no correctness/path errors, but bad profile activation
  - likely receive-policy tuning issue

## Per-Call Summary Template

Copy this section for each new call:

```md
## Call: <date / short label>

Room:
- `<room id>`

Files:
- Side A: `<path>`
- Side B: `<path>`

User symptom:
- `<plain description>`

High-level verdict:
- `<good / mixed / bad / catastrophic>`
- `<one sentence summary>`

Not the problem:
- `<decrypt / decode / queue / failover / startup / etc.>`

Primary next target:
- `<profile or subsystem>`
```

## Side-By-Side Table Template

```md
| Side | Role | Dominant Profile | User-Bad? | avgPcmBufferedMs | missingFrames | concealmentTicks | UnderTarget | Rate<0.97 | Adaptive Mode | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | `<root/standby/participant>` | `<profile>` | `<yes/no>` | `<n>` | `<n>` | `<n>` | `<n>` | `<n>` | `<mode>` | `<short note>` |
| B | `<root/standby/participant>` | `<profile>` | `<yes/no>` | `<n>` | `<n>` | `<n>` | `<n>` | `<n>` | `<mode>` | `<short note>` |
```

## Classification Check

For each side:

```md
### Side A

Expected profile from symptom:
- `<profile>`

Actual exported profile:
- `<profile>`

Did classification match?
- `<yes/no/partly>`

If no:
- `<what looked wrong>`
- `<whether to retune selector or create a new profile>`
```

## Trend Check

Use `recentWindowTrends` to decide whether the call was:
- flat-bad the whole sampled window
- gradually degrading
- hit by a discrete event
- oscillating between modes

Prefer the windowed delta fields when judging whether the call is still bad now:
- `missingFramesDelta`
- `concealmentTicksDelta`
- `packetsDroppedPendingDecryptDelta`
- `packetsDroppedDecodeFailureDelta`
- `outboundNoTargetSkipsDelta`

Use `recentWindowSummary` for a quick whole-export-window read, then inspect the raw
trend rows when a side improved or degraded during the call.

Use `profileTransitions` and `livePolicyStateBySource` to answer:
- when a profile changed
- what metrics caused the transition
- whether a profile is stuck because hold timers or clear conditions remain active
- what target/floor/extra-hold values were actually applied

Template:

```md
## Trend Read

Side A:
- `<flat-bad / gradual / discrete / oscillating>`
- Reasons seen:
  - `<entered-recovery>`
  - `<concealment-spike>`
  - `<missing-frames-spike>`
  - `<none>`

Side B:
- `<flat-bad / gradual / discrete / oscillating>`
- Reasons seen:
  - `<...>`
```

## Decision Rules

Use these rules to pick the next change:

- If classification was correct and the profile stayed active too long:
  - tune that profile’s hold and clear conditions first
- If classification was correct but the immediate quality was still bad:
  - tune that profile’s target boost and floor
- If classification was wrong:
  - tune selector entry logic before touching target sizes
- If multiple unrelated profiles failed in the same batch of calls:
  - inspect baseline policy and recovery hysteresis
- If state/key/failover/startup is implicated:
  - do not tune receive profiles first

## New Profile Gate

Only add a new profile if all are true:
- the failure shape recurs
- it does not fit an existing profile cleanly
- forcing it into an existing profile would likely worsen other calls
- the symptom can be described as a stable class, not a one-off export quirk

Record the proposal like this:

```md
## New Profile Proposal

Name:
- `<candidate profile name>`

Why existing profiles were insufficient:
- `<reason>`

Recurring evidence:
- `<call ids or export labels>`

Distinct signals:
- `<metrics / trends / user symptom>`

Risk if folded into an existing profile:
- `<what would likely regress>`
```

## Batch Scoreboard Template

Use this when reviewing multiple calls on one build:

```md
| Call | Side | Dominant Profile | User-Bad? | Classification Correct? | Main Issue Class | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| `<call id>` | A | `<profile>` | `<yes/no>` | `<yes/no/partly>` | `<receive/startup/key/etc.>` | `<tune X / no change>` |
| `<call id>` | B | `<profile>` | `<yes/no>` | `<yes/no/partly>` | `<receive/startup/key/etc.>` | `<tune X / no change>` |
```

## Success Criteria

Treat a build as materially improved when a batch of ordinary calls shows:
- most sides spend most time in `clean-low-latency`
- bad profiles are brief, not dominant for the whole call
- `recentWindowTrends` are mostly quiet
- `missingFrames` and `concealmentTicks` are modest
- no repeated startup/failover/key regressions
- user reports align with the profile diagnostics

## Notes

- Prefer profile-specific changes over global baseline changes.
- Prefer changing one profile at a time unless several failure classes regress together.
- Keep short labels for calls consistent so future comparisons are easy.
