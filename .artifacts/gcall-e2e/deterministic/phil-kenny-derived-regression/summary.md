# Group Call E2E Summary

Scenario: `phil-kenny-derived-regression`
Mode: `deterministic`
Quality: `8.87/10`
Paired status: `both-pass`
Worse peer: `peer-B`
First degraded peer: `peer-A`
First degraded stage: `jitter`

## Likely Fix Surfaces
- `mixed`: Inspect the worst peer first, then split follow-up work by the paired secondary class.
- `transport-dominated`: Inspect bridge pressure, packet delivery delay, and transport recovery behavior.
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `philKennyTransportSender`: mixed, severity=healthy, underTarget=0.02, avgPcmMs=118
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Tick budget: 180 breaches, P95=40.0ms
  Transport triad: bridgeHW=24, binaryHW=18
- `peer-B` (standby-forwarder) via `philKennyStaleSender`: policy-dominated, severity=healthy, underTarget=0.16, avgPcmMs=104, staleTsDrops=202 (6.53/s)
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Stale timestamp drops: 202 (6.53/s); inspect sourceTimestampLateness gating before playout policy tuning
