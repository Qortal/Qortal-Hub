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

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
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
  private sessionStartedAtMs = Date.now();
  private transportMode: GroupCallTransportMode = 'connecting';
  private transportModeSinceMs = Date.now();
  private relayDwellAccumulatedMs = 0;

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

  recordJitterUnderrun(count = 1): void {
    this.snapshot.jitterUnderruns += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordMissingFrames(count = 1): void {
    if (count <= 0) return;
    this.snapshot.missingFrames += count;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordConcealmentTick(count = 1): void {
    this.snapshot.concealmentTicks += count;
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
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcBackoffDrop(): void {
    this.snapshot.dcBackoffDrops++;
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordDcSendErrorDrop(): void {
    this.snapshot.dcSendErrorDrops++;
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
  }

  /** One periodic sample from group-playout-processor (every ~100ms audio per source). */
  recordPlayoutMetricTick(bufferedMs: number, outsideTargetBand: boolean): void {
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
    this.sessionStartedAtMs = now;
    this.transportMode = 'connecting';
    this.transportModeSinceMs = now;
    this.relayDwellAccumulatedMs = 0;
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
