import { compareRootForwardersSameEpoch } from './election-order';

export type RouterRole =
  | 'participant'
  | 'cluster-forwarder'
  | 'root-forwarder'
  | 'standby-forwarder';

export interface RouterClusterDef {
  members: string[];
  forwarder: string;
  standby: string;
  /** Third in election order within the cluster; empty if fewer than three members. */
  standby2: string;
}

/** Named officers for failover logic (deterministic from topology row). */
export function getClusterOfficers(cluster: {
  forwarder: string;
  standby: string;
  standby2?: string;
}): { forwarder: string; standby: string; backup: string } {
  return {
    forwarder: cluster.forwarder,
    standby: cluster.standby,
    backup: cluster.standby2 ?? '',
  };
}

/**
 * After cluster forwarder failure: standby becomes forwarder; fill standby/standby2 from backup
 * then remaining members in election order (`members` array).
 */
export function promoteClusterOfficersRow(
  cluster: RouterClusterDef
): RouterClusterDef {
  const { forwarder, standby, backup } = getClusterOfficers(cluster);
  if (!standby || standby === forwarder) return cluster;

  const newForwarder = standby;
  const used = new Set<string>([newForwarder]);

  let newStandby = '';
  if (backup && backup !== newForwarder) {
    newStandby = backup;
    used.add(newStandby);
  }
  if (!newStandby) {
    for (const m of cluster.members) {
      if (!used.has(m)) {
        newStandby = m;
        used.add(m);
        break;
      }
    }
  }

  let newStandby2 = '';
  for (const m of cluster.members) {
    if (!used.has(m)) {
      newStandby2 = m;
      break;
    }
  }

  return {
    ...cluster,
    forwarder: newForwarder,
    standby: newStandby || newForwarder,
    standby2: newStandby2,
  };
}

/** Root / global standby forwarder derived from cluster forwarder list (matches hierarchical buildTopology). */
export function roomLevelOfficersFromClusters(
  clusters: readonly RouterClusterDef[]
): { rootForwarder: string; standbyForwarder: string } {
  const forwards = clusters.map((c) => c.forwarder).filter(Boolean);
  return {
    rootForwarder: forwards[0] ?? '',
    standbyForwarder: forwards[1] ?? forwards[0] ?? '',
  };
}

/**
 * Apply in-cluster forwarder promotion at `clusterIndex` and bump epoch; re-derives room-level root/standby.
 */
export function buildTopologyAfterClusterPromotion(
  topology: RouterTopology,
  clusterIndex: number,
  newEpoch: number
): RouterTopology | null {
  const c = topology.clusters[clusterIndex];
  if (!c) return null;
  const promoted = promoteClusterOfficersRow(c);
  if (promoted.forwarder === c.forwarder) return null;
  const clusters = topology.clusters.map((cl, i) =>
    i === clusterIndex ? promoted : cl
  );
  const { rootForwarder, standbyForwarder } =
    roomLevelOfficersFromClusters(clusters);
  return {
    ...topology,
    topologyEpoch: newEpoch,
    clusters,
    rootForwarder,
    standbyForwarder,
  };
}

export interface RouterTopology {
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: RouterClusterDef[];
}

export interface RouterTopologyAuthorityView extends RouterTopology {
  lastSeen?: number | null;
}

export type RouterTopologyAuthorityReason =
  | 'stale-epoch'
  | 'newer-epoch'
  | 'lastSeen'
  | 'rootForwarder-lexical'
  | 'same-topology';

export interface RouterTopologyAuthorityDecision {
  acceptIncoming: boolean;
  reason: RouterTopologyAuthorityReason;
  winningRoot: string;
}

export interface RouterTopologyAuthorityOptions {
  compareRoots?: (incomingRoot: string, currentRoot: string) => number;
  /** When set, same-epoch root tie-break uses syncRootElectionDigestHex (matches main process). */
  roomId?: string;
  /**
   * Retained for call-site compatibility. Same-epoch root conflicts now ignore wall-clock
   * `lastSeen` ordering and always resolve by deterministic root comparison.
   */
  sameEpochRootConflictStickyMs?: number;
}

/** Default for {@link RouterTopologyAuthorityOptions.sameEpochRootConflictStickyMs}. */
export const DEFAULT_SAME_EPOCH_ROOT_CONFLICT_STICKY_MS = 150;

/**
 * Resolve conflicting topology candidates with a symmetric rule that every peer
 * can compute locally. Same-epoch root conflicts must not use wall-clock freshness,
 * or a late joiner with a partial roster can override the deterministic winner.
 */
export function chooseRouterTopologyAuthority(
  current: RouterTopologyAuthorityView,
  incoming: RouterTopologyAuthorityView,
  opts?: RouterTopologyAuthorityOptions
): RouterTopologyAuthorityDecision {
  if (incoming.topologyEpoch !== current.topologyEpoch) {
    return {
      acceptIncoming: incoming.topologyEpoch > current.topologyEpoch,
      reason:
        incoming.topologyEpoch > current.topologyEpoch
          ? 'newer-epoch'
          : 'stale-epoch',
      winningRoot:
        incoming.topologyEpoch > current.topologyEpoch
          ? incoming.rootForwarder
          : current.rootForwarder,
    };
  }

  if (incoming.rootForwarder !== current.rootForwarder) {
    const currentRoot = current.rootForwarder.trim();
    const incomingRoot = incoming.rootForwarder.trim();
    if (!currentRoot && incomingRoot) {
      return {
        acceptIncoming: true,
        reason: 'rootForwarder-lexical',
        winningRoot: incomingRoot,
      };
    }
    if (currentRoot && !incomingRoot) {
      return {
        acceptIncoming: false,
        reason: 'rootForwarder-lexical',
        winningRoot: currentRoot,
      };
    }
    const compareRoots =
      opts?.compareRoots ??
      (opts?.roomId
        ? (nextRoot: string, existingRoot: string) =>
            compareRootForwardersSameEpoch(nextRoot, existingRoot, opts.roomId!)
        : (nextRoot: string, existingRoot: string) =>
            nextRoot.localeCompare(existingRoot));
    const acceptIncoming = compareRoots(incomingRoot, currentRoot) < 0;
    return {
      acceptIncoming,
      reason: 'rootForwarder-lexical',
      winningRoot: acceptIncoming ? incomingRoot : currentRoot,
    };
  }

  const incomingSeen = incoming.lastSeen;
  const currentSeen = current.lastSeen;
  if (
    typeof incomingSeen === 'number' &&
    Number.isFinite(incomingSeen) &&
    typeof currentSeen === 'number' &&
    Number.isFinite(currentSeen) &&
    incomingSeen !== currentSeen
  ) {
    return {
      acceptIncoming: incomingSeen > currentSeen,
      reason: 'lastSeen',
      winningRoot: current.rootForwarder,
    };
  }

  return {
    acceptIncoming: false,
    reason: 'same-topology',
    winningRoot: current.rootForwarder,
  };
}

/**
 * Single-cluster election with sticky root: keep the previous root if still present
 * (hash order is `sorted` ascending). Caller must only use when `sorted.length <= clusterSize`.
 * Returns `null` if `sorted.length > clusterSize` (use hierarchical `buildTopology` instead).
 */
export function buildSingleClusterTopologyWithStickyRoot(
  sorted: string[],
  topologyEpoch: number,
  previousRoot: string | null | undefined,
  clusterSize: number
): RouterTopology | null {
  if (sorted.length > clusterSize) return null;
  if (sorted.length === 0) {
    return {
      topologyEpoch,
      rootForwarder: '',
      standbyForwarder: '',
      clusters: [{ members: [], forwarder: '', standby: '', standby2: '' }],
    };
  }

  const root =
    previousRoot && sorted.includes(previousRoot)
      ? previousRoot
      : (sorted[0] ?? '');
  const standby = sorted.find((a) => a !== root) ?? '';
  const standby2 = sorted.find((a) => a !== root && a !== standby) ?? '';

  return {
    topologyEpoch,
    rootForwarder: root,
    standbyForwarder: standby,
    clusters: [
      {
        members: sorted,
        forwarder: root,
        standby,
        standby2,
      },
    ],
  };
}

/**
 * Hierarchical election with sticky root: if the previous root is still present,
 * keep that peer as the room root by promoting it to the front of its cluster and
 * moving that cluster to the front of the room-level ordering.
 */
export function buildHierarchicalTopologyWithStickyRoot(
  sorted: string[],
  topologyEpoch: number,
  previousRoot: string | null | undefined,
  clusterSize: number
): RouterTopology | null {
  if (sorted.length === 0 || sorted.length <= clusterSize) return null;
  const stickyRoot = previousRoot?.trim() ?? '';
  if (!stickyRoot || !sorted.includes(stickyRoot)) return null;

  const chunked: string[][] = [];
  for (let i = 0; i < sorted.length; i += clusterSize) {
    chunked.push(sorted.slice(i, i + clusterSize));
  }
  const rootClusterIndex = chunked.findIndex((cluster) =>
    cluster.includes(stickyRoot)
  );
  if (rootClusterIndex < 0) return null;

  const reordered = chunked.map((cluster, idx) => {
    if (idx !== rootClusterIndex) return cluster;
    return [stickyRoot, ...cluster.filter((addr) => addr !== stickyRoot)];
  });
  if (rootClusterIndex > 0) {
    const [rootCluster] = reordered.splice(rootClusterIndex, 1);
    if (rootCluster) reordered.unshift(rootCluster);
  }

  const clusters = reordered.map((members) => ({
    members,
    forwarder: members[0] ?? '',
    standby: members[1] ?? members[0] ?? '',
    standby2: members[2] ?? '',
  }));
  const { rootForwarder, standbyForwarder } =
    roomLevelOfficersFromClusters(clusters);
  return {
    topologyEpoch,
    rootForwarder,
    standbyForwarder,
    clusters,
  };
}

export interface RouterParticipant {
  address: string;
  publicKey: string;
  speaking: boolean;
  role: RouterRole;
}

/** Optional detail for playout metric ticks (from group-playout-processor). */
export interface PlayoutMetricTickOpts {
  outsideUnder?: boolean;
  outsideOver?: boolean;
  deltaMs?: number;
  /** Smoothed playback rate from group-playout-processor (EMA). */
  playoutRate?: number;
}

/** Renderer-side packet drop attribution (see `recordPacketDroppedWithReason`). */
export type GroupCallPacketDropReason =
  | 'pending-decrypt'
  | 'startup-gate'
  | 'decode-failure'
  | 'decoder-throw'
  | 'stale-timestamp'
  | 'unknown-source';

export interface GroupCallMetricsSnapshot {
  role: RouterRole;
  /** Topology-derived role when the live metrics source is receive-only. */
  topologyRole?: RouterRole;
  /** Current number of intended fan-out recipients for local outbound audio. */
  forwardRecipientCount?: number;
  packetsReceived: number;
  packetsForwarded: number;
  packetsDecoded: number;
  packetsDropped: number;
  /** Sub-counts; sum should match `packetsDropped` when all drops use `recordPacketDroppedWithReason`. */
  packetsDroppedPendingDecrypt: number;
  /** Decrypt worker returned after key rotation; pending job discarded (not TTL/cap). */
  packetsDroppedStaleWorkerDecrypt: number;
  packetsDroppedStartupGate: number;
  packetsDroppedDecodeFailure: number;
  packetsDroppedDecoderThrow: number;
  packetsDroppedStaleTimestamp: number;
  packetsDroppedUnknownSource: number;
  relayPacketsSent: number;
  relayPacketsReceived: number;
  /** Wall time (ms) of last legacy relay send or receive; 0 = none this session. */
  lastRelayActivityAtMs: number;
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  decoderCount: number;
  playbackNodeCount: number;
  jitterBufferCount: number;
  avgIncomingPacketMs: number;
  maxIncomingPacketMs: number;
  avgJitterTickMs: number;
  maxJitterTickMs: number;
  /** Rolling avg PCM depth (ms) from group playout worklets. */
  avgPcmBufferedMs: number;
  /** Fraction of playout metric ticks where |bufferedMs - target| > band (tuning KPI). */
  playoutOutsideTargetFraction: number;
  /** Fraction of ticks where buffered < target - band (shallow vs deep diagnostics). */
  playoutUnderTargetFraction: number;
  /** Fraction of ticks where buffered > target + band. */
  playoutOverTargetFraction: number;
  /** Mean (bufferedMs - targetMs) over ticks that reported deltaMs. */
  avgPlayoutDeltaMs: number;
  /** Rolling mean smoothed playout rate (1 = real-time). */
  avgPlayoutRate: number;
  /** Fraction of playout metric ticks with rate &lt; 1.0. */
  playoutRateFractionBelow1: number;
  /** Fraction of playout metric ticks with rate &lt; 0.97. */
  playoutRateFractionBelow097: number;
  /** Local receiver ingress -> renderer worklet post latency for V2 playout. */
  avgReceiverIngressToPlayoutPostMs: number;
  /** Session max local receiver ingress -> renderer worklet post latency for V2 playout. */
  maxReceiverIngressToPlayoutPostMs: number;
  /** Mean Python-bridge receive -> renderer ingress latency for Reticulum inbound audio. */
  avgReticulumAudioBridgeToRendererIngressMs: number;
  /** Session max Python-bridge receive -> renderer ingress latency for Reticulum inbound audio. */
  maxReticulumAudioBridgeToRendererIngressMs: number;
  /**
   * Outbound: mean delay from capture worklet `postMessage` to main-thread handler
   * (worklet → JS thread handoff).
   */
  avgGcallSenderWorkletToMainThreadMs: number;
  maxGcallSenderWorkletToMainThreadMs: number;
  /**
   * Outbound: main-thread PCM handler start → `AudioEncoder` output callback
   * (i16, AudioData, Opus encode).
   */
  avgGcallSenderMainThreadToEncoderOutputMs: number;
  maxGcallSenderMainThreadToEncoderOutputMs: number;
  /**
   * Outbound: worklet `postMessage` time → `AudioEncoder` output
   * (end-to-end before `sendEncodedFrame`).
   */
  avgGcallSenderWorkletToEncoderOutputMs: number;
  maxGcallSenderWorkletToEncoderOutputMs: number;
  /**
   * Outbound: `AudioEncoder` output → `timestampMs` assignment
   * (framing, encrypt/sync path, key checks).
   */
  avgGcallSenderEncoderOutputToPacketTimestampMs: number;
  maxGcallSenderEncoderOutputToPacketTimestampMs: number;
  /** Rolling mean of per-drain-tick mean jitter depth (Opus frames) across active sources. */
  jitterBufferDepthFramesMean: number;
  /** Session high-water: max per-tick worst depth across active sources (Opus frames). */
  jitterBufferDepthFramesWorst: number;
  /** Fraction of drain-tick source samples where `!hasReadyFrame()`. */
  jitterNotReadyFraction: number;
  /** Fraction of drain-tick source samples where jitter buffer had zero frames. */
  jitterRawEmptyFraction: number;
  lastUpdatedAt: number;
  /** Present-tense: Reticulum transport needed for this role is ready (set in useGroupVoiceCall flush). */
  transportReady?: boolean;
  relayDwellMs: number;
  relayDwellFraction: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  /**
   * Worst playout starvation severity across sources (last adaptive playout tick pass).
   */
  playoutStarvationWorstSeverity: 'none' | 'mild' | 'strong';
  /** Fallback relay throttled (RELAY_FALLBACK_MIN_INTERVAL_MS) — frame not sent yet. */
  relayThrottleDrops: number;
  /** Superseded pending relay payload (newest-frame-wins coalescing). */
  relayCoalesceSuperseded: number;
  /** IPC/main rejected send (e.g. relay token bucket) or invoke threw. */
  relayIpcFailures: number;
  /** Latest per-peer pending frames before main enqueues into bridge. */
  reticulumAudioPendingFrames: number;
  /** Latest age of the oldest per-peer pending Reticulum frame before bridge enqueue. */
  reticulumAudioPendingOldestAgeMs: number;
  /** Session high-water mark for per-peer pending frames. */
  reticulumAudioPendingFramesHighWater: number;
  /** Session max age of the oldest per-peer pending Reticulum frame. */
  reticulumAudioPendingOldestAgeMaxMs: number;
  /** Latest queued frames waiting in the main-process bridge. */
  reticulumAudioBridgeQueuedFrames: number;
  /** Latest age of the oldest queued frame in the main-process bridge. */
  reticulumAudioBridgeQueuedOldestAgeMs: number;
  /** Session high-water mark for main-process bridge queued frames. */
  reticulumAudioBridgeQueuedFramesHighWater: number;
  /** Session max age of the oldest queued frame in the main-process bridge. */
  reticulumAudioBridgeQueuedOldestAgeMaxMs: number;
  /** Latest decoded fd3 queue depth inside the Python bridge. */
  reticulumAudioDecodedQueueDepth: number;
  /** Latest age of the oldest decoded fd3 batch inside the Python bridge. */
  reticulumAudioDecodedQueueOldestAgeMs: number;
  /** Session high-water mark for Python decoded queue depth. */
  reticulumAudioDecodedQueueDepthHighWater: number;
  /** Session max age of the oldest decoded fd3 batch inside the Python bridge. */
  reticulumAudioDecodedQueueOldestAgeMaxMs: number;
  /** Latest child→parent binary queue depth inside the Python bridge. */
  reticulumAudioBinaryOutQueueDepth: number;
  /** Latest age of the oldest child→parent binary queue item inside the Python bridge. */
  reticulumAudioBinaryOutQueueOldestAgeMs: number;
  /** Session high-water mark for Python child→parent binary queue depth. */
  reticulumAudioBinaryOutQueueDepthHighWater: number;
  /** Session max age of the oldest child→parent binary queue item inside the Python bridge. */
  reticulumAudioBinaryOutQueueOldestAgeMaxMs: number;
  /** Latest fd3 backpressure flag from bridge (align with main-process pressure). */
  reticulumAudioBridgeWaitingForDrain: boolean;
  /** Counted send-path drops caused by queue pressure. */
  reticulumAudioQueuePressureDrops: number;
  /** Rolling 5-second queue-pressure drop count reported from the bridge. */
  reticulumAudioQueuePressureDropsLast5s: number;
  /** Counted send-path drops caused by stale queued audio. */
  reticulumAudioStaleDrops: number;
  /** Rolling 5-second stale-drop count reported from the bridge. */
  reticulumAudioStaleDropsLast5s: number;
  /** Link became unready while trying to enqueue/send audio. */
  reticulumAudioLinkUnreadyDrops: number;
  /** Reticulum packet send failures reported by the bridge. */
  reticulumAudioPacketSendFailures: number;
  /** Packet path requests emitted by the bridge. */
  reticulumAudioPacketPathRequests: number;
  /** Packet path resolutions observed by the bridge. */
  reticulumAudioPacketPathResolutions: number;
  /** Packet path timeouts observed by the bridge. */
  reticulumAudioPacketPathTimeouts: number;
  /** Sends issued while path looked fresh. */
  reticulumAudioPacketFreshSends: number;
  /** Sends issued while path looked stale/warming. */
  reticulumAudioPacketStaleSends: number;
  /** Sends issued while path state was unknown/failing. */
  reticulumAudioPacketUnknownSends: number;
  /** Audio frames dropped by Python bridge because they missed the outbound deadline. */
  reticulumAudioDeadlineDropCount: number;
  /** Decoded Python fd3 batches evicted oldest-first to admit fresh audio. */
  reticulumAudioDecodedQueueEvictOldestCount: number;
  /** Fresh decoded Python fd3 batches dropped because admission still failed. */
  reticulumAudioDecodedQueueDropNewestCount: number;
  /** Max age of an outbound audio frame when Python decoded it from fd3. */
  reticulumAudioFd3DecodedAgeMsMax: number;
  /** Max dwell time inside the Python decoded audio queue before RNS processing. */
  reticulumAudioDecodedQueueDwellMsMax: number;
  /** Max observed duration of an RNS audio packet send. */
  reticulumAudioRnsSendDurationMsMax: number;
  /** Max observed duration of packet path check before RNS send. */
  reticulumAudioPacketPathCheckMsMax: number;
  /** Max time between Python RNS executor loop passes. */
  reticulumAudioExecutorLoopGapMsMax: number;
  /** Max executor loop gap while decoded audio was already waiting. */
  reticulumAudioExecutorGapWhileQueuedMsMax: number;
  /** Max duration of one Python executor audio-drain pass. */
  reticulumAudioExecutorAudioPassMsMax: number;
  /** Max duration of processing one decoded audio batch. */
  reticulumAudioProcessBatchMsMax: number;
  /** Largest decoded audio batch processed by Python. */
  reticulumAudioProcessBatchFramesMax: number;
  /** Count of slow RNS audio packet sends observed by Python. */
  reticulumAudioRnsSendSlowCount: number;
  /** Count of executor loop stalls while decoded audio was queued. */
  reticulumAudioExecutorStallCount: number;
  /** Max duration of one non-audio command handled by the Python RNS executor. */
  reticulumAudioExecutorCommandMsMax: number;
  /** Max command duration when decoded audio was already queued. */
  reticulumAudioExecutorCommandWhileQueuedMsMax: number;
  /** Count of slow non-audio commands handled by the Python RNS executor. */
  reticulumAudioExecutorCommandSlowCount: number;
  /** Max scheduling gap observed by the Python/RNS callback heartbeat thread. */
  reticulumAudioRnsCallbackSchedulerGapMsMax: number;
  /** Count of Python/RNS callback heartbeat gaps over 100ms. */
  reticulumAudioRnsCallbackSchedulerGapOver100Count: number;
  /** Count of Python/RNS callback heartbeat gaps over 250ms. */
  reticulumAudioRnsCallbackSchedulerGapOver250Count: number;
  /** Count of Python/RNS callback heartbeat gaps over 500ms. */
  reticulumAudioRnsCallbackSchedulerGapOver500Count: number;
  /** Count of Python/RNS callback heartbeat gaps over 1000ms. */
  reticulumAudioRnsCallbackSchedulerGapOver1000Count: number;
  /**
   * Outbound group-audio send path observed from main-process diagnostics (`transport` field).
   * Incremented once per send IPC completion that reported a `link` transport.
   */
  reticulumAudioOutboundLinkSamples: number;
  /**
   * Outbound group-audio send path observed from main-process diagnostics (`transport` field).
   * Incremented once per send IPC completion that reported a `packet` transport.
   */
  reticulumAudioOutboundPacketSamples: number;
  /** Most recent outbound `transport` from main-process send diagnostics; null if none yet. */
  reticulumAudioOutboundTransportLast: 'link' | 'packet' | null;
  /**
   * Inbound group-audio transport observed from main-process `gcall:audio` events.
   * Incremented once per received packet that reported a `link` transport.
   */
  reticulumAudioInboundLinkSamples: number;
  /**
   * Inbound group-audio transport observed from main-process `gcall:audio` events.
   * Incremented once per received packet that reported a `packet` transport.
   */
  reticulumAudioInboundPacketSamples: number;
  /** Most recent inbound `transport` from main-process `gcall:audio`; null if none yet. */
  reticulumAudioInboundTransportLast: 'link' | 'packet' | null;
  mixerActiveSpeakerEstimate: number;
  mixerMasterGain: number;
  mixerCurrentReductionDb: number;
  mixerAvgReductionDb: number;
  mixerOverloadEvents: number;
  mixerHeavyReductionFraction: number;
  /** libopus WASM FEC path (session totals). */
  wasmFecPlcFrames: number;
  wasmFecAttempts: number;
  wasmFecSuccessCoarse: number;
  wasmFecDeferredPcmTicks: number;
  /** Non-root cluster standby promoted after forwarder liveness timeout (Phase 1 failover). */
  clusterFailoverPromotionCount: number;
  /** Room standby promoted to root after root liveness timeout (flat / global standby). */
  rootFailoverPromotionCount: number;
  /** This node applied higher epoch / lost cluster.forwarder and demoted forwarding. */
  clusterForwarderDemotionCount: number;
  /** Latest in-flight decrypt-worker job count (main-thread map until `result`). */
  pendingDecryptDepth: number;
  /** Session high-water for {@link pendingDecryptDepth}. */
  pendingDecryptDepthHighWater: number;

