# Group call audio — forwarder architecture and native Reticulum

This document captures **long-horizon** work referenced by the group audio quality plan. It is not a commitment to ship dates.

## Forwarder / relay architecture

**Problem:** The elected root forwarder decodes, mixes, and re-encodes (or forwards) for multiple peers. Under load, main-process scheduling and CPU contention affect everyone.

**Directions to evaluate:**

1. **Opaque relay earlier:** Forward encrypted media frames without decode on the hot path where policy allows, so the forwarder’s decode budget scales with *local* playback only.
2. **Hierarchical topology:** For larger rooms, rely on cluster forwarders so no single peer fans out to the entire mesh (see existing hierarchical topology for 11–50 participants).
3. **Standby promotion:** Ensure promotion/demotion minimizes unnecessary media session resets (metrics: `clusterForwarderDemotionCount`, etc.).

**Testing:** Any structural change needs **load tests** with multiple simultaneous speakers and **per-role** metrics (root vs participant vs cluster forwarder).

## Native Reticulum / network layer

**Problem:** UDP timing, MTU, path selection, and reordering live largely outside the Electron app.

**Coordination points:**

- **Path warmup** and **packet vs link** transport are handled in `electron/src/group-call.ts` (e.g. `requestReticulumPacketPathWarmup`).
- **“Best possible”** quality may require Reticulum-level features: redundant paths, smarter MTU, or duplicate transmission for critical control—owned by **Reticulum** maintainers.
- **OS QoS** for real-time UDP is best-effort; document expectations for users on congested Wi‑Fi.

## Diagnostics

Use **split renderer drop reasons** (`packetsDropped*` fields on `GroupCallMetricsSnapshot` and per-window metrics) together with **main-process** `reticulumAudioQueuePressureDrops` and bridge high-water marks to see whether tuning should target **transport** vs **decode** vs **crypto/key** paths.
