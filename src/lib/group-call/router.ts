export type RouterRole =
  | 'participant'
  | 'cluster-forwarder'
  | 'root-forwarder'
  | 'standby-forwarder';

export interface RouterClusterDef {
  members: string[];
  forwarder: string;
  standby: string;
}

export interface RouterTopology {
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: RouterClusterDef[];
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
      clusters: [{ members: [], forwarder: '', standby: '' }],
    };
  }

  const root =
    previousRoot && sorted.includes(previousRoot) ? previousRoot : (sorted[0] ?? '');
  const standby = sorted.find((a) => a !== root) ?? '';

  return {
    topologyEpoch,
    rootForwarder: root,
    standbyForwarder: standby,
    clusters: [
      {
        members: sorted,
        forwarder: root,
        standby,
      },
    ],
  };
}

export interface RouterParticipant {
  address: string;
  publicKey: string;
  speaking: boolean;
  role: RouterRole;
}

export interface GroupCallMetricsSnapshot {
  role: RouterRole;
  packetsReceived: number;
  packetsForwarded: number;
  packetsDecoded: number;
  packetsDropped: number;
  relayPacketsSent: number;
  relayPacketsReceived: number;
  /** Wall time (ms) of last mesh GC_AUDIO send or receive; 0 = none this session. */
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
  lastUpdatedAt: number;
  /** Present-tense: DataChannels needed for this role are open (set in useGroupVoiceCall flush). */
  dcTransportReady?: boolean;
  pcConnectedTransitions: number;
  pcDisconnectedTransitions: number;
  pcFailedTransitions: number;
  pcClosedTransitions: number;
  dcOpenCount: number;
  dcCloseCount: number;
  dcErrorCount: number;
  iceRestartAttempts: number;
  iceRestartSuccesses: number;
  reconnectAttempts: number;
  persistentDisconnectTeardowns: number;
  avgRecoveryMs: number;
  maxRecoveryMs: number;
  dcBackpressureDrops: number;
  dcBackoffDrops: number;
  dcSendErrorDrops: number;
  relayDwellMs: number;
  relayDwellFraction: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  /** Fallback relay throttled (RELAY_FALLBACK_MIN_INTERVAL_MS) — frame not sent yet. */
  relayThrottleDrops: number;
  /** Superseded pending relay payload (newest-frame-wins coalescing). */
  relayCoalesceSuperseded: number;
  /** IPC/main rejected send (e.g. relay token bucket) or invoke threw. */
  relayIpcFailures: number;
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
}

export interface GroupCallSourceWindowMetrics {
  sourceAddr: string;
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  avgPcmBufferedMs: number;
  playoutOutsideTargetFraction: number;
  avgOpusBufferedMs: number;
  maxOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  adaptiveTargetP95Ms: number;
  adaptiveTargetMaxMs: number;
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
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  dcBackpressureDrops: number;
  dcBackoffDrops: number;
  dcSendErrorDrops: number;
  relayDwellMs: number;
  relayDwellFraction: number;
  avgPcmBufferedMs: number;
  playoutOutsideTargetFraction: number;
  avgOpusBufferedMs: number;
  maxOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  adaptiveTargetP95Ms: number;
  adaptiveTargetMaxMs: number;
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

export interface GroupCallSourceStallAssessmentInput {
  sourceExpected: boolean;
  dcTransportReady: boolean;
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

  if (source.adaptiveTargetP95Ms >= 170) score += 1;
  if (source.avgPcmBufferedMs <= 20) score += 1;
  if (source.avgOpusBufferedMs <= 25) score += 1;

