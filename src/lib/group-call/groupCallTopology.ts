export interface GroupCallTopologyCluster {
  members: string[];
  forwarder: string;
  standby: string;
  standby2?: string;
}

export interface GroupCallTopology {
  roomId?: string;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: GroupCallTopologyCluster[];
  lastSeen?: number;
  /** Verified network author, attached locally after main-process validation. */
  fromAddress?: string;
}

export type GroupCallRole =
  | 'participant'
  | 'cluster-forwarder'
  | 'root-forwarder'
  | 'standby-forwarder';

/** Keep calls with up to 15 participants on one forwarder; cluster at 16+. */
export const DEFAULT_GROUP_CALL_CLUSTER_SIZE = 15;

/**
 * Transport diagnostics may temporarily use `unknown` when an inbound audio
 * route has not been resolved to its signed Qortal sender yet. That sentinel
 * is never a participant identity and must not enter a roster or topology.
 */
export function isResolvedGroupCallParticipantAddress(
  addressValue: string | null | undefined
): boolean {
  const address = addressValue?.trim() ?? '';
  return address.length > 0 && address.toLowerCase() !== 'unknown';
}

export function isFanoutForwarderRole(role: GroupCallRole): boolean {
  return role === 'root-forwarder' || role === 'cluster-forwarder';
}

export function normalizeGroupCallTopology(
  topology: GroupCallTopology
): GroupCallTopology {
  return {
    ...topology,
    clusters: topology.clusters.map((cluster) => ({
      ...cluster,
      standby2: cluster.standby2 ?? '',
    })),
  };
}

export function buildGroupCallTopology(
  sorted: string[],
  topologyEpoch: number,
  clusterSize: number = DEFAULT_GROUP_CALL_CLUSTER_SIZE
): GroupCallTopology {
  const resolvedParticipants = sorted.filter(
    isResolvedGroupCallParticipantAddress
  );
  if (resolvedParticipants.length <= clusterSize) {
    const root = resolvedParticipants[0] ?? '';
    const standby = resolvedParticipants[1] ?? '';
    const standby2 = resolvedParticipants[2] ?? '';
    return {
      topologyEpoch,
      rootForwarder: root,
      standbyForwarder: standby,
      clusters: [
        {
          members: resolvedParticipants,
          forwarder: root,
          standby: standby || root,
          standby2,
        },
      ],
    };
  }

  const clusters: GroupCallTopologyCluster[] = [];
  for (let i = 0; i < resolvedParticipants.length; i += clusterSize) {
    const chunk = resolvedParticipants.slice(i, i + clusterSize);
    clusters.push({
      members: chunk,
      forwarder: chunk[0] ?? '',
      standby: chunk[1] ?? chunk[0] ?? '',
      standby2: chunk[2] ?? '',
    });
  }

  const clusterForwarders = clusters.map((cluster) => cluster.forwarder);
  return {
    topologyEpoch,
    rootForwarder: clusterForwarders[0] ?? '',
    standbyForwarder: clusterForwarders[1] ?? clusterForwarders[0] ?? '',
    clusters,
  };
}

export function computeGroupCallRole(
  myAddress: string,
  topology: GroupCallTopology
): GroupCallRole {
  if (myAddress === topology.rootForwarder) return 'root-forwarder';
  if (myAddress === topology.standbyForwarder) return 'standby-forwarder';
  if (topology.clusters.some((cluster) => cluster.forwarder === myAddress)) {
    return 'cluster-forwarder';
  }
  return 'participant';
}

export function findAssignedForwarder(
  myAddress: string,
  topology: GroupCallTopology
): string {
  const normalized = normalizeGroupCallTopology(topology);
  for (const cluster of normalized.clusters) {
    if (cluster.members.includes(myAddress)) {
      return cluster.forwarder;
    }
  }
  return normalized.rootForwarder;
}

function findMyCluster(
  myAddress: string,
  topology: GroupCallTopology
): GroupCallTopologyCluster | null {
  const normalized = normalizeGroupCallTopology(topology);
  for (const cluster of normalized.clusters) {
    if (cluster.members.includes(myAddress)) return cluster;
  }
  return null;
}

