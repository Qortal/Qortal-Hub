import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupCallWebRtcDataChannelTransport } from './groupCallWebRtcDataChannelTransport';

class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType: BinaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: unknown[] = [];

  send(value: unknown): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 'closed';
  }
}

class FakePeerConnection {
  static latest: FakePeerConnection | null = null;
  static instances: FakePeerConnection[] = [];
  static emitCandidateDuringSetLocal = false;
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly channel = new FakeDataChannel();
  createOfferCalls = 0;
  rollbackCalls = 0;
  rejectNextOfferAsIncompatible = false;
  rejectCandidate = '';
  readonly addedCandidates: RTCIceCandidateInit[] = [];

  constructor() {
    FakePeerConnection.latest = this;
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(): RTCDataChannel {
    return this.channel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.createOfferCalls += 1;
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-sdp' };
  }

  async setLocalDescription(
    description: RTCLocalSessionDescriptionInit
  ): Promise<void> {
    if (description.type === 'rollback') {
      this.rollbackCalls += 1;
      this.localDescription = null;
      this.signalingState = 'stable';
      return;
    }
    this.localDescription = description as RTCSessionDescription;
    this.signalingState =
      description.type === 'offer' ? 'have-local-offer' : 'stable';
    if (FakePeerConnection.emitCandidateDuringSetLocal) {
      this.onicecandidate?.({
        candidate: {
          toJSON: () => ({ candidate: 'candidate-during-local-description' }),
        },
      } as unknown as RTCPeerConnectionIceEvent);
      this.onicecandidate?.({
        candidate: null,
      } as unknown as RTCPeerConnectionIceEvent);
    }
  }

  async setRemoteDescription(
    description: RTCSessionDescriptionInit
  ): Promise<void> {
    if (description.type === 'offer' && this.rejectNextOfferAsIncompatible) {
      this.rejectNextOfferAsIncompatible = false;
      throw new Error(
        "Failed to set remote offer sdp: The order of m-lines in subsequent offer doesn't match order from previous offer/answer."
      );
    }
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState =
      description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (candidate.candidate === this.rejectCandidate) {
      throw new Error('stale-candidate');
    }
    this.addedCandidates.push(candidate);
  }
  getConfiguration(): RTCConfiguration {
    return { iceServers: [] };
  }
  setConfiguration(_configuration: RTCConfiguration): void {}
  close(): void {
    this.connectionState = 'closed';
  }
}

const originalPeerConnection = globalThis.RTCPeerConnection;

afterEach(() => {
  vi.useRealTimers();
  globalThis.RTCPeerConnection = originalPeerConnection;
  FakePeerConnection.latest = null;
  FakePeerConnection.instances = [];
  FakePeerConnection.emitCandidateDuringSetLocal = false;
  vi.restoreAllMocks();
});

describe('GroupCallWebRtcDataChannelTransport', () => {
  it('waits for peer capability before the offer and sends only on an open channel', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await transport.start(false);
    expect(signals).toEqual([]);
    expect(transport.send(new Uint8Array([1]))).toBe(false);

    await transport.enableNegotiation();
    expect(signals).toEqual(['offer']);

    const channel = FakePeerConnection.latest!.channel;
    channel.readyState = 'open';
    channel.onopen?.();
    expect(transport.send(new Uint8Array([2]))).toBe(true);
    expect(channel.sent).toHaveLength(1);
  });

  it('asks the offerer to reconnect when the answering edge needs recovery', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: false,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await transport.start(false);
    await transport.requestRecovery();
    expect(signals).toEqual(['reconnect']);
  });