  return {
    activeSource: true,
    score,
    severe,
    shouldEscalate: severe || score >= 4,
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
  if (!activeSource || !input.dcTransportReady || !input.ingressPeerConnected) {
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

/** Mesh relay must be this recent (ms) to show "P2P relay" instead of Data channel. */
export const GROUP_CALL_RELAY_INDICATOR_STALE_MS = 2_500;

/** Compare-only fingerprint: normalize cluster/member order so duplicate topology heartbeats match. */
export function groupCallTopologyStructureFingerprint(topology: RouterTopology): string {
  const normClusters = topology.clusters
    .map((c) => ({
      forwarder: c.forwarder,
      standby: c.standby,
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
 * Same local epoch and same structure as previous topology → skip redundant React state updates
 * but still run WebRTC ensure on each root heartbeat.
 */
export function isGroupCallTopologyDuplicateHeartbeat(
  prev: RouterTopology | null,
  incoming: RouterTopology,
  localEpoch: number
): boolean {
  return (
    prev !== null &&
    incoming.topologyEpoch === localEpoch &&
    groupCallTopologyStructureFingerprint(incoming) === groupCallTopologyStructureFingerprint(prev)
  );
}

/** True when the hook should open a new RTCPeerConnection (no PC or terminal ICE state). */
export function isGroupCallWebRtcPeerInactive(connectionState: string | undefined): boolean {
  return connectionState === undefined || connectionState === 'failed' || connectionState === 'closed';
}

/**
 * How many cluster members may be in the middle of a DC handshake (e.g. re-joining)
 * before the root-forwarder's transport indicator downgrades to "relay".
 * Setting this to 1 prevents a single reconnecting peer from keeping the whole
 * transport mode stuck in relay while all other legs are healthy.
 */
export const DC_TRANSPORT_RECONNECT_TOLERANCE = 1;

/**
 * Whether required WebRTC DataChannels are open for the current role (upload path for non-root;
 * all downstream peers for root forwarder).
 */
export function computeGroupCallDcTransportReady(
  role: RouterRole,
  myAddress: string,
  topology: RouterTopology | null,
  peerDcOpen: (address: string) => boolean,
  upstreamDcOpen: boolean
): boolean {
  if (!topology) return false;
  if (role === 'root-forwarder') {
    // Tolerate up to DC_TRANSPORT_RECONNECT_TOLERANCE members mid-handshake so that
    // a single re-joining peer does not keep the entire transport indicator in
    // "relay" mode while the other legs are healthy.
    let closedCount = 0;
    for (const cluster of topology.clusters) {
      if (cluster.forwarder !== myAddress) continue;
      for (const member of cluster.members) {
        if (member === myAddress) continue;
        if (!peerDcOpen(member)) closedCount++;
      }
    }
    return closedCount <= DC_TRANSPORT_RECONNECT_TOLERANCE;
  }
  return upstreamDcOpen;
}

export type GroupCallTransportMode = 'datachannel' | 'relay' | 'connecting';

/**
 * Live transport indicator: DataChannels when role-required DCs are ready; else recent mesh relay;
 * else connecting. dcTransportReady wins over a brief relay burst during reconnect.
 */
export function getGroupCallTransportSummary(
  m: Pick<
    GroupCallMetricsSnapshot,
    'relayPacketsSent' | 'relayPacketsReceived' | 'lastRelayActivityAtMs'
  > & { dcTransportReady?: boolean },
  now: number = Date.now()
): { mode: GroupCallTransportMode; label: string; tooltip: string } {
  const staleMs = GROUP_CALL_RELAY_INDICATOR_STALE_MS;
  const recentRelay =
    m.lastRelayActivityAtMs > 0 && now - m.lastRelayActivityAtMs <= staleMs;
  const dcReady = m.dcTransportReady === true;

  if (dcReady) {
    return {
      mode: 'datachannel',
      label: 'Data channel',
      tooltip:
        'WebRTC DataChannels are up for this role. Mesh relay may still be used briefly for other legs during recovery.',
    };
  }
  if (recentRelay) {
    return {
      mode: 'relay',
      label: 'P2P relay',
      tooltip:
        'Audio is using the P2P mesh (GC_AUDIO) fallback — typically while WebRTC DataChannels connect or recover.',
    };
  }
  return {
    mode: 'connecting',
    label: 'Connecting…',
    tooltip:
      'WebRTC DataChannels are not all open yet; mesh relay may be used briefly when you speak.',
  };
}

interface ResourceCounts {
  decoders: number;
  playbackNodes: number;
  jitterBuffers: number;
}

interface WindowCounterSet {
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  dcBackpressureDrops: number;
  dcBackoffDrops: number;
  dcSendErrorDrops: number;
}

interface SourceWindowAccumulator {
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  playoutTicks: number;
  playoutOutsideTicks: number;
  playoutBufferedMsSum: number;
  playoutBufferedMsSamples: number;
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

function percentile(samples: readonly number[], percentileRank: number): number {
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
    jitterUnderruns: 0,
    missingFrames: 0,
    concealmentTicks: 0,
    dcBackpressureDrops: 0,
    dcBackoffDrops: 0,
    dcSendErrorDrops: 0,
  };
}

export class GroupCallPerformanceTracker {
  private snapshot: GroupCallMetricsSnapshot = {
    role: 'participant',
    packetsReceived: 0,
    packetsForwarded: 0,
    packetsDecoded: 0,
    packetsDropped: 0,
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
    lastUpdatedAt: 0,
    pcConnectedTransitions: 0,
    pcDisconnectedTransitions: 0,
    pcFailedTransitions: 0,
    pcClosedTransitions: 0,
    dcOpenCount: 0,
    dcCloseCount: 0,
    dcErrorCount: 0,
    iceRestartAttempts: 0,
    iceRestartSuccesses: 0,
    reconnectAttempts: 0,
    persistentDisconnectTeardowns: 0,
    avgRecoveryMs: 0,
    maxRecoveryMs: 0,
    dcBackpressureDrops: 0,
    dcBackoffDrops: 0,
    dcSendErrorDrops: 0,
    relayDwellMs: 0,
    relayDwellFraction: 0,
    adaptiveNetworkMode: 'low-latency',
    relayThrottleDrops: 0,
    relayCoalesceSuperseded: 0,
    relayIpcFailures: 0,
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
  };

  private incomingPacketSamples = 0;
  private incomingPacketTotalMs = 0;
  private jitterTickSamples = 0;
  private jitterTickTotalMs = 0;

  private playoutMetricTicks = 0;
  private playoutOutsideTicks = 0;
  private playoutBufferedMsSum = 0;
  private playoutBufferedMsSamples = 0;
  private recoverySamples = 0;
  private recoveryTotalMs = 0;
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
  private windowPlayoutBufferedMsSum = 0;
  private windowPlayoutBufferedMsSamples = 0;
  private windowOpusBufferedMsSum = 0;
  private windowOpusBufferedMsSamples = 0;
  private windowOpusBufferedMsMax = 0;
  private sourceWindowStats = new Map<string, SourceWindowAccumulator>();

  private getSourceWindowAccumulator(sourceAddr: string): SourceWindowAccumulator {
    let current = this.sourceWindowStats.get(sourceAddr);
    if (!current) {
      current = {
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        playoutTicks: 0,
        playoutOutsideTicks: 0,
        playoutBufferedMsSum: 0,
        playoutBufferedMsSamples: 0,
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
    this.windowPlayoutBufferedMsSum = 0;
    this.windowPlayoutBufferedMsSamples = 0;
    this.windowOpusBufferedMsSum = 0;
    this.windowOpusBufferedMsSamples = 0;
    this.windowOpusBufferedMsMax = 0;
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
    if (fecSuccessCoarse > 0) this.snapshot.wasmFecSuccessCoarse += fecSuccessCoarse;
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

  recordPcConnectionStateTransition(state: RTCPeerConnectionState): void {
    if (state === 'connected') this.snapshot.pcConnectedTransitions++;
    else if (state === 'disconnected') this.snapshot.pcDisconnectedTransitions++;
    else if (state === 'failed') this.snapshot.pcFailedTransitions++;
    else if (state === 'closed') this.snapshot.pcClosedTransitions++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcOpen(): void {
    this.snapshot.dcOpenCount++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcClose(): void {
    this.snapshot.dcCloseCount++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcError(): void {
    this.snapshot.dcErrorCount++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordIceRestartAttempt(): void {
    this.snapshot.iceRestartAttempts++;
    this.snapshot.reconnectAttempts++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordIceRestartSuccess(): void {
    this.snapshot.iceRestartSuccesses++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordPersistentDisconnectTeardown(): void {
    this.snapshot.persistentDisconnectTeardowns++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRecoveryDuration(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.recoverySamples++;
    this.recoveryTotalMs += durationMs;
    this.snapshot.avgRecoveryMs = roundMetric(
      this.recoveryTotalMs / Math.max(1, this.recoverySamples)
    );
    this.snapshot.maxRecoveryMs = roundMetric(
      Math.max(this.snapshot.maxRecoveryMs, durationMs)
    );
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcBackpressureDrop(): void {
    this.snapshot.dcBackpressureDrops++;
    this.windowCounters.dcBackpressureDrops++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcBackoffDrop(): void {
    this.snapshot.dcBackoffDrops++;
    this.windowCounters.dcBackoffDrops++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcSendErrorDrop(): void {
    this.snapshot.dcSendErrorDrops++;
    this.windowCounters.dcSendErrorDrops++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  setAdaptiveNetworkMode(mode: 'low-latency' | 'recovery'): void {
    this.snapshot.adaptiveNetworkMode = mode;
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
        this.windowRelayDwellAccumulatedMs += now - this.windowTransportModeSinceMs;
      }
      this.windowTransportMode = mode;
      this.windowTransportModeSinceMs = now;
    }
  }

  /** One periodic sample from group-playout-processor (every ~100ms audio per source). */
  recordPlayoutMetricTick(
    bufferedMs: number,
    outsideTargetBand: boolean,
    sourceAddr?: string
  ): void {
    this.playoutMetricTicks++;
    if (outsideTargetBand) this.playoutOutsideTicks++;
    this.playoutBufferedMsSum += bufferedMs;
    this.playoutBufferedMsSamples++;
    this.snapshot.avgPcmBufferedMs = roundMetric(
      this.playoutBufferedMsSum / Math.max(1, this.playoutBufferedMsSamples)
    );
    this.snapshot.playoutOutsideTargetFraction = roundMetric(
      this.playoutOutsideTicks / Math.max(1, this.playoutMetricTicks)
    );
    this.windowPlayoutMetricTicks++;
    if (outsideTargetBand) this.windowPlayoutOutsideTicks++;
    this.windowPlayoutBufferedMsSum += bufferedMs;
    this.windowPlayoutBufferedMsSamples++;
    if (sourceAddr) {
      const source = this.getSourceWindowAccumulator(sourceAddr);
      source.playoutTicks++;
      if (outsideTargetBand) source.playoutOutsideTicks++;
      source.playoutBufferedMsSum += bufferedMs;
      source.playoutBufferedMsSamples++;
    }
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordAdaptiveTargetSample(sourceAddr: string, targetMs: number): void {
    if (!Number.isFinite(targetMs) || targetMs <= 0) return;
    this.getSourceWindowAccumulator(sourceAddr).adaptiveTargetSamples.push(targetMs);
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordOpusBufferedMetric(sourceAddr: string, bufferedMs: number): void {
    if (!Number.isFinite(bufferedMs) || bufferedMs < 0) return;
    this.windowOpusBufferedMsSum += bufferedMs;
    this.windowOpusBufferedMsSamples++;
    this.windowOpusBufferedMsMax = Math.max(this.windowOpusBufferedMsMax, bufferedMs);
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
    const reduction = Number.isFinite(reductionDb) ? Math.min(0, reductionDb) : 0;
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
      lastUpdatedAt: now,
      pcConnectedTransitions: 0,
      pcDisconnectedTransitions: 0,
      pcFailedTransitions: 0,
      pcClosedTransitions: 0,
      dcOpenCount: 0,
      dcCloseCount: 0,
      dcErrorCount: 0,
      iceRestartAttempts: 0,
      iceRestartSuccesses: 0,
      reconnectAttempts: 0,
      persistentDisconnectTeardowns: 0,
      avgRecoveryMs: 0,
      maxRecoveryMs: 0,
      dcBackpressureDrops: 0,
      dcBackoffDrops: 0,
      dcSendErrorDrops: 0,
      relayDwellMs: 0,
      relayDwellFraction: 0,
      adaptiveNetworkMode: 'low-latency',
      relayThrottleDrops: 0,
      relayCoalesceSuperseded: 0,
      relayIpcFailures: 0,
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
    };
    this.incomingPacketSamples = 0;
    this.incomingPacketTotalMs = 0;
    this.jitterTickSamples = 0;
    this.jitterTickTotalMs = 0;
    this.playoutMetricTicks = 0;
    this.playoutOutsideTicks = 0;
    this.playoutBufferedMsSum = 0;
    this.playoutBufferedMsSamples = 0;
    this.recoverySamples = 0;
    this.recoveryTotalMs = 0;
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

  captureWindowMetrics(receivingPeer: string, endAt = Date.now()): GroupCallWindowMetrics {
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
            stats.playoutBufferedMsSum / Math.max(1, stats.playoutBufferedMsSamples)
          ),
          playoutOutsideTargetFraction: roundMetric(
            stats.playoutOutsideTicks / Math.max(1, stats.playoutTicks)
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
          wasmFecPlcFrames: stats.wasmFecPlcFrames,
          wasmFecAttempts: stats.wasmFecAttempts,
          wasmFecSuccessCoarse: stats.wasmFecSuccessCoarse,
          wasmFecDeferredPcmTicks: stats.wasmFecDeferredPcmTicks,
        };
      })
      .sort((a, b) => a.sourceAddr.localeCompare(b.sourceAddr));
    const allAdaptiveSamples = sources.flatMap((source) =>
      this.sourceWindowStats.get(source.sourceAddr)?.adaptiveTargetSamples ?? []
    );
    const worstSource = sources.reduce<GroupCallSourceWindowMetrics | null>(
      (worst, current) =>
        !worst || current.adaptiveTargetMaxMs > worst.adaptiveTargetMaxMs
          ? current
          : worst,
      null
    );
    const result: GroupCallWindowMetrics = {
      receivingPeer,
      startAt: this.windowStartedAtMs,
      endAt,
      durationMs: roundMetric(durationMs),
      jitterUnderruns: this.windowCounters.jitterUnderruns,
      missingFrames: this.windowCounters.missingFrames,
      concealmentTicks: this.windowCounters.concealmentTicks,
      dcBackpressureDrops: this.windowCounters.dcBackpressureDrops,
      dcBackoffDrops: this.windowCounters.dcBackoffDrops,
      dcSendErrorDrops: this.windowCounters.dcSendErrorDrops,
      relayDwellMs: roundMetric(relayDwellMs),
      relayDwellFraction: roundMetric(relayDwellMs / durationMs),
      avgPcmBufferedMs: roundMetric(
        this.windowPlayoutBufferedMsSum / Math.max(1, this.windowPlayoutBufferedMsSamples)
      ),
      playoutOutsideTargetFraction: roundMetric(
        this.windowPlayoutOutsideTicks / Math.max(1, this.windowPlayoutMetricTicks)
      ),
      avgOpusBufferedMs: roundMetric(
        this.windowOpusBufferedMsSum / Math.max(1, this.windowOpusBufferedMsSamples)
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
  if (!topology || (role !== 'cluster-forwarder' && role !== 'root-forwarder')) {
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
