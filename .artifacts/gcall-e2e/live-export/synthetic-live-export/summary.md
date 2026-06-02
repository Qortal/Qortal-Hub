# Group Call E2E Summary

Scenario: `synthetic-live-export`
Mode: `live-export`
Quality: `3.58/10`
Paired status: `needs-work`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `unknown`

## Likely Fix Surfaces
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `live-export`: policy-dominated, severity=moderate, underTarget=0.63, avgPcmMs=42.00
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Stale timestamp drops: 120 (5.00/s); inspect sourceTimestampLateness gating before playout policy tuning
  Policy: avgPcm=42.0ms, underTarget=63%, mode=recovery
- `peer-B` (standby-forwarder) via `live-export`: policy-dominated, severity=healthy, underTarget=0.12, avgPcmMs=96.00
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