  it('serializes overlapping negotiation requests into one offer', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await transport.start(false);
    await Promise.all([
      transport.enableNegotiation(),
      transport.enableNegotiation(),
    ]);

    expect(signals).toEqual(['offer']);
  });

  it('batches locally gathered ICE candidates into one signal', async () => {
    vi.useFakeTimers();
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const signals: Array<{ type: string; count?: number }> = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        signals.push({
          type: signal.type,
          count:
            signal.type === 'candidates' ? signal.candidates.length : undefined,
        });
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await transport.start(true);
    const pc = FakePeerConnection.latest!;
    for (const index of [1, 2, 3]) {
      pc.onicecandidate?.({
        candidate: {
          toJSON: () => ({ candidate: `candidate-${index}` }),
        },
      } as unknown as RTCPeerConnectionIceEvent);
    }
    expect(signals.map((signal) => signal.type)).toEqual(['offer']);

    await vi.advanceTimersByTimeAsync(75);

    expect(signals).toEqual([
      { type: 'offer', count: undefined },
      { type: 'candidates', count: 3 },
    ]);
    transport.close();
  });

  it('always sends the description before candidates emitted during setup', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    FakePeerConnection.emitCandidateDuringSetLocal = true;
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await transport.start(true);

    expect(signals).toEqual(['offer', 'candidates']);
    transport.close();
  });

  it('does not send candidates when sending their description fails', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    FakePeerConnection.emitCandidateDuringSetLocal = true;
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
        if (signal.type === 'offer') throw new Error('signal-send-failed');
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await expect(transport.start(true)).rejects.toThrow('signal-send-failed');
    FakePeerConnection.latest!.onicecandidate?.({
      candidate: {
        toJSON: () => ({ candidate: 'candidate-after-failed-offer' }),
      },
    } as unknown as RTCPeerConnectionIceEvent);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(signals).toEqual(['offer']);
    transport.close();
  });

  it('ignores malformed candidate collections without disrupting negotiation', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: false,
      iceServers: [],
      onSignal: vi.fn(),
      onPacket: vi.fn(),
      onState: vi.fn(),
    });
    await transport.start(false);

    await expect(
      transport.handleSignal({
        type: 'candidates',
        candidates: null,
      } as unknown as Parameters<typeof transport.handleSignal>[0])
    ).resolves.toBeUndefined();

    await transport.handleSignal({
      type: 'offer',
      generation: 'generation-valid',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    expect(FakePeerConnection.latest!.remoteDescription?.type).toBe('offer');
    transport.close();
  });

  it('applies every candidate in a received candidate batch', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: false,
      iceServers: [],
      onSignal: vi.fn(),
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    await transport.start(false);
    await transport.handleSignal({
      type: 'offer',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    await transport.handleSignal({
      type: 'candidates',
      candidates: [{ candidate: 'candidate-1' }, { candidate: 'candidate-2' }],
    });

    expect(FakePeerConnection.latest!.addedCandidates).toEqual([
      { candidate: 'candidate-1' },
      { candidate: 'candidate-2' },
    ]);
  });

  it('continues applying a batch after one stale candidate fails', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: false,
      iceServers: [],
      onSignal: vi.fn(),
      onPacket: vi.fn(),
      onState: vi.fn(),
    });
    await transport.start(false);
    await transport.handleSignal({
      type: 'offer',
      generation: 'generation-1',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    FakePeerConnection.latest!.rejectCandidate = 'candidate-stale';
    await transport.handleSignal({
      type: 'candidates',
      generation: 'generation-1',
      candidates: [
        { candidate: 'candidate-stale' },
        { candidate: 'candidate-current' },
      ],
    });

    expect(FakePeerConnection.latest!.addedCandidates).toEqual([
      { candidate: 'candidate-current' },
    ]);
    transport.close();
  });

  it('rejects an offer from a retired negotiation generation', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: false,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });
    await transport.start(false);
    await transport.handleSignal({
      type: 'offer',
      generation: 'generation-old',
      description: { type: 'offer', sdp: 'old' },
    });
    await transport.handleSignal({
      type: 'offer',
      generation: 'generation-new',
      description: { type: 'offer', sdp: 'new' },
    });
    await transport.handleSignal({
      type: 'offer',
      generation: 'generation-old',
      description: { type: 'offer', sdp: 'old-delayed' },
    });

    expect(signals).toEqual(['answer', 'answer']);
    transport.close();
  });

  it('rolls back an unopened host-only offer before applying late ICE servers', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const generations: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        if (signal.type === 'offer' && signal.generation) {
          generations.push(signal.generation);
        }
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });
    await transport.start(true);
    const pc = FakePeerConnection.latest!;
    await transport.updateIceServers([{ urls: 'stun:community.test:47321' }]);

    expect(pc.rollbackCalls).toBe(1);
    expect(pc.createOfferCalls).toBe(2);
    expect(generations).toHaveLength(2);
    expect(generations[1]).not.toBe(generations[0]);
    transport.close();
  });

  it('resends the pending offer without rolling it back or changing its SDP', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const offers: RTCSessionDescriptionInit[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: true,
      iceServers: [],
      onSignal: (signal) => {
        if (signal.type === 'offer') offers.push(signal.description);
      },
      onPacket: vi.fn(),
      onState: vi.fn(),
    });

    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await transport.start(false);
    await transport.enableNegotiation();
    vi.spyOn(Date, 'now').mockReturnValue(8_000);
    await transport.enableNegotiation();

    const pc = FakePeerConnection.latest!;
    expect(offers).toHaveLength(2);
    expect(offers[1]).toEqual(offers[0]);
    expect(pc.createOfferCalls).toBe(1);
    expect(pc.rollbackCalls).toBe(0);
  });

  it('replaces only the peer connection when a restarted peer has incompatible SDP', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const states: string[] = [];
    const signals: string[] = [];
    const transport = new GroupCallWebRtcDataChannelTransport({
      peerAddress: 'peer',
      offerer: false,
      iceServers: [],
      onSignal: (signal) => {
        signals.push(signal.type);
      },
      onPacket: vi.fn(),
      onState: (state) => states.push(state),
    });

    await transport.start(false);
    await transport.handleSignal({
      type: 'offer',
      description: { type: 'offer', sdp: 'first-offer' },
    });
    const first = FakePeerConnection.latest!;
    first.rejectNextOfferAsIncompatible = true;
    await transport.handleSignal({
      type: 'offer',
      description: { type: 'offer', sdp: 'replacement-offer' },
    });

    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(first.connectionState).toBe('closed');
    expect(states).toContain('connecting');
    expect(signals).toEqual(['answer', 'answer']);
  });
});
