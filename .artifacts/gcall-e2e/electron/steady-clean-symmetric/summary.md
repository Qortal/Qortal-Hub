# Group Call E2E Summary

Scenario: `steady-clean-symmetric`
Mode: `electron`
Quality: `9.93/10`
Paired status: `both-pass`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `jitter`

## Likely Fix Surfaces
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `cleanSender`: policy-dominated, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
- `peer-B` (standby-forwarder) via `cleanSender`: policy-dominated, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