  /** Cumulative ms in decrypt burst window tier (session). */
  gcallAudioBurstWindowCumulativeMs: number;
  /** Cumulative ms in decrypt overload (stage 4). */
  gcallAudioOverloadCumulativeMs: number;
  /** Cumulative ms with ingress pacing tier &gt; 0 (Opus send-pressure). */
  gcallAudioIngressPacingCumulativeMs: number;
  /** Cumulative ms with extra flush boost / stage-5 escalation active (renderer estimate). */
  gcallAudioStage5BoostCumulativeMs: number;
  /** Cumulative ms in fail-safe mode (optional stage 6). */
  gcallAudioFailSafeCumulativeMs: number;
  /** Last completed continuous stint in burst window (ms). */
  gcallAudioBurstWindowLastStintMs: number;
  gcallAudioOverloadLastStintMs: number;
  gcallAudioIngressPacingLastStintMs: number;
  gcallAudioStage5BoostLastStintMs: number;
  gcallAudioFailSafeLastStintMs: number;
  /** Session entry counts (flapping indicator). */
  gcallAudioBurstWindowEntries: number;
  gcallAudioOverloadEntries: number;
  gcallAudioIngressPacingEntries: number;
  gcallAudioStage5BoostEntries: number;
  gcallAudioFailSafeEntries: number;
}

export interface GroupCallSourceWindowMetrics {
  sourceAddr: string;
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  avgPcmBufferedMs: number;
  playoutOutsideTargetFraction: number;
  playoutUnderTargetFraction?: number;
  playoutOverTargetFraction?: number;
  avgPlayoutDeltaMs?: number;
  avgOpusBufferedMs: number;
  maxOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  adaptiveTargetP95Ms: number;
  adaptiveTargetMaxMs: number;
  /** Playout metric samples for this source in the metrics window (starvation min-sample gate). */
  playoutMetricTicks?: number;
  avgReceiverIngressToPlayoutPostMs?: number;
  maxReceiverIngressToPlayoutPostMs?: number;
  wasmFecPlcFrames?: number;
  wasmFecAttempts?: number;
  wasmFecSuccessCoarse?: number;
  wasmFecDeferredPcmTicks?: number;
}

export interface GroupCallWindowMetrics {
  receivingPeer: string;
  startAt: number;
  endAt: number;
  durationMs: number;
  packetsDropped: number;
  packetsDroppedPendingDecrypt: number;
  packetsDroppedStaleWorkerDecrypt: number;
  packetsDroppedStartupGate: number;
  packetsDroppedDecodeFailure: number;
  packetsDroppedDecoderThrow: number;
  packetsDroppedStaleTimestamp: number;
  packetsDroppedUnknownSource: number;
  /** Max in-flight decrypt jobs observed during this metrics window. */
  pendingDecryptDepthHighWater: number;
  /** `packetsDroppedPendingDecrypt` per second over the window. */
  packetsDroppedPendingDecryptRatePerSec: number;
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioLinkUnreadyDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioPacketPathRequests: number;
  reticulumAudioPacketPathResolutions: number;
  reticulumAudioPacketPathTimeouts: number;
  reticulumAudioPacketFreshSends: number;
  reticulumAudioPacketStaleSends: number;
  reticulumAudioPacketUnknownSends: number;
  /** Send IPC completions in this window that reported `transport: link`. */
  reticulumAudioOutboundLinkSamples: number;
  /** Send IPC completions in this window that reported `transport: packet`. */
  reticulumAudioOutboundPacketSamples: number;
  /** Received `gcall:audio` events in this window that reported `transport: link`. */
  reticulumAudioInboundLinkSamples: number;
  /** Received `gcall:audio` events in this window that reported `transport: packet`. */
  reticulumAudioInboundPacketSamples: number;
  reticulumAudioQueuePressureDropRatePerSec: number;
  reticulumAudioStaleDropRatePerSec: number;
  reticulumAudioPacketSendFailureRatePerSec: number;
  reticulumAudioPendingFramesHighWater: number;
  reticulumAudioPendingOldestAgeMaxMs: number;
  reticulumAudioBridgeQueuedFramesHighWater: number;
  reticulumAudioBridgeQueuedOldestAgeMaxMs: number;
  reticulumAudioDecodedQueueDepthHighWater: number;
  reticulumAudioDecodedQueueOldestAgeMaxMs: number;
  reticulumAudioBinaryOutQueueDepthHighWater: number;
  reticulumAudioBinaryOutQueueOldestAgeMaxMs: number;
  relayDwellMs: number;
  relayDwellFraction: number;
  avgPcmBufferedMs: number;
  playoutOutsideTargetFraction: number;
  playoutUnderTargetFraction: number;
  playoutOverTargetFraction: number;
  avgPlayoutDeltaMs: number;
  avgOpusBufferedMs: number;
  maxOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  adaptiveTargetP95Ms: number;
  adaptiveTargetMaxMs: number;
  /** Mean smoothed playout rate over the window (ticks with rate samples). */
  avgPlayoutRate: number;
  /** Fraction of playout ticks with rate &lt; 1.0. */
  playoutRateFractionBelow1: number;
  /** Fraction of playout ticks with rate &lt; 0.97. */
  playoutRateFractionBelow097: number;
  /** Window mean local receiver ingress -> renderer worklet post latency for V2 playout. */
  avgReceiverIngressToPlayoutPostMs: number;
  /** Window max local receiver ingress -> renderer worklet post latency for V2 playout. */
  maxReceiverIngressToPlayoutPostMs: number;
  /** Window mean Python-bridge receive -> renderer ingress latency for Reticulum inbound audio. */
  avgReticulumAudioBridgeToRendererIngressMs: number;
  /** Window max Python-bridge receive -> renderer ingress latency for Reticulum inbound audio. */
  maxReticulumAudioBridgeToRendererIngressMs: number;
  /** Window mean capture worklet → main thread handoff. */
  avgGcallSenderWorkletToMainThreadMs: number;
  maxGcallSenderWorkletToMainThreadMs: number;
  /** Window mean main-thread PCM/encode stage through WebCodecs. */
  avgGcallSenderMainThreadToEncoderOutputMs: number;
  maxGcallSenderMainThreadToEncoderOutputMs: number;
  /** Window mean worklet handoff through encoder output. */
  avgGcallSenderWorkletToEncoderOutputMs: number;
  maxGcallSenderWorkletToEncoderOutputMs: number;
  /** Window mean encoder output → `timestampMs` line. */
  avgGcallSenderEncoderOutputToPacketTimestampMs: number;
  maxGcallSenderEncoderOutputToPacketTimestampMs: number;
  /** Mean of per-drain-tick mean jitter depth (Opus frames) in this window. */
  jitterBufferDepthFramesMean: number;
  /** Max per-tick worst jitter depth (Opus frames) in this window. */
  jitterBufferDepthFramesWorst: number;
  /** Fraction of drain-tick source samples with `!hasReadyFrame()`. */
  jitterNotReadyFraction: number;
  /** Fraction of drain-tick source samples with empty jitter buffer. */
  jitterRawEmptyFraction: number;
  worstSourceAddr: string | null;
  worstAdaptiveTargetMs: number;
  sources: GroupCallSourceWindowMetrics[];
}

export interface GroupCallSourceRecoveryAssessment {
  activeSource: boolean;
  score: number;
  severe: boolean;
  shouldEscalate: boolean;
}

export interface GroupCallReticulumAudioPressureAssessment {
  score: number;
  severe: boolean;
  shouldTightenRecovery: boolean;
}

export interface GroupCallSourceStallAssessmentInput {
  sourceExpected: boolean;
  transportReady: boolean;
  ingressPeerConnected: boolean;
  lastRecvAgeMs: number;
  opusBufferedMs: number;
  adaptiveTargetMs: number;
  adaptiveTargetIdleAgeMs: number;
  hadRecentMediaWindow: boolean;
  gapEvidence: boolean;
}

export interface GroupCallSourceStallAssessment {
  activeSource: boolean;
  stalled: boolean;
  gapEvidence: boolean;
  score: number;
  severe: boolean;
  shouldEscalate: boolean;
}

export function hasGroupCallSourceWindowMediaActivity(
  source: GroupCallSourceWindowMetrics | null | undefined
): boolean {
  if (!source) return false;
  return (
    source.missingFrames > 0 ||
    source.jitterUnderruns > 0 ||
    source.concealmentTicks > 0 ||
    source.avgOpusBufferedMs > 0 ||
    source.maxOpusBufferedMs > 0 ||
    source.adaptiveTargetMaxMs > 0 ||
    (source.wasmFecAttempts ?? 0) > 0 ||
    (source.wasmFecPlcFrames ?? 0) > 0
  );
}

/**
 * Heuristic for when a source's 60s media window is bad enough to justify escalating the
 * transport leg that carried it into recovery/reconnect. We intentionally bias toward
 * sequence gaps and sustained low-buffer playout rather than raw underrun counts, which
 * can be noisy during idle talk gaps.
 */
export function assessGroupCallSourceWindowForRecovery(
  source: GroupCallSourceWindowMetrics
): GroupCallSourceRecoveryAssessment {
  const hasTransportEvidence =
    source.missingFrames > 0 ||
    source.avgOpusBufferedMs > 0 ||
    source.adaptiveTargetMaxMs > 0;
  if (!hasTransportEvidence) {
    return {
      activeSource: false,
      score: 0,
      severe: false,
      shouldEscalate: false,
    };
  }

  let score = 0;
  let severe = false;

  if (source.missingFrames >= 160) {
    score += 3;
    severe = true;
  } else if (source.missingFrames >= 60) {
    score += 2;
  } else if (source.missingFrames > 0) {
    score += 1;
  }

  if (source.concealmentTicks >= 180) score += 2;
  else if (source.concealmentTicks >= 60) score += 1;

  if (source.playoutOutsideTargetFraction >= 0.95) score += 2;
  else if (source.playoutOutsideTargetFraction >= 0.8) score += 1;

  if ((source.playoutUnderTargetFraction ?? 0) >= 0.9) {
    score += 3;
    severe = true;
  } else if ((source.playoutUnderTargetFraction ?? 0) >= 0.75) {
    score += 2;
  } else if ((source.playoutUnderTargetFraction ?? 0) >= 0.55) {
    score += 1;
  }

  if ((source.avgPlayoutDeltaMs ?? 0) <= -100) {
    score += 2;
    severe = true;
  } else if ((source.avgPlayoutDeltaMs ?? 0) <= -60) {
    score += 1;
  }

  if (source.adaptiveTargetP95Ms >= 170) score += 1;
  if (source.avgPcmBufferedMs <= 20) {
    score += 1;
    severe = severe || (source.playoutUnderTargetFraction ?? 0) >= 0.75;
  } else if (source.avgPcmBufferedMs <= 35) {
    score += 1;
  }
  if (source.avgOpusBufferedMs <= 25) score += 1;
  else if (source.avgOpusBufferedMs <= 50) score += 1;

  return {
    activeSource: true,
    score,
    severe,
    shouldEscalate: severe || score >= 4,
  };
}

