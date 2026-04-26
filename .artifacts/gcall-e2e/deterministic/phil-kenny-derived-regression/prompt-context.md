# Cursor Prompt Context

Use this bundle to debug scenario `phil-kenny-derived-regression`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Offline deterministic regression derived from the real phil-kenny pair: one side sees mixed transport/stall pressure while the other sees severe stale timestamp dropping.
- Mode: `deterministic`
- Seed: `1001`
- Fixture: `n/a`

## Paired Result
- Call summary: [Good 8.9/10] BOTH PEERS PASS — peer-A (root-forwarder): mixed, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `mixed`, `transport-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `jitter`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `philKennyTransportSender` (Derived from the real phil-kenny capture: bridge pressure, latency spikes, and tick stalls on the worse peer path.)
- Primary class: `mixed`
- Key metrics: avgPcm=118ms, avgOpus=312ms, underTarget=0.02, tickBreachP95=40.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `philKennyStaleSender` (Derived from the real phil-kenny capture: sender timestamps drift stale/regressing while the opposite side remains under playout pressure.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=104ms, avgOpus=315ms, underTarget=0.16, tickBreachP95=0.00ms, staleTsDrops=202
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect the worst peer first, then split follow-up work by the paired secondary class.
