import { describe, expect, it, vi } from 'vitest';
import {
  GroupCallPerformanceTracker,
  collectActiveSpeakers,
  disposeParticipantAudioState,
  evaluateActiveSpeaker,
  forwardPacketForRole,
  reconcileParticipantSpeaking,
  sameAddressList,
} from './router';

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
    tracker.setResourceCounts({ decoders: 2, playbackNodes: 1, jitterBuffers: 3 });

    expect(tracker.getSnapshot()).toMatchObject({
      role: 'root-forwarder',
      packetsReceived: 1,
      packetsForwarded: 3,
      packetsDecoded: 2,
      relayPacketsSent: 1,
      relayPacketsReceived: 1,
      decoderCount: 2,
      playbackNodeCount: 1,
      jitterBufferCount: 3,
      avgIncomingPacketMs: 4,
      avgJitterTickMs: 2,
    });
  });
});
