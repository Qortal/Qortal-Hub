# Cursor Prompt Context

Use this bundle to debug scenario `good-vs-stalled`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Peer B intermittently stalls, but the paired call should still remain healthy.
- Mode: `deterministic`
- Seed: `505`
- Fixture: `n/a`

## Paired Result
- Call summary: [Good 9.7/10] BOTH PEERS PASS — peer-A (root-forwarder): transport-dominated, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `transport-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `jitter`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `stalledSender` (Intermittent sender stalls causing burst loss and transport disruption.)
- Primary class: `transport-dominated`
- Key metrics: avgPcm=118ms, avgOpus=312ms, underTarget=0.02, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `cleanSender` (Low jitter, no intentional loss, stable cadence.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=119ms, avgOpus=314ms, underTarget=0.01, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect bridge pressure, packet delivery delay, and transport recovery behavior.
