# Group Call E2E Summary

Scenario: `phil-kenny-one-on-one-77`
Mode: `live-export`
Quality: `7.13/10`
Paired status: `needs-work`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `unknown`

## Likely Fix Surfaces
- `stall-dominated`: Inspect tick budget breaches, long tasks, and main-thread scheduling stalls.
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `live-export`: stall-dominated, severity=healthy, underTarget=0.22, avgPcmMs=133
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Tick budget: 17 breaches, P95=24.8ms
  Stage5 boost: 12.1s
- `peer-B` (standby-forwarder) via `live-export`: policy-dominated, severity=healthy, underTarget=0.03, avgPcmMs=146
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Stale timestamp drops: 220 (4.20/s); inspect sourceTimestampLateness gating before playout policy tuning
