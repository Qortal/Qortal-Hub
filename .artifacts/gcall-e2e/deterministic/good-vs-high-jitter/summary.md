# Group Call E2E Summary

Scenario: `good-vs-high-jitter`
Mode: `deterministic`
Quality: `9.67/10`
Paired status: `both-pass`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `jitter`

## Likely Fix Surfaces
- `transport-dominated`: Inspect bridge pressure, packet delivery delay, and transport recovery behavior.
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `highJitterSender`: transport-dominated, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Transport triad: bridgeHW=20, binaryHW=14
- `peer-B` (standby-forwarder) via `cleanSender`: policy-dominated, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
