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
  decoderCount: number;
  playbackNodeCount: number;
  jitterBufferCount: number;
  avgIncomingPacketMs: number;
  maxIncomingPacketMs: number;
  avgJitterTickMs: number;
  maxJitterTickMs: number;
  lastUpdatedAt: number;
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
    decoderCount: 0,
    playbackNodeCount: 0,
    jitterBufferCount: 0,
    avgIncomingPacketMs: 0,
    maxIncomingPacketMs: 0,
    avgJitterTickMs: 0,
    maxJitterTickMs: 0,
    lastUpdatedAt: 0,
  };

  private incomingPacketSamples = 0;
  private incomingPacketTotalMs = 0;
  private jitterTickSamples = 0;
  private jitterTickTotalMs = 0;

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
    this.snapshot.lastUpdatedAt = Date.now();
  }

  recordRelayReceived(count = 1): void {
    this.snapshot.relayPacketsReceived += count;
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
    this.snapshot = {
      ...this.snapshot,
      packetsReceived: 0,
      packetsForwarded: 0,
      packetsDecoded: 0,
      packetsDropped: 0,
      relayPacketsSent: 0,
      relayPacketsReceived: 0,
      decoderCount: 0,
      playbackNodeCount: 0,
      jitterBufferCount: 0,
      avgIncomingPacketMs: 0,
      maxIncomingPacketMs: 0,
      avgJitterTickMs: 0,
      maxJitterTickMs: 0,
      lastUpdatedAt: Date.now(),
    };
    this.incomingPacketSamples = 0;
    this.incomingPacketTotalMs = 0;
    this.jitterTickSamples = 0;
    this.jitterTickTotalMs = 0;
  }

  getSnapshot(): GroupCallMetricsSnapshot {
    return { ...this.snapshot };
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
