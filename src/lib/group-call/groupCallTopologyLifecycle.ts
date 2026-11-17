import type {
  GroupCallRole,
  GroupCallTopology,
} from './groupCallTopology';

export function computeTopologySettleMs(opts: {
  previousTopology: GroupCallTopology | null;
  nextTopology: GroupCallTopology;
  baseSettleMs: number;
}): number {
  if (
    opts.previousTopology &&
    opts.previousTopology.rootForwarder !== opts.nextTopology.rootForwarder
  ) {
    return opts.baseSettleMs * 2;
  }
  return opts.baseSettleMs;
}

export function shouldRestartTopologyHeartbeat(opts: {
  role: GroupCallRole;
  previousRole: GroupCallRole;
  previousTopology: GroupCallTopology | null;
  nextTopology: GroupCallTopology;
}): boolean {
  return (
    opts.role === 'root-forwarder' &&
    (opts.previousRole !== 'root-forwarder' ||
      !opts.previousTopology ||
      opts.previousTopology.topologyEpoch !== opts.nextTopology.topologyEpoch ||
      opts.previousTopology.rootForwarder !== opts.nextTopology.rootForwarder ||
      opts.previousTopology.standbyForwarder !==
        opts.nextTopology.standbyForwarder)
  );
}

export function shouldRestartClusterHeartbeat(opts: {
  role: GroupCallRole;
  previousRole: GroupCallRole;
  previousTopology: GroupCallTopology | null;
  nextTopology: GroupCallTopology;
  clusterForwarderIndex: number;
}): boolean {
  return (
    (opts.role === 'cluster-forwarder' || opts.role === 'root-forwarder') &&
    opts.clusterForwarderIndex >= 0 &&
    (opts.previousRole !== opts.role ||
      !opts.previousTopology ||
      opts.previousTopology.topologyEpoch !== opts.nextTopology.topologyEpoch ||
      opts.previousTopology.rootForwarder !== opts.nextTopology.rootForwarder ||
      opts.previousTopology.standbyForwarder !==
        opts.nextTopology.standbyForwarder)
  );
}

export function buildStandbyRootFailoverTopology(opts: {
  promotedTopology: GroupCallTopology;
  sortedAddresses: string[];
  deadRoot: string;
  myAddress: string;
  nowMs: number;
}): GroupCallTopology {
  const overriddenStandby =
    opts.sortedAddresses.find((address) => address !== opts.myAddress) ?? '';
  const overriddenClusters = opts.promotedTopology.clusters.map((cluster) => ({
    ...cluster,
    forwarder:
      cluster.forwarder === opts.deadRoot ? opts.myAddress : cluster.forwarder,
    standby:
      cluster.standby === opts.deadRoot ? overriddenStandby : cluster.standby,
    standby2: cluster.standby2 ?? '',
  }));
  return {
    ...opts.promotedTopology,
    rootForwarder: opts.myAddress,
    standbyForwarder: overriddenStandby,
    clusters: overriddenClusters,
    lastSeen: opts.nowMs,
  };
}
