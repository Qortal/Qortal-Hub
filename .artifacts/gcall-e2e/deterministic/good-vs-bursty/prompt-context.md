# Cursor Prompt Context

Use this bundle to debug scenario `good-vs-bursty`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Peer B sends bursty audio with bridge pressure, but the paired call should still remain healthy.
- Mode: `deterministic`
- Seed: `303`
- Fixture: `n/a`

## Paired Result
- Call summary: [Good 9.6/10] BOTH PEERS PASS — peer-A (root-forwarder): transport-dominated, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `transport-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `jitter`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `burstySender` (Packets arrive in clusters with elevated bridge pressure bursts.)
- Primary class: `transport-dominated`
- Key metrics: avgPcm=117ms, avgOpus=311ms, underTarget=0.03, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `cleanSender` (Low jitter, no intentional loss, stable cadence.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=118ms, avgOpus=313ms, underTarget=0.02, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect bridge pressure, packet delivery delay, and transport recovery behavior.
