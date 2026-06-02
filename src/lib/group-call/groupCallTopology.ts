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
}

export type GroupCallRole =
  | 'participant'
  | 'cluster-forwarder'
  | 'root-forwarder'
  | 'standby-forwarder';

export const DEFAULT_GROUP_CALL_CLUSTER_SIZE = 10;

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
  if (sorted.length <= clusterSize) {
    const root = sorted[0] ?? '';
    const standby = sorted[1] ?? '';
    const standby2 = sorted[2] ?? '';
    return {
      topologyEpoch,
      rootForwarder: root,
      standbyForwarder: standby,
      clusters: [
        {
          members: sorted,
          forwarder: root,
          standby: standby || root,
          standby2,
        },
      ],
    };
  }

  const clusters: GroupCallTopologyCluster[] = [];
  for (let i = 0; i < sorted.length; i += clusterSize) {
    const chunk = sorted.slice(i, i + clusterSize);
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
          if (member && member !== myAddress) targets.add(member);
        }
      } else if (cluster.forwarder) {
        targets.add(cluster.forwarder);
      }
    }
    const standbyForwarder = normalized.standbyForwarder.trim();
    if (standbyForwarder && standbyForwarder !== myAddress) {
      targets.add(standbyForwarder);
    }
  } else if (role === 'cluster-forwarder') {
    if (normalized.rootForwarder && normalized.rootForwarder !== myAddress) {
      targets.add(normalized.rootForwarder);
    }
    const myCluster = findMyCluster(myAddress, normalized);
    if (myCluster) {
      for (const member of myCluster.members) {
        if (member && member !== myAddress) targets.add(member);
      }
    }
  } else {
    const assignedForwarder = findAssignedForwarder(myAddress, normalized);
    if (assignedForwarder && assignedForwarder !== myAddress) {
      targets.add(assignedForwarder);
    }
  }
  return [...targets];
}

export function getRootInboundWarmPeers(
  myAddress: string,
  topology: GroupCallTopology
): string[] {
  if (!myAddress) return [];
  const normalized = normalizeGroupCallTopology(topology);
  const targets = new Set<string>();
  const standbyForwarder = normalized.standbyForwarder.trim();
  if (standbyForwarder && standbyForwarder !== myAddress) {
    targets.add(standbyForwarder);
  }
  for (const cluster of normalized.clusters) {
    if (cluster.forwarder === myAddress) {
      for (const member of cluster.members) {
        if (member && member !== myAddress) targets.add(member);
      }
    } else if (cluster.forwarder && cluster.forwarder.trim() !== myAddress) {
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
  return [...targets].filter((peer) => peer && peer !== myAddress);
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
