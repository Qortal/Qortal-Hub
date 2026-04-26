# Group Call E2E Summary

Scenario: `good-vs-cpu-stressed`
Mode: `deterministic`
Quality: `8.34/10`
Paired status: `both-pass`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `playout`

## Likely Fix Surfaces
- `stall-dominated`: Inspect tick budget breaches, long tasks, and main-thread scheduling stalls.
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `cpuStressedSender`: stall-dominated, severity=healthy, underTarget=0.04, avgPcmMs=116
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Hidden decoded reserve: ring=277.0ms, target=120.0ms
  Tick budget: 269 breaches, P95=36.0ms
- `peer-B` (standby-forwarder) via `cleanSender`: policy-dominated, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
