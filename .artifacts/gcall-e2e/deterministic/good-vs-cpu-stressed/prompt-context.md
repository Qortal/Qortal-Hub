# Cursor Prompt Context

Use this bundle to debug scenario `good-vs-cpu-stressed`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Peer B is CPU stressed, but the paired call should still remain healthy.
- Mode: `deterministic`
- Seed: `606`
- Fixture: `n/a`

## Paired Result
- Call summary: [Good 8.3/10] BOTH PEERS PASS — peer-A (root-forwarder): stall-dominated, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `stall-dominated`, `policy-dominated`
- First degraded peer/stage: `peer-A` / `playout`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `cpuStressedSender` (Sender-side runtime pressure with repeated tick-budget-like stalls and bursty delivery.)
- Primary class: `stall-dominated`
- Key metrics: avgPcm=116ms, avgOpus=304ms, underTarget=0.04, tickBreachP95=36.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`playout`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `cleanSender` (Low jitter, no intentional loss, stable cadence.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=118ms, avgOpus=314ms, underTarget=0.02, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect tick budget breaches, long tasks, and main-thread scheduling stalls.
