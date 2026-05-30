import { describe, expect, it } from 'vitest';
import type { GroupCallTopology } from './groupCallTopology';
import {
  buildStandbyRootFailoverTopology,
  computeTopologySettleMs,
  shouldRestartClusterHeartbeat,
  shouldRestartTopologyHeartbeat,
} from './groupCallTopologyLifecycle';

describe('groupCallTopologyLifecycle', () => {
  it('widens topology settle time on root change', () => {
    const previousTopology: GroupCallTopology = {
      topologyEpoch: 4,
      rootForwarder: 'Q-root-a',
      standbyForwarder: 'Q-standby',
      clusters: [],
    };
    const nextTopology: GroupCallTopology = {
      topologyEpoch: 5,
      rootForwarder: 'Q-root-b',
      standbyForwarder: 'Q-standby',
      clusters: [],
    };

    expect(
      computeTopologySettleMs({
        previousTopology,
        nextTopology,
        baseSettleMs: 1_500,
      })
    ).toBe(3_000);

    expect(
      computeTopologySettleMs({
        previousTopology,
        nextTopology: { ...nextTopology, rootForwarder: 'Q-root-a' },
        baseSettleMs: 1_500,
      })
    ).toBe(1_500);
  });

  it('restarts topology heartbeat only when root ownership meaningfully changes', () => {
    const previousTopology: GroupCallTopology = {
      topologyEpoch: 4,
      rootForwarder: 'Q-root',
      standbyForwarder: 'Q-standby',
      clusters: [],
    };
    const nextTopology: GroupCallTopology = {
      topologyEpoch: 5,
      rootForwarder: 'Q-root',
      standbyForwarder: 'Q-standby',
      clusters: [],
    };

    expect(
      shouldRestartTopologyHeartbeat({
        role: 'root-forwarder',
        previousRole: 'participant',
        previousTopology,
        nextTopology,
      })
    ).toBe(true);

    expect(
      shouldRestartTopologyHeartbeat({
        role: 'participant',
        previousRole: 'root-forwarder',
        previousTopology,
        nextTopology,
      })
    ).toBe(false);
  });

  it('restarts cluster heartbeat only for active forwarders with a cluster assignment', () => {
    const previousTopology: GroupCallTopology = {
      topologyEpoch: 4,
      rootForwarder: 'Q-root',
      standbyForwarder: 'Q-standby',
      clusters: [],
    };
    const nextTopology: GroupCallTopology = {
      topologyEpoch: 4,
      rootForwarder: 'Q-root',
      standbyForwarder: 'Q-standby-2',
      clusters: [],
    };

    expect(
      shouldRestartClusterHeartbeat({
        role: 'cluster-forwarder',
        previousRole: 'participant',
        previousTopology,
        nextTopology,
        clusterForwarderIndex: 1,
      })
    ).toBe(true);

    expect(
      shouldRestartClusterHeartbeat({
        role: 'participant',
        previousRole: 'participant',
        previousTopology,
        nextTopology,
        clusterForwarderIndex: -1,
      })
    ).toBe(false);
  });

  it('builds standby root failover topology with overridden root and standby', () => {
    const promotedTopology: GroupCallTopology = {
      topologyEpoch: 8,
      rootForwarder: 'Q-dead-root',
      standbyForwarder: 'Q-next',
      clusters: [
        {
          members: ['Q-dead-root', 'Q-self', 'Q-third'],
          forwarder: 'Q-dead-root',
          standby: 'Q-dead-root',
          standby2: '',
        },
      ],
    };

    expect(
      buildStandbyRootFailoverTopology({
        promotedTopology,
        sortedAddresses: ['Q-self', 'Q-peer', 'Q-third'],
        deadRoot: 'Q-dead-root',
        myAddress: 'Q-self',
        nowMs: 9_999,
      })
    ).toEqual({
      topologyEpoch: 8,
      rootForwarder: 'Q-self',
      standbyForwarder: 'Q-peer',
      lastSeen: 9_999,
      clusters: [
        {
          members: ['Q-dead-root', 'Q-self', 'Q-third'],
          forwarder: 'Q-self',
          standby: 'Q-peer',
          standby2: '',
        },
      ],
    });
  });
});
