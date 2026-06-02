# Cursor Prompt Context

Use this bundle to debug scenario `good-vs-stale-timestamp`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Peer B emits stale/regressing sender timestamps, but the paired call should still recover to healthy.
- Mode: `deterministic`
- Seed: `909`
- Fixture: `n/a`

## Paired Result
- Call summary: [Acceptable 7.9/10] BOTH PEERS PASS — peer-A (root-forwarder): policy-dominated, severity=healthy; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `policy-dominated`
- First degraded peer/stage: `peer-A` / `jitter`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `staleTimestampSender` (Sender timestamps lag behind receive time and periodically regress, reproducing sourceTimestampLateness drops.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=104ms, avgOpus=313ms, underTarget=0.16, tickBreachP95=0.00ms, staleTsDrops=158
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `cleanSender` (Low jitter, no intentional loss, stable cadence.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=118ms, avgOpus=314ms, underTarget=0.02, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=20.00ms, stage=`jitter`

## Suggested Next Step
- Inspect target buffer policy, backlogDrain transitions, and playout stabilization.