export function getReticulumTransportTargets(
  myAddress: string,
  topology: GroupCallTopology
): string[] {
  if (!myAddress) return [];
  const normalized = normalizeGroupCallTopology(topology);
  const role = computeGroupCallRole(myAddress, normalized);
  const targets = new Set<string>();
  if (role === 'root-forwarder') {
    for (const cluster of normalized.clusters) {
      if (cluster.forwarder === myAddress) {
        for (const member of cluster.members) {
          if (
            isResolvedGroupCallParticipantAddress(member) &&
            member !== myAddress
          ) {
            targets.add(member);
          }
        }
      } else if (isResolvedGroupCallParticipantAddress(cluster.forwarder)) {
        targets.add(cluster.forwarder);
      }
    }
    const standbyForwarder = normalized.standbyForwarder.trim();
    if (
      isResolvedGroupCallParticipantAddress(standbyForwarder) &&
      standbyForwarder !== myAddress
    ) {
      targets.add(standbyForwarder);
    }
  } else if (role === 'cluster-forwarder') {
    if (
      isResolvedGroupCallParticipantAddress(normalized.rootForwarder) &&
      normalized.rootForwarder !== myAddress
    ) {
      targets.add(normalized.rootForwarder);
    }
    const myCluster = findMyCluster(myAddress, normalized);
    if (myCluster) {
      for (const member of myCluster.members) {
        if (
          isResolvedGroupCallParticipantAddress(member) &&
          member !== myAddress
        ) {
          targets.add(member);
        }
      }
    }
  } else {
    const assignedForwarder = findAssignedForwarder(myAddress, normalized);
    if (
      isResolvedGroupCallParticipantAddress(assignedForwarder) &&
      assignedForwarder !== myAddress
    ) {
      targets.add(assignedForwarder);
    }
  }
  return [...targets];
}

/**
 * Keep WebRTC offer ownership deterministic for every topology edge. The
 * DataChannel is bidirectional once open, but both ends must agree about who
 * creates it while an edge is being negotiated.
 */
export function shouldOfferGroupRtcTransport(
  myAddress: string,
  peerAddress: string,
  topology: GroupCallTopology
): boolean {
  const normalized = normalizeGroupCallTopology(topology);
  const role = computeGroupCallRole(myAddress, normalized);
  return role === 'cluster-forwarder'
    ? peerAddress === normalized.rootForwarder
    : role !== 'root-forwarder' && role !== 'cluster-forwarder';
}

export type GroupRtcTopologyEdgeTransition =
  | 'preserve'
  | 'remove'
  | 'restart';

/**
 * Reconcile one existing WebRTC edge across a topology update. Open channels
 * remain usable in either direction, so only an obsolete edge or an in-flight
 * negotiation whose offer ownership changed needs to be torn down.
 */
export function classifyGroupRtcTopologyEdgeTransition(
  myAddress: string,
  peerAddress: string,
  isOpen: boolean,
  previousTopology: GroupCallTopology,
  nextTopology: GroupCallTopology
): GroupRtcTopologyEdgeTransition {
  if (
    !getReticulumTransportTargets(myAddress, nextTopology).includes(peerAddress)
  ) {
    return 'remove';
  }
  if (isOpen) return 'preserve';
  return shouldOfferGroupRtcTransport(
    myAddress,
    peerAddress,
    previousTopology
  ) === shouldOfferGroupRtcTransport(myAddress, peerAddress, nextTopology)
    ? 'preserve'
    : 'restart';
}

export function getRootInboundWarmPeers(
  myAddress: string,
  topology: GroupCallTopology
): string[] {
  if (!myAddress) return [];
  const normalized = normalizeGroupCallTopology(topology);
  const targets = new Set<string>();
  const standbyForwarder = normalized.standbyForwarder.trim();
  if (
    isResolvedGroupCallParticipantAddress(standbyForwarder) &&
    standbyForwarder !== myAddress
  ) {
    targets.add(standbyForwarder);
  }
  for (const cluster of normalized.clusters) {
    if (cluster.forwarder === myAddress) {
      for (const member of cluster.members) {
        if (
          isResolvedGroupCallParticipantAddress(member) &&
          member !== myAddress
        ) {
          targets.add(member);
        }
      }
    } else if (
      isResolvedGroupCallParticipantAddress(cluster.forwarder) &&
      cluster.forwarder.trim() !== myAddress
    ) {
      targets.add(cluster.forwarder.trim());
    }
  }
  return [...targets];
}

export function getPredictiveWarmPeers(
  myAddress: string,
  topology: GroupCallTopology
): string[] {
  const targets = new Set<string>();
  for (const peer of getRootInboundWarmPeers(myAddress, topology)) {
    targets.add(peer);
  }
  for (const peer of getReticulumTransportTargets(myAddress, topology)) {
    targets.add(peer);
  }
  return [...targets].filter(
    (peer) => isResolvedGroupCallParticipantAddress(peer) && peer !== myAddress
  );
}

export function findNonRootClusterStandbyDuty(
  myAddress: string,
  topology: GroupCallTopology
): { index: number; cluster: GroupCallTopologyCluster } | null {
  const normalized = normalizeGroupCallTopology(topology);
  if (normalized.clusters.length < 2) return null;
  for (let i = 0; i < normalized.clusters.length; i++) {
    const cluster = normalized.clusters[i]!;
    if (cluster.forwarder === normalized.rootForwarder) continue;
    if (cluster.standby === myAddress && cluster.forwarder !== myAddress) {
      return { index: i, cluster };
    }
  }
  return null;
}

export function findClusterIndexForForwarder(
  forwarder: string,
  topology: GroupCallTopology
): number {
  const normalized = normalizeGroupCallTopology(topology);
  for (let i = 0; i < normalized.clusters.length; i++) {
    if (normalized.clusters[i]!.forwarder === forwarder) return i;
  }
  return -1;
}
