# Group Call E2E Summary

Scenario: `phil-kenny-one-on-one-76`
Mode: `live-export`
Quality: `3.08/10`
Paired status: `needs-work`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `unknown`

## Likely Fix Surfaces
- `mixed`: Inspect the worst peer first, then split follow-up work by the paired secondary class.
- `transport-dominated`: Inspect bridge pressure, packet delivery delay, and transport recovery behavior.
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `live-export`: mixed, severity=moderate, underTarget=0.48, avgPcmMs=90.85
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Stale timestamp drops: 22 (0.71/s); inspect sourceTimestampLateness gating before playout policy tuning
  Tick budget: 23 breaches, P95=39.7ms
  Transport triad: bridgeHW=24, binaryHW=2
  Stage5 boost: 23.9s
- `peer-B` (standby-forwarder) via `live-export`: policy-dominated, severity=mild, underTarget=0.54, avgPcmMs=111
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Stale timestamp drops: 947 (32.47/s); inspect sourceTimestampLateness gating before playout policy tuning
  Policy: avgPcm=110.6ms, underTarget=54%, mode=recovery
  Stage5 boost: 24.0s