export function compareGroupCallSourceIsolationPriority(
  a: GroupCallSourceWindowMetrics,
  b: GroupCallSourceWindowMetrics
): number {
  const aAssessment = assessGroupCallSourceWindowForRecovery(a);
  const bAssessment = assessGroupCallSourceWindowForRecovery(b);
  if (aAssessment.severe !== bAssessment.severe) {
    return aAssessment.severe ? 1 : -1;
  }
  if (aAssessment.score !== bAssessment.score) {
    return aAssessment.score - bAssessment.score;
  }

  const aUnderTarget = a.playoutUnderTargetFraction ?? 0;
  const bUnderTarget = b.playoutUnderTargetFraction ?? 0;
  if (aUnderTarget !== bUnderTarget) {
    return aUnderTarget - bUnderTarget;
  }

  const aDelta = a.avgPlayoutDeltaMs ?? 0;
  const bDelta = b.avgPlayoutDeltaMs ?? 0;
  if (aDelta !== bDelta) {
    return bDelta - aDelta;
  }

  const aObservedTarget = Math.max(
    1,
    a.adaptiveTargetMedianMs || a.adaptiveTargetMaxMs || 1
  );
  const bObservedTarget = Math.max(
    1,
    b.adaptiveTargetMedianMs || b.adaptiveTargetMaxMs || 1
  );
  const aReserveRatio = a.avgOpusBufferedMs / aObservedTarget;
  const bReserveRatio = b.avgOpusBufferedMs / bObservedTarget;
  if (aReserveRatio !== bReserveRatio) {
    return bReserveRatio - aReserveRatio;
  }

  if (a.adaptiveTargetMaxMs !== b.adaptiveTargetMaxMs) {
    return a.adaptiveTargetMaxMs - b.adaptiveTargetMaxMs;
  }
  return b.sourceAddr.localeCompare(a.sourceAddr);
}

export function pickWorstSourceForIsolation(
  sources: readonly GroupCallSourceWindowMetrics[]
): GroupCallSourceWindowMetrics | null {
  return sources.reduce<GroupCallSourceWindowMetrics | null>(
    (worst, current) => {
      if (!worst) return current;
      return compareGroupCallSourceIsolationPriority(current, worst) > 0
        ? current
        : worst;
    },
    null
  );
}

export function assessReticulumAudioPressureWindow(
  windowMetrics: Pick<
    GroupCallWindowMetrics,
    | 'durationMs'
    | 'reticulumAudioQueuePressureDrops'
    | 'reticulumAudioStaleDrops'
    | 'reticulumAudioPacketSendFailures'
    | 'reticulumAudioPendingFramesHighWater'
    | 'reticulumAudioBridgeQueuedFramesHighWater'
    | 'reticulumAudioDecodedQueueDepthHighWater'
    | 'reticulumAudioBinaryOutQueueDepthHighWater'
    | 'packetsDroppedPendingDecrypt'
    | 'pendingDecryptDepthHighWater'
  >
): GroupCallReticulumAudioPressureAssessment {
  const durationSeconds = Math.max(1, windowMetrics.durationMs / 1000);
  const queuePressureRate =
    windowMetrics.reticulumAudioQueuePressureDrops / durationSeconds;
  const staleDropRate =
    windowMetrics.reticulumAudioStaleDrops / durationSeconds;
  const pendingDecryptDropRate =
    windowMetrics.packetsDroppedPendingDecrypt / durationSeconds;
  let score = 0;
  let severe = false;

  if (queuePressureRate >= 8) {
    score += 3;
    severe = true;
  } else if (queuePressureRate >= 3) {
    score += 2;
  } else if (queuePressureRate > 0) {
    score += 1;
  }

  if (windowMetrics.reticulumAudioDecodedQueueDepthHighWater >= 16) {
    score += 2;
    severe = true;
  } else if (windowMetrics.reticulumAudioDecodedQueueDepthHighWater >= 10) {
    score += 1;
  }

  if (windowMetrics.reticulumAudioPendingFramesHighWater >= 18) score += 2;
  else if (windowMetrics.reticulumAudioPendingFramesHighWater >= 12) score += 1;
  if (windowMetrics.reticulumAudioBridgeQueuedFramesHighWater >= 8) score += 1;
  if (windowMetrics.reticulumAudioBinaryOutQueueDepthHighWater >= 4) score += 1;
  if (staleDropRate >= 1) score += 1;
  if (windowMetrics.reticulumAudioPacketSendFailures > 0) score += 1;

  if (pendingDecryptDropRate >= 8) {
    score += 3;
    severe = true;
  } else if (pendingDecryptDropRate >= 3) {
    score += 2;
  } else if (pendingDecryptDropRate > 0) {
    score += 1;
  }
  const pdhw = windowMetrics.pendingDecryptDepthHighWater ?? 0;
  if (pdhw >= 90) {
    score += 2;
    severe = true;
  } else if (pdhw >= 64) {
    score += 2;
  } else if (pdhw >= 32) {
    score += 1;
  }

  return {
    score,
    severe,
    shouldTightenRecovery: severe || score >= 4,
  };
}

/**
 * Live watchdog heuristic for the "silent stall" class: the source used to carry media,
 * remains expected in topology, transport still looks healthy, but no packets or playout
 * activity are visible anymore. Packet-gap evidence is excluded so gap-based recovery and
 * stall-based recovery stay distinct.
 */
export function assessGroupCallSourceStall(
  input: GroupCallSourceStallAssessmentInput
): GroupCallSourceStallAssessment {
  const activeSource = input.sourceExpected && input.hadRecentMediaWindow;
  if (!activeSource || !input.transportReady || !input.ingressPeerConnected) {
    return {
      activeSource,
      stalled: false,
      gapEvidence: input.gapEvidence,
      score: 0,
      severe: false,
      shouldEscalate: false,
    };
  }

  if (input.gapEvidence) {
    return {
      activeSource: true,
      stalled: false,
      gapEvidence: true,
      score: 0,
      severe: false,
      shouldEscalate: false,
    };
  }

  const targetRecentlyActive =
    input.adaptiveTargetMs > 0 && input.adaptiveTargetIdleAgeMs < 5_000;
  const stalled =
    input.lastRecvAgeMs >= 8_000 &&
    input.opusBufferedMs <= 0 &&
    !targetRecentlyActive;
  if (!stalled) {
    return {
      activeSource: true,
      stalled: false,
      gapEvidence: false,
      score: 0,
      severe: false,
      shouldEscalate: false,
    };
  }

  let score = 0;
  let severe = false;

  if (input.lastRecvAgeMs >= 20_000) {
    score += 3;
    severe = true;
  } else if (input.lastRecvAgeMs >= 12_000) {
    score += 2;
  } else {
    score += 1;
  }

  if (input.opusBufferedMs <= 0) score += 2;
  else if (input.opusBufferedMs <= 20) score += 1;

  if (input.adaptiveTargetMs <= 0) score += 1;
  if (
    input.adaptiveTargetIdleAgeMs >= input.lastRecvAgeMs ||
    input.adaptiveTargetIdleAgeMs >= 8_000
  ) {
    score += 1;
  }

  return {
    activeSource: true,
    stalled: true,
    gapEvidence: false,
    score,
    severe,
    shouldEscalate: severe || score >= 4,
  };
}

/** Legacy relay must be this recent (ms) to show "P2P relay" instead of Connecting. */
export const GROUP_CALL_RELAY_INDICATOR_STALE_MS = 2_500;

/** Compare-only fingerprint: normalize cluster/member order so duplicate topology heartbeats match. */
export function groupCallTopologyStructureFingerprint(
  topology: RouterTopology
): string {
  const normClusters = topology.clusters
    .map((c) => ({
      forwarder: c.forwarder,
      standby: c.standby,
      standby2: c.standby2 ?? '',
      members: [...c.members].sort(),
    }))
    .sort((a, b) => a.forwarder.localeCompare(b.forwarder));
  return JSON.stringify({
    topologyEpoch: topology.topologyEpoch,
    rootForwarder: topology.rootForwarder,
    standbyForwarder: topology.standbyForwarder,
    clusters: normClusters,
  });
}

/**
 * Same local epoch and same structure as previous topology → skip redundant React state updates.
 */
export function isGroupCallTopologyDuplicateHeartbeat(
  prev: RouterTopology | null,
  incoming: RouterTopology,
  localEpoch: number
): boolean {
  return (
    prev !== null &&
    incoming.topologyEpoch === localEpoch &&
    groupCallTopologyStructureFingerprint(incoming) ===
      groupCallTopologyStructureFingerprint(prev)
  );
}

export type GroupCallTransportMode = 'reticulum' | 'relay' | 'connecting';

/**
 * Live transport indicator: Reticulum when the role-required transport is ready;
 * else recent legacy relay; else connecting.
 */
export function getGroupCallTransportSummary(
  m: Pick<
    GroupCallMetricsSnapshot,
    'relayPacketsSent' | 'relayPacketsReceived' | 'lastRelayActivityAtMs'
  > & {
    transportReady?: boolean;
  },
  now: number = Date.now()
): { mode: GroupCallTransportMode; label: string; tooltip: string } {
  const staleMs = GROUP_CALL_RELAY_INDICATOR_STALE_MS;
  const recentRelay =
    m.lastRelayActivityAtMs > 0 && now - m.lastRelayActivityAtMs <= staleMs;
  const transportReady = m.transportReady === true;

  if (transportReady) {
    return {
      mode: 'reticulum',
      label: 'Reticulum',
      tooltip:
        'Reticulum audio links are up for this role and are carrying group-call media.',
    };
  }
  if (recentRelay) {
    return {
      mode: 'relay',
      label: 'P2P relay',
      tooltip: 'Audio is using the legacy P2P relay path.',
    };
  }
  return {
    mode: 'connecting',
    label: 'Connecting…',
    tooltip:
      'Reticulum transport for this role is not ready yet; legacy relay may be used briefly when you speak.',
  };
}

interface ResourceCounts {
  decoders: number;
  playbackNodes: number;
  jitterBuffers: number;
}

interface WindowCounterSet {
  packetsDropped: number;
  packetsDroppedPendingDecrypt: number;
  packetsDroppedStaleWorkerDecrypt: number;
  packetsDroppedStartupGate: number;
  packetsDroppedDecodeFailure: number;
  packetsDroppedDecoderThrow: number;
  packetsDroppedStaleTimestamp: number;
  packetsDroppedUnknownSource: number;
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioLinkUnreadyDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioPacketPathRequests: number;
  reticulumAudioPacketPathResolutions: number;
  reticulumAudioPacketPathTimeouts: number;
  reticulumAudioPacketFreshSends: number;
  reticulumAudioPacketStaleSends: number;
  reticulumAudioPacketUnknownSends: number;
  reticulumAudioOutboundLinkSamples: number;
  reticulumAudioOutboundPacketSamples: number;
  reticulumAudioInboundLinkSamples: number;
  reticulumAudioInboundPacketSamples: number;
}

interface SourceWindowAccumulator {
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  playoutTicks: number;
  playoutOutsideTicks: number;
  playoutUnderTicks: number;
  playoutOverTicks: number;
  playoutDeltaMsSum: number;
  playoutDeltaMsSamples: number;
  playoutBufferedMsSum: number;
  playoutBufferedMsSamples: number;
  playoutPostLatencyMsSum: number;
  playoutPostLatencyMsSamples: number;
  playoutPostLatencyMsMax: number;
  opusBufferedMsSum: number;
  opusBufferedMsSamples: number;
  opusBufferedMsMax: number;
  adaptiveTargetSamples: number[];
  wasmFecPlcFrames: number;
  wasmFecAttempts: number;
  wasmFecSuccessCoarse: number;
  wasmFecDeferredPcmTicks: number;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
}

function maxFiniteMetric(current: number | undefined, next: number): number {
  const currentSafe = Number.isFinite(current) ? Number(current) : 0;
  return Math.max(currentSafe, Math.max(0, roundMetric(next)));
}

function maxFiniteCount(current: number | undefined, next: number): number {
  const currentSafe = Number.isFinite(current) ? Number(current) : 0;
  return Math.max(currentSafe, Math.max(0, Math.trunc(next)));
}

function percentile(
  samples: readonly number[],
  percentileRank: number
): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileRank * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

function emptyWindowCounters(): WindowCounterSet {
  return {
    packetsDropped: 0,
    packetsDroppedPendingDecrypt: 0,
    packetsDroppedStaleWorkerDecrypt: 0,
    packetsDroppedStartupGate: 0,
    packetsDroppedDecodeFailure: 0,
    packetsDroppedDecoderThrow: 0,
    packetsDroppedStaleTimestamp: 0,
    packetsDroppedUnknownSource: 0,
    jitterUnderruns: 0,
    missingFrames: 0,
    concealmentTicks: 0,
    reticulumAudioQueuePressureDrops: 0,
    reticulumAudioStaleDrops: 0,
    reticulumAudioLinkUnreadyDrops: 0,
    reticulumAudioPacketSendFailures: 0,
    reticulumAudioPacketPathRequests: 0,
    reticulumAudioPacketPathResolutions: 0,
    reticulumAudioPacketPathTimeouts: 0,
    reticulumAudioPacketFreshSends: 0,
    reticulumAudioPacketStaleSends: 0,
    reticulumAudioPacketUnknownSends: 0,
    reticulumAudioDeadlineDropCount: 0,
    reticulumAudioDecodedQueueEvictOldestCount: 0,
    reticulumAudioDecodedQueueDropNewestCount: 0,
    reticulumAudioFd3DecodedAgeMsMax: 0,
    reticulumAudioDecodedQueueDwellMsMax: 0,
    reticulumAudioRnsSendDurationMsMax: 0,
    reticulumAudioPacketPathCheckMsMax: 0,
    reticulumAudioExecutorLoopGapMsMax: 0,
    reticulumAudioExecutorGapWhileQueuedMsMax: 0,
    reticulumAudioExecutorAudioPassMsMax: 0,
    reticulumAudioProcessBatchMsMax: 0,
    reticulumAudioProcessBatchFramesMax: 0,
    reticulumAudioRnsSendSlowCount: 0,
    reticulumAudioExecutorStallCount: 0,
    reticulumAudioExecutorCommandMsMax: 0,
    reticulumAudioExecutorCommandWhileQueuedMsMax: 0,
    reticulumAudioExecutorCommandSlowCount: 0,
    reticulumAudioRnsCallbackSchedulerGapMsMax: 0,
    reticulumAudioRnsCallbackSchedulerGapOver100Count: 0,
    reticulumAudioRnsCallbackSchedulerGapOver250Count: 0,
    reticulumAudioRnsCallbackSchedulerGapOver500Count: 0,
    reticulumAudioRnsCallbackSchedulerGapOver1000Count: 0,
    reticulumAudioOutboundLinkSamples: 0,
    reticulumAudioOutboundPacketSamples: 0,
    reticulumAudioInboundLinkSamples: 0,
    reticulumAudioInboundPacketSamples: 0,
  };
}

