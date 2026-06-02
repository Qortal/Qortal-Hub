# Cursor Prompt Context

Use this bundle to debug scenario `phil-kenny-one-on-one-76`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Captured paired export from the real phil-kenny one-on-one call that exposed mixed transport/stall pressure on one peer and severe stale-timestamp dropping on the other.
- Mode: `live-export`
- Seed: `n/a`
- Fixture: `n/a`

## Paired Result
- Call summary: [Poor 3.1/10] ONE OR BOTH PEERS FAIL — peer-A (root-forwarder): mixed, severity=moderate; peer-B (standby-forwarder): policy-dominated, severity=mild
- Likely fix surfaces: `mixed`, `transport-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `unknown`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `live-export` (Imported from a live paired diagnostics export.)
- Primary class: `mixed`
- Key metrics: avgPcm=90.85ms, avgOpus=0.00ms, underTarget=0.48, tickBreachP95=39.70ms, staleTsDrops=0
- Timeline: firstIssue=0.00ms, stage=`playout`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `live-export` (Imported from a live paired diagnostics export.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=111ms, avgOpus=214ms, underTarget=0.54, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=0.00ms, stage=`pcm-ring`

## Suggested Next Step
- Inspect the worst peer first, then split follow-up work by the paired secondary class.
