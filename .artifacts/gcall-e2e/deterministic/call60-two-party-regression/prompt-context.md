# Cursor Prompt Context

Use this bundle to debug scenario `call60-two-party-regression`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Recreates the call-60 rebuild oscillation, but the paired call should still recover to healthy.
- Mode: `deterministic`
- Seed: `808`
- Fixture: `call-60-rebuild-oscillation`

## Paired Result
- Call summary: [Good 9.2/10] BOTH PEERS PASS — peer-A (root-forwarder): mixed, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `mixed`, `transport-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `playout`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `call60FixtureSender` (Bursty transport-flap arrival shape from call-60 rebuild oscillation.)
- Primary class: `mixed`
- Key metrics: avgPcm=119ms, avgOpus=318ms, underTarget=0.01, tickBreachP95=26.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`playout`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `cleanSender` (Low jitter, no intentional loss, stable cadence.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=120ms, avgOpus=318ms, underTarget=0.00, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect the worst peer first, then split follow-up work by the paired secondary class.
