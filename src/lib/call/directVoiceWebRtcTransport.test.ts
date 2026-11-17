import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectVoiceWebRtcTransport,
  type DirectVoiceRtcSignal,
} from './directVoiceWebRtcTransport';

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];
  static emitCandidateDuringSetLocal = false;
  static deferSetLocalDescription = false;
  static releaseSetLocalDescription: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  private eventListeners = new Map<string, Set<() => void>>();
  addTrack = vi.fn();
  replaceTrack = vi.fn(async () => {});
  getSenders = vi.fn(() => [
    {
      track: { kind: 'audio' },
      replaceTrack: this.replaceTrack,
    } as unknown as RTCRtpSender,
  ]);
  addIceCandidate = vi.fn(async () => {});
  createAnswer = vi.fn(
    async () => ({ type: 'answer', sdp: 'answer' }) as RTCSessionDescriptionInit
  );
  createOffer = vi.fn(
    async () => ({ type: 'offer', sdp: 'offer' }) as RTCSessionDescriptionInit
  );
  setRemoteDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.remoteDescription = {
        type: description.type,
        sdp: description.sdp ?? '',
        toJSON: () => description,
      } as RTCSessionDescription;
      this.signalingState =
        description.type === 'offer' ? 'have-remote-offer' : 'stable';
    }
  );
  setLocalDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      if (MockPeerConnection.emitCandidateDuringSetLocal) {
        this.onicecandidate?.({
          candidate: {
            type: 'host',
            protocol: 'udp',
            toJSON: () => ({
              candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host',
            }),
          } as RTCIceCandidate,
        } as RTCPeerConnectionIceEvent);
      }
      this.localDescription = {
        type: description.type,
        sdp: description.sdp ?? '',
        toJSON: () => description,
      } as RTCSessionDescription;
      this.signalingState =
        description.type === 'offer' ? 'have-local-offer' : 'stable';
      if (MockPeerConnection.deferSetLocalDescription) {
        await new Promise<void>((resolve) => {
          MockPeerConnection.releaseSetLocalDescription = resolve;
        });
      }
    }
  );
  setConfiguration = vi.fn();
  getConfiguration = vi.fn(() => ({ iceServers: [] }));
  addEventListener = vi.fn((type: string, listener: () => void) => {
    const listeners = this.eventListeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.eventListeners.set(type, listeners);
  });
  removeEventListener = vi.fn((type: string, listener: () => void) => {
    this.eventListeners.get(type)?.delete(listener);
  });
  emitEvent(type: string): void {
    for (const listener of this.eventListeners.get(type) ?? []) listener();
  }
  close = vi.fn();

  constructor(_configuration?: RTCConfiguration) {
    MockPeerConnection.instances.push(this);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockPeerConnection.instances = [];
  MockPeerConnection.emitCandidateDuringSetLocal = false;
  MockPeerConnection.deferSetLocalDescription = false;
  MockPeerConnection.releaseSetLocalDescription = null;
});

