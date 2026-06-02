# Cursor Prompt Context

Use this bundle to debug scenario `phil-kenny-one-on-one-77`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Captured paired export from the post-fix phil-kenny one-on-one call: the root-forwarder still shows residual stall/playout instability while the standby-forwarder is mostly healthy aside from timestamp dropping.
- Mode: `live-export`
- Seed: `n/a`
- Fixture: `n/a`

## Paired Result
- Call summary: [Acceptable 7.1/10] ONE OR BOTH PEERS FAIL — peer-A (root-forwarder): stall-dominated, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `stall-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `unknown`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `live-export` (Imported from a live paired diagnostics export.)
- Primary class: `stall-dominated`
- Key metrics: avgPcm=133ms, avgOpus=107ms, underTarget=0.22, tickBreachP95=24.80ms, staleTsDrops=0
- Timeline: firstIssue=0.00ms, stage=`playout`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `live-export` (Imported from a live paired diagnostics export.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=146ms, avgOpus=103ms, underTarget=0.03, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=0.00ms, stage=`unknown`

## Suggested Next Step
- Inspect tick budget breaches, long tasks, and main-thread scheduling stalls.
