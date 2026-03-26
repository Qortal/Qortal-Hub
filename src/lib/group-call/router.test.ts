import { describe, expect, it, vi } from 'vitest';
import {
  buildSingleClusterTopologyWithStickyRoot,
  GroupCallPerformanceTracker,
  collectActiveSpeakers,
  computeGroupCallDcTransportReady,
  disposeParticipantAudioState,
  evaluateActiveSpeaker,
  forwardPacketForRole,
  getGroupCallTransportSummary,
  groupCallTopologyStructureFingerprint,
  isGroupCallTopologyDuplicateHeartbeat,
  isGroupCallWebRtcPeerInactive,
  reconcileParticipantSpeaking,
  sameAddressList,
} from './router';

describe('buildSingleClusterTopologyWithStickyRoot', () => {
  const CLUSTER = 10;

  it('keeps previous root when still in roster though not hash-min', () => {
    const sorted = ['a', 'b', 'c'];
    const topo = buildSingleClusterTopologyWithStickyRoot(sorted, 2, 'b', CLUSTER);
    expect(topo).not.toBeNull();
    expect(topo!.rootForwarder).toBe('b');
    expect(topo!.standbyForwarder).toBe('a');
    expect(topo!.clusters[0]).toEqual({
      members: sorted,
      forwarder: 'b',
      standby: 'a',
    });
  });

  it('falls back to hash-min when previous root left', () => {
    const sorted = ['a', 'b'];
    const topo = buildSingleClusterTopologyWithStickyRoot(sorted, 1, 'gone', CLUSTER);
    expect(topo!.rootForwarder).toBe('a');
    expect(topo!.standbyForwarder).toBe('b');
  });

  it('uses hash-min when no previous root', () => {
    const sorted = ['x', 'y'];
    const topo = buildSingleClusterTopologyWithStickyRoot(sorted, 1, undefined, CLUSTER);
    expect(topo!.rootForwarder).toBe('x');
    expect(topo!.standbyForwarder).toBe('y');
  });

  it('solo room: standby is empty string', () => {
    const topo = buildSingleClusterTopologyWithStickyRoot(['alice'], 1, null, CLUSTER);
    expect(topo!.rootForwarder).toBe('alice');
    expect(topo!.standbyForwarder).toBe('');
    expect(topo!.clusters[0].standby).toBe('');
  });

  it('returns null when over cluster size', () => {
    const sorted = Array.from({ length: 11 }, (_, i) => `p${i}`);
    expect(buildSingleClusterTopologyWithStickyRoot(sorted, 1, 'p0', CLUSTER)).toBeNull();
  });

  it('empty sorted matches flat topology shape', () => {
    const topo = buildSingleClusterTopologyWithStickyRoot([], 3, null, CLUSTER);
    expect(topo!.rootForwarder).toBe('');
    expect(topo!.standbyForwarder).toBe('');
    expect(topo!.clusters[0].members).toEqual([]);
  });
});

