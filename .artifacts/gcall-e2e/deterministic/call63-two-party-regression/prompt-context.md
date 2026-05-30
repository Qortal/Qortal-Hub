# Cursor Prompt Context

Use this bundle to debug scenario `call63-two-party-regression`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Recreates the call-63 asymmetric failure shape, but the paired call should still recover to healthy.
- Mode: `deterministic`
- Seed: `707`
- Fixture: `call-63-one-remote-playout-trap`

## Paired Result
- Call summary: [Good 9.2/10] BOTH PEERS PASS — peer-A (root-forwarder): mixed, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `mixed`, `transport-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `jitter`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `call63FixtureSender` (Recovery-path latch plus bridge pressure and sustained degraded arrival shape from call-63.)
- Primary class: `mixed`
- Key metrics: avgPcm=119ms, avgOpus=315ms, underTarget=0.01, tickBreachP95=18.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `cleanSender` (Low jitter, no intentional loss, stable cadence.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=119ms, avgOpus=318ms, underTarget=0.01, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect the worst peer first, then split follow-up work by the paired secondary class.
