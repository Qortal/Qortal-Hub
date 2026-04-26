import { describe, expect, it, vi } from 'vitest';
import {
  buildHierarchicalTopologyWithStickyRoot,
  assessGroupCallSourceStall,
  assessReticulumAudioPressureWindow,
  compareGroupCallSourceIsolationPriority,
  assessGroupCallSourceWindowForRecovery,
  buildSingleClusterTopologyWithStickyRoot,
  buildTopologyAfterClusterPromotion,
  chooseRouterTopologyAuthority,
  GroupCallPerformanceTracker,
  collectActiveSpeakers,
  disposeParticipantAudioState,
  collectForwardRecipientsForRole,
  evaluateActiveSpeaker,
  forwardPacketForRole,
  getGroupCallTransportSummary,
  groupCallTopologyStructureFingerprint,
  hasGroupCallSourceWindowMediaActivity,
  isGroupCallTopologyDuplicateHeartbeat,
  promoteClusterOfficersRow,
  pickWorstSourceForIsolation,
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
      standby2: 'c',
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

describe('pickWorstSourceForIsolation', () => {
  it('prefers real starvation over a merely higher adaptive target', () => {
    const worst = pickWorstSourceForIsolation([
      {
        sourceAddr: 'high-target',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 95,
        playoutOutsideTargetFraction: 0.1,
        playoutUnderTargetFraction: 0.1,
        avgPlayoutDeltaMs: -10,
        avgOpusBufferedMs: 92,
        maxOpusBufferedMs: 110,
        adaptiveTargetMedianMs: 130,
        adaptiveTargetP95Ms: 170,
        adaptiveTargetMaxMs: 185,
      },
      {
        sourceAddr: 'starved',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 120,
        avgPcmBufferedMs: 14,
        playoutOutsideTargetFraction: 1,
        playoutUnderTargetFraction: 1,
        avgPlayoutDeltaMs: -150,
        avgOpusBufferedMs: 20,
        maxOpusBufferedMs: 30,
        adaptiveTargetMedianMs: 120,
        adaptiveTargetP95Ms: 140,
        adaptiveTargetMaxMs: 145,
      },
    ]);
    expect(worst?.sourceAddr).toBe('starved');
  });

  it('uses reserve ratio and delta as tie-breakers when recovery scores match', () => {
    const preferred = compareGroupCallSourceIsolationPriority(
      {
        sourceAddr: 'thin',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 60,
        avgPcmBufferedMs: 18,
        playoutOutsideTargetFraction: 0.8,
        playoutUnderTargetFraction: 0.75,
        avgPlayoutDeltaMs: -95,
        avgOpusBufferedMs: 28,
        maxOpusBufferedMs: 40,
        adaptiveTargetMedianMs: 120,
        adaptiveTargetP95Ms: 140,
        adaptiveTargetMaxMs: 150,
      },
      {
        sourceAddr: 'less-thin',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 60,
        avgPcmBufferedMs: 30,
        playoutOutsideTargetFraction: 0.8,
        playoutUnderTargetFraction: 0.75,
        avgPlayoutDeltaMs: -70,
        avgOpusBufferedMs: 46,
        maxOpusBufferedMs: 58,
        adaptiveTargetMedianMs: 120,
        adaptiveTargetP95Ms: 150,
        adaptiveTargetMaxMs: 165,
      }
    );
    expect(preferred).toBeGreaterThan(0);
  });
});

describe('buildHierarchicalTopologyWithStickyRoot', () => {
  const CLUSTER = 3;

  it('keeps the previous root authoritative across clusters', () => {
    const topo = buildHierarchicalTopologyWithStickyRoot(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      4,
      'e',
      CLUSTER
    );
    expect(topo).not.toBeNull();
    expect(topo!.rootForwarder).toBe('e');
    expect(topo!.standbyForwarder).toBe('a');
    expect(topo!.clusters.map((cluster) => cluster.forwarder)).toEqual([
      'e',
      'a',
    ]);
    expect(topo!.clusters[0]).toEqual({
      members: ['e', 'd', 'f'],
      forwarder: 'e',
      standby: 'd',
      standby2: 'f',
    });
  });

  it('returns null when root is absent or room is single-cluster', () => {
    expect(
      buildHierarchicalTopologyWithStickyRoot(['a', 'b', 'c'], 1, 'b', CLUSTER)
    ).toBeNull();
    expect(
      buildHierarchicalTopologyWithStickyRoot(
        ['a', 'b', 'c', 'd'],
        1,
        'missing',
        CLUSTER
      )
    ).toBeNull();
  });
});

describe('chooseRouterTopologyAuthority', () => {
  it('accepts newer epochs and rejects stale ones', () => {
    const current = {
      topologyEpoch: 5,
      rootForwarder: 'root-b',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    expect(
      chooseRouterTopologyAuthority(current, {
        ...current,
        topologyEpoch: 6,
      })
    ).toEqual({
      acceptIncoming: true,
      reason: 'newer-epoch',
      winningRoot: 'root-b',
    });
    expect(
      chooseRouterTopologyAuthority(current, {
        ...current,
        topologyEpoch: 4,
      })
    ).toEqual({
      acceptIncoming: false,
      reason: 'stale-epoch',
      winningRoot: 'root-b',
    });
  });

  it('breaks same-epoch root conflicts by election digest even when lastSeen is newer', () => {
    const current = {
      topologyEpoch: 8,
      rootForwarder: 'alpha',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    const electionDigests = new Map<string, string>([
      ['alpha', 'dd957904'],
      ['beta', 'cdc71363'],
    ]);
    expect(
      chooseRouterTopologyAuthority(current, {
        ...current,
        rootForwarder: 'beta',
        lastSeen: 2_000,
      }, {
        compareRoots: (incomingRoot, currentRoot) =>
          electionDigests.get(incomingRoot)!.localeCompare(
            electionDigests.get(currentRoot)!
          ),
      })
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
      winningRoot: 'beta',
    });
    expect(
      chooseRouterTopologyAuthority(
        {
          ...current,
          rootForwarder: 'beta',
        },
        {
          ...current,
          rootForwarder: 'alpha',
          lastSeen: 2_000,
        },
        {
          compareRoots: (incomingRoot, currentRoot) =>
            electionDigests.get(incomingRoot)!.localeCompare(
              electionDigests.get(currentRoot)!
            ),
        }
      )
    ).toEqual({
      acceptIncoming: false,
      reason: 'rootForwarder-lexical',
      winningRoot: 'beta',
    });
  });

  it('ignores same-epoch root lastSeen deltas and keeps the digest winner', () => {
    const current = {
      topologyEpoch: 8,
      rootForwarder: 'alpha',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    expect(
      chooseRouterTopologyAuthority(
        current,
        { ...current, rootForwarder: 'beta', lastSeen: 1_080 },
        { roomId: 'r', sameEpochRootConflictStickyMs: 150 }
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
      winningRoot: 'beta',
    });
    expect(
      chooseRouterTopologyAuthority(
        current,
        { ...current, rootForwarder: 'beta', lastSeen: 1_200 },
        { roomId: 'r', sameEpochRootConflictStickyMs: 150 }
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
      winningRoot: 'beta',
    });
  });

  it('uses election digest when same-epoch roots differ but lastSeen ties', () => {
    const current = {
      topologyEpoch: 8,
      rootForwarder: 'alpha',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    const electionDigests = new Map<string, string>([
      ['alpha', 'dd957904'],
      ['beta', 'cdc71363'],
    ]);
    expect(
      chooseRouterTopologyAuthority(
        current,
        { ...current, rootForwarder: 'beta' },
        {
          compareRoots: (incomingRoot, currentRoot) =>
            electionDigests.get(incomingRoot)!.localeCompare(
              electionDigests.get(currentRoot)!
            ),
        }
      )
    ).toEqual({
      acceptIncoming: true,
      reason: 'rootForwarder-lexical',
      winningRoot: 'beta',
    });
  });

  it('refreshes same-root topologies by lastSeen only', () => {
    const current = {
      topologyEpoch: 8,
      rootForwarder: 'root-a',
      standbyForwarder: 'standby',
      clusters: [],
      lastSeen: 1_000,
    };
    expect(
      chooseRouterTopologyAuthority(current, {
        ...current,
        lastSeen: 2_000,
      })
    ).toEqual({
      acceptIncoming: true,
      reason: 'lastSeen',
      winningRoot: 'root-a',
    });
    expect(
      chooseRouterTopologyAuthority(current, {
        ...current,
        lastSeen: 1_000,
      })
    ).toEqual({
      acceptIncoming: false,
      reason: 'same-topology',
      winningRoot: 'root-a',
    });
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
        {
          members: ['root', 'alice', 'bob'],
          forwarder: 'root',
          standby: 'standby',
          standby2: 'bob',
        },
        {
          members: ['cluster', 'charlie'],
          forwarder: 'cluster',
          standby: 'charlie',
          standby2: '',
        },
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

  it('collectForwardRecipientsForRole matches forwardPacketForRole recipient set', () => {
    const topology = {
      topologyEpoch: 1,
      rootForwarder: 'root',
      standbyForwarder: 'standby',
      clusters: [
        {
          members: ['root', 'alice', 'bob'],
          forwarder: 'root',
          standby: 'standby',
          standby2: 'bob',
        },
        {
          members: ['cluster', 'charlie'],
          forwarder: 'cluster',
          standby: 'charlie',
          standby2: '',
        },
      ],
    };
    const rootRecipients = collectForwardRecipientsForRole(
      'root-forwarder',
      topology,
      'root',
      'alice'
    );
    expect(rootRecipients.sort()).toEqual(['bob', 'cluster'].sort());
    const clusterRecipients = collectForwardRecipientsForRole(
      'cluster-forwarder',
      topology,
      'cluster',
      'charlie'
    );
    expect(clusterRecipients).toEqual(['root']);
  });

  it('disposes participant audio resources safely', () => {
    const decoder = { state: 'configured', close: vi.fn() } as unknown as AudioDecoder;
    const node = { disconnect: vi.fn() } as unknown as AudioWorkletNode;
    const gainNode = { disconnect: vi.fn() } as unknown as GainNode;
    const jitter = { clear: vi.fn() };

    const decoders = new Map([['alice', decoder]]);
    const playbackNodes = new Map([['alice', node]]);
    const playbackGainNodes = new Map([['alice', gainNode]]);
    const jitterBuffers = new Map([['alice', jitter]]);
    const lastRecvAt = new Map([['alice', 1]]);
    const speakers = new Map([['alice', 2]]);

    disposeParticipantAudioState(
      'alice',
      decoders,
      playbackNodes,
      playbackGainNodes,
      jitterBuffers,
      lastRecvAt,
      speakers
    );

    expect((decoder.close as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((node.disconnect as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((gainNode.disconnect as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((jitter.clear as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(decoders.size).toBe(0);
    expect(playbackNodes.size).toBe(0);
    expect(playbackGainNodes.size).toBe(0);
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
    tracker.recordRelayThrottleDrop(2);
    tracker.recordRelayCoalesceSuperseded(3);
    tracker.recordRelayIpcFailure(1);
    tracker.recordReticulumAudioQueuePressureDrop(2);
    tracker.recordReticulumAudioStaleDrop(1);
    tracker.recordReticulumAudioLinkUnreadyDrop(1);
    tracker.recordReticulumAudioPacketSendFailure(3);
    tracker.recordReticulumAudioPacketPathActivity({
      requests: 4,
      resolutions: 3,
      timeouts: 1,
      freshSends: 8,
      staleSends: 2,
      unknownSends: 1,
    });
    tracker.setReticulumAudioQueueDepths({
      pendingFrames: 4,
      bridgeQueuedFrames: 7,
      decodedQueueDepth: 5,
      binaryOutQueueDepth: 2,
    });
    tracker.recordIncomingPacketDuration(4);
    tracker.recordJitterTickDuration(2);
    tracker.recordJitterUnderrun(2);
    tracker.recordMissingFrames(2);
    tracker.recordConcealmentTick(1);
    tracker.recordPlayoutMetricTick(100, true, undefined, {
      outsideUnder: true,
      deltaMs: -40,
    });
    tracker.recordPlayoutMetricTick(100, false, undefined, { deltaMs: 2 });
    tracker.recordMixerState(4, 0.55);
    tracker.recordMixerReductionSample(-3.2);
    tracker.setResourceCounts({ decoders: 2, playbackNodes: 1, jitterBuffers: 3 });

    expect(tracker.getSnapshot()).toMatchObject({
      role: 'root-forwarder',
      packetsReceived: 1,
      packetsForwarded: 3,
      packetsDecoded: 2,
      relayPacketsSent: 1,
      relayPacketsReceived: 1,
      relayThrottleDrops: 2,
      relayCoalesceSuperseded: 3,
      relayIpcFailures: 1,
      reticulumAudioPendingFrames: 4,
      reticulumAudioBridgeQueuedFrames: 7,
      reticulumAudioDecodedQueueDepth: 5,
      reticulumAudioBinaryOutQueueDepth: 2,
      reticulumAudioQueuePressureDrops: 2,
      reticulumAudioStaleDrops: 1,
      reticulumAudioLinkUnreadyDrops: 1,
      reticulumAudioPacketSendFailures: 3,
      reticulumAudioPacketPathRequests: 4,
      reticulumAudioPacketPathResolutions: 3,
      reticulumAudioPacketPathTimeouts: 1,
      reticulumAudioPacketFreshSends: 8,
      reticulumAudioPacketStaleSends: 2,
      reticulumAudioPacketUnknownSends: 1,
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
      playoutUnderTargetFraction: 0.5,
      playoutOverTargetFraction: 0,
      avgPlayoutDeltaMs: -19,
      mixerActiveSpeakerEstimate: 4,
      mixerMasterGain: 0.55,
      mixerCurrentReductionDb: -3.2,
      mixerOverloadEvents: 1,
      wasmFecPlcFrames: 0,
      wasmFecAttempts: 0,
      wasmFecSuccessCoarse: 0,
      wasmFecDeferredPcmTicks: 0,
    });
  });

  it('records root failover promotion count', () => {
    const tracker = new GroupCallPerformanceTracker();
    expect(tracker.getSnapshot().rootFailoverPromotionCount).toBe(0);
    tracker.recordRootFailoverPromotion(1);
    expect(tracker.getSnapshot().rootFailoverPromotionCount).toBe(1);
  });

  it('assesses bad per-source windows for media recovery', () => {
    expect(
      assessGroupCallSourceWindowForRecovery({
        sourceAddr: 'bad',
        jitterUnderruns: 425,
        missingFrames: 390,
        concealmentTicks: 338,
        avgPcmBufferedMs: 15.443,
        playoutOutsideTargetFraction: 0.985,
        playoutUnderTargetFraction: 0.92,
        avgPlayoutDeltaMs: -118,
        avgOpusBufferedMs: 22.965,
        maxOpusBufferedMs: 140,
        adaptiveTargetMedianMs: 120,
        adaptiveTargetP95Ms: 120,
        adaptiveTargetMaxMs: 120,
      })
    ).toMatchObject({
      activeSource: true,
      severe: true,
      shouldEscalate: true,
    });

    expect(
      assessGroupCallSourceWindowForRecovery({
        sourceAddr: 'healthy',
        jitterUnderruns: 1356,
        missingFrames: 0,
        concealmentTicks: 1,
        avgPcmBufferedMs: 137.714,
        playoutOutsideTargetFraction: 0.466,
        playoutUnderTargetFraction: 0.1,
        avgPlayoutDeltaMs: -12,
        avgOpusBufferedMs: 20.726,
        maxOpusBufferedMs: 200,
        adaptiveTargetMedianMs: 101.335,
        adaptiveTargetP95Ms: 116.66,
        adaptiveTargetMaxMs: 146.724,
      })
    ).toMatchObject({
      activeSource: true,
      severe: false,
      shouldEscalate: false,
    });
  });

  it('ignores idle sources when assessing media recovery', () => {
    expect(
      assessGroupCallSourceWindowForRecovery({
        sourceAddr: 'idle',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 479,
        avgPcmBufferedMs: 0.021,
        playoutOutsideTargetFraction: 1,
        playoutUnderTargetFraction: 0,
        avgPlayoutDeltaMs: 0,
        avgOpusBufferedMs: 0,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 0,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 0,
      })
    ).toEqual({
      activeSource: false,
      score: 0,
      severe: false,
      shouldEscalate: false,
    });
  });

  it('assesses live silent stalls separately from packet gaps', () => {
    expect(
      assessGroupCallSourceStall({
        sourceExpected: true,
        transportReady: true,
        ingressPeerConnected: true,
        lastRecvAgeMs: 15_000,
        opusBufferedMs: 0,
        adaptiveTargetMs: 0,
        adaptiveTargetIdleAgeMs: 15_000,
        hadRecentMediaWindow: true,
        gapEvidence: false,
      })
    ).toMatchObject({
      activeSource: true,
      stalled: true,
      gapEvidence: false,
      shouldEscalate: true,
    });

    expect(
      assessGroupCallSourceStall({
        sourceExpected: true,
        transportReady: true,
        ingressPeerConnected: true,
        lastRecvAgeMs: 15_000,
        opusBufferedMs: 0,
        adaptiveTargetMs: 0,
        adaptiveTargetIdleAgeMs: 15_000,
        hadRecentMediaWindow: true,
        gapEvidence: true,
      })
    ).toEqual({
      activeSource: true,
      stalled: false,
      gapEvidence: true,
      score: 0,
      severe: false,
      shouldEscalate: false,
    });
  });

  it('does not escalate silent stalls for idle or never-active sources', () => {
    expect(
      assessGroupCallSourceStall({
        sourceExpected: true,
        transportReady: true,
        ingressPeerConnected: true,
        lastRecvAgeMs: 20_000,
        opusBufferedMs: 0,
        adaptiveTargetMs: 0,
        adaptiveTargetIdleAgeMs: 20_000,
        hadRecentMediaWindow: false,
        gapEvidence: false,
      })
    ).toEqual({
      activeSource: false,
      stalled: false,
      gapEvidence: false,
      score: 0,
      severe: false,
      shouldEscalate: false,
    });

    expect(
      hasGroupCallSourceWindowMediaActivity({
        sourceAddr: 'idle',
        jitterUnderruns: 0,
        missingFrames: 0,
        concealmentTicks: 0,
        avgPcmBufferedMs: 0,
        playoutOutsideTargetFraction: 0,
        playoutUnderTargetFraction: 0,
        avgPlayoutDeltaMs: 0,
        avgOpusBufferedMs: 0,
        maxOpusBufferedMs: 0,
        adaptiveTargetMedianMs: 0,
        adaptiveTargetP95Ms: 0,
        adaptiveTargetMaxMs: 0,
      })
    ).toBe(false);
  });

  it('captures fixed-window metrics with per-source worst-leg detail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordTransportMode('relay', 0);
    tracker.recordJitterUnderrun(2, 'alice');
    tracker.recordMissingFrames(3, 'alice');
    tracker.recordConcealmentTick(1, 'alice');
    tracker.recordReticulumAudioQueuePressureDrop(2);
    tracker.recordReticulumAudioStaleDrop(1);
    tracker.recordReticulumAudioLinkUnreadyDrop(1);
    tracker.recordReticulumAudioPacketSendFailure(2);
    tracker.recordReticulumAudioPacketPathActivity({
      requests: 3,
      resolutions: 2,
      timeouts: 1,
      freshSends: 7,
      staleSends: 2,
      unknownSends: 1,
    });
    tracker.setReticulumAudioQueueDepths({
      pendingFrames: 14,
      pendingOldestAgeMs: 280,
      bridgeQueuedFrames: 6,
      bridgeQueuedOldestAgeMs: 190,
      decodedQueueDepth: 11,
      decodedQueueOldestAgeMs: 340,
      binaryOutQueueDepth: 3,
      binaryOutQueueOldestAgeMs: 120,
      queuePressureDropsLast5s: 2,
      staleDropsLast5s: 1,
      packetPathRequests: 3,
      packetPathResolutions: 2,
      packetPathTimeouts: 1,
      packetFreshSends: 7,
      packetStaleSends: 2,
      packetUnknownSends: 1,
    });
    tracker.recordPlayoutMetricTick(80, false, 'alice', { deltaMs: -5 });
    tracker.recordPlayoutMetricTick(120, true, 'alice', {
      outsideOver: true,
      deltaMs: 28,
    });
    tracker.recordReceiverIngressToPlayoutPostLatency('alice', 240);
    tracker.recordReceiverIngressToPlayoutPostLatency('alice', 480);
    tracker.recordReticulumAudioBridgeToRendererIngressLatency(55);
    tracker.recordReticulumAudioBridgeToRendererIngressLatency(95);
    tracker.recordAdaptiveTargetSample('alice', 110);
    tracker.recordAdaptiveTargetSample('alice', 155);
    tracker.recordOpusBufferedMetric('alice', 80);
    tracker.recordOpusBufferedMetric('alice', 120);

    tracker.recordAdaptiveTargetSample('bob', 95);
    tracker.recordOpusBufferedMetric('bob', 40);
    tracker.recordPendingDecryptDepth(50);
    tracker.recordPendingDecryptDepth(40);

    const window = tracker.captureWindowMetrics('me', 60_000);

    expect(window.receivingPeer).toBe('me');
    expect(window.packetsDropped).toBe(0);
    expect(window.packetsDroppedPendingDecrypt).toBe(0);
    expect(window.packetsDroppedStaleWorkerDecrypt).toBe(0);
    expect(window.packetsDroppedStartupGate).toBe(0);
    expect(window.packetsDroppedDecodeFailure).toBe(0);
    expect(window.packetsDroppedDecoderThrow).toBe(0);
    expect(window.packetsDroppedUnknownSource).toBe(0);
    expect(window.pendingDecryptDepthHighWater).toBe(50);
    expect(window.packetsDroppedPendingDecryptRatePerSec).toBe(0);
    expect(window.relayDwellFraction).toBe(1);
    expect(window.missingFrames).toBe(3);
    expect(window.jitterUnderruns).toBe(2);
    expect(window.reticulumAudioQueuePressureDrops).toBe(2);
    expect(window.reticulumAudioStaleDrops).toBe(1);
    expect(window.reticulumAudioLinkUnreadyDrops).toBe(1);
    expect(window.reticulumAudioPacketSendFailures).toBe(2);
    expect(window.reticulumAudioPacketPathRequests).toBe(3);
    expect(window.reticulumAudioPacketPathResolutions).toBe(2);
    expect(window.reticulumAudioPacketPathTimeouts).toBe(1);
    expect(window.reticulumAudioPacketFreshSends).toBe(7);
    expect(window.reticulumAudioPacketStaleSends).toBe(2);
    expect(window.reticulumAudioPacketUnknownSends).toBe(1);
    expect(window.reticulumAudioQueuePressureDropRatePerSec).toBe(0.033);
    expect(window.reticulumAudioPendingFramesHighWater).toBe(14);
    expect(window.reticulumAudioPendingOldestAgeMaxMs).toBe(280);
    expect(window.reticulumAudioBridgeQueuedOldestAgeMaxMs).toBe(190);
    expect(window.reticulumAudioDecodedQueueDepthHighWater).toBe(11);
    expect(window.reticulumAudioDecodedQueueOldestAgeMaxMs).toBe(340);
    expect(window.reticulumAudioBinaryOutQueueOldestAgeMaxMs).toBe(120);
    expect(window.avgPcmBufferedMs).toBe(100);
    expect(window.playoutOutsideTargetFraction).toBe(0.5);
    expect(window.playoutUnderTargetFraction).toBe(0);
    expect(window.playoutOverTargetFraction).toBe(0.5);
    expect(window.avgPlayoutDeltaMs).toBe(11.5);
    expect(window.avgReceiverIngressToPlayoutPostMs).toBe(360);
    expect(window.maxReceiverIngressToPlayoutPostMs).toBe(480);
    expect(window.avgReticulumAudioBridgeToRendererIngressMs).toBe(75);
    expect(window.maxReticulumAudioBridgeToRendererIngressMs).toBe(95);
    expect(window.worstSourceAddr).toBe('bob');
    expect(window.worstAdaptiveTargetMs).toBe(95);
    expect(window.sources).toEqual([
      expect.objectContaining({
        sourceAddr: 'alice',
        missingFrames: 3,
        jitterUnderruns: 2,
        concealmentTicks: 1,
        avgPcmBufferedMs: 100,
        playoutOutsideTargetFraction: 0.5,
        playoutUnderTargetFraction: 0,
        playoutOverTargetFraction: 0.5,
        avgPlayoutDeltaMs: 11.5,
        avgReceiverIngressToPlayoutPostMs: 360,
        maxReceiverIngressToPlayoutPostMs: 480,
        avgOpusBufferedMs: 100,
        maxOpusBufferedMs: 120,
        adaptiveTargetMedianMs: 110,
        adaptiveTargetP95Ms: 155,
        adaptiveTargetMaxMs: 155,
      }),
      expect.objectContaining({
        sourceAddr: 'bob',
        adaptiveTargetMaxMs: 95,
      }),
    ]);
    vi.useRealTimers();
  });

  it('records stale worker decrypt drops in snapshot and window', () => {
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordStaleWorkerDecryptDrop(2);
    expect(tracker.getSnapshot().packetsDroppedStaleWorkerDecrypt).toBe(2);
    expect(tracker.getSnapshot().packetsDropped).toBe(2);
    const w = tracker.captureWindowMetrics('me', 5_000);
    expect(w.packetsDroppedStaleWorkerDecrypt).toBe(2);
    expect(w.packetsDropped).toBe(2);
  });

  it('records unknown-source drops in snapshot and window', () => {
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordPacketDroppedWithReason('unknown-source', 2);
    expect(tracker.getSnapshot().packetsDroppedUnknownSource).toBe(2);
    expect(tracker.getSnapshot().packetsDropped).toBe(2);
    const w = tracker.captureWindowMetrics('me', 5_000);
    expect(w.packetsDroppedUnknownSource).toBe(2);
    expect(w.packetsDropped).toBe(2);
  });

  it('records stale-timestamp drops in snapshot and window', () => {
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordPacketDroppedWithReason('stale-timestamp', 3);
    expect(tracker.getSnapshot().packetsDroppedStaleTimestamp).toBe(3);
    expect(tracker.getSnapshot().packetsDropped).toBe(3);
    const w = tracker.captureWindowMetrics('me', 5_000);
    expect(w.packetsDroppedStaleTimestamp).toBe(3);
    expect(w.packetsDropped).toBe(3);
  });

  it('records outbound pre-timestamp sender pipeline in snapshot and window', () => {
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordGcallSenderPreEncodePipeline({
      workletToMainThreadMs: 2,
      mainThreadToEncoderOutputMs: 4,
      workletToEncoderOutputMs: 6,
    });
    tracker.recordGcallSenderPreEncodePipeline({
      workletToMainThreadMs: 4,
      mainThreadToEncoderOutputMs: 6,
      workletToEncoderOutputMs: 10,
    });
    tracker.recordGcallSenderEncoderToPacketTimestampGap(0.5);
    tracker.recordGcallSenderEncoderToPacketTimestampGap(1.5);
    const s = tracker.getSnapshot();
    expect(s.avgGcallSenderWorkletToMainThreadMs).toBe(3);
    expect(s.maxGcallSenderWorkletToMainThreadMs).toBe(4);
    expect(s.avgGcallSenderMainThreadToEncoderOutputMs).toBe(5);
    expect(s.maxGcallSenderMainThreadToEncoderOutputMs).toBe(6);
    expect(s.avgGcallSenderWorkletToEncoderOutputMs).toBe(8);
    expect(s.maxGcallSenderWorkletToEncoderOutputMs).toBe(10);
    expect(s.avgGcallSenderEncoderOutputToPacketTimestampMs).toBe(1);
    expect(s.maxGcallSenderEncoderOutputToPacketTimestampMs).toBe(1.5);
    const w = tracker.captureWindowMetrics('me', 10_000);
    expect(w.avgGcallSenderWorkletToMainThreadMs).toBe(3);
    expect(w.maxGcallSenderWorkletToMainThreadMs).toBe(4);
    expect(w.avgGcallSenderEncoderOutputToPacketTimestampMs).toBe(1);
    expect(w.maxGcallSenderEncoderOutputToPacketTimestampMs).toBe(1.5);
  });

  it('resets window-only ratios after capture', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordTransportMode('relay', 0);
    tracker.recordPlayoutMetricTick(90, true, 'alice');

    const first = tracker.captureWindowMetrics('me', 1_000);
    expect(first.playoutOutsideTargetFraction).toBe(1);
    expect(first.relayDwellFraction).toBe(1);

    tracker.recordTransportMode('reticulum', 1_000);
    const second = tracker.captureWindowMetrics('me', 2_000);
    expect(second.playoutOutsideTargetFraction).toBe(0);
    expect(second.relayDwellFraction).toBe(0);
    vi.useRealTimers();
  });

  it('records outbound Reticulum link vs packet samples (session + window)', () => {
    const tracker = new GroupCallPerformanceTracker();
    tracker.recordReticulumAudioOutboundTransport('packet');
    tracker.recordReticulumAudioOutboundTransport('packet');
    tracker.recordReticulumAudioOutboundTransport('link');
    const snap = tracker.getSnapshot();
    expect(snap.reticulumAudioOutboundPacketSamples).toBe(2);
    expect(snap.reticulumAudioOutboundLinkSamples).toBe(1);
    expect(snap.reticulumAudioOutboundTransportLast).toBe('link');
    const w = tracker.captureWindowMetrics('me');
    expect(w.reticulumAudioOutboundPacketSamples).toBe(2);
    expect(w.reticulumAudioOutboundLinkSamples).toBe(1);
    tracker.recordReticulumAudioOutboundTransport('packet');
    const w2 = tracker.captureWindowMetrics('me');
    expect(w2.reticulumAudioOutboundPacketSamples).toBe(1);
    expect(w2.reticulumAudioOutboundLinkSamples).toBe(0);
    expect(tracker.getSnapshot().reticulumAudioOutboundPacketSamples).toBe(3);
  });

  it('assesses reticulum queue-pressure windows separately from transport failure', () => {
    expect(
      assessReticulumAudioPressureWindow({
        durationMs: 10_000,
        reticulumAudioQueuePressureDrops: 90,
        reticulumAudioStaleDrops: 3,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPendingFramesHighWater: 18,
        reticulumAudioBridgeQueuedFramesHighWater: 9,
        reticulumAudioDecodedQueueDepthHighWater: 16,
        reticulumAudioBinaryOutQueueDepthHighWater: 4,
        packetsDroppedPendingDecrypt: 0,
        pendingDecryptDepthHighWater: 0,
      })
    ).toEqual({
      score: 9,
      severe: true,
      shouldTightenRecovery: true,
    });
  });

  it('assesses pending-decrypt backlog as pressure', () => {
    expect(
      assessReticulumAudioPressureWindow({
        durationMs: 10_000,
        reticulumAudioQueuePressureDrops: 0,
        reticulumAudioStaleDrops: 0,
        reticulumAudioPacketSendFailures: 0,
        reticulumAudioPendingFramesHighWater: 0,
        reticulumAudioBridgeQueuedFramesHighWater: 0,
        reticulumAudioDecodedQueueDepthHighWater: 0,
        reticulumAudioBinaryOutQueueDepthHighWater: 0,
        packetsDroppedPendingDecrypt: 40,
        pendingDecryptDepthHighWater: 95,
      })
    ).toEqual({
      score: 4,
      severe: true,
      shouldTightenRecovery: true,
    });
  });

  it('getGroupCallTransportSummary: Reticulum when transport is ready and no recent relay', () => {
    expect(
      getGroupCallTransportSummary(
        {
          relayPacketsSent: 5,
          relayPacketsReceived: 0,
          lastRelayActivityAtMs: 1_000,
          transportReady: true,
        },
        5_000
      )
    ).toMatchObject({
      mode: 'reticulum',
      label: 'Reticulum',
    });
  });

  it('getGroupCallTransportSummary: Reticulum wins when ready even if relay was recent', () => {
    expect(
      getGroupCallTransportSummary(
        {
          relayPacketsSent: 1,
          relayPacketsReceived: 0,
          lastRelayActivityAtMs: 4_000,
          transportReady: true,
        },
        5_000
      )
    ).toMatchObject({
      mode: 'reticulum',
      label: 'Reticulum',
    });
  });

  it('getGroupCallTransportSummary: connecting when not ready and relay stale', () => {
    expect(
      getGroupCallTransportSummary(
        {
          relayPacketsSent: 0,
          relayPacketsReceived: 0,
          lastRelayActivityAtMs: 0,
          transportReady: false,
        },
        5_000
      )
    ).toMatchObject({
      mode: 'connecting',
      label: 'Connecting…',
    });
  });

  it('duplicate topology heartbeat: same epoch+structure despite member order', () => {
    const a = {
      topologyEpoch: 3,
      rootForwarder: 'r',
      standbyForwarder: 's',
      clusters: [
        { members: ['b', 'a', 'r'], forwarder: 'r', standby: 's', standby2: '' },
      ],
    };
    const b = {
      topologyEpoch: 3,
      rootForwarder: 'r',
      standbyForwarder: 's',
      clusters: [
        { members: ['r', 'a', 'b'], forwarder: 'r', standby: 's', standby2: '' },
      ],
    };
    expect(groupCallTopologyStructureFingerprint(a)).toBe(groupCallTopologyStructureFingerprint(b));
    expect(isGroupCallTopologyDuplicateHeartbeat(a, b, 3)).toBe(true);
    expect(isGroupCallTopologyDuplicateHeartbeat(null, b, 3)).toBe(false);
    expect(isGroupCallTopologyDuplicateHeartbeat(a, { ...b, topologyEpoch: 4 }, 3)).toBe(false);
  });

  it('promoteClusterOfficersRow rotates forwarder within a cluster', () => {
    const c = {
      members: ['f', 's', 't'],
      forwarder: 'f',
      standby: 's',
      standby2: 't',
    };
    const p = promoteClusterOfficersRow(c);
    expect(p.forwarder).toBe('s');
    expect(p.standby).toBe('t');
    expect(p.standby2).toBe('f');
  });

  it('buildTopologyAfterClusterPromotion bumps epoch and room-level officers', () => {
    const base = {
      topologyEpoch: 5,
      rootForwarder: 'c1',
      standbyForwarder: 'c2',
      clusters: [
        { members: ['c1', 'a', 'b'], forwarder: 'c1', standby: 'a', standby2: 'b' },
        { members: ['c2', 'x', 'y'], forwarder: 'c2', standby: 'x', standby2: 'y' },
      ],
    };
    const next = buildTopologyAfterClusterPromotion(base, 1, 6);
    expect(next).not.toBeNull();
    expect(next!.topologyEpoch).toBe(6);
    expect(next!.clusters[1]!.forwarder).toBe('x');
    expect(next!.rootForwarder).toBe('c1');
    expect(next!.standbyForwarder).toBe('x');
  });
});