describe('group-call router helpers', () => {
  it('keeps existing speakers active but caps new ones', () => {
    const speakers = new Map([
      ['a', 1_000],
      ['b', 1_500],
    ]);

    expect(evaluateActiveSpeaker(speakers, 'a', true, 2_000, 2)).toBe(true);
    expect(evaluateActiveSpeaker(speakers, 'c', true, 2_000, 2)).toBe(false);
    expect(evaluateActiveSpeaker(speakers, 'c', true, 2_000, 3)).toBe(true);
    expect(evaluateActiveSpeaker(speakers, 'c', false, 2_000, 3)).toBe(false);
  });

  it('collects active speakers and keeps stable ordering checks cheap', () => {
    const speakers = new Map([
      ['a', 1_000],
      ['b', 2_000],
      ['c', 600],
    ]);
    const active = collectActiveSpeakers(speakers, 3_500, 2_000, 5);
    expect(active).toEqual(['b']);
    expect(sameAddressList(active, ['b'])).toBe(true);
    expect(sameAddressList(active, ['a'])).toBe(false);
  });

  it('reconciles participant speaking state without rebuilding unchanged rows', () => {
    const prev = [
      { address: 'a', publicKey: '1', speaking: false, role: 'participant' as const },
      { address: 'b', publicKey: '2', speaking: true, role: 'participant' as const },
    ];

    const unchanged = reconcileParticipantSpeaking(prev, ['b']);
    expect(unchanged).toBe(prev);

    const changed = reconcileParticipantSpeaking(prev, ['a']);
    expect(changed).not.toBe(prev);
    expect(changed.map((item) => item.speaking)).toEqual([true, false]);
    expect(changed[0]).not.toBe(prev[0]);
  });

  it('routes packets for root and cluster forwarders', () => {
    const sends: string[] = [];
    const topology = {
      topologyEpoch: 1,
      rootForwarder: 'root',
      standbyForwarder: 'standby',
      clusters: [
        { members: ['root', 'alice', 'bob'], forwarder: 'root', standby: 'standby' },
        { members: ['cluster', 'charlie'], forwarder: 'cluster', standby: 'charlie' },
      ],
    };

    const sendToAddress = (address: string) => {
      sends.push(address);
      return true;
    };

    const rootForwarded = forwardPacketForRole(
      'root-forwarder',
      topology,
      'root',
      'alice',
      new ArrayBuffer(1),
      sendToAddress
    );
    expect(rootForwarded).toBe(2);
    expect(sends).toEqual(['bob', 'cluster']);

    sends.length = 0;
    const clusterForwarded = forwardPacketForRole(
      'cluster-forwarder',
      topology,
      'cluster',
      'charlie',
      new ArrayBuffer(1),
      sendToAddress
    );
    expect(clusterForwarded).toBe(1);
    expect(sends).toEqual(['root']);
  });

  it('disposes participant audio resources safely', () => {
    const decoder = { state: 'configured', close: vi.fn() } as unknown as AudioDecoder;
    const node = { disconnect: vi.fn() } as unknown as AudioWorkletNode;
    const jitter = { clear: vi.fn() };

    const decoders = new Map([['alice', decoder]]);
    const playbackNodes = new Map([['alice', node]]);
    const jitterBuffers = new Map([['alice', jitter]]);
    const lastRecvAt = new Map([['alice', 1]]);
    const speakers = new Map([['alice', 2]]);

    disposeParticipantAudioState('alice', decoders, playbackNodes, jitterBuffers, lastRecvAt, speakers);

    expect((decoder.close as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((node.disconnect as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((jitter.clear as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(decoders.size).toBe(0);
    expect(playbackNodes.size).toBe(0);
    expect(jitterBuffers.size).toBe(0);
    expect(lastRecvAt.size).toBe(0);
    expect(speakers.size).toBe(0);
  });

  it('tracks metrics snapshots', () => {
    const tracker = new GroupCallPerformanceTracker();
    tracker.setRole('root-forwarder');
    tracker.recordPacketReceived();
    tracker.recordPacketForwarded(3);
    tracker.recordPacketDecoded(2);
    tracker.recordRelaySent();
    tracker.recordRelayReceived();
    tracker.recordIncomingPacketDuration(4);
    tracker.recordJitterTickDuration(2);
    tracker.recordJitterUnderrun(2);
    tracker.recordMissingFrames(2);
    tracker.recordConcealmentTick(1);
    tracker.recordPlayoutMetricTick(100, true);
    tracker.recordPlayoutMetricTick(100, false);
    tracker.setResourceCounts({ decoders: 2, playbackNodes: 1, jitterBuffers: 3 });

    expect(tracker.getSnapshot()).toMatchObject({
      role: 'root-forwarder',
      packetsReceived: 1,
      packetsForwarded: 3,
      packetsDecoded: 2,
      relayPacketsSent: 1,
      relayPacketsReceived: 1,
      lastRelayActivityAtMs: expect.any(Number),
      jitterUnderruns: 2,
      missingFrames: 2,
      concealmentTicks: 1,
      decoderCount: 2,
      playbackNodeCount: 1,
      jitterBufferCount: 3,
      avgIncomingPacketMs: 4,
      avgJitterTickMs: 2,
      avgPcmBufferedMs: 100,
      playoutOutsideTargetFraction: 0.5,
    });
  });

  it('getGroupCallTransportSummary: DC when channels ready and no recent relay', () => {
    expect(
      getGroupCallTransportSummary(
        {
          relayPacketsSent: 5,
          relayPacketsReceived: 0,
          lastRelayActivityAtMs: 1_000,
          dcTransportReady: true,
        },
        5_000
      )
    ).toMatchObject({
      mode: 'datachannel',
      label: 'Data channel',
    });
  });

  it('getGroupCallTransportSummary: DC wins when ready even if relay was recent', () => {
    expect(
      getGroupCallTransportSummary(
        {
          relayPacketsSent: 1,
          relayPacketsReceived: 0,
          lastRelayActivityAtMs: 4_000,
          dcTransportReady: true,
        },
        5_000
      )
    ).toMatchObject({
      mode: 'datachannel',
      label: 'Data channel',
    });
  });

  it('getGroupCallTransportSummary: connecting when not ready and relay stale', () => {
    expect(
      getGroupCallTransportSummary(
        {
          relayPacketsSent: 0,
          relayPacketsReceived: 0,
          lastRelayActivityAtMs: 0,
          dcTransportReady: false,
        },
        5_000
      )
    ).toMatchObject({
      mode: 'connecting',
      label: 'Connecting…',
    });
  });

  it('computeGroupCallDcTransportReady: root requires downstream DC to each member', () => {
    const topo = {
      topologyEpoch: 1,
      rootForwarder: 'root',
      standbyForwarder: 'b',
      clusters: [{ members: ['root', 'a', 'b'], forwarder: 'root', standby: 'b' }],
    };
    expect(
      computeGroupCallDcTransportReady('root-forwarder', 'root', topo, () => false, false)
    ).toBe(false);
    expect(
      computeGroupCallDcTransportReady('root-forwarder', 'root', topo, (addr) => addr === 'a' || addr === 'b', false)
    ).toBe(true);
    expect(computeGroupCallDcTransportReady('participant', 'a', topo, () => false, false)).toBe(false);
    expect(computeGroupCallDcTransportReady('participant', 'a', topo, () => false, true)).toBe(true);
  });

  it('isGroupCallWebRtcPeerInactive: disconnected/connecting are not inactive', () => {
    expect(isGroupCallWebRtcPeerInactive(undefined)).toBe(true);
    expect(isGroupCallWebRtcPeerInactive('failed')).toBe(true);
    expect(isGroupCallWebRtcPeerInactive('closed')).toBe(true);
    expect(isGroupCallWebRtcPeerInactive('disconnected')).toBe(false);
    expect(isGroupCallWebRtcPeerInactive('connecting')).toBe(false);
    expect(isGroupCallWebRtcPeerInactive('connected')).toBe(false);
    expect(isGroupCallWebRtcPeerInactive('new')).toBe(false);
  });

  it('duplicate topology heartbeat: same epoch+structure despite member order', () => {
    const a = {
      topologyEpoch: 3,
      rootForwarder: 'r',
      standbyForwarder: 's',
      clusters: [{ members: ['b', 'a', 'r'], forwarder: 'r', standby: 's' }],
    };
    const b = {
      topologyEpoch: 3,
      rootForwarder: 'r',
      standbyForwarder: 's',
      clusters: [{ members: ['r', 'a', 'b'], forwarder: 'r', standby: 's' }],
    };
    expect(groupCallTopologyStructureFingerprint(a)).toBe(groupCallTopologyStructureFingerprint(b));
    expect(isGroupCallTopologyDuplicateHeartbeat(a, b, 3)).toBe(true);
    expect(isGroupCallTopologyDuplicateHeartbeat(null, b, 3)).toBe(false);
    expect(isGroupCallTopologyDuplicateHeartbeat(a, { ...b, topologyEpoch: 4 }, 3)).toBe(false);
  });
});
