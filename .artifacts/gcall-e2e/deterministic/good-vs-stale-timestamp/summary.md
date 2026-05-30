# Group Call E2E Summary

Scenario: `good-vs-stale-timestamp`
Mode: `deterministic`
Quality: `7.87/10`
Paired status: `both-pass`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `jitter`

## Likely Fix Surfaces
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `staleTimestampSender`: policy-dominated, severity=healthy, underTarget=0.16, avgPcmMs=104, staleTsDrops=158 (6.59/s)
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Hidden decoded reserve: ring=258.0ms, target=120.0ms
  Stale timestamp drops: 158 (6.59/s); inspect sourceTimestampLateness gating before playout policy tuning
- `peer-B` (standby-forwarder) via `cleanSender`: policy-dominated, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