export class GroupCallPerformanceTracker {
  private snapshot: GroupCallMetricsSnapshot = {
    role: 'participant',
    packetsReceived: 0,
    packetsForwarded: 0,
    packetsDecoded: 0,
    packetsDropped: 0,
    packetsDroppedPendingDecrypt: 0,
    packetsDroppedStaleWorkerDecrypt: 0,
    packetsDroppedStartupGate: 0,
    packetsDroppedDecodeFailure: 0,
    packetsDroppedDecoderThrow: 0,
    packetsDroppedStaleTimestamp: 0,
    packetsDroppedUnknownSource: 0,
    relayPacketsSent: 0,
    relayPacketsReceived: 0,
    lastRelayActivityAtMs: 0,
    jitterUnderruns: 0,
    missingFrames: 0,
    concealmentTicks: 0,
    decoderCount: 0,
    playbackNodeCount: 0,
    jitterBufferCount: 0,
    avgIncomingPacketMs: 0,
    maxIncomingPacketMs: 0,
    avgJitterTickMs: 0,
    maxJitterTickMs: 0,
    avgPcmBufferedMs: 0,
    playoutOutsideTargetFraction: 0,
    playoutUnderTargetFraction: 0,
    playoutOverTargetFraction: 0,
    avgPlayoutDeltaMs: 0,
    avgPlayoutRate: 1,
    playoutRateFractionBelow1: 0,
    playoutRateFractionBelow097: 0,
    avgReceiverIngressToPlayoutPostMs: 0,
    maxReceiverIngressToPlayoutPostMs: 0,
    avgReticulumAudioBridgeToRendererIngressMs: 0,
    maxReticulumAudioBridgeToRendererIngressMs: 0,
    avgGcallSenderWorkletToMainThreadMs: 0,
    maxGcallSenderWorkletToMainThreadMs: 0,
    avgGcallSenderMainThreadToEncoderOutputMs: 0,
    maxGcallSenderMainThreadToEncoderOutputMs: 0,
    avgGcallSenderWorkletToEncoderOutputMs: 0,
    maxGcallSenderWorkletToEncoderOutputMs: 0,
    avgGcallSenderEncoderOutputToPacketTimestampMs: 0,
    maxGcallSenderEncoderOutputToPacketTimestampMs: 0,
    jitterBufferDepthFramesMean: 0,
    jitterBufferDepthFramesWorst: 0,
    jitterNotReadyFraction: 0,
    jitterRawEmptyFraction: 0,
    lastUpdatedAt: 0,
    relayDwellMs: 0,
    relayDwellFraction: 0,
    adaptiveNetworkMode: 'low-latency',
    playoutStarvationWorstSeverity: 'none',
    relayThrottleDrops: 0,
    relayCoalesceSuperseded: 0,
    relayIpcFailures: 0,
    reticulumAudioPendingFrames: 0,
    reticulumAudioPendingOldestAgeMs: 0,
    reticulumAudioPendingFramesHighWater: 0,
    reticulumAudioPendingOldestAgeMaxMs: 0,
    reticulumAudioBridgeQueuedFrames: 0,
    reticulumAudioBridgeQueuedOldestAgeMs: 0,
    reticulumAudioBridgeQueuedFramesHighWater: 0,
    reticulumAudioBridgeQueuedOldestAgeMaxMs: 0,
    reticulumAudioDecodedQueueDepth: 0,
    reticulumAudioDecodedQueueOldestAgeMs: 0,
    reticulumAudioDecodedQueueDepthHighWater: 0,
    reticulumAudioDecodedQueueOldestAgeMaxMs: 0,
    reticulumAudioBinaryOutQueueDepth: 0,
    reticulumAudioBinaryOutQueueOldestAgeMs: 0,
    reticulumAudioBinaryOutQueueDepthHighWater: 0,
    reticulumAudioBinaryOutQueueOldestAgeMaxMs: 0,
    reticulumAudioBridgeWaitingForDrain: false,
    reticulumAudioQueuePressureDrops: 0,
    reticulumAudioQueuePressureDropsLast5s: 0,
    reticulumAudioStaleDrops: 0,
    reticulumAudioStaleDropsLast5s: 0,
    reticulumAudioLinkUnreadyDrops: 0,
    reticulumAudioPacketSendFailures: 0,
    reticulumAudioPacketPathRequests: 0,
    reticulumAudioPacketPathResolutions: 0,
    reticulumAudioPacketPathTimeouts: 0,
    reticulumAudioPacketFreshSends: 0,
    reticulumAudioPacketStaleSends: 0,
    reticulumAudioPacketUnknownSends: 0,
    reticulumAudioDeadlineDropCount: 0,
    reticulumAudioDecodedQueueEvictOldestCount: 0,
    reticulumAudioDecodedQueueDropNewestCount: 0,
    reticulumAudioFd3DecodedAgeMsMax: 0,
    reticulumAudioDecodedQueueDwellMsMax: 0,
    reticulumAudioRnsSendDurationMsMax: 0,
    reticulumAudioPacketPathCheckMsMax: 0,
    reticulumAudioExecutorLoopGapMsMax: 0,
    reticulumAudioExecutorGapWhileQueuedMsMax: 0,
    reticulumAudioExecutorAudioPassMsMax: 0,
    reticulumAudioProcessBatchMsMax: 0,
    reticulumAudioProcessBatchFramesMax: 0,
    reticulumAudioRnsSendSlowCount: 0,
    reticulumAudioExecutorStallCount: 0,
    reticulumAudioExecutorCommandMsMax: 0,
    reticulumAudioExecutorCommandWhileQueuedMsMax: 0,
    reticulumAudioExecutorCommandSlowCount: 0,
    reticulumAudioRnsCallbackSchedulerGapMsMax: 0,
    reticulumAudioRnsCallbackSchedulerGapOver100Count: 0,
    reticulumAudioRnsCallbackSchedulerGapOver250Count: 0,
    reticulumAudioRnsCallbackSchedulerGapOver500Count: 0,
    reticulumAudioRnsCallbackSchedulerGapOver1000Count: 0,
    reticulumAudioOutboundLinkSamples: 0,
    reticulumAudioOutboundPacketSamples: 0,
    reticulumAudioOutboundTransportLast: null,
    reticulumAudioInboundLinkSamples: 0,
    reticulumAudioInboundPacketSamples: 0,
    reticulumAudioInboundTransportLast: null,
    mixerActiveSpeakerEstimate: 0,
    mixerMasterGain: 1,
    mixerCurrentReductionDb: 0,
    mixerAvgReductionDb: 0,
    mixerOverloadEvents: 0,
    mixerHeavyReductionFraction: 0,
    wasmFecPlcFrames: 0,
    wasmFecAttempts: 0,
    wasmFecSuccessCoarse: 0,
    wasmFecDeferredPcmTicks: 0,
    clusterFailoverPromotionCount: 0,
    rootFailoverPromotionCount: 0,
    clusterForwarderDemotionCount: 0,
    pendingDecryptDepth: 0,
    pendingDecryptDepthHighWater: 0,
    gcallAudioBurstWindowCumulativeMs: 0,
    gcallAudioOverloadCumulativeMs: 0,
    gcallAudioIngressPacingCumulativeMs: 0,
    gcallAudioStage5BoostCumulativeMs: 0,
    gcallAudioFailSafeCumulativeMs: 0,
    gcallAudioBurstWindowLastStintMs: 0,
    gcallAudioOverloadLastStintMs: 0,
    gcallAudioIngressPacingLastStintMs: 0,
    gcallAudioStage5BoostLastStintMs: 0,
    gcallAudioFailSafeLastStintMs: 0,
    gcallAudioBurstWindowEntries: 0,
    gcallAudioOverloadEntries: 0,
    gcallAudioIngressPacingEntries: 0,
    gcallAudioStage5BoostEntries: 0,
    gcallAudioFailSafeEntries: 0,
  };

  private gcallStageBurstStintStart: number | null = null;
  private gcallStageOverloadStintStart: number | null = null;
  private gcallStageIngressStintStart: number | null = null;
  private gcallStage5StintStart: number | null = null;
  private gcallStageFailSafeStintStart: number | null = null;

  private incomingPacketSamples = 0;
  private incomingPacketTotalMs = 0;
  private jitterTickSamples = 0;
  private jitterTickTotalMs = 0;

  private jitterDrainTicksSession = 0;
  private jitterDepthMeanTickSumSession = 0;
  private jitterDepthWorstTickMaxSession = 0;
  private jitterNotReadySlotsSession = 0;
  private jitterSlotSamplesSession = 0;
  private jitterRawEmptySlotsSession = 0;

  private windowJitterDrainTicks = 0;
  private windowJitterDepthMeanTickSum = 0;
  private windowJitterDepthWorstMax = 0;
  private windowJitterNotReadySlots = 0;
  private windowJitterSlotSamples = 0;
  private windowJitterRawEmptySlots = 0;

  private playoutMetricTicks = 0;
  private playoutOutsideTicks = 0;
  private playoutUnderTicks = 0;
  private playoutOverTicks = 0;
  private playoutDeltaMsSum = 0;
  private playoutDeltaMsSamples = 0;
  private playoutBufferedMsSum = 0;
  private playoutBufferedMsSamples = 0;
  private mixerReductionSamples = 0;
  private mixerReductionTotalDb = 0;
  private mixerHeavyReductionSamples = 0;
  private mixerOverloaded = false;
  private sessionStartedAtMs = Date.now();
  private transportMode: GroupCallTransportMode = 'connecting';
  private transportModeSinceMs = Date.now();
  private relayDwellAccumulatedMs = 0;
  private windowStartedAtMs = Date.now();
  private windowTransportMode: GroupCallTransportMode = 'connecting';
  private windowTransportModeSinceMs = Date.now();
  private windowRelayDwellAccumulatedMs = 0;
  private windowCounters: WindowCounterSet = emptyWindowCounters();
  private windowPlayoutMetricTicks = 0;
  private windowPlayoutOutsideTicks = 0;
  private windowPlayoutUnderTicks = 0;
  private windowPlayoutOverTicks = 0;
  private windowPlayoutDeltaMsSum = 0;
  private windowPlayoutDeltaMsSamples = 0;
  private windowPlayoutBufferedMsSum = 0;
  private windowPlayoutBufferedMsSamples = 0;
  private playoutRateSum = 0;
  private playoutRateSamples = 0;
  private playoutRateTicksBelow1 = 0;
  private playoutRateTicksBelow097 = 0;
  private playoutPostLatencyMsSum = 0;
  private playoutPostLatencyMsSamples = 0;
  private playoutPostLatencyMsMax = 0;
  private bridgeToRendererIngressLatencyMsSum = 0;
  private bridgeToRendererIngressLatencyMsSamples = 0;
  private bridgeToRendererIngressLatencyMsMax = 0;

  private senderWorkletToMainThreadMsSum = 0;
  private senderWorkletToMainThreadMsSamples = 0;
  private senderWorkletToMainThreadMsMax = 0;
  private senderMainToEncoderOutputMsSum = 0;
  private senderMainToEncoderOutputMsSamples = 0;
  private senderMainToEncoderOutputMsMax = 0;
  private senderWorkletToEncoderOutputMsSum = 0;
  private senderWorkletToEncoderOutputMsSamples = 0;
  private senderWorkletToEncoderOutputMsMax = 0;
  private senderEncoderToPacketTimestampMsSum = 0;
  private senderEncoderToPacketTimestampMsSamples = 0;
  private senderEncoderToPacketTimestampMsMax = 0;

  private windowSenderWorkletToMainThreadMsSum = 0;
  private windowSenderWorkletToMainThreadMsSamples = 0;
  private windowSenderWorkletToMainThreadMsMax = 0;
  private windowSenderMainToEncoderOutputMsSum = 0;
  private windowSenderMainToEncoderOutputMsSamples = 0;
  private windowSenderMainToEncoderOutputMsMax = 0;
  private windowSenderWorkletToEncoderOutputMsSum = 0;
  private windowSenderWorkletToEncoderOutputMsSamples = 0;
  private windowSenderWorkletToEncoderOutputMsMax = 0;
  private windowSenderEncoderToPacketTimestampMsSum = 0;
  private windowSenderEncoderToPacketTimestampMsSamples = 0;
  private windowSenderEncoderToPacketTimestampMsMax = 0;

  private windowPlayoutRateSum = 0;
  private windowPlayoutRateSamples = 0;
  private windowPlayoutRateTicksBelow1 = 0;
  private windowPlayoutRateTicksBelow097 = 0;
  private windowPlayoutPostLatencyMsSum = 0;
  private windowPlayoutPostLatencyMsSamples = 0;
  private windowPlayoutPostLatencyMsMax = 0;
  private windowBridgeToRendererIngressLatencyMsSum = 0;
  private windowBridgeToRendererIngressLatencyMsSamples = 0;
  private windowBridgeToRendererIngressLatencyMsMax = 0;
  private windowOpusBufferedMsSum = 0;
  private windowOpusBufferedMsSamples = 0;
  private windowOpusBufferedMsMax = 0;
  private windowReticulumAudioPendingFramesHighWater = 0;
  private windowReticulumAudioPendingOldestAgeMaxMs = 0;
  private windowReticulumAudioBridgeQueuedFramesHighWater = 0;
  private windowReticulumAudioBridgeQueuedOldestAgeMaxMs = 0;
  private windowReticulumAudioDecodedQueueDepthHighWater = 0;
  private windowReticulumAudioDecodedQueueOldestAgeMaxMs = 0;
  private windowReticulumAudioBinaryOutQueueDepthHighWater = 0;
  private windowReticulumAudioBinaryOutQueueOldestAgeMaxMs = 0;
  private windowPendingDecryptDepthHighWater = 0;
  private sourceWindowStats = new Map<string, SourceWindowAccumulator>();

  private getSourceWindowAccumulator(
    sourceAddr: string
  ): SourceWindowAccumulator {
    let current = this.sourceWindowStats.get(sourceAddr);
    if (!current) {
      current = {
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        playoutTicks: 0,
        playoutOutsideTicks: 0,
        playoutUnderTicks: 0,
        playoutOverTicks: 0,
        playoutDeltaMsSum: 0,
        playoutDeltaMsSamples: 0,
        playoutBufferedMsSum: 0,
        playoutBufferedMsSamples: 0,
        playoutPostLatencyMsSum: 0,
        playoutPostLatencyMsSamples: 0,
        playoutPostLatencyMsMax: 0,
        opusBufferedMsSum: 0,
        opusBufferedMsSamples: 0,
        opusBufferedMsMax: 0,
        adaptiveTargetSamples: [],
        wasmFecPlcFrames: 0,
        wasmFecAttempts: 0,
        wasmFecSuccessCoarse: 0,
        wasmFecDeferredPcmTicks: 0,
      };
      this.sourceWindowStats.set(sourceAddr, current);
    }
    return current;
  }

  private resetWindow(now = Date.now()): void {
    this.windowStartedAtMs = now;
    this.windowTransportMode = this.transportMode;
    this.windowTransportModeSinceMs = now;
    this.windowRelayDwellAccumulatedMs = 0;
    this.windowCounters = emptyWindowCounters();
    this.windowPlayoutMetricTicks = 0;
    this.windowPlayoutOutsideTicks = 0;
    this.windowPlayoutUnderTicks = 0;
    this.windowPlayoutOverTicks = 0;
    this.windowPlayoutDeltaMsSum = 0;
    this.windowPlayoutDeltaMsSamples = 0;
    this.windowPlayoutBufferedMsSum = 0;
    this.windowPlayoutBufferedMsSamples = 0;
    this.windowPlayoutRateSum = 0;
    this.windowPlayoutRateSamples = 0;
    this.windowPlayoutRateTicksBelow1 = 0;
    this.windowPlayoutRateTicksBelow097 = 0;
    this.windowPlayoutPostLatencyMsSum = 0;
    this.windowPlayoutPostLatencyMsSamples = 0;
    this.windowPlayoutPostLatencyMsMax = 0;
    this.windowBridgeToRendererIngressLatencyMsSum = 0;
    this.windowBridgeToRendererIngressLatencyMsSamples = 0;
    this.windowBridgeToRendererIngressLatencyMsMax = 0;
    this.windowSenderWorkletToMainThreadMsSum = 0;
    this.windowSenderWorkletToMainThreadMsSamples = 0;
    this.windowSenderWorkletToMainThreadMsMax = 0;
    this.windowSenderMainToEncoderOutputMsSum = 0;
    this.windowSenderMainToEncoderOutputMsSamples = 0;
    this.windowSenderMainToEncoderOutputMsMax = 0;
    this.windowSenderWorkletToEncoderOutputMsSum = 0;
    this.windowSenderWorkletToEncoderOutputMsSamples = 0;
    this.windowSenderWorkletToEncoderOutputMsMax = 0;
    this.windowSenderEncoderToPacketTimestampMsSum = 0;
    this.windowSenderEncoderToPacketTimestampMsSamples = 0;
    this.windowSenderEncoderToPacketTimestampMsMax = 0;
    this.windowOpusBufferedMsSum = 0;
    this.windowOpusBufferedMsSamples = 0;
    this.windowOpusBufferedMsMax = 0;
    this.windowReticulumAudioPendingFramesHighWater = 0;
    this.windowReticulumAudioPendingOldestAgeMaxMs = 0;
    this.windowReticulumAudioBridgeQueuedFramesHighWater = 0;
    this.windowReticulumAudioBridgeQueuedOldestAgeMaxMs = 0;
    this.windowReticulumAudioDecodedQueueDepthHighWater = 0;
    this.windowReticulumAudioDecodedQueueOldestAgeMaxMs = 0;
    this.windowReticulumAudioBinaryOutQueueDepthHighWater = 0;
    this.windowReticulumAudioBinaryOutQueueOldestAgeMaxMs = 0;
    this.windowPendingDecryptDepthHighWater = 0;
    this.windowJitterDrainTicks = 0;
    this.windowJitterDepthMeanTickSum = 0;
    this.windowJitterDepthWorstMax = 0;
    this.windowJitterNotReadySlots = 0;
    this.windowJitterSlotSamples = 0;
    this.windowJitterRawEmptySlots = 0;
    this.sourceWindowStats.clear();
  }

