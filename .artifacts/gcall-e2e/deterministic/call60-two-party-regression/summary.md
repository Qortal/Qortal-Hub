# Group Call E2E Summary

Scenario: `call60-two-party-regression`
Mode: `deterministic`
Quality: `9.22/10`
Paired status: `both-pass`
Worse peer: `peer-A`
First degraded peer: `peer-A`
First degraded stage: `playout`

## Likely Fix Surfaces
- `mixed`: Inspect the worst peer first, then split follow-up work by the paired secondary class.
- `transport-dominated`: Inspect bridge pressure, packet delivery delay, and transport recovery behavior.
- `policy-dominated`: Inspect target buffer policy, backlogDrain transitions, and playout stabilization.

## Peer Notes
- `peer-A` (root-forwarder) via `call60FixtureSender`: mixed, severity=healthy, underTarget=0.01, avgPcmMs=119
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
  Tick budget: 145 breaches, P95=26.0ms
  Transport triad: bridgeHW=22, binaryHW=16
- `peer-B` (standby-forwarder) via `cleanSender`: policy-dominated, severity=healthy, underTarget=0.00, avgPcmMs=120
  V2-managed sources: 1; using v2 jitter summary instead of legacy Opus window fields
