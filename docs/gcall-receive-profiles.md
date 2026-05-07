# GCall Receive Profiles

This document is the working reference for the live receive-policy profiles used by the group-call audio engine.

Primary code:
- [src/lib/group-call/groupCallAudioReceiveEngine.ts](/home/qortal/Desktop/desktop-app-official/qortal-desktop/src/lib/group-call/groupCallAudioReceiveEngine.ts)
- [src/lib/group-call/groupCallAudioReceiveEngine.test.ts](/home/qortal/Desktop/desktop-app-official/qortal-desktop/src/lib/group-call/groupCallAudioReceiveEngine.test.ts)

Primary runtime diagnostics:
- `audioSurfaceRuntimeDiagnostics.receiveEngine.livePolicyProfilesBySource`
- `recentWindowTrends`
- `events[].tag == "call-quality-worsened"`

This file is meant to answer:
- What profile did a bad call fall into?
- Why did that profile activate?
- What should we tune next if that profile still sounds bad?

## How To Use This Doc

For a new export:
- Check `livePolicyProfilesBySource` for each source.
- Check `exportWindowMetrics` and `recentWindowTrends` for the matching side.
- Match the observed metrics to the profile description below.
- Tune that profile first before touching unrelated ones.

Do not create a new profile unless:
- the failure shape is recurring,
- it is materially different from the existing profiles,
- and forcing it into an existing profile would likely harm other call shapes.

## Shared Signals

The receive engine derives profile selection from live playout metrics such as:
- `avgPcmBufferedMs`
- `jitterBufferDepthFramesMean`
- `jitterNotReadyFraction`
- `avgPlayoutDeltaMs`
- `playoutUnderTargetFraction`
- `playoutRateFractionBelow097`
- `missingFrames`
- `concealmentTicks`
- `avgReticulumAudioBridgeToRendererIngressMs`
- `oldestFrameAgeMs`

Internal smoothed state includes:
- buffered reserve EMA
- playout delta EMA
- under-target EMA
- concealment EMA
- playout-rate EMA
- oldest-frame-age EMA
- pre-process buffered frames
- hold timers for stronger protection modes

## Profiles

### `clean-low-latency`

What it means:
- Listener looks healthy enough to stay in the normal low-latency path.

Typical signals:
- decent reserve
- no meaningful under-target pressure
- no meaningful concealment pressure
- no strong rate-chasing
- no lean/prebuffer warning state

User symptom:
- clear call
- no obvious breakup
- no obvious lag

If this profile sounds bad anyway:
- first suspect a metrics blind spot
- or a startup/playout-ready issue
- or a transport/key/state issue outside receive policy

What to tune:
- usually do not tune this profile first
- only revisit if many healthy-looking calls still sound bad

### `steady-weak-listener`

What it means:
- Listener is weak enough to need help, but not in a severe collapse shape.

Typical signals:
- modest under-target pressure
- modest rate-chasing
- some weak-listener pressure
- not enough damage to justify a heavier profile

User symptom:
- understandable but not clean
- occasional breakup
- sometimes “thin” sounding audio

What to tune:
- light target boost
- light floor behavior
- post-recovery hysteresis
- entry conditions if too many healthy listeners get classified here

When this profile is suspicious:
- if reserve is clearly healthy and the call sounds fine
- if a listener keeps being labeled weak when the path looks clean

### `repair-heavy-connected`

What it means:
- Listener is still connected and buffered, but too much audio is being repaired.

Typical signals:
- meaningful `missingFrames`
- meaningful `concealmentTicks`
- meaningful under-target fraction
- slower playout rate
- reserve may still look “okay” on paper

User symptom:
- breakup
- static
- patched / synthetic sounding audio
- understandable but poor clarity

What to tune:
- stronger hold duration
- stricter clear conditions
- profile-specific floor / target boost
- recovery-mode hold while under-target and slow-rate pressure are still active
- avoid relaxing back to low-latency too early

When this profile is suspicious:
- if a side clearly sounds like collapse rather than repair-heavy survival
- if reserve is very low and concealment is still exploding

Current tuning note:
- This profile now uses stronger profile-specific target/floor behavior than `steady-weak-listener`, a longer hold window, and a slightly larger accumulation hold cap.
- It should keep recovery-mode protection while the listener is still repair-heavy and rate-chasing, but it can stop forcing recovery once the current pressure has eased even if the profile hold is still carrying extra headroom.

### `repair-collapse`

What it means:
- Listener is both repair-heavy and very shallow on reserve.

Typical signals:
- high concealment
- shallow reserve
- strongly negative playout delta
- real “listener is failing hard” pattern

User symptom:
- very broken audio
- frequent collapse / heavy patching
- hard to follow speech