  setRole(role: RouterRole): void {
    this.snapshot.role = role;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordPacketReceived(): void {
    this.snapshot.packetsReceived++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordPacketForwarded(count = 1): void {
    this.snapshot.packetsForwarded += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordPacketDecoded(count = 1): void {
    this.snapshot.packetsDecoded += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordPacketDropped(count = 1): void {
    this.snapshot.packetsDropped += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordPacketDroppedWithReason(
    reason: GroupCallPacketDropReason,
    count = 1
  ): void {
    if (count <= 0) return;
    this.snapshot.packetsDropped += count;
    this.windowCounters.packetsDropped += count;
    switch (reason) {
      case 'pending-decrypt':
        this.snapshot.packetsDroppedPendingDecrypt += count;
        this.windowCounters.packetsDroppedPendingDecrypt += count;
        break;
      case 'startup-gate':
        this.snapshot.packetsDroppedStartupGate += count;
        this.windowCounters.packetsDroppedStartupGate += count;
        break;
      case 'decode-failure':
        this.snapshot.packetsDroppedDecodeFailure += count;
        this.windowCounters.packetsDroppedDecodeFailure += count;
        break;
      case 'decoder-throw':
        this.snapshot.packetsDroppedDecoderThrow += count;
        this.windowCounters.packetsDroppedDecoderThrow += count;
        break;
      case 'stale-timestamp':
        this.snapshot.packetsDroppedStaleTimestamp += count;
        this.windowCounters.packetsDroppedStaleTimestamp += count;
        break;
      case 'unknown-source':
        this.snapshot.packetsDroppedUnknownSource += count;
        this.windowCounters.packetsDroppedUnknownSource += count;
        break;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /** Track decrypt-worker backlog depth (call after enqueue/dequeue/sweep). */
  recordPendingDecryptDepth(depth: number): void {
    const d = Math.max(0, Math.trunc(depth));
    this.snapshot.pendingDecryptDepth = d;
    this.snapshot.pendingDecryptDepthHighWater = Math.max(
      this.snapshot.pendingDecryptDepthHighWater,
      d
    );
    this.windowPendingDecryptDepthHighWater = Math.max(
      this.windowPendingDecryptDepthHighWater,
      d
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /**
   * Time-in-stage metrics (cumulative session ms, last completed stint, entry counts).
   * Call on a fixed cadence (e.g. Opus send-pressure tick) with wall-clock delta.
   */
  tickGcallAudioStageMetrics(
    deltaMs: number,
    active: {
      burstWindow: boolean;
      overload: boolean;
      ingressPacing: boolean;
      stage5Boost: boolean;
      failSafe: boolean;
    }
  ): void {
    const d = Math.max(0, deltaMs);
    const now = Date.now();

    if (active.burstWindow) {
      if (this.gcallStageBurstStintStart === null) {
        this.gcallStageBurstStintStart = now;
        this.snapshot.gcallAudioBurstWindowEntries++;
      }
      this.snapshot.gcallAudioBurstWindowCumulativeMs += d;
    } else if (this.gcallStageBurstStintStart !== null) {
      this.snapshot.gcallAudioBurstWindowLastStintMs =
        now - this.gcallStageBurstStintStart;
      this.gcallStageBurstStintStart = null;
    }

    if (active.overload) {
      if (this.gcallStageOverloadStintStart === null) {
        this.gcallStageOverloadStintStart = now;
        this.snapshot.gcallAudioOverloadEntries++;
      }
      this.snapshot.gcallAudioOverloadCumulativeMs += d;
    } else if (this.gcallStageOverloadStintStart !== null) {
      this.snapshot.gcallAudioOverloadLastStintMs =
        now - this.gcallStageOverloadStintStart;
      this.gcallStageOverloadStintStart = null;
    }

    if (active.ingressPacing) {
      if (this.gcallStageIngressStintStart === null) {
        this.gcallStageIngressStintStart = now;
        this.snapshot.gcallAudioIngressPacingEntries++;
      }
      this.snapshot.gcallAudioIngressPacingCumulativeMs += d;
    } else if (this.gcallStageIngressStintStart !== null) {
      this.snapshot.gcallAudioIngressPacingLastStintMs =
        now - this.gcallStageIngressStintStart;
      this.gcallStageIngressStintStart = null;
    }

    if (active.stage5Boost) {
      if (this.gcallStage5StintStart === null) {
        this.gcallStage5StintStart = now;
        this.snapshot.gcallAudioStage5BoostEntries++;
      }
      this.snapshot.gcallAudioStage5BoostCumulativeMs += d;
    } else if (this.gcallStage5StintStart !== null) {
      this.snapshot.gcallAudioStage5BoostLastStintMs =
        now - this.gcallStage5StintStart;
      this.gcallStage5StintStart = null;
    }

    if (active.failSafe) {
      if (this.gcallStageFailSafeStintStart === null) {
        this.gcallStageFailSafeStintStart = now;
        this.snapshot.gcallAudioFailSafeEntries++;
      }
      this.snapshot.gcallAudioFailSafeCumulativeMs += d;
    } else if (this.gcallStageFailSafeStintStart !== null) {
      this.snapshot.gcallAudioFailSafeLastStintMs =
        now - this.gcallStageFailSafeStintStart;
      this.gcallStageFailSafeStintStart = null;
    }

    this.snapshot.lastUpdatedAt = Date.now();
  }

  /** Worker returned after key version changed; pending decrypt job was discarded. */

  recordStaleWorkerDecryptDrop(count = 1): void {
    if (count <= 0) return;
    this.snapshot.packetsDropped += count;
    this.windowCounters.packetsDropped += count;
    this.snapshot.packetsDroppedStaleWorkerDecrypt += count;
    this.windowCounters.packetsDroppedStaleWorkerDecrypt += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRelaySent(count = 1): void {
    this.snapshot.relayPacketsSent += count;
    this.snapshot.lastRelayActivityAtMs = Date.now();
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRelayReceived(count = 1): void {
    this.snapshot.relayPacketsReceived += count;
    this.snapshot.lastRelayActivityAtMs = Date.now();
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordClusterFailoverPromotion(count = 1): void {
    this.snapshot.clusterFailoverPromotionCount += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRootFailoverPromotion(count = 1): void {
    this.snapshot.rootFailoverPromotionCount += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordClusterForwarderDemotion(count = 1): void {
    this.snapshot.clusterForwarderDemotionCount += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRelayThrottleDrop(count = 1): void {
    this.snapshot.relayThrottleDrops += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRelayCoalesceSuperseded(count = 1): void {
    this.snapshot.relayCoalesceSuperseded += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRelayIpcFailure(count = 1): void {
    this.snapshot.relayIpcFailures += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReticulumAudioQueuePressureDrop(count = 1): void {
    if (count <= 0) return;
    this.snapshot.reticulumAudioQueuePressureDrops += count;
    this.windowCounters.reticulumAudioQueuePressureDrops += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReticulumAudioStaleDrop(count = 1): void {
    if (count <= 0) return;
    this.snapshot.reticulumAudioStaleDrops += count;
    this.windowCounters.reticulumAudioStaleDrops += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReticulumAudioLinkUnreadyDrop(count = 1): void {
    if (count <= 0) return;
    this.snapshot.reticulumAudioLinkUnreadyDrops += count;
    this.windowCounters.reticulumAudioLinkUnreadyDrops += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReticulumAudioPacketSendFailure(count = 1): void {
    if (count <= 0) return;
    this.snapshot.reticulumAudioPacketSendFailures += count;
    this.windowCounters.reticulumAudioPacketSendFailures += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /**
   * From main-process `sendAudio` / `sendAudioBatch` diagnostics' `transport` field
   * (outbound group audio: `link` vs `packet`).
   */
  recordReticulumAudioOutboundTransport(transport: 'link' | 'packet'): void {
    this.snapshot.reticulumAudioOutboundTransportLast = transport;
    if (transport === 'link') {
      this.snapshot.reticulumAudioOutboundLinkSamples++;
      this.windowCounters.reticulumAudioOutboundLinkSamples++;
    } else {
      this.snapshot.reticulumAudioOutboundPacketSamples++;
      this.windowCounters.reticulumAudioOutboundPacketSamples++;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /**
   * From main-process `gcall:audio` diagnostics' `transport` field
   * (inbound group audio: `link` vs `packet`).
   */
  recordReticulumAudioInboundTransport(transport: 'link' | 'packet'): void {
    this.snapshot.reticulumAudioInboundTransportLast = transport;
    if (transport === 'link') {
      this.snapshot.reticulumAudioInboundLinkSamples++;
      this.windowCounters.reticulumAudioInboundLinkSamples++;
    } else {
      this.snapshot.reticulumAudioInboundPacketSamples++;
      this.windowCounters.reticulumAudioInboundPacketSamples++;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReticulumAudioPacketPathActivity(activity: {
    requests?: number;
    resolutions?: number;
    timeouts?: number;
    freshSends?: number;
    staleSends?: number;
    unknownSends?: number;
  }): void {
    const requests = Math.max(0, Math.trunc(activity.requests ?? 0));
    const resolutions = Math.max(0, Math.trunc(activity.resolutions ?? 0));
    const timeouts = Math.max(0, Math.trunc(activity.timeouts ?? 0));
    const freshSends = Math.max(0, Math.trunc(activity.freshSends ?? 0));
    const staleSends = Math.max(0, Math.trunc(activity.staleSends ?? 0));
    const unknownSends = Math.max(0, Math.trunc(activity.unknownSends ?? 0));
    if (
      requests === 0 &&
      resolutions === 0 &&
      timeouts === 0 &&
      freshSends === 0 &&
      staleSends === 0 &&
      unknownSends === 0
    ) {
      return;
    }
    this.snapshot.reticulumAudioPacketPathRequests += requests;
    this.snapshot.reticulumAudioPacketPathResolutions += resolutions;
    this.snapshot.reticulumAudioPacketPathTimeouts += timeouts;
    this.snapshot.reticulumAudioPacketFreshSends += freshSends;
    this.snapshot.reticulumAudioPacketStaleSends += staleSends;
    this.snapshot.reticulumAudioPacketUnknownSends += unknownSends;
    this.windowCounters.reticulumAudioPacketPathRequests += requests;
    this.windowCounters.reticulumAudioPacketPathResolutions += resolutions;
    this.windowCounters.reticulumAudioPacketPathTimeouts += timeouts;
    this.windowCounters.reticulumAudioPacketFreshSends += freshSends;
    this.windowCounters.reticulumAudioPacketStaleSends += staleSends;
    this.windowCounters.reticulumAudioPacketUnknownSends += unknownSends;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  setReticulumAudioQueueDepths(depths: {
    pendingFrames?: number;
    pendingOldestAgeMs?: number;
    bridgeQueuedFrames?: number;
    bridgeQueuedOldestAgeMs?: number;
    bridgeWaitingForDrain?: boolean;
    decodedQueueDepth?: number;
    decodedQueueOldestAgeMs?: number;
    binaryOutQueueDepth?: number;
    binaryOutQueueOldestAgeMs?: number;
    queuePressureDropsLast5s?: number;
    staleDropsLast5s?: number;
    packetPathRequests?: number;
    packetPathResolutions?: number;
    packetPathTimeouts?: number;
    packetFreshSends?: number;
    packetStaleSends?: number;
    packetUnknownSends?: number;
    deadlineDropCount?: number;
    decodedQueueEvictOldestCount?: number;
    decodedQueueDropNewestCount?: number;
    fd3DecodedAgeMsMax?: number;
    decodedQueueDwellMsMax?: number;
    rnsSendDurationMsMax?: number;
    packetPathCheckMsMax?: number;
    executorLoopGapMsMax?: number;
    executorGapWhileQueuedMsMax?: number;
    executorAudioPassMsMax?: number;
    processBatchMsMax?: number;
    processBatchFramesMax?: number;
    rnsSendSlowCount?: number;
    executorStallCount?: number;
    executorCommandMsMax?: number;
    executorCommandWhileQueuedMsMax?: number;
    executorCommandSlowCount?: number;
    rnsCallbackSchedulerGapMsMax?: number;
    rnsCallbackSchedulerGapOver100Count?: number;
    rnsCallbackSchedulerGapOver250Count?: number;
    rnsCallbackSchedulerGapOver500Count?: number;
    rnsCallbackSchedulerGapOver1000Count?: number;
  }): void {
    if (typeof depths.pendingFrames === 'number') {
      const pendingFrames = Math.max(0, Math.trunc(depths.pendingFrames));
      this.snapshot.reticulumAudioPendingFrames = pendingFrames;
      this.snapshot.reticulumAudioPendingFramesHighWater = Math.max(
        this.snapshot.reticulumAudioPendingFramesHighWater,
        pendingFrames
      );
      this.windowReticulumAudioPendingFramesHighWater = Math.max(
        this.windowReticulumAudioPendingFramesHighWater,
        pendingFrames
      );
    }
    if (typeof depths.pendingOldestAgeMs === 'number') {
      const pendingOldestAgeMs = Math.max(
        0,
        roundMetric(depths.pendingOldestAgeMs)
      );
      this.snapshot.reticulumAudioPendingOldestAgeMs = pendingOldestAgeMs;
      this.snapshot.reticulumAudioPendingOldestAgeMaxMs = Math.max(
        this.snapshot.reticulumAudioPendingOldestAgeMaxMs,
        pendingOldestAgeMs
      );
      this.windowReticulumAudioPendingOldestAgeMaxMs = Math.max(
        this.windowReticulumAudioPendingOldestAgeMaxMs,
        pendingOldestAgeMs
      );
    }
    if (typeof depths.bridgeQueuedFrames === 'number') {
      const bridgeQueuedFrames = Math.max(
        0,
        Math.trunc(depths.bridgeQueuedFrames)
      );
      this.snapshot.reticulumAudioBridgeQueuedFrames = bridgeQueuedFrames;
      this.snapshot.reticulumAudioBridgeQueuedFramesHighWater = Math.max(
        this.snapshot.reticulumAudioBridgeQueuedFramesHighWater,
        bridgeQueuedFrames
      );
      this.windowReticulumAudioBridgeQueuedFramesHighWater = Math.max(
        this.windowReticulumAudioBridgeQueuedFramesHighWater,
        bridgeQueuedFrames
      );
    }
    if (typeof depths.bridgeQueuedOldestAgeMs === 'number') {
      const bridgeQueuedOldestAgeMs = Math.max(
        0,
        roundMetric(depths.bridgeQueuedOldestAgeMs)
      );
      this.snapshot.reticulumAudioBridgeQueuedOldestAgeMs =
        bridgeQueuedOldestAgeMs;
      this.snapshot.reticulumAudioBridgeQueuedOldestAgeMaxMs = Math.max(
        this.snapshot.reticulumAudioBridgeQueuedOldestAgeMaxMs,
        bridgeQueuedOldestAgeMs
      );
      this.windowReticulumAudioBridgeQueuedOldestAgeMaxMs = Math.max(
        this.windowReticulumAudioBridgeQueuedOldestAgeMaxMs,
        bridgeQueuedOldestAgeMs
      );
    }
    if (typeof depths.bridgeWaitingForDrain === 'boolean') {
      this.snapshot.reticulumAudioBridgeWaitingForDrain =
        depths.bridgeWaitingForDrain;
    }
    if (typeof depths.decodedQueueDepth === 'number') {
      const decodedQueueDepth = Math.max(
        0,
        Math.trunc(depths.decodedQueueDepth)
      );
      this.snapshot.reticulumAudioDecodedQueueDepth = decodedQueueDepth;
      this.snapshot.reticulumAudioDecodedQueueDepthHighWater = Math.max(
        this.snapshot.reticulumAudioDecodedQueueDepthHighWater,
        decodedQueueDepth
      );
      this.windowReticulumAudioDecodedQueueDepthHighWater = Math.max(
        this.windowReticulumAudioDecodedQueueDepthHighWater,
        decodedQueueDepth
      );
    }
    if (typeof depths.decodedQueueOldestAgeMs === 'number') {
      const decodedQueueOldestAgeMs = Math.max(
        0,
        roundMetric(depths.decodedQueueOldestAgeMs)
      );
      this.snapshot.reticulumAudioDecodedQueueOldestAgeMs =
        decodedQueueOldestAgeMs;
      this.snapshot.reticulumAudioDecodedQueueOldestAgeMaxMs = Math.max(
        this.snapshot.reticulumAudioDecodedQueueOldestAgeMaxMs,
        decodedQueueOldestAgeMs
      );
      this.windowReticulumAudioDecodedQueueOldestAgeMaxMs = Math.max(
        this.windowReticulumAudioDecodedQueueOldestAgeMaxMs,
        decodedQueueOldestAgeMs
      );
    }
    if (typeof depths.binaryOutQueueDepth === 'number') {
      const binaryOutQueueDepth = Math.max(
        0,
        Math.trunc(depths.binaryOutQueueDepth)
      );
      this.snapshot.reticulumAudioBinaryOutQueueDepth = binaryOutQueueDepth;
      this.snapshot.reticulumAudioBinaryOutQueueDepthHighWater = Math.max(
        this.snapshot.reticulumAudioBinaryOutQueueDepthHighWater,
        binaryOutQueueDepth
      );
      this.windowReticulumAudioBinaryOutQueueDepthHighWater = Math.max(
        this.windowReticulumAudioBinaryOutQueueDepthHighWater,
        binaryOutQueueDepth
      );
    }
    if (typeof depths.binaryOutQueueOldestAgeMs === 'number') {
      const binaryOutQueueOldestAgeMs = Math.max(
        0,
        roundMetric(depths.binaryOutQueueOldestAgeMs)
      );
      this.snapshot.reticulumAudioBinaryOutQueueOldestAgeMs =
        binaryOutQueueOldestAgeMs;
      this.snapshot.reticulumAudioBinaryOutQueueOldestAgeMaxMs = Math.max(
        this.snapshot.reticulumAudioBinaryOutQueueOldestAgeMaxMs,
        binaryOutQueueOldestAgeMs
      );
      this.windowReticulumAudioBinaryOutQueueOldestAgeMaxMs = Math.max(
        this.windowReticulumAudioBinaryOutQueueOldestAgeMaxMs,
        binaryOutQueueOldestAgeMs
      );
    }
    if (typeof depths.queuePressureDropsLast5s === 'number') {
      this.snapshot.reticulumAudioQueuePressureDropsLast5s = Math.max(
        0,
        Math.trunc(depths.queuePressureDropsLast5s)
      );
    }
    if (typeof depths.staleDropsLast5s === 'number') {
      this.snapshot.reticulumAudioStaleDropsLast5s = Math.max(
        0,
        Math.trunc(depths.staleDropsLast5s)
      );
    }
    if (typeof depths.packetPathRequests === 'number') {
      this.snapshot.reticulumAudioPacketPathRequests = Math.max(
        0,
        Math.trunc(depths.packetPathRequests)
      );
    }
    if (typeof depths.packetPathResolutions === 'number') {
      this.snapshot.reticulumAudioPacketPathResolutions = Math.max(
        0,
        Math.trunc(depths.packetPathResolutions)
      );
    }
    if (typeof depths.packetPathTimeouts === 'number') {
      this.snapshot.reticulumAudioPacketPathTimeouts = Math.max(
        0,
        Math.trunc(depths.packetPathTimeouts)
      );
    }
    if (typeof depths.packetFreshSends === 'number') {
      this.snapshot.reticulumAudioPacketFreshSends = Math.max(
        0,
        Math.trunc(depths.packetFreshSends)
      );
    }
    if (typeof depths.packetStaleSends === 'number') {
      this.snapshot.reticulumAudioPacketStaleSends = Math.max(
        0,
        Math.trunc(depths.packetStaleSends)
      );
    }
    if (typeof depths.packetUnknownSends === 'number') {
      this.snapshot.reticulumAudioPacketUnknownSends = Math.max(
        0,
        Math.trunc(depths.packetUnknownSends)
      );
    }
    if (typeof depths.deadlineDropCount === 'number') {
      this.snapshot.reticulumAudioDeadlineDropCount = Math.max(
        0,
        Math.trunc(depths.deadlineDropCount)
      );
    }
    if (typeof depths.decodedQueueEvictOldestCount === 'number') {
      this.snapshot.reticulumAudioDecodedQueueEvictOldestCount = Math.max(
        0,
        Math.trunc(depths.decodedQueueEvictOldestCount)
      );
    }
    if (typeof depths.decodedQueueDropNewestCount === 'number') {
      this.snapshot.reticulumAudioDecodedQueueDropNewestCount = Math.max(
        0,
        Math.trunc(depths.decodedQueueDropNewestCount)
      );
    }
    if (typeof depths.fd3DecodedAgeMsMax === 'number') {
      this.snapshot.reticulumAudioFd3DecodedAgeMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioFd3DecodedAgeMsMax,
        depths.fd3DecodedAgeMsMax
      );
    }
    if (typeof depths.decodedQueueDwellMsMax === 'number') {
      this.snapshot.reticulumAudioDecodedQueueDwellMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioDecodedQueueDwellMsMax,
        depths.decodedQueueDwellMsMax
      );
    }
    if (typeof depths.rnsSendDurationMsMax === 'number') {
      this.snapshot.reticulumAudioRnsSendDurationMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioRnsSendDurationMsMax,
        depths.rnsSendDurationMsMax
      );
    }
    if (typeof depths.packetPathCheckMsMax === 'number') {
      this.snapshot.reticulumAudioPacketPathCheckMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioPacketPathCheckMsMax,
        depths.packetPathCheckMsMax
      );
    }
    if (typeof depths.executorLoopGapMsMax === 'number') {
      this.snapshot.reticulumAudioExecutorLoopGapMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioExecutorLoopGapMsMax,
        depths.executorLoopGapMsMax
      );
    }
    if (typeof depths.executorGapWhileQueuedMsMax === 'number') {
      this.snapshot.reticulumAudioExecutorGapWhileQueuedMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioExecutorGapWhileQueuedMsMax,
        depths.executorGapWhileQueuedMsMax
      );
    }
    if (typeof depths.executorAudioPassMsMax === 'number') {
      this.snapshot.reticulumAudioExecutorAudioPassMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioExecutorAudioPassMsMax,
        depths.executorAudioPassMsMax
      );
    }
    if (typeof depths.processBatchMsMax === 'number') {
      this.snapshot.reticulumAudioProcessBatchMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioProcessBatchMsMax,
        depths.processBatchMsMax
      );
    }
    if (typeof depths.processBatchFramesMax === 'number') {
      this.snapshot.reticulumAudioProcessBatchFramesMax = maxFiniteCount(
        this.snapshot.reticulumAudioProcessBatchFramesMax,
        depths.processBatchFramesMax
      );
    }
    if (typeof depths.rnsSendSlowCount === 'number') {
      this.snapshot.reticulumAudioRnsSendSlowCount = Math.max(
        0,
        Math.trunc(depths.rnsSendSlowCount)
      );
    }
    if (typeof depths.executorStallCount === 'number') {
      this.snapshot.reticulumAudioExecutorStallCount = Math.max(
        0,
        Math.trunc(depths.executorStallCount)
      );
    }
    if (typeof depths.executorCommandMsMax === 'number') {
      this.snapshot.reticulumAudioExecutorCommandMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioExecutorCommandMsMax,
        depths.executorCommandMsMax
      );
    }
    if (typeof depths.executorCommandWhileQueuedMsMax === 'number') {
      this.snapshot.reticulumAudioExecutorCommandWhileQueuedMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioExecutorCommandWhileQueuedMsMax,
        depths.executorCommandWhileQueuedMsMax
      );
    }
    if (typeof depths.executorCommandSlowCount === 'number') {
      this.snapshot.reticulumAudioExecutorCommandSlowCount = Math.max(
        0,
        Math.trunc(depths.executorCommandSlowCount)
      );
    }
    if (typeof depths.rnsCallbackSchedulerGapMsMax === 'number') {
      this.snapshot.reticulumAudioRnsCallbackSchedulerGapMsMax = maxFiniteMetric(
        this.snapshot.reticulumAudioRnsCallbackSchedulerGapMsMax,
        depths.rnsCallbackSchedulerGapMsMax
      );
    }
    if (typeof depths.rnsCallbackSchedulerGapOver100Count === 'number') {
      this.snapshot.reticulumAudioRnsCallbackSchedulerGapOver100Count = Math.max(
        0,
        Math.trunc(depths.rnsCallbackSchedulerGapOver100Count)
      );
    }
    if (typeof depths.rnsCallbackSchedulerGapOver250Count === 'number') {
      this.snapshot.reticulumAudioRnsCallbackSchedulerGapOver250Count = Math.max(
        0,
        Math.trunc(depths.rnsCallbackSchedulerGapOver250Count)
      );
    }
    if (typeof depths.rnsCallbackSchedulerGapOver500Count === 'number') {
      this.snapshot.reticulumAudioRnsCallbackSchedulerGapOver500Count = Math.max(
        0,
        Math.trunc(depths.rnsCallbackSchedulerGapOver500Count)
      );
    }
    if (typeof depths.rnsCallbackSchedulerGapOver1000Count === 'number') {
      this.snapshot.reticulumAudioRnsCallbackSchedulerGapOver1000Count = Math.max(
        0,
        Math.trunc(depths.rnsCallbackSchedulerGapOver1000Count)
      );
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordJitterUnderrun(count = 1, sourceAddr?: string): void {
    this.snapshot.jitterUnderruns += count;
    this.windowCounters.jitterUnderruns += count;
    if (sourceAddr) {
      this.getSourceWindowAccumulator(sourceAddr).jitterUnderruns += count;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordMissingFrames(count = 1, sourceAddr?: string): void {
    if (count <= 0) return;
    this.snapshot.missingFrames += count;
    this.windowCounters.missingFrames += count;
    if (sourceAddr) {
      this.getSourceWindowAccumulator(sourceAddr).missingFrames += count;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /** WASM libopus FEC path stats (per decode batch). Coarse FEC success is heuristic (refinement D). */
  recordWasmFecDecodeStats(
    sourceAddr: string,
    stats: {
      plcFrames: number;
      fecAttempts: number;
      fecSuccessCoarse: number;
      deferredPcmTick?: boolean;
    }
  ): void {
    const { plcFrames, fecAttempts, fecSuccessCoarse, deferredPcmTick } = stats;
    if (plcFrames > 0) this.snapshot.wasmFecPlcFrames += plcFrames;
    if (fecAttempts > 0) this.snapshot.wasmFecAttempts += fecAttempts;
    if (fecSuccessCoarse > 0)
      this.snapshot.wasmFecSuccessCoarse += fecSuccessCoarse;
    if (deferredPcmTick) this.snapshot.wasmFecDeferredPcmTicks++;
    const src = this.getSourceWindowAccumulator(sourceAddr);
    if (plcFrames > 0) src.wasmFecPlcFrames += plcFrames;
    if (fecAttempts > 0) src.wasmFecAttempts += fecAttempts;
    if (fecSuccessCoarse > 0) src.wasmFecSuccessCoarse += fecSuccessCoarse;
    if (deferredPcmTick) src.wasmFecDeferredPcmTicks++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordConcealmentTick(count = 1, sourceAddr?: string): void {
    this.snapshot.concealmentTicks += count;
    this.windowCounters.concealmentTicks += count;
    if (sourceAddr) {
      this.getSourceWindowAccumulator(sourceAddr).concealmentTicks += count;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  setAdaptiveNetworkMode(mode: 'low-latency' | 'recovery'): void {
    this.snapshot.adaptiveNetworkMode = mode;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  setPlayoutStarvationWorstSeverity(
    severity: 'none' | 'mild' | 'strong'
  ): void {
    this.snapshot.playoutStarvationWorstSeverity = severity;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordTransportMode(mode: GroupCallTransportMode, now = Date.now()): void {
    if (mode !== this.transportMode) {
      if (this.transportMode === 'relay') {
        this.relayDwellAccumulatedMs += now - this.transportModeSinceMs;
      }
      this.transportMode = mode;
      this.transportModeSinceMs = now;
      this.snapshot.lastUpdatedAt = now;
    }
    if (mode !== this.windowTransportMode) {
      if (this.windowTransportMode === 'relay') {
        this.windowRelayDwellAccumulatedMs +=
          now - this.windowTransportModeSinceMs;
      }
      this.windowTransportMode = mode;
      this.windowTransportModeSinceMs = now;
    }
  }

  /** One periodic sample from group-playout-processor (every ~100ms audio per source). */
  recordPlayoutMetricTick(
    bufferedMs: number,
    outsideTargetBand: boolean,
    sourceAddr?: string,
    opts?: PlayoutMetricTickOpts
  ): void {
    this.playoutMetricTicks++;
    if (outsideTargetBand) this.playoutOutsideTicks++;
    if (opts?.outsideUnder) this.playoutUnderTicks++;
    if (opts?.outsideOver) this.playoutOverTicks++;
    if (typeof opts?.deltaMs === 'number' && Number.isFinite(opts.deltaMs)) {
      this.playoutDeltaMsSum += opts.deltaMs;
      this.playoutDeltaMsSamples++;
    }
    this.playoutBufferedMsSum += bufferedMs;
    this.playoutBufferedMsSamples++;
    this.snapshot.avgPcmBufferedMs = roundMetric(
      this.playoutBufferedMsSum / Math.max(1, this.playoutBufferedMsSamples)
    );
    this.snapshot.playoutOutsideTargetFraction = roundMetric(
      this.playoutOutsideTicks / Math.max(1, this.playoutMetricTicks)
    );
    this.snapshot.playoutUnderTargetFraction = roundMetric(
      this.playoutUnderTicks / Math.max(1, this.playoutMetricTicks)
    );
    this.snapshot.playoutOverTargetFraction = roundMetric(
      this.playoutOverTicks / Math.max(1, this.playoutMetricTicks)
    );
    this.snapshot.avgPlayoutDeltaMs = roundMetric(
      this.playoutDeltaMsSum / Math.max(1, this.playoutDeltaMsSamples)
    );
    if (
      typeof opts?.playoutRate === 'number' &&
      Number.isFinite(opts.playoutRate)
    ) {
      this.playoutRateSum += opts.playoutRate;
      this.playoutRateSamples++;
      if (opts.playoutRate < 1) this.playoutRateTicksBelow1++;
      if (opts.playoutRate < 0.97) this.playoutRateTicksBelow097++;
      this.snapshot.avgPlayoutRate = roundMetric(
        this.playoutRateSum / Math.max(1, this.playoutRateSamples)
      );
      this.snapshot.playoutRateFractionBelow1 = roundMetric(
        this.playoutRateTicksBelow1 / Math.max(1, this.playoutRateSamples)
      );
      this.snapshot.playoutRateFractionBelow097 = roundMetric(
        this.playoutRateTicksBelow097 / Math.max(1, this.playoutRateSamples)
      );
    }
    this.windowPlayoutMetricTicks++;
    if (outsideTargetBand) this.windowPlayoutOutsideTicks++;
    if (opts?.outsideUnder) this.windowPlayoutUnderTicks++;
    if (opts?.outsideOver) this.windowPlayoutOverTicks++;
    if (typeof opts?.deltaMs === 'number' && Number.isFinite(opts.deltaMs)) {
      this.windowPlayoutDeltaMsSum += opts.deltaMs;
      this.windowPlayoutDeltaMsSamples++;
    }
    this.windowPlayoutBufferedMsSum += bufferedMs;
    this.windowPlayoutBufferedMsSamples++;
    if (
      typeof opts?.playoutRate === 'number' &&
      Number.isFinite(opts.playoutRate)
    ) {
      this.windowPlayoutRateSum += opts.playoutRate;
      this.windowPlayoutRateSamples++;
      if (opts.playoutRate < 1) this.windowPlayoutRateTicksBelow1++;
      if (opts.playoutRate < 0.97) this.windowPlayoutRateTicksBelow097++;
    }
    if (sourceAddr) {
      const source = this.getSourceWindowAccumulator(sourceAddr);
      source.playoutTicks++;
      if (outsideTargetBand) source.playoutOutsideTicks++;
      if (opts?.outsideUnder) source.playoutUnderTicks++;
      if (opts?.outsideOver) source.playoutOverTicks++;
      if (typeof opts?.deltaMs === 'number' && Number.isFinite(opts.deltaMs)) {
        source.playoutDeltaMsSum += opts.deltaMs;
        source.playoutDeltaMsSamples++;
      }
      source.playoutBufferedMsSum += bufferedMs;
      source.playoutBufferedMsSamples++;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReceiverIngressToPlayoutPostLatency(
    sourceAddr: string,
    latencyMs: number
  ): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.playoutPostLatencyMsSum += latencyMs;
    this.playoutPostLatencyMsSamples++;
    this.playoutPostLatencyMsMax = Math.max(
      this.playoutPostLatencyMsMax,
      latencyMs
    );
    this.snapshot.avgReceiverIngressToPlayoutPostMs = roundMetric(
      this.playoutPostLatencyMsSum /
        Math.max(1, this.playoutPostLatencyMsSamples)
    );
    this.snapshot.maxReceiverIngressToPlayoutPostMs = roundMetric(
      this.playoutPostLatencyMsMax
    );

    this.windowPlayoutPostLatencyMsSum += latencyMs;
    this.windowPlayoutPostLatencyMsSamples++;
    this.windowPlayoutPostLatencyMsMax = Math.max(
      this.windowPlayoutPostLatencyMsMax,
      latencyMs
    );

    const source = this.getSourceWindowAccumulator(sourceAddr);
    source.playoutPostLatencyMsSum += latencyMs;
    source.playoutPostLatencyMsSamples++;
    source.playoutPostLatencyMsMax = Math.max(
      source.playoutPostLatencyMsMax,
      latencyMs
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordReticulumAudioBridgeToRendererIngressLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.bridgeToRendererIngressLatencyMsSum += latencyMs;
    this.bridgeToRendererIngressLatencyMsSamples++;
    this.bridgeToRendererIngressLatencyMsMax = Math.max(
      this.bridgeToRendererIngressLatencyMsMax,
      latencyMs
    );
    this.snapshot.avgReticulumAudioBridgeToRendererIngressMs = roundMetric(
      this.bridgeToRendererIngressLatencyMsSum /
        Math.max(1, this.bridgeToRendererIngressLatencyMsSamples)
    );
    this.snapshot.maxReticulumAudioBridgeToRendererIngressMs = roundMetric(
      this.bridgeToRendererIngressLatencyMsMax
    );
    this.windowBridgeToRendererIngressLatencyMsSum += latencyMs;
    this.windowBridgeToRendererIngressLatencyMsSamples++;
    this.windowBridgeToRendererIngressLatencyMsMax = Math.max(
      this.windowBridgeToRendererIngressLatencyMsMax,
      latencyMs
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /**
   * Outbound sender path: one sample per Opus frame after WebCodecs encode,
   * before `sendEncodedFrame` (see `recordGcallSenderEncoderToPacketTimestampGap`).
   */
  recordGcallSenderPreEncodePipeline(sample: {
    workletToMainThreadMs: number;
    mainThreadToEncoderOutputMs: number;
    workletToEncoderOutputMs: number;
  }): void {
    const a = sample.workletToMainThreadMs;
    const b = sample.mainThreadToEncoderOutputMs;
    const c = sample.workletToEncoderOutputMs;
    if (!Number.isFinite(a) || a < 0) return;
    if (!Number.isFinite(b) || b < 0) return;
    if (!Number.isFinite(c) || c < 0) return;
    this.senderWorkletToMainThreadMsSum += a;
    this.senderWorkletToMainThreadMsSamples++;
    this.senderWorkletToMainThreadMsMax = Math.max(
      this.senderWorkletToMainThreadMsMax,
      a
    );
    this.senderMainToEncoderOutputMsSum += b;
    this.senderMainToEncoderOutputMsSamples++;
    this.senderMainToEncoderOutputMsMax = Math.max(
      this.senderMainToEncoderOutputMsMax,
      b
    );
    this.senderWorkletToEncoderOutputMsSum += c;
    this.senderWorkletToEncoderOutputMsSamples++;
    this.senderWorkletToEncoderOutputMsMax = Math.max(
      this.senderWorkletToEncoderOutputMsMax,
      c
    );
    this.snapshot.avgGcallSenderWorkletToMainThreadMs = roundMetric(
      this.senderWorkletToMainThreadMsSum /
        Math.max(1, this.senderWorkletToMainThreadMsSamples)
    );
    this.snapshot.maxGcallSenderWorkletToMainThreadMs = roundMetric(
      this.senderWorkletToMainThreadMsMax
    );
    this.snapshot.avgGcallSenderMainThreadToEncoderOutputMs = roundMetric(
      this.senderMainToEncoderOutputMsSum /
        Math.max(1, this.senderMainToEncoderOutputMsSamples)
    );
    this.snapshot.maxGcallSenderMainThreadToEncoderOutputMs = roundMetric(
      this.senderMainToEncoderOutputMsMax
    );
    this.snapshot.avgGcallSenderWorkletToEncoderOutputMs = roundMetric(
      this.senderWorkletToEncoderOutputMsSum /
        Math.max(1, this.senderWorkletToEncoderOutputMsSamples)
    );
    this.snapshot.maxGcallSenderWorkletToEncoderOutputMs = roundMetric(
      this.senderWorkletToEncoderOutputMsMax
    );
    this.windowSenderWorkletToMainThreadMsSum += a;
    this.windowSenderWorkletToMainThreadMsSamples++;
    this.windowSenderWorkletToMainThreadMsMax = Math.max(
      this.windowSenderWorkletToMainThreadMsMax,
      a
    );
    this.windowSenderMainToEncoderOutputMsSum += b;
    this.windowSenderMainToEncoderOutputMsSamples++;
    this.windowSenderMainToEncoderOutputMsMax = Math.max(
      this.windowSenderMainToEncoderOutputMsMax,
      b
    );
    this.windowSenderWorkletToEncoderOutputMsSum += c;
    this.windowSenderWorkletToEncoderOutputMsSamples++;
    this.windowSenderWorkletToEncoderOutputMsMax = Math.max(
      this.windowSenderWorkletToEncoderOutputMsMax,
      c
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /**
   * Outbound: delay from `AudioEncoder` output callback to assignment of `timestampMs` in
   * `sendEncodedFrame` (sync frame/encrypt, early-return gates).
   */
  recordGcallSenderEncoderToPacketTimestampGap(gapMs: number): void {
    if (!Number.isFinite(gapMs) || gapMs < 0) return;
    this.senderEncoderToPacketTimestampMsSum += gapMs;
    this.senderEncoderToPacketTimestampMsSamples++;
    this.senderEncoderToPacketTimestampMsMax = Math.max(
      this.senderEncoderToPacketTimestampMsMax,
      gapMs
    );
    this.snapshot.avgGcallSenderEncoderOutputToPacketTimestampMs = roundMetric(
      this.senderEncoderToPacketTimestampMsSum /
        Math.max(1, this.senderEncoderToPacketTimestampMsSamples)
    );
    this.snapshot.maxGcallSenderEncoderOutputToPacketTimestampMs = roundMetric(
      this.senderEncoderToPacketTimestampMsMax
    );
    this.windowSenderEncoderToPacketTimestampMsSum += gapMs;
    this.windowSenderEncoderToPacketTimestampMsSamples++;
    this.windowSenderEncoderToPacketTimestampMsMax = Math.max(
      this.windowSenderEncoderToPacketTimestampMsMax,
      gapMs
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordAdaptiveTargetSample(sourceAddr: string, targetMs: number): void {
    if (!Number.isFinite(targetMs) || targetMs <= 0) return;
    this.getSourceWindowAccumulator(sourceAddr).adaptiveTargetSamples.push(
      targetMs
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordOpusBufferedMetric(sourceAddr: string, bufferedMs: number): void {
    if (!Number.isFinite(bufferedMs) || bufferedMs < 0) return;
    this.windowOpusBufferedMsSum += bufferedMs;
    this.windowOpusBufferedMsSamples++;
    this.windowOpusBufferedMsMax = Math.max(
      this.windowOpusBufferedMsMax,
      bufferedMs
    );
    const source = this.getSourceWindowAccumulator(sourceAddr);
    source.opusBufferedMsSum += bufferedMs;
    source.opusBufferedMsSamples++;
    source.opusBufferedMsMax = Math.max(source.opusBufferedMsMax, bufferedMs);
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordIncomingPacketDuration(durationMs: number): void {
    this.incomingPacketSamples++;
    this.incomingPacketTotalMs += durationMs;
    this.snapshot.avgIncomingPacketMs = roundMetric(
      this.incomingPacketTotalMs / this.incomingPacketSamples
    );
    this.snapshot.maxIncomingPacketMs = roundMetric(
      Math.max(this.snapshot.maxIncomingPacketMs, durationMs)
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordJitterTickDuration(durationMs: number): void {
    this.jitterTickSamples++;
    this.jitterTickTotalMs += durationMs;
    this.snapshot.avgJitterTickMs = roundMetric(
      this.jitterTickTotalMs / this.jitterTickSamples
    );
    this.snapshot.maxJitterTickMs = roundMetric(
      Math.max(this.snapshot.maxJitterTickMs, durationMs)
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  /**
   * One sample per jitter drain tick: aggregate depth / starvation across active sources.
   */
  recordJitterDrainTelemetry(sample: {
    sourceCount: number;
    depthSum: number;
    worstDepth: number;
    notReadyCount: number;
    rawEmptyCount: number;
  }): void {
    const n = sample.sourceCount;
    if (!Number.isFinite(n) || n <= 0) return;
    const tickMean = sample.depthSum / n;
    this.jitterDrainTicksSession++;
    this.jitterDepthMeanTickSumSession += tickMean;
    this.jitterDepthWorstTickMaxSession = Math.max(
      this.jitterDepthWorstTickMaxSession,
      sample.worstDepth
    );
    this.jitterNotReadySlotsSession += sample.notReadyCount;
    this.jitterSlotSamplesSession += n;
    this.jitterRawEmptySlotsSession += sample.rawEmptyCount;

    this.windowJitterDrainTicks++;
    this.windowJitterDepthMeanTickSum += tickMean;
    this.windowJitterDepthWorstMax = Math.max(
      this.windowJitterDepthWorstMax,
      sample.worstDepth
    );
    this.windowJitterNotReadySlots += sample.notReadyCount;
    this.windowJitterSlotSamples += n;
    this.windowJitterRawEmptySlots += sample.rawEmptyCount;

    this.snapshot.jitterBufferDepthFramesMean = roundMetric(
      this.jitterDepthMeanTickSumSession /
        Math.max(1, this.jitterDrainTicksSession)
    );
    this.snapshot.jitterBufferDepthFramesWorst = roundMetric(
      this.jitterDepthWorstTickMaxSession
    );
    this.snapshot.jitterNotReadyFraction = roundMetric(
      this.jitterNotReadySlotsSession /
        Math.max(1, this.jitterSlotSamplesSession)
    );
    this.snapshot.jitterRawEmptyFraction = roundMetric(
      this.jitterRawEmptySlotsSession /
        Math.max(1, this.jitterSlotSamplesSession)
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  setResourceCounts(counts: ResourceCounts): void {
    this.snapshot.decoderCount = counts.decoders;
    this.snapshot.playbackNodeCount = counts.playbackNodes;
    this.snapshot.jitterBufferCount = counts.jitterBuffers;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordMixerState(activeSpeakerEstimate: number, masterGain: number): void {
    this.snapshot.mixerActiveSpeakerEstimate = Math.max(
      0,
      Math.round(activeSpeakerEstimate)
    );
    this.snapshot.mixerMasterGain = roundMetric(masterGain);
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordMixerReductionSample(
    reductionDb: number,
    overloadThresholdDb = -1.5,
    heavyReductionThresholdDb = -3
  ): void {
    const reduction = Number.isFinite(reductionDb)
      ? Math.min(0, reductionDb)
      : 0;
    this.snapshot.mixerCurrentReductionDb = roundMetric(reduction);
    this.mixerReductionSamples++;
    this.mixerReductionTotalDb += reduction;
    this.snapshot.mixerAvgReductionDb = roundMetric(
      this.mixerReductionTotalDb / Math.max(1, this.mixerReductionSamples)
    );
    if (reduction <= heavyReductionThresholdDb) {
      this.mixerHeavyReductionSamples++;
    }
    this.snapshot.mixerHeavyReductionFraction = roundMetric(
      this.mixerHeavyReductionSamples / Math.max(1, this.mixerReductionSamples)
    );
    const overloaded = reduction <= overloadThresholdDb;
    if (overloaded && !this.mixerOverloaded) {
      this.snapshot.mixerOverloadEvents++;
    }
    this.mixerOverloaded = overloaded;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  reset(): void {
    const now = Date.now();
    this.snapshot = {
      ...this.snapshot,
      packetsReceived: 0,
      packetsForwarded: 0,
      packetsDecoded: 0,
      packetsDropped: 0,
      packetsDroppedPendingDecrypt: 0,
      packetsDroppedStaleWorkerDecrypt: 0,
      packetsDroppedStartupGate: 0,
      packetsDroppedDecodeFailure: 0,
      packetsDroppedDecoderThrow: 0,
      packetsDroppedStaleTimestamp: 0,
      packetsDroppedUnknownSource: 0,
      relayPacketsSent: 0,
      relayPacketsReceived: 0,
      lastRelayActivityAtMs: 0,
      jitterUnderruns: 0,
      missingFrames: 0,
      concealmentTicks: 0,
      decoderCount: 0,
      playbackNodeCount: 0,
      jitterBufferCount: 0,
      avgIncomingPacketMs: 0,
      maxIncomingPacketMs: 0,
      avgJitterTickMs: 0,
      maxJitterTickMs: 0,
      avgPcmBufferedMs: 0,
      playoutOutsideTargetFraction: 0,
      playoutUnderTargetFraction: 0,
      playoutOverTargetFraction: 0,
      avgPlayoutDeltaMs: 0,
      avgPlayoutRate: 1,
      playoutRateFractionBelow1: 0,
      playoutRateFractionBelow097: 0,
      avgReceiverIngressToPlayoutPostMs: 0,
      maxReceiverIngressToPlayoutPostMs: 0,
      avgReticulumAudioBridgeToRendererIngressMs: 0,
      maxReticulumAudioBridgeToRendererIngressMs: 0,
      avgGcallSenderWorkletToMainThreadMs: 0,
      maxGcallSenderWorkletToMainThreadMs: 0,
      avgGcallSenderMainThreadToEncoderOutputMs: 0,
      maxGcallSenderMainThreadToEncoderOutputMs: 0,
      avgGcallSenderWorkletToEncoderOutputMs: 0,
      maxGcallSenderWorkletToEncoderOutputMs: 0,
      avgGcallSenderEncoderOutputToPacketTimestampMs: 0,
      maxGcallSenderEncoderOutputToPacketTimestampMs: 0,
      jitterBufferDepthFramesMean: 0,
      jitterBufferDepthFramesWorst: 0,
      jitterNotReadyFraction: 0,
      jitterRawEmptyFraction: 0,
      lastUpdatedAt: now,
      relayDwellMs: 0,
      relayDwellFraction: 0,
      adaptiveNetworkMode: 'low-latency',
      playoutStarvationWorstSeverity: 'none',
      relayThrottleDrops: 0,
      relayCoalesceSuperseded: 0,
      relayIpcFailures: 0,
      reticulumAudioPendingFrames: 0,
      reticulumAudioPendingOldestAgeMs: 0,
      reticulumAudioPendingFramesHighWater: 0,
      reticulumAudioPendingOldestAgeMaxMs: 0,
      reticulumAudioBridgeQueuedFrames: 0,
      reticulumAudioBridgeQueuedOldestAgeMs: 0,
      reticulumAudioBridgeQueuedFramesHighWater: 0,
      reticulumAudioBridgeQueuedOldestAgeMaxMs: 0,
      reticulumAudioDecodedQueueDepth: 0,
      reticulumAudioDecodedQueueOldestAgeMs: 0,
      reticulumAudioDecodedQueueDepthHighWater: 0,
      reticulumAudioDecodedQueueOldestAgeMaxMs: 0,
      reticulumAudioBinaryOutQueueDepth: 0,
      reticulumAudioBinaryOutQueueOldestAgeMs: 0,
      reticulumAudioBinaryOutQueueDepthHighWater: 0,
      reticulumAudioBinaryOutQueueOldestAgeMaxMs: 0,
      reticulumAudioBridgeWaitingForDrain: false,
      reticulumAudioQueuePressureDrops: 0,
      reticulumAudioQueuePressureDropsLast5s: 0,
      reticulumAudioStaleDrops: 0,
      reticulumAudioStaleDropsLast5s: 0,
      reticulumAudioLinkUnreadyDrops: 0,
      reticulumAudioPacketSendFailures: 0,
      reticulumAudioPacketPathRequests: 0,
      reticulumAudioPacketPathResolutions: 0,
      reticulumAudioPacketPathTimeouts: 0,
      reticulumAudioPacketFreshSends: 0,
      reticulumAudioPacketStaleSends: 0,
      reticulumAudioPacketUnknownSends: 0,
      reticulumAudioDeadlineDropCount: 0,
      reticulumAudioDecodedQueueEvictOldestCount: 0,
      reticulumAudioDecodedQueueDropNewestCount: 0,
      reticulumAudioFd3DecodedAgeMsMax: 0,
      reticulumAudioDecodedQueueDwellMsMax: 0,
      reticulumAudioRnsSendDurationMsMax: 0,
      reticulumAudioPacketPathCheckMsMax: 0,
      reticulumAudioExecutorLoopGapMsMax: 0,
      reticulumAudioExecutorGapWhileQueuedMsMax: 0,
      reticulumAudioExecutorAudioPassMsMax: 0,
      reticulumAudioProcessBatchMsMax: 0,
      reticulumAudioProcessBatchFramesMax: 0,
      reticulumAudioRnsSendSlowCount: 0,
      reticulumAudioExecutorStallCount: 0,
      reticulumAudioExecutorCommandMsMax: 0,
      reticulumAudioExecutorCommandWhileQueuedMsMax: 0,
      reticulumAudioExecutorCommandSlowCount: 0,
      reticulumAudioRnsCallbackSchedulerGapMsMax: 0,
      reticulumAudioRnsCallbackSchedulerGapOver100Count: 0,
      reticulumAudioRnsCallbackSchedulerGapOver250Count: 0,
      reticulumAudioRnsCallbackSchedulerGapOver500Count: 0,
      reticulumAudioRnsCallbackSchedulerGapOver1000Count: 0,
      reticulumAudioOutboundLinkSamples: 0,
      reticulumAudioOutboundPacketSamples: 0,
      reticulumAudioOutboundTransportLast: null,
      reticulumAudioInboundLinkSamples: 0,
      reticulumAudioInboundPacketSamples: 0,
      reticulumAudioInboundTransportLast: null,
      mixerActiveSpeakerEstimate: 0,
      mixerMasterGain: 1,
      mixerCurrentReductionDb: 0,
      mixerAvgReductionDb: 0,
      mixerOverloadEvents: 0,
      mixerHeavyReductionFraction: 0,
      wasmFecPlcFrames: 0,
      wasmFecAttempts: 0,
      wasmFecSuccessCoarse: 0,
      wasmFecDeferredPcmTicks: 0,
      clusterFailoverPromotionCount: 0,
      rootFailoverPromotionCount: 0,
      clusterForwarderDemotionCount: 0,
      pendingDecryptDepth: 0,
      pendingDecryptDepthHighWater: 0,
      gcallAudioBurstWindowCumulativeMs: 0,
      gcallAudioOverloadCumulativeMs: 0,
      gcallAudioIngressPacingCumulativeMs: 0,
      gcallAudioStage5BoostCumulativeMs: 0,
      gcallAudioFailSafeCumulativeMs: 0,
      gcallAudioBurstWindowLastStintMs: 0,
      gcallAudioOverloadLastStintMs: 0,
      gcallAudioIngressPacingLastStintMs: 0,
      gcallAudioStage5BoostLastStintMs: 0,
      gcallAudioFailSafeLastStintMs: 0,
      gcallAudioBurstWindowEntries: 0,
      gcallAudioOverloadEntries: 0,
      gcallAudioIngressPacingEntries: 0,
      gcallAudioStage5BoostEntries: 0,
      gcallAudioFailSafeEntries: 0,
    };
    this.gcallStageBurstStintStart = null;
    this.gcallStageOverloadStintStart = null;
    this.gcallStageIngressStintStart = null;
    this.gcallStage5StintStart = null;
    this.gcallStageFailSafeStintStart = null;
    this.incomingPacketSamples = 0;
    this.incomingPacketTotalMs = 0;
    this.jitterTickSamples = 0;
    this.jitterTickTotalMs = 0;
    this.jitterDrainTicksSession = 0;
    this.jitterDepthMeanTickSumSession = 0;
    this.jitterDepthWorstTickMaxSession = 0;
    this.jitterNotReadySlotsSession = 0;
    this.jitterSlotSamplesSession = 0;
    this.jitterRawEmptySlotsSession = 0;
    this.playoutMetricTicks = 0;
    this.playoutOutsideTicks = 0;
    this.playoutUnderTicks = 0;
    this.playoutOverTicks = 0;
    this.playoutDeltaMsSum = 0;
    this.playoutDeltaMsSamples = 0;
    this.playoutBufferedMsSum = 0;
    this.playoutBufferedMsSamples = 0;
    this.playoutRateSum = 0;
    this.playoutRateSamples = 0;
    this.playoutRateTicksBelow1 = 0;
    this.playoutRateTicksBelow097 = 0;
    this.playoutPostLatencyMsSum = 0;
    this.playoutPostLatencyMsSamples = 0;
    this.playoutPostLatencyMsMax = 0;
    this.bridgeToRendererIngressLatencyMsSum = 0;
    this.bridgeToRendererIngressLatencyMsSamples = 0;
    this.bridgeToRendererIngressLatencyMsMax = 0;
    this.senderWorkletToMainThreadMsSum = 0;
    this.senderWorkletToMainThreadMsSamples = 0;
    this.senderWorkletToMainThreadMsMax = 0;
    this.senderMainToEncoderOutputMsSum = 0;
    this.senderMainToEncoderOutputMsSamples = 0;
    this.senderMainToEncoderOutputMsMax = 0;
    this.senderWorkletToEncoderOutputMsSum = 0;
    this.senderWorkletToEncoderOutputMsSamples = 0;
    this.senderWorkletToEncoderOutputMsMax = 0;
    this.senderEncoderToPacketTimestampMsSum = 0;
    this.senderEncoderToPacketTimestampMsSamples = 0;
    this.senderEncoderToPacketTimestampMsMax = 0;
    this.mixerReductionSamples = 0;
    this.mixerReductionTotalDb = 0;
    this.mixerHeavyReductionSamples = 0;
    this.mixerOverloaded = false;
    this.sessionStartedAtMs = now;
    this.transportMode = 'connecting';
    this.transportModeSinceMs = now;
    this.relayDwellAccumulatedMs = 0;
    this.resetWindow(now);
  }

  getSnapshot(): GroupCallMetricsSnapshot {
    const now = Date.now();
    const relayDwellMs =
      this.relayDwellAccumulatedMs +
      (this.transportMode === 'relay' ? now - this.transportModeSinceMs : 0);
    const elapsedMs = Math.max(1, now - this.sessionStartedAtMs);
    return {
      ...this.snapshot,
      relayDwellMs: roundMetric(relayDwellMs),
      relayDwellFraction: roundMetric(relayDwellMs / elapsedMs),
    };
  }

  captureWindowMetrics(
    receivingPeer: string,
    endAt = Date.now()
  ): GroupCallWindowMetrics {
    const relayDwellMs =
      this.windowRelayDwellAccumulatedMs +
      (this.windowTransportMode === 'relay'
        ? endAt - this.windowTransportModeSinceMs
        : 0);
    const durationMs = Math.max(1, endAt - this.windowStartedAtMs);
    const sources = [...this.sourceWindowStats.entries()]
      .map(([sourceAddr, stats]) => {
        const adaptiveTargetMaxMs = stats.adaptiveTargetSamples.reduce(
          (max, value) => Math.max(max, value),
          0
        );
        return {
          sourceAddr,
          jitterUnderruns: stats.jitterUnderruns,
          missingFrames: stats.missingFrames,
          concealmentTicks: stats.concealmentTicks,
          avgPcmBufferedMs: roundMetric(
            stats.playoutBufferedMsSum /
              Math.max(1, stats.playoutBufferedMsSamples)
          ),
          playoutOutsideTargetFraction: roundMetric(
            stats.playoutOutsideTicks / Math.max(1, stats.playoutTicks)
          ),
          playoutUnderTargetFraction: roundMetric(
            stats.playoutUnderTicks / Math.max(1, stats.playoutTicks)
          ),
          playoutOverTargetFraction: roundMetric(
            stats.playoutOverTicks / Math.max(1, stats.playoutTicks)
          ),
          avgPlayoutDeltaMs: roundMetric(
            stats.playoutDeltaMsSum / Math.max(1, stats.playoutDeltaMsSamples)
          ),
          avgReceiverIngressToPlayoutPostMs: roundMetric(
            stats.playoutPostLatencyMsSum /
              Math.max(1, stats.playoutPostLatencyMsSamples)
          ),
          maxReceiverIngressToPlayoutPostMs: roundMetric(
            stats.playoutPostLatencyMsMax
          ),
          avgOpusBufferedMs: roundMetric(
            stats.opusBufferedMsSum / Math.max(1, stats.opusBufferedMsSamples)
          ),
          maxOpusBufferedMs: roundMetric(stats.opusBufferedMsMax),
          adaptiveTargetMedianMs: roundMetric(
            percentile(stats.adaptiveTargetSamples, 0.5)
          ),
          adaptiveTargetP95Ms: roundMetric(
            percentile(stats.adaptiveTargetSamples, 0.95)
          ),
          adaptiveTargetMaxMs: roundMetric(adaptiveTargetMaxMs),
          playoutMetricTicks: stats.playoutTicks,
          wasmFecPlcFrames: stats.wasmFecPlcFrames,
          wasmFecAttempts: stats.wasmFecAttempts,
          wasmFecSuccessCoarse: stats.wasmFecSuccessCoarse,
          wasmFecDeferredPcmTicks: stats.wasmFecDeferredPcmTicks,
        };
      })
      .sort((a, b) => a.sourceAddr.localeCompare(b.sourceAddr));
    const allAdaptiveSamples = sources.flatMap(
      (source) =>
        this.sourceWindowStats.get(source.sourceAddr)?.adaptiveTargetSamples ??
        []
    );
    const worstSource = pickWorstSourceForIsolation(sources);
    const result: GroupCallWindowMetrics = {
      receivingPeer,
      startAt: this.windowStartedAtMs,
      endAt,
      durationMs: roundMetric(durationMs),
      packetsDropped: this.windowCounters.packetsDropped,
      packetsDroppedPendingDecrypt:
        this.windowCounters.packetsDroppedPendingDecrypt,
      packetsDroppedStaleWorkerDecrypt:
        this.windowCounters.packetsDroppedStaleWorkerDecrypt,
      packetsDroppedStartupGate: this.windowCounters.packetsDroppedStartupGate,
      packetsDroppedDecodeFailure:
        this.windowCounters.packetsDroppedDecodeFailure,
      packetsDroppedDecoderThrow:
        this.windowCounters.packetsDroppedDecoderThrow,
      packetsDroppedStaleTimestamp:
        this.windowCounters.packetsDroppedStaleTimestamp,
      packetsDroppedUnknownSource:
        this.windowCounters.packetsDroppedUnknownSource,
      pendingDecryptDepthHighWater: this.windowPendingDecryptDepthHighWater,
      packetsDroppedPendingDecryptRatePerSec: roundMetric(
        this.windowCounters.packetsDroppedPendingDecrypt / (durationMs / 1000)
      ),
      jitterUnderruns: this.windowCounters.jitterUnderruns,
      missingFrames: this.windowCounters.missingFrames,
      concealmentTicks: this.windowCounters.concealmentTicks,
      reticulumAudioQueuePressureDrops:
        this.windowCounters.reticulumAudioQueuePressureDrops,
      reticulumAudioStaleDrops: this.windowCounters.reticulumAudioStaleDrops,
      reticulumAudioLinkUnreadyDrops:
        this.windowCounters.reticulumAudioLinkUnreadyDrops,
      reticulumAudioPacketSendFailures:
        this.windowCounters.reticulumAudioPacketSendFailures,
      reticulumAudioPacketPathRequests:
        this.windowCounters.reticulumAudioPacketPathRequests,
      reticulumAudioPacketPathResolutions:
        this.windowCounters.reticulumAudioPacketPathResolutions,
      reticulumAudioPacketPathTimeouts:
        this.windowCounters.reticulumAudioPacketPathTimeouts,
      reticulumAudioPacketFreshSends:
        this.windowCounters.reticulumAudioPacketFreshSends,
      reticulumAudioPacketStaleSends:
        this.windowCounters.reticulumAudioPacketStaleSends,
      reticulumAudioPacketUnknownSends:
        this.windowCounters.reticulumAudioPacketUnknownSends,
      reticulumAudioOutboundLinkSamples:
        this.windowCounters.reticulumAudioOutboundLinkSamples,
      reticulumAudioOutboundPacketSamples:
        this.windowCounters.reticulumAudioOutboundPacketSamples,
      reticulumAudioInboundLinkSamples:
        this.windowCounters.reticulumAudioInboundLinkSamples,
      reticulumAudioInboundPacketSamples:
        this.windowCounters.reticulumAudioInboundPacketSamples,
      reticulumAudioQueuePressureDropRatePerSec: roundMetric(
        this.windowCounters.reticulumAudioQueuePressureDrops /
          (durationMs / 1000)
      ),
      reticulumAudioStaleDropRatePerSec: roundMetric(
        this.windowCounters.reticulumAudioStaleDrops / (durationMs / 1000)
      ),
      reticulumAudioPacketSendFailureRatePerSec: roundMetric(
        this.windowCounters.reticulumAudioPacketSendFailures /
          (durationMs / 1000)
      ),
      reticulumAudioPendingFramesHighWater:
        this.windowReticulumAudioPendingFramesHighWater,
      reticulumAudioPendingOldestAgeMaxMs:
        this.windowReticulumAudioPendingOldestAgeMaxMs,
      reticulumAudioBridgeQueuedFramesHighWater:
        this.windowReticulumAudioBridgeQueuedFramesHighWater,
      reticulumAudioBridgeQueuedOldestAgeMaxMs:
        this.windowReticulumAudioBridgeQueuedOldestAgeMaxMs,
      reticulumAudioDecodedQueueDepthHighWater:
        this.windowReticulumAudioDecodedQueueDepthHighWater,
      reticulumAudioDecodedQueueOldestAgeMaxMs:
        this.windowReticulumAudioDecodedQueueOldestAgeMaxMs,
      reticulumAudioBinaryOutQueueDepthHighWater:
        this.windowReticulumAudioBinaryOutQueueDepthHighWater,
      reticulumAudioBinaryOutQueueOldestAgeMaxMs:
        this.windowReticulumAudioBinaryOutQueueOldestAgeMaxMs,
      relayDwellMs: roundMetric(relayDwellMs),
      relayDwellFraction: roundMetric(relayDwellMs / durationMs),
      avgPcmBufferedMs: roundMetric(
        this.windowPlayoutBufferedMsSum /
          Math.max(1, this.windowPlayoutBufferedMsSamples)
      ),
      playoutOutsideTargetFraction: roundMetric(
        this.windowPlayoutOutsideTicks /
          Math.max(1, this.windowPlayoutMetricTicks)
      ),
      playoutUnderTargetFraction: roundMetric(
        this.windowPlayoutUnderTicks /
          Math.max(1, this.windowPlayoutMetricTicks)
      ),
      playoutOverTargetFraction: roundMetric(
        this.windowPlayoutOverTicks / Math.max(1, this.windowPlayoutMetricTicks)
      ),
      avgPlayoutDeltaMs: roundMetric(
        this.windowPlayoutDeltaMsSum /
          Math.max(1, this.windowPlayoutDeltaMsSamples)
      ),
      avgPlayoutRate: roundMetric(
        this.windowPlayoutRateSamples > 0
          ? this.windowPlayoutRateSum / this.windowPlayoutRateSamples
          : 1
      ),
      playoutRateFractionBelow1: roundMetric(
        this.windowPlayoutRateSamples > 0
          ? this.windowPlayoutRateTicksBelow1 / this.windowPlayoutRateSamples
          : 0
      ),
      playoutRateFractionBelow097: roundMetric(
        this.windowPlayoutRateSamples > 0
          ? this.windowPlayoutRateTicksBelow097 / this.windowPlayoutRateSamples
          : 0
      ),
      avgReceiverIngressToPlayoutPostMs: roundMetric(
        this.windowPlayoutPostLatencyMsSum /
          Math.max(1, this.windowPlayoutPostLatencyMsSamples)
      ),
      maxReceiverIngressToPlayoutPostMs: roundMetric(
        this.windowPlayoutPostLatencyMsMax
      ),
      avgReticulumAudioBridgeToRendererIngressMs: roundMetric(
        this.windowBridgeToRendererIngressLatencyMsSum /
          Math.max(1, this.windowBridgeToRendererIngressLatencyMsSamples)
      ),
      maxReticulumAudioBridgeToRendererIngressMs: roundMetric(
        this.windowBridgeToRendererIngressLatencyMsMax
      ),
      avgGcallSenderWorkletToMainThreadMs: roundMetric(
        this.windowSenderWorkletToMainThreadMsSum /
          Math.max(1, this.windowSenderWorkletToMainThreadMsSamples)
      ),
      maxGcallSenderWorkletToMainThreadMs: roundMetric(
        this.windowSenderWorkletToMainThreadMsMax
      ),
      avgGcallSenderMainThreadToEncoderOutputMs: roundMetric(
        this.windowSenderMainToEncoderOutputMsSum /
          Math.max(1, this.windowSenderMainToEncoderOutputMsSamples)
      ),
      maxGcallSenderMainThreadToEncoderOutputMs: roundMetric(
        this.windowSenderMainToEncoderOutputMsMax
      ),
      avgGcallSenderWorkletToEncoderOutputMs: roundMetric(
        this.windowSenderWorkletToEncoderOutputMsSum /
          Math.max(1, this.windowSenderWorkletToEncoderOutputMsSamples)
      ),
      maxGcallSenderWorkletToEncoderOutputMs: roundMetric(
        this.windowSenderWorkletToEncoderOutputMsMax
      ),
      avgGcallSenderEncoderOutputToPacketTimestampMs: roundMetric(
        this.windowSenderEncoderToPacketTimestampMsSum /
          Math.max(1, this.windowSenderEncoderToPacketTimestampMsSamples)
      ),
      maxGcallSenderEncoderOutputToPacketTimestampMs: roundMetric(
        this.windowSenderEncoderToPacketTimestampMsMax
      ),
      jitterBufferDepthFramesMean: roundMetric(
        this.windowJitterDrainTicks > 0
          ? this.windowJitterDepthMeanTickSum / this.windowJitterDrainTicks
          : 0
      ),
      jitterBufferDepthFramesWorst: roundMetric(this.windowJitterDepthWorstMax),
      jitterNotReadyFraction: roundMetric(
        this.windowJitterSlotSamples > 0
          ? this.windowJitterNotReadySlots / this.windowJitterSlotSamples
          : 0
      ),
      jitterRawEmptyFraction: roundMetric(
        this.windowJitterSlotSamples > 0
          ? this.windowJitterRawEmptySlots / this.windowJitterSlotSamples
          : 0
      ),
      avgOpusBufferedMs: roundMetric(
        this.windowOpusBufferedMsSum /
          Math.max(1, this.windowOpusBufferedMsSamples)
      ),
      maxOpusBufferedMs: roundMetric(this.windowOpusBufferedMsMax),
      adaptiveTargetMedianMs: roundMetric(percentile(allAdaptiveSamples, 0.5)),
      adaptiveTargetP95Ms: roundMetric(percentile(allAdaptiveSamples, 0.95)),
      adaptiveTargetMaxMs: roundMetric(
        allAdaptiveSamples.reduce((max, value) => Math.max(max, value), 0)
      ),
      worstSourceAddr: worstSource?.sourceAddr ?? null,
      worstAdaptiveTargetMs: roundMetric(worstSource?.adaptiveTargetMaxMs ?? 0),
      sources,
    };
    this.resetWindow(endAt);
    return result;
  }
}

export function evaluateActiveSpeaker(
  speakers: Map<string, number>,
  sourceAddr: string,
  vad: boolean,
  now: number,
  maxSpeakers: number,
  activeWindowMs = 3_000
): boolean {
  if (!vad) return false;
  if (speakers.has(sourceAddr)) return true;
  let speakingCount = 0;
  for (const [, lastSeen] of speakers) {
    if (now - lastSeen < activeWindowMs) speakingCount++;
  }
  return speakingCount < maxSpeakers;
}

export function collectActiveSpeakers(
  speakers: Map<string, number>,
  now: number,
  activeWindowMs: number,
  limit: number
): string[] {
  const active: string[] = [];
  for (const [address, lastSeen] of speakers) {
    if (now - lastSeen < activeWindowMs) {
      active.push(address);
      if (active.length >= limit) break;
    }
  }
  return active;
}

export function sameAddressList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function reconcileParticipantSpeaking(
  prev: RouterParticipant[],
  speakers: string[]
): RouterParticipant[] {
  const speakerSet = new Set(speakers);
  let changed = false;
  const next = prev.map((participant) => {
    const speaking = speakerSet.has(participant.address);
    if (participant.speaking === speaking) return participant;
    changed = true;
    return { ...participant, speaking };
  });
  return changed ? next : prev;
}

export function disposeParticipantAudioState(
  address: string,
  decoders: Map<string, AudioDecoder>,
  playbackNodes: Map<string, AudioWorkletNode>,
  playbackGainNodes: Map<string, GainNode>,
  jitterBuffers: Map<string, { clear?: () => void }>,
  lastRecvAt: Map<string, number>,
  speakers: Map<string, number>
): void {
  const decoder = decoders.get(address);
  if (decoder) {
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch {
      /* ignore close races */
    }
    decoders.delete(address);
  }

  const node = playbackNodes.get(address);
  if (node) {
    try {
      node.disconnect();
    } catch {
      /* ignore disconnect races */
    }
    playbackNodes.delete(address);
  }

  const gainNode = playbackGainNodes.get(address);
  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch {
      /* ignore disconnect races */
    }
    playbackGainNodes.delete(address);
  }

  const jitter = jitterBuffers.get(address);
  try {
    jitter?.clear?.();
  } catch {
    /* ignore clear races */
  }
  jitterBuffers.delete(address);
  lastRecvAt.delete(address);
  speakers.delete(address);
}

export function forwardPacketForRole(
  role: RouterRole,
  topology: RouterTopology | null,
  myAddress: string,
  sourceAddr: string,
  data: ArrayBuffer,
  sendToAddress: (address: string, data: ArrayBuffer) => boolean
): number {
  if (
    !topology ||
    (role !== 'cluster-forwarder' && role !== 'root-forwarder')
  ) {
    return 0;
  }

  let forwarded = 0;

  if (role === 'root-forwarder') {
    for (const cluster of topology.clusters) {
      if (cluster.forwarder === myAddress) {
        for (const member of cluster.members) {
          if (member === sourceAddr || member === myAddress) continue;
          if (sendToAddress(member, data)) forwarded++;
        }
      } else if (sendToAddress(cluster.forwarder, data)) {
        forwarded++;
      }
    }
    return forwarded;
  }

  if (topology.rootForwarder && topology.rootForwarder !== myAddress) {
    if (sendToAddress(topology.rootForwarder, data)) forwarded++;
  }

  for (const cluster of topology.clusters) {
    if (cluster.forwarder !== myAddress) continue;
    for (const member of cluster.members) {
      if (member === sourceAddr || member === myAddress) continue;
      if (sendToAddress(member, data)) forwarded++;
    }
    break;
  }

  return forwarded;
}

/** Same recipient set as {@link forwardPacketForRole}, for per-frame batched `sendAudioBatch`. */
export function collectForwardRecipientsForRole(
  role: RouterRole,
  topology: RouterTopology | null,
  myAddress: string,
  sourceAddr: string
): string[] {
  if (
    !topology ||
    (role !== 'cluster-forwarder' && role !== 'root-forwarder')
  ) {
    return [];
  }

  const out: string[] = [];

  if (role === 'root-forwarder') {
    for (const cluster of topology.clusters) {
      if (cluster.forwarder === myAddress) {
        for (const member of cluster.members) {
          if (member === sourceAddr || member === myAddress) continue;
          if (member) out.push(member);
        }
      } else if (cluster.forwarder) {
        out.push(cluster.forwarder);
      }
    }
    return out;
  }

  if (topology.rootForwarder && topology.rootForwarder !== myAddress) {
    out.push(topology.rootForwarder);
  }

  for (const cluster of topology.clusters) {
    if (cluster.forwarder !== myAddress) continue;
    for (const member of cluster.members) {
      if (member === sourceAddr || member === myAddress) continue;
      if (member) out.push(member);
    }
    break;
  }

  return out;
}
