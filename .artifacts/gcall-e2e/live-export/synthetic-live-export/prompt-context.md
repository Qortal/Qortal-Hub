# Cursor Prompt Context

Use this bundle to debug scenario `synthetic-live-export`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.

## Scenario
- Description: Synthetic paired export used to validate live export workflow.
- Mode: `live-export`
- Seed: `n/a`
- Fixture: `n/a`

## Paired Result
- Call summary: [Poor 3.6/10] ONE OR BOTH PEERS FAIL — peer-A (root-forwarder): policy-dominated, severity=moderate; peer-B (standby-forwarder): policy-dominated, severity=healthy
- Likely fix surfaces: `policy-dominated`
- First degraded peer/stage: `peer-A` / `unknown`

## Peer A
- Addr/role: `peer-A` / `root-forwarder`
- Sender profile: `live-export` (Imported from a live paired diagnostics export.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=42.00ms, avgOpus=88.00ms, underTarget=0.63, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=0.00ms, stage=`pcm-ring`

## Peer B
- Addr/role: `peer-B` / `standby-forwarder`
- Sender profile: `live-export` (Imported from a live paired diagnostics export.)
- Primary class: `policy-dominated`
- Key metrics: avgPcm=96.00ms, avgOpus=88.00ms, underTarget=0.12, tickBreachP95=0.00ms, staleTsDrops=0
- Timeline: firstIssue=0.00ms, stage=`unknown`

## Suggested Next Step
- Inspect target buffer policy, backlogDrain transitions, and playout stabilization.