What to tune:
- stronger target boost
- stronger floor
- collapse-specific hold
- stricter exit than `repair-heavy-connected`

Use this instead of a new profile if:
- the call is clearly repair-heavy and shallow-buffered
- but still does not fit the simpler repair-heavy-connected path

### `persistent-lean`

What it means:
- Listener is not dramatically collapsing, but lives too close to empty for too long.

Typical signals:
- low reserve for many windows
- low prebuffer
- low jitter depth
- more lean than healthy, but not necessarily high concealment yet

User symptom:
- not clear
- weak audibility
- ongoing roughness rather than one sharp failure

What to tune:
- stronger steady target
- stronger floor
- longer hold
- stricter exit only after reserve really rebuilds

When this profile is suspicious:
- if the listener still sounds fine even with low reserve
- if the real issue is actually startup or hidden playout readiness

### `silent-lean`

What it means:
- Listener is living dangerously close to empty, but the usual damage counters may still look deceptively mild.

Typical signals:
- tiny reserve
- tiny prebuffer
- strongly negative delta
- low concealment
- low or zero obvious damage counters
- may still have `jitterHasReadyFrame: false` at times

User symptom:
- “I can’t hear them well”
- audio is weak or not clear
- metrics may look cleaner than the user experience suggests

Why it exists:
- this profile covers the blind spot where a side sounds bad before the usual damage counters fully explode

What to tune:
- stronger floor
- stronger target boost
- longer hold
- stricter exit conditions

When this profile is suspicious:
- if the listener is actually repair-heavy and should have been in a heavier damage profile
- if startup readiness never truly begins, which is a separate hidden-playout problem

### `post-failover-stabilization`

What it means:
- Listener is the newly promoted root after failover and should temporarily receive extra protection.

Typical signals:
- recent root promotion after heartbeat timeout
- call otherwise converged structurally
- receive path still vulnerable right after promotion

User symptom:
- failover succeeded, but the new root sounds weak or fragile immediately after

What to tune:
- temporary target boost
- temporary floor
- hold duration after promotion

Do not use this for:
- ordinary calls with no failover
- generic weak-listener behavior

### `collapse-recovery`

What it means:
- Listener is in the strongest collapse-style recovery path.

Typical signals:
- very low reserve
- very negative delta
- real under-target / concealment pressure
- often elevated ingress age or empty prebuffer

User symptom:
- very bad call quality
- obvious collapse
- severe breakup
- speech hard to follow

What to tune:
- collapse target boost
- collapse floor
- latch duration
- stricter clear conditions after the collapse

When this profile is suspicious:
- if it keeps activating on merely moderate calls
- if healthy or repair-heavy-but-buffered calls are being flattened into this stronger mode

## Interpreting Real Exports

### If the profile seems correct, but the call still sounds bad

That usually means:
- the profile exists for the right reason
- but its target/floor/hold behavior is still too weak

Tune:
- target boost
- floor
- hold duration
- clear conditions

### If the profile seems wrong for the call shape

That usually means:
- entry signals are too eager
- or a neighboring profile is winning too early

Tune:
- entry conditions
- priority order
- gating conditions for overlapping profiles

### If the call sounds bad but the profile is `clean-low-latency`

That usually means one of:
- a metrics blind spot
- startup/pllayout readiness issue
- key/state issue outside receive policy
- a genuinely new failure class

Do not immediately add a new profile. First verify:
- receive metrics
- runtime diagnostics
- startup readiness state
- topology/key events

## Current Mapping Heuristics

As of now, the rough intent is:
- `clean-low-latency`: healthy listener
- `steady-weak-listener`: modest weak path
- `repair-heavy-connected`: buffered but breaking
- `repair-collapse`: buffered and heavily damaged
- `persistent-lean`: steady near-empty listener
- `silent-lean`: near-empty but deceptively “clean” counters
- `post-failover-stabilization`: promoted-root protection window
- `collapse-recovery`: strongest collapse mode

If a call repeatedly lands in one of these and still sounds bad, tune that profile first.

## Suggested Workflow For Future Call Logs

1. Confirm the two exports are from the same room/call.
2. Check each side’s `livePolicyProfilesBySource`.
3. Compare that profile to:
   - reserve
   - under-target
   - rate
   - concealment
   - missing frames
   - readiness state
4. Decide:
   - correct profile, weak tuning
   - wrong profile, bad entry logic
   - not a receive-policy problem
5. Only then patch code.

## Updating This File

Whenever a profile changes materially:
- update its “Typical signals”
- update its “User symptom”
- update its “What to tune”

Whenever a genuinely new recurring failure class appears:
- add it here only after confirming it is not just a mis-tuned existing profile.
