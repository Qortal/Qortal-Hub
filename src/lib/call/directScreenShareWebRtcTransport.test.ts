import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DirectScreenShareWebRtcTransport,
  type DirectScreenShareRtcSignal,
} from './directScreenShareWebRtcTransport';

class FakePeerConnection {
  static latest: FakePeerConnection | null = null;
  static created = 0;
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addedTracks: MediaStreamTrack[] = [];
  offerOptions: RTCOfferOptions[] = [];
  configuredIceServers: RTCIceServer[][] = [];
  rejectCandidates = false;

  constructor() {
    FakePeerConnection.created += 1;
    FakePeerConnection.latest = this;
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    this.addedTracks.push(track);
    return {} as RTCRtpSender;
  }

  async createOffer(options: RTCOfferOptions = {}): Promise<RTCSessionDescriptionInit> {
    this.offerOptions.push(options);
    return { type: 'offer', sdp: 'screen-offer' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'screen-answer' };
  }

  async setLocalDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = {
      ...value,
      toJSON: () => value,
    } as RTCSessionDescription;
    this.signalingState =
      value.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(value: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = value as RTCSessionDescription;
    this.signalingState =
      value.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(): Promise<void> {
    if (this.rejectCandidates) throw new Error('stale-candidate');
  }

  setConfiguration(configuration: RTCConfiguration): void {
    this.configuredIceServers.push(configuration.iceServers ?? []);
  }

  close(): void {
    this.connectionState = 'closed';
  }
}

const originalPeerConnection = globalThis.RTCPeerConnection;

afterEach(() => {
  vi.useRealTimers();
  globalThis.RTCPeerConnection = originalPeerConnection;
  FakePeerConnection.latest = null;
  FakePeerConnection.created = 0;
  vi.restoreAllMocks();
});

describe('DirectScreenShareWebRtcTransport', () => {
  it('creates an isolated video-only offer for the sharing peer', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const track = { kind: 'video' } as MediaStreamTrack;
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const signals: DirectScreenShareRtcSignal[] = [];
    const transport = new DirectScreenShareWebRtcTransport({
      generation: 'screen_generation',
      sender: true,
      localStream: stream,
      getIceServers: async () => [],
      onSignal: (signal) => {
        signals.push(signal);
      },
      onRemoteStream: vi.fn(),
      onState: vi.fn(),
    });

    await transport.startSender();

    expect(FakePeerConnection.latest?.addedTracks).toEqual([track]);
    expect(signals[0]).toMatchObject({
      kind: 'screen-description',
      generation: 'screen_generation',
      description: { type: 'offer' },
    });
    transport.close();
  });

  it('answers an incoming screen offer and buffers early ICE safely', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const signals: DirectScreenShareRtcSignal[] = [];
    const transport = new DirectScreenShareWebRtcTransport({
      generation: 'screen_generation',
      sender: false,
      getIceServers: async () => [],
      onSignal: (signal) => {
        signals.push(signal);
      },
      onRemoteStream: vi.fn(),
      onState: vi.fn(),
    });

    await transport.handleSignal({
      kind: 'screen-ice',
      generation: 'screen_generation',
      candidate: { candidate: 'candidate' },
    });
    await transport.handleSignal({
      kind: 'screen-description',
      generation: 'screen_generation',
      description: { type: 'offer', sdp: 'screen-offer' },
    });

    expect(signals[0]).toMatchObject({
      kind: 'screen-description',
      generation: 'screen_generation',
      description: { type: 'answer' },
    });
    transport.close();
  });

  it('uses one peer connection when an offer and ICE arrive concurrently', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    let resolveIceServers: ((servers: RTCIceServer[]) => void) | null = null;
    const iceServers = new Promise<RTCIceServer[]>((resolve) => {
      resolveIceServers = resolve;
    });
    const signals: DirectScreenShareRtcSignal[] = [];
    const transport = new DirectScreenShareWebRtcTransport({
      generation: 'screen_generation',
      sender: false,
      getIceServers: () => iceServers,
      onSignal: (signal) => {
        signals.push(signal);
      },
      onRemoteStream: vi.fn(),
      onState: vi.fn(),
    });

    const offer = transport.handleSignal({
      kind: 'screen-description',
      generation: 'screen_generation',
      description: { type: 'offer', sdp: 'screen-offer' },
    });
    const candidate = transport.handleSignal({
      kind: 'screen-ice',
      generation: 'screen_generation',
      candidate: { candidate: 'candidate' },
    });

    expect(FakePeerConnection.created).toBe(0);
    resolveIceServers?.([]);
    await Promise.all([offer, candidate]);

    expect(FakePeerConnection.created).toBe(1);
    expect(signals).toContainEqual(
      expect.objectContaining({
        kind: 'screen-description',
        generation: 'screen_generation',
        description: expect.objectContaining({ type: 'answer' }),
      })
    );
    transport.close();
  });

  it('ignores signals belonging to another screen generation', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const transport = new DirectScreenShareWebRtcTransport({
      generation: 'expected_generation',
      sender: false,
      getIceServers: async () => [],
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
      onState: vi.fn(),
    });

    await transport.handleSignal({
      kind: 'screen-description',
      generation: 'stale_generation',
      description: { type: 'offer', sdp: 'stale' },
    });

    expect(FakePeerConnection.latest).toBeNull();
  });

  it('restarts sender ICE after a transient connection failure', async () => {
    vi.useFakeTimers();
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const track = { kind: 'video' } as MediaStreamTrack;
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const signals: DirectScreenShareRtcSignal[] = [];
    const states: string[] = [];
    const transport = new DirectScreenShareWebRtcTransport({
      generation: 'screen_generation',
      sender: true,
      localStream: stream,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      onSignal: (signal) => {
        signals.push(signal);
      },
      onRemoteStream: vi.fn(),
      onState: (state) => states.push(state),
    });

    await transport.startSender();
    const pc = FakePeerConnection.latest!;
    pc.connectionState = 'failed';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(pc.offerOptions).toEqual([{}, { iceRestart: true }]);
    expect(
      signals.filter((signal) => signal.kind === 'screen-description')
    ).toHaveLength(2);
    expect(states).not.toContain('failed');

    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(states).not.toContain('failed');
    transport.close();
  });

  it('ignores an unusable stale ICE candidate instead of ending the share', async () => {
    globalThis.RTCPeerConnection =
      FakePeerConnection as unknown as typeof RTCPeerConnection;
    const transport = new DirectScreenShareWebRtcTransport({
      generation: 'screen_generation',
      sender: false,
      getIceServers: async () => [],
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
      onState: vi.fn(),
    });

    await transport.handleSignal({
      kind: 'screen-description',
      generation: 'screen_generation',
      description: { type: 'offer', sdp: 'screen-offer' },
    });
    FakePeerConnection.latest!.rejectCandidates = true;

    await expect(
      transport.handleSignal({
        kind: 'screen-ice',
        generation: 'screen_generation',
        candidate: { candidate: 'stale-candidate' },
      })
    ).resolves.toBeUndefined();
    transport.close();
  });
});
