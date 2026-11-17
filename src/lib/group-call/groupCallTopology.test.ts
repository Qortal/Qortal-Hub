import { describe, expect, it } from 'vitest';
import {
  buildGroupCallTopology,
  classifyGroupRtcTopologyEdgeTransition,
  DEFAULT_GROUP_CALL_CLUSTER_SIZE,
  getReticulumTransportTargets,
  isResolvedGroupCallParticipantAddress,
  shouldOfferGroupRtcTransport,
} from './groupCallTopology';

describe('group-call topology participant identities', () => {
  it('does not treat unresolved transport sentinels as participants', () => {
    expect(isResolvedGroupCallParticipantAddress('unknown')).toBe(false);
    expect(isResolvedGroupCallParticipantAddress(' UNKNOWN ')).toBe(false);
    expect(isResolvedGroupCallParticipantAddress('')).toBe(false);
    expect(isResolvedGroupCallParticipantAddress('Q-peer')).toBe(true);
  });

  it('does not elect or route audio to an unresolved transport sentinel', () => {
    const topology = buildGroupCallTopology(['Q-root', 'unknown', 'Q-peer'], 1);

    expect(topology.clusters[0]?.members).toEqual(['Q-root', 'Q-peer']);
    expect(getReticulumTransportTargets('Q-root', topology)).toEqual([
      'Q-peer',
    ]);
  });

  it('filters an unresolved sentinel from a topology received from a peer', () => {
    const targets = getReticulumTransportTargets('Q-root', {
      topologyEpoch: 4,
      rootForwarder: 'Q-root',
      standbyForwarder: 'unknown',
      clusters: [
        {
          members: ['Q-root', 'Q-peer', 'unknown'],
          forwarder: 'Q-root',
          standby: 'Q-peer',
          standby2: 'unknown',
        },
      ],
    });

    expect(targets).toEqual(['Q-peer']);
  });

  it('uses one forwarder through 15 participants and clusters at 16', () => {
    expect(DEFAULT_GROUP_CALL_CLUSTER_SIZE).toBe(15);

    const fifteen = Array.from({ length: 15 }, (_, index) => `Q-peer-${index}`);
    const singleForwarder = buildGroupCallTopology(fifteen, 1);
    expect(singleForwarder.clusters).toHaveLength(1);
    expect(singleForwarder.clusters[0]?.members).toEqual(fifteen);

    const sixteen = [...fifteen, 'Q-peer-15'];
    const clustered = buildGroupCallTopology(sixteen, 2);
    expect(clustered.clusters).toHaveLength(2);
    expect(clustered.clusters[0]?.members).toHaveLength(15);
    expect(clustered.clusters[1]?.members).toEqual(['Q-peer-15']);
  });
});

describe('group-call WebRTC topology transitions', () => {
  const initial = buildGroupCallTopology(['Q-root', 'Q-a', 'Q-b'], 1);

  it('keeps deterministic offer ownership on each topology edge', () => {
    expect(shouldOfferGroupRtcTransport('Q-root', 'Q-a', initial)).toBe(false);
    expect(shouldOfferGroupRtcTransport('Q-a', 'Q-root', initial)).toBe(true);

    const clustered = buildGroupCallTopology(
      Array.from({ length: 16 }, (_, index) => `Q-${index}`),
      2
    );
    expect(shouldOfferGroupRtcTransport('Q-15', 'Q-0', clustered)).toBe(true);
    expect(shouldOfferGroupRtcTransport('Q-0', 'Q-15', clustered)).toBe(false);
  });

  it('preserves existing WebRTC edges when another participant joins', () => {
    const joined = buildGroupCallTopology(
      ['Q-root', 'Q-a', 'Q-b', 'Q-c'],
      2
    );
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-a',
        'Q-root',
        true,
        initial,
        joined
      )
    ).toBe('preserve');
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-root',
        'Q-a',
        true,
        initial,
        joined
      )
    ).toBe('preserve');
  });

  it('preserves remaining WebRTC edges when a non-root participant leaves', () => {
    const left = buildGroupCallTopology(['Q-root', 'Q-a'], 2);
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-a',
        'Q-root',
        true,
        initial,
        left
      )
    ).toBe('preserve');
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-root',
        'Q-a',
        true,
        initial,
        left
      )
    ).toBe('preserve');
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-root',
        'Q-b',
        true,
        initial,
        left
      )
    ).toBe('remove');
  });

  it('removes obsolete edges and restarts only incompatible negotiations', () => {
    const newRoot = buildGroupCallTopology(['Q-a', 'Q-b'], 2);
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-b',
        'Q-root',
        true,
        initial,
        newRoot
      )
    ).toBe('remove');
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-root',
        'Q-a',
        false,
        initial,
        newRoot
      )
    ).toBe('restart');
    expect(
      classifyGroupRtcTopologyEdgeTransition(
        'Q-root',
        'Q-a',
        true,
        initial,
        newRoot
      )
    ).toBe('preserve');
  });
});