describe('DirectVoiceWebRtcTransport', () => {
  const audioTrack = {
    id: 'mic-track',
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const localStream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack],
  } as unknown as MediaStream;

  it('keeps a candidate that arrives before its offer', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });
    await transport.start();

    const candidate = {
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host',
    };
    await transport.handleSignal({
      kind: 'ice',
      generation: 'generation_1234',
      candidate,
    });
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'offer', sdp: 'offer' },
    });

    const pc = MockPeerConnection.instances[0]!;
    expect(pc.setRemoteDescription).toHaveBeenCalledOnce();
    expect(pc.addTrack).toHaveBeenCalledWith(audioTrack, localStream);
    expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate);
    expect(emitted).toContainEqual({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'answer', sdp: 'answer' },
    });
    transport.close();
  });

  it('applies every candidate in an authenticated candidate batch', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });
    await transport.start();
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_batch',
      description: { type: 'offer', sdp: 'offer' },
    });
    await transport.handleSignal({
      kind: 'ice-candidates',
      generation: 'generation_batch',
      candidates: [{ candidate: 'candidate-1' }, { candidate: 'candidate-2' }],
    });

    expect(
      MockPeerConnection.instances[0]!.addIceCandidate
    ).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('does not let a retired offer generation replace the current one', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });
    await transport.start();
    const offer = (generation: string) =>
      transport.handleSignal({
        kind: 'description' as const,
        generation,
        description: { type: 'offer' as const, sdp: generation },
      });
    await offer('generation_old');
    await offer('generation_new');
    await offer('generation_old');

    expect(
      MockPeerConnection.instances[0]!.setRemoteDescription
    ).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('opens native media when the peer connection connects', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const onState = vi.fn();
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
      onState,
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();

    expect(transport.isOpen()).toBe(false);

    pc.ontrack?.({
      track: { kind: 'audio' } as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as RTCTrackEvent);

    expect(transport.isOpen()).toBe(true);
    expect(onState).toHaveBeenLastCalledWith('open');
    transport.close();
  });

  it('delivers the remote stream and replaces the microphone track', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const previousTrack = {
      id: 'previous-mic',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const previousStream = {
      getAudioTracks: () => [previousTrack],
      getTracks: () => [previousTrack],
    } as unknown as MediaStream;
    const nextTrack = {
      id: 'next-mic',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const nextStream = {
      getAudioTracks: () => [nextTrack],
      getTracks: () => [nextTrack],
    } as unknown as MediaStream;
    const remoteTrack = { kind: 'audio' } as MediaStreamTrack;
    const remoteStream = {} as MediaStream;
    const onRemoteStream = vi.fn();
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers: async () => [],
      localStream: previousStream,
      onSignal: vi.fn(),
      onRemoteStream,
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.ontrack?.({
      track: remoteTrack,
      streams: [remoteStream],
    } as RTCTrackEvent);
    await transport.replaceLocalStream(nextStream);

    expect(onRemoteStream).toHaveBeenCalledWith(remoteStream);
    expect(pc.replaceTrack).toHaveBeenCalledWith(nextTrack);
    expect(previousTrack.stop).toHaveBeenCalledOnce();
    transport.close();
  });

  it('retries recovery when a restart offer receives no answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.ontrack?.({
      track: { kind: 'audio' } as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as RTCTrackEvent);
    pc.onconnectionstatechange?.();
    expect(transport.isOpen()).toBe(true);

    pc.connectionState = 'disconnected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });

    // No answer and no further connection-state event: the watchdog must
    // still produce another restart attempt rather than remaining on the
    // Reticulum fallback forever.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(pc.createOffer).toHaveBeenCalledTimes(3);
    expect(
      emitted.filter(
        (signal) =>
          signal.kind === 'description' && signal.description.type === 'offer'
      )
    ).toHaveLength(3);

    transport.close();
  });

  it('cancels the recovery watchdog after WebRTC reconnects', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [],
      localStream,
      onSignal: vi.fn(),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    pc.connectionState = 'connected';
    pc.ontrack?.({
      track: { kind: 'audio' } as MediaStreamTrack,
      streams: [{} as MediaStream],
    } as RTCTrackEvent);
    pc.onconnectionstatechange?.();

    pc.connectionState = 'disconnected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(pc.createOffer).toHaveBeenCalledTimes(2);

    pc.connectionState = 'connected';
    pc.onconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(transport.isOpen()).toBe(true);
    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it('adopts late ICE servers and requests a bounded restart from the offerer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    const firstOffer = emitted.find(
      (signal) =>
        signal.kind === 'description' && signal.description.type === 'offer'
    );
    expect(firstOffer?.kind).toBe('description');

    await vi.advanceTimersByTimeAsync(750);
    expect(pc.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        iceServers: [{ urls: 'stun:community.test:3478' }],
      })
    );
    // The first offer is still outstanding, so the refresh waits for a stable
    // signaling state instead of causing offer glare.
    expect(pc.createOffer).toHaveBeenCalledTimes(1);

    await transport.handleSignal({
      kind: 'description',
      generation: firstOffer!.generation,
      description: { type: 'answer', sdp: 'answer' },
    });
    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    expect(pc.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    transport.close();
  });

  it('asks the offerer to restart when the answerer discovers ICE servers late', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    await transport.handleSignal({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'offer', sdp: 'offer' },
    });
    await vi.advanceTimersByTimeAsync(750);

    expect(emitted).toContainEqual({
      kind: 'ice-refresh-request',
      generation: 'generation_1234',
    });
    transport.close();
  });

  it('signals an answer before a refresh that arrives while the answer is pending', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const transport = new DirectVoiceWebRtcTransport({
      offerer: false,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    MockPeerConnection.deferSetLocalDescription = true;
    const handling = transport.handleSignal({
      kind: 'description',
      generation: 'generation_1234',
      description: { type: 'offer', sdp: 'offer' },
    });
    await vi.waitFor(() => {
      expect(MockPeerConnection.releaseSetLocalDescription).toBeTypeOf(
        'function'
      );
    });
    await vi.advanceTimersByTimeAsync(750);
    MockPeerConnection.releaseSetLocalDescription?.();
    await handling;

    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-refresh-request',
    ]);
    transport.close();
  });

  it('keeps bounded recovery available when a proactive restart fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const getIceServers = vi
      .fn<() => Promise<RTCIceServer[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ urls: 'stun:community.test:3478' }]);
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers,
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    await transport.start();
    const pc = MockPeerConnection.instances[0]!;
    const initialOffer = emitted.find(
      (signal) =>
        signal.kind === 'description' && signal.description.type === 'offer'
    );
    expect(initialOffer?.kind).toBe('description');
    await vi.advanceTimersByTimeAsync(750);
    pc.createOffer.mockRejectedValueOnce(new Error('restart-failed'));
    await expect(
      transport.handleSignal({
        kind: 'description',
        generation: initialOffer!.generation,
        description: { type: 'answer', sdp: 'answer' },
      })
    ).rejects.toThrow('restart-failed');

    await vi.advanceTimersByTimeAsync(3_000);
    expect(pc.createOffer).toHaveBeenCalledTimes(3);
    transport.close();
  });

  it('signals candidates gathered during local description setup after SDP', async () => {
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });
    MockPeerConnection.emitCandidateDuringSetLocal = true;
    await transport.start();
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);
    expect(emitted[1]).toMatchObject({
      kind: 'ice-candidates',
      candidates: [{ candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host' }],
    });
    transport.close();
  });

  it('signals SDP promptly and batches candidates gathered later', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:example.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    MockPeerConnection.deferSetLocalDescription = true;
    const startPromise = transport.start();
    await vi.advanceTimersByTimeAsync(0);
    const pc = MockPeerConnection.instances[0]!;
    pc.iceGatheringState = 'gathering';
    pc.onicecandidate?.({
      candidate: {
        type: 'srflx',
        protocol: 'udp',
        toJSON: () => ({
          candidate: 'candidate:1 1 UDP 1 203.0.113.1 5000 typ srflx',
        }),
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent);
    expect(emitted).toEqual([]);
    MockPeerConnection.releaseSetLocalDescription?.();
    await vi.advanceTimersByTimeAsync(0);

    await startPromise;
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);

    pc.onicecandidate?.({
      candidate: {
        type: 'relay',
        protocol: 'udp',
        toJSON: () => ({
          candidate: 'candidate:2 1 UDP 1 203.0.113.2 5001 typ relay',
        }),
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent);
    await vi.advanceTimersByTimeAsync(75);
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
      'ice-candidates',
    ]);
    transport.close();
  });

  it('does not delay SDP when ICE gathering never completes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'RTCPeerConnection',
      MockPeerConnection as unknown as typeof RTCPeerConnection
    );
    const emitted: DirectVoiceRtcSignal[] = [];
    const transport = new DirectVoiceWebRtcTransport({
      offerer: true,
      getIceServers: async () => [{ urls: 'stun:unresponsive.test:3478' }],
      localStream,
      onSignal: (signal) => emitted.push(signal),
      onRemoteStream: vi.fn(),
    });

    MockPeerConnection.deferSetLocalDescription = true;
    const startPromise = transport.start();
    await vi.advanceTimersByTimeAsync(0);
    const pc = MockPeerConnection.instances[0]!;
    pc.iceGatheringState = 'gathering';
    MockPeerConnection.releaseSetLocalDescription?.();
    await startPromise;
    expect(emitted.map((signal) => signal.kind)).toEqual(['description']);

    pc.onicecandidate?.({
      candidate: {
        type: 'host',
        protocol: 'udp',
        toJSON: () => ({
          candidate: 'candidate:3 1 UDP 1 192.0.2.1 5002 typ host',
        }),
      } as RTCIceCandidate,
    } as RTCPeerConnectionIceEvent);
    await vi.advanceTimersByTimeAsync(75);
    expect(emitted.map((signal) => signal.kind)).toEqual([
      'description',
      'ice-candidates',
    ]);
    transport.close();
  });
});
