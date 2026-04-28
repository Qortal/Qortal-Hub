import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getGroupMembers } = vi.hoisted(() => ({
  getGroupMembers: vi.fn(),
}));
vi.mock('../../components/Group/groupApi', () => ({
  getGroupMembers,
}));
import { GroupCallAudioEngineRuntime } from './groupCallAudioEngineRuntime';
import { encodeAudioPacketV2 } from './audioPacketCodec';
import { buildMediaKeyCommitmentHex } from './mediaKeyCommitment';

type GroupCallEventHandler = (event: string, payload: unknown) => void;

describe('GroupCallAudioEngineRuntime', () => {
  const join = vi.fn();
  const leave = vi.fn();
  const setLocalAddresses = vi.fn();
  const sendAudio = vi.fn();
  const sendAudioBatch = vi.fn();
  const broadcastTopology = vi.fn();
  const sendKey = vi.fn();
  const sendKeyRotate = vi.fn();
  const sendKeyRequest = vi.fn();
  const getRoomParticipants = vi.fn();
  const getRoomBootstrapState = vi.fn();
  const setQortalGroupReticulumTargets = vi.fn();
  let groupCallEventHandler: GroupCallEventHandler | null = null;
  const runtimes = new Set<GroupCallAudioEngineRuntime>();
  let latestCapturePort:
    | {
        onmessage: ((event: MessageEvent) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
      }
    | null = null;

  beforeEach(() => {
    join.mockReset();
    leave.mockReset();
    setLocalAddresses.mockReset();
    sendAudio.mockReset();
    sendAudioBatch.mockReset();
    broadcastTopology.mockReset();
    sendKey.mockReset();
    sendKeyRotate.mockReset();
    sendKeyRequest.mockReset();
    getRoomParticipants.mockReset();
    getRoomBootstrapState.mockReset();
    setQortalGroupReticulumTargets.mockReset();
    getGroupMembers.mockReset();
    groupCallEventHandler = null;
    latestCapturePort = null;
    join.mockResolvedValue({ success: true, callSessionId: 'csid-1' });
    leave.mockResolvedValue({ success: true });
    setLocalAddresses.mockResolvedValue({ success: true });
    sendAudio.mockResolvedValue({ success: true });
    sendAudioBatch.mockResolvedValue({ success: true });
    broadcastTopology.mockResolvedValue({ success: true });
    sendKey.mockResolvedValue({ success: true });
    sendKeyRotate.mockResolvedValue({ success: true });
    sendKeyRequest.mockResolvedValue({ success: true });
    setQortalGroupReticulumTargets.mockResolvedValue({ success: true });
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
    ]);
    getRoomBootstrapState.mockResolvedValue(null);
    getGroupMembers.mockResolvedValue({ members: [] });

    vi.stubGlobal('crypto', {
      getRandomValues: <T extends ArrayBufferView>(value: T) => value,
      subtle: {
        digest: async (_algorithm: string, data: BufferSource) => {
          const bytes =
            data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const digest = createHash('sha256').update(bytes).digest();
          return digest.buffer.slice(
            digest.byteOffset,
            digest.byteOffset + digest.byteLength
          );
        },
      },
    });
    (window as unknown as { sendMessage: unknown }).sendMessage = vi
      .fn()
      .mockResolvedValue({
        signature: 'sig',
      });
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 48_000;
        state = 'running';
        destination = { connect: vi.fn(), disconnect: vi.fn() };
        audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
        createMediaStreamSource() {
          return { connect: vi.fn(), disconnect: vi.fn() };
        }
        createGain() {
          return {
            gain: { value: 0 },
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
        close = vi.fn().mockResolvedValue(undefined);
      }
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = {
          onmessage: null,
          postMessage: vi.fn(),
        };
        constructor(_ctx: unknown, name: string) {
          if (name === 'capture-processor') {
            latestCapturePort = this.port;
          }
        }
        connect = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal(
      'AudioData',
      class {
        constructor(_init: unknown) {}
        close() {}
      }
    );
    vi.stubGlobal(
      'AudioDecoder',
      class {
        state: 'configured' | 'closed' = 'configured';
        constructor(_init: unknown) {}
        configure = vi.fn();
        decode = vi.fn();
        close = vi.fn(() => {
          this.state = 'closed';
        });
      }
    );
    vi.stubGlobal(
      'EncodedAudioChunk',
      class {
        constructor(_init: unknown) {}
      }
    );
    vi.stubGlobal(
      'AudioEncoder',
      class {
        state: 'configured' | 'closed' = 'configured';
        private readonly output;
        constructor(init: { output: (chunk: unknown) => void }) {
          this.output = init.output;
        }
        configure = vi.fn();
        encode = vi.fn(() => {
          this.output({
            byteLength: 3,
            copyTo: (target: Uint8Array) => target.set([1, 2, 3]),
          });
        });
        flush = vi.fn().mockResolvedValue(undefined);
        close = vi.fn(() => {
          this.state = 'closed';
        });
      }
    );
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor(..._args: unknown[]) {
          queueMicrotask(() => {
            this.onmessage?.({
              data: { type: 'workerReady' },
            } as MessageEvent);
          });
        }
        postMessage(message: unknown) {
          const typed = message as
            | {
                type?: string;
                keyVersion?: number;
                ids?: number[];
              }
            | undefined;
          if (typed?.type === 'setRoomKey') {
            queueMicrotask(() => {
              this.onmessage?.({
                data: {
                  type: 'roomKeyApplied',
                  keyVersion: typed.keyVersion ?? 0,
                },
              } as MessageEvent);
            });
            return;
          }
          if (typed?.type === 'clearRoomKey') {
            queueMicrotask(() => {
              this.onmessage?.({
                data: {
                  type: 'roomKeyCleared',
                  keyVersion: typed.keyVersion ?? 0,
                },
              } as MessageEvent);
            });
            return;
          }
          if (typed?.type === 'decryptBatch') {
            queueMicrotask(() => {
              this.onmessage?.({
                data: {
                  type: 'resultBatch',
                  batchId: 1,
                  results: (typed.ids ?? []).map((id) => ({
                    id,
                    status: 'ok',
                    decoded: {
                      sourceAddr: 'Qpeer',
                      vad: true,
                      seq: id,
                      timestampMs: id * 10,
                      opusFrame: new Uint8Array([9, 8, 7]).buffer,
                    },
                  })),
                },
              } as MessageEvent);
            });
          }
        }
        terminate() {}
      }
    );
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [],
        }),
      },
    });
    window.localStorage.setItem('gcallWasmFec', '0');
    (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI = {
      ...window.electronAPI,
      reticulumGetLocalDestinationHash: vi.fn().mockResolvedValue({
        destinationHash: '0123456789abcdef0123456789abcdef',
      }),
      reticulumGetLocalIdentityPublicKeyBase64: vi.fn().mockResolvedValue({
        publicKeyBase64: btoa('a'.repeat(64)),
      }),
    };
    window.groupCall = {
      ...(window.groupCall ?? {}),
      join,
      leave,
      setLocalAddresses,
      broadcastTopology,
      sendAudio,
      sendAudioBatch,
      sendKey,
      sendKeyRotate,
      sendKeyRequest,
      getRoomParticipants,
      getRoomBootstrapState,
      setQortalGroupReticulumTargets,
      onEvent: (cb) => {
        groupCallEventHandler = cb;
        return () => {
          groupCallEventHandler = null;
        };
      },
    } as unknown as Window['groupCall'];
  });

  afterEach(() => {
    for (const runtime of runtimes) {
      runtime.dispose();
    }
    runtimes.clear();
    vi.unstubAllGlobals();
    delete (window as unknown as { sendMessage?: unknown }).sendMessage;
    delete window.electronAPI;
    delete window.groupCall;
    window.localStorage.removeItem('gcallWasmFec');
  });

  it('joins, reacts to transport events, and leaves through the extracted runtime', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{ type: string; snapshot?: { roomState: string; participants: Array<{ address: string }> } }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });

    runtime.start();
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    const joinResult = await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
      options: { memberGateGroupName: 'Group Alpha' },
    });

    expect(joinResult.ok).toBe(true);
    expect(setLocalAddresses).toHaveBeenCalledWith(['Qlocal'], 'group');
    expect(join).toHaveBeenCalledTimes(1);

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: 'pub-peer',
    });
    groupCallEventHandler?.('gcall:session-updated', { roomId: 'room-1' });

    const snapshotEvents = events.filter((event) => event.type === 'snapshot');
    const lastSnapshot = snapshotEvents[snapshotEvents.length - 1];
    expect(lastSnapshot?.snapshot?.roomState).toBe('connected');
    expect(lastSnapshot?.snapshot?.participants.map((participant) => participant.address)).toEqual([
      'Qlocal',
      'Qpeer',
    ]);

    const leaveResult = await runtime.handleCommand({ type: 'leave-group-call' });
    expect(leaveResult.ok).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('surfaces diagnostics export through the command interface', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' }],
    });
    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    expect(result.ok).toBe(true);
    expect(typeof result.ok === 'boolean' && result.ok ? typeof result.payload : null).toBe('string');
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      liveMetricsSnapshot?: {
        role?: string;
        topologyRole?: string;
        forwardRecipientCount?: number;
      };
      audioSurfaceRuntimeDiagnostics?: {
        pipelineMode?: { sharedArrayBufferDefined?: boolean };
        sessionState?: {
          roomId?: string | null;
          roomState?: string;
          role?: string;
          forwardRecipientCount?: number;
        };
        recentEvents?: Array<{ tag: string }>;
      };
    };
    expect(parsed.liveMetricsSnapshot?.role).toBe('standby-forwarder');
    expect(parsed.liveMetricsSnapshot?.topologyRole).toBe('standby-forwarder');
    expect(parsed.liveMetricsSnapshot?.forwardRecipientCount).toBe(1);
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.roomId).toBe('room-1');
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.roomState).toBe('connected');
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.role).toBe(
      'standby-forwarder'
    );
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.forwardRecipientCount
    ).toBe(1);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.pipelineMode?.sharedArrayBufferDefined
    ).toBeTypeOf('boolean');
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) => event.tag === 'join-start'
      )
    ).toBe(true);
  });

  it('installs a room key and sends encoded audio through the hidden runtime', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{ type: string; snapshot?: { metrics?: { packetsReceived: number; packetsDecoded: number } } }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(roomKey, 'csid-1', 1);
    (window as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage = vi
      .fn()
      .mockImplementation(async (action: string) => {
        if (action === 'decryptBoxWithMyKey') {
          return { decryptedKey };
        }
        return { signature: 'sig' };
      });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' }],
    });
    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-1',
      encryptedKey: btoa(String.fromCharCode(...new Uint8Array(64).fill(1))),
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      keyMessageVersion: 3,
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
      keyCommitment,
      verified: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    latestCapturePort?.onmessage?.({
      data: {
        frame: new Float32Array(960).fill(0.25),
        vad: true,
      },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendAudio).toHaveBeenCalledTimes(1);
    expect(sendAudio).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      expect.any(Uint8Array)
    );

    groupCallEventHandler?.('gcall:audio', {
      roomId: 'room-1',
      data: encodeAudioPacketV2('Qpeer', true, 1, 10, new Uint8Array([9, 8, 7]), roomKey)
        .buffer,
      fromAddress: 'Qpeer',
      transport: 'link',
      bridgeReceivedAtWallMs: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.metrics?.packetsReceived).toBe(1);
    expect(lastSnapshot?.snapshot?.metrics?.packetsDecoded).toBe(1);
  });

  it('backfills a visible participant from successfully decoded remote audio', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        participants?: Array<{ address: string }>;
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(roomKey, 'csid-1', 1);
    (window as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage = vi
      .fn()
      .mockImplementation(async (action: string) => {
        if (action === 'decryptBoxWithMyKey') {
          return { decryptedKey };
        }
        return { signature: 'sig' };
      });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-1',
      encryptedKey: btoa(String.fromCharCode(...new Uint8Array(64).fill(1))),
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      keyMessageVersion: 3,
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
      keyCommitment,
      verified: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:audio', {
      roomId: 'room-1',
      data: encodeAudioPacketV2(
        'Qpeer',
        false,
        1,
        10,
        new Uint8Array([9, 8, 7]),
        roomKey
      ).buffer,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: 'Qpeer' })])
    );
  });

  it('holds early media while awaiting the authoritative key and flushes it after key apply', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: { metrics?: { packetsReceived: number; packetsDecoded: number } };
      json?: string;
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(roomKey, 'csid-1', 1);
    (window as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage = vi
      .fn()
      .mockImplementation(async (action: string) => {
        if (action === 'decryptBoxWithMyKey') {
          return { decryptedKey };
        }
        return { signature: 'sig' };
      });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' }],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:audio', {
      roomId: 'room-1',
      data: encodeAudioPacketV2('Qpeer', true, 1, 10, new Uint8Array([9, 8, 7]), roomKey)
        .buffer,
      fromAddress: 'Qpeer',
      transport: 'link',
      bridgeReceivedAtWallMs: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.metrics?.packetsReceived ?? 0).toBe(0);
    expect(lastSnapshot?.snapshot?.metrics?.packetsDecoded ?? 0).toBe(0);

    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-1',
      encryptedKey: btoa(String.fromCharCode(...new Uint8Array(64).fill(1))),
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      keyMessageVersion: 3,
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
      keyCommitment,
      verified: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.metrics?.packetsReceived).toBe(1);
    expect(lastSnapshot?.snapshot?.metrics?.packetsDecoded).toBe(1);

    const exported = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(exported.ok ? exported.payload : 'null')) as {
      audioSurfaceRuntimeDiagnostics?: {
        recentEvents?: Array<{ tag: string; payload?: { count?: number } }>;
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) =>
          event.tag === 'held-audio-flush-after-room-key' &&
          event.payload?.count === 1
      )
    ).toBe(true);
  });

  it('does not keep rescheduling authoritative-key recovery on repeated early media', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' }],
    });
    (
      runtime as unknown as {
        awaitingAuthoritativeKey: boolean;
        roomKey: Uint8Array | null;
        keyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null;
        heldIncomingAudio: Array<unknown>;
      }
    ).awaitingAuthoritativeKey = true;
    (runtime as unknown as { roomKey: Uint8Array | null }).roomKey = null;

    const payload = {
      roomId: 'room-1',
      data: new Uint8Array([1, 2, 3]).buffer,
      fromAddress: 'Qpeer',
      transport: 'link' as const,
      bridgeReceivedAtWallMs: Date.now(),
    };
    groupCallEventHandler?.('gcall:audio', payload);
    const firstTimer = (
      runtime as unknown as {
        keyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null;
      }
    ).keyRecoveryRetryTimer;
    expect(firstTimer).not.toBeNull();

    groupCallEventHandler?.('gcall:audio', payload);
    groupCallEventHandler?.('gcall:audio', payload);

    const runtimeState = runtime as unknown as {
      keyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null;
      heldIncomingAudio: Array<unknown>;
    };
    expect(runtimeState.keyRecoveryRetryTimer).toBe(firstTimer);
    expect(runtimeState.heldIncomingAudio).toHaveLength(3);
  });

  it('requests a room key on session-updated when another participant is root', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: 'pub-peer',
    });
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' }],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-2',
      mediaSessionGeneration: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendKeyRequest.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(sendKeyRequest).toHaveBeenLastCalledWith(
      'room-1',
      'Qpeer',
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      'csid-2',
      2
    );
  });

  it('hydrates bootstrap topology after join and requests a room key for late joiners', async () => {
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 4,
      lastTopology: {
        topologyEpoch: 4,
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qpeer',
            standby: 'Qlocal',
          },
        ],
        lastSeen: Date.now(),
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 7,
      updatedAtMs: Date.now(),
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    expect(sendKeyRequest.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(sendKeyRequest).toHaveBeenLastCalledWith(
      'room-1',
      'Qpeer',
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      'csid-bootstrap',
      7
    );
  });

  it('hydrates member gate names from the hidden runtime roster sync', async () => {
    getGroupMembers.mockResolvedValue({
      members: [
        { member: 'Qlocal', primaryName: 'alice' },
        { member: 'Qpeer', primaryName: 'bob' },
      ],
    });
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{ type: string; snapshot?: { memberPrimaryNames?: Record<string, string> } }> =
      [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      options: {
        memberGateGroupId: 812,
        memberGateGroupName: 'DevNet-PUBLIC',
      },
    });

    expect(setQortalGroupReticulumTargets).toHaveBeenCalledWith(
      'gcall-qortal-812',
      ['Qlocal', 'Qpeer']
    );
    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.memberPrimaryNames).toEqual({
      Qlocal: 'alice',
      Qpeer: 'bob',
    });
  });

  it('owns active-speaker state in the hidden runtime', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        activeSpeakers?: string[];
        participants?: Array<{ address: string; speaking: boolean }>;
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(roomKey, 'csid-1', 1);
    (window as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage = vi
      .fn()
      .mockImplementation(async (action: string) => {
        if (action === 'decryptBoxWithMyKey') {
          return { decryptedKey };
        }
        return { signature: 'sig' };
      });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' }],
    });
    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-1',
      encryptedKey: btoa(String.fromCharCode(...new Uint8Array(64).fill(1))),
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      keyMessageVersion: 3,
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
      keyCommitment,
      verified: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:audio', {
      roomId: 'room-1',
      data: encodeAudioPacketV2('Qpeer', true, 1, 10, new Uint8Array([9, 8, 7]), roomKey)
        .buffer,
      fromAddress: 'Qpeer',
      transport: 'link',
      bridgeReceivedAtWallMs: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.myRole).toBe('standby-forwarder');
    expect(lastSnapshot?.snapshot?.activeSpeakers).toEqual(['Qpeer']);
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'Qpeer',
          speaking: true,
          role: 'root-forwarder',
        }),
        expect.objectContaining({
          address: 'Qlocal',
          role: 'standby-forwarder',
        }),
      ])
    );
  });

  it('marks the local participant as speaking from sender VAD changes without polling', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        activeSpeakers?: string[];
        participants?: Array<{
          address: string;
          speaking: boolean;
          role: string;
        }>;
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    (runtime as any).roomKey = new Uint8Array(32).fill(3);
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' }],
    });
    await (runtime as any).syncSenderState();
    expect(latestCapturePort?.onmessage).toBeTypeOf('function');

    latestCapturePort?.onmessage?.({
      data: { frame: new Float32Array([0]), vad: true },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    let lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.activeSpeakers).toContain('Qlocal');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'Qlocal',
          speaking: true,
          role: 'root-forwarder',
        }),
      ])
    );

    latestCapturePort?.onmessage?.({
      data: { frame: new Float32Array([0]), vad: false },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.activeSpeakers ?? []).not.toContain('Qlocal');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'Qlocal',
          speaking: false,
          role: 'root-forwarder',
        }),
      ])
    );
  });

  it('derives local connection hints from hidden-runtime metrics', () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: { localConnectionHint?: { level: string } | null };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const now = Date.now();
    (runtime as any).roomKey = new Uint8Array(32).fill(1);
    (runtime as any).connectionHintBadSince = now - 4_000;
    (runtime as any).connectionHintSevereSince = now - 2_000;
    (runtime as any).snapshot = {
      ...(runtime as any).snapshot,
      roomState: 'connected',
      participants: [{ address: 'Qpeer', publicKey: 'pub-peer', speaking: false, role: 'participant' }],
      metrics: {
        ...(runtime as any).snapshot.metrics,
        adaptiveNetworkMode: 'recovery',
        relayDwellFraction: 0.25,
        playoutOutsideTargetFraction: 0.9,
        avgPcmBufferedMs: 300,
      },
    };

    (runtime as any).emitSnapshot();

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.localConnectionHint?.level).toBe('severe');
  });

  it('answers key requests from the authoritative root even when the requester has a stale callSessionId', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const sendTargetedRoomKey = vi
      .spyOn(runtime as any, 'sendTargetedRoomKey')
      .mockResolvedValue(undefined);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: 'pub-peer',
    });
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [{ members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' }],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-root',
      mediaSessionGeneration: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:key-request', {
      roomId: 'room-1',
      toAddress: 'Qlocal',
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      callSessionId: 'stale-requester-csid',
      mediaSessionGeneration: 2,
      verified: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendTargetedRoomKey).toHaveBeenCalledTimes(1);
    expect(sendTargetedRoomKey).toHaveBeenLastCalledWith(
      expect.any(Uint8Array),
      'Qpeer',
      'pub-peer',
      'key-request'
    );
  });

  it('elects and broadcasts a topology after join when bootstrap has no authority', async () => {
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });

    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 180));

    expect(broadcastTopology.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        topologyEpoch: 1,
        rootForwarder: expect.any(String),
        standbyForwarder: expect.any(String),
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
  });

  it('keeps an established remote root when a new participant joins shortly after bootstrap', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
      { address: 'Qnew', publicKey: 'pub-new' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qpeer',
            standby: 'Qlocal',
          },
        ],
        lastSeen: Date.now(),
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: Date.now(),
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qpeer',
      'Qnew',
    ]);

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    broadcastTopology.mockClear();
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qnew',
      publicKey: 'pub-new',
    });

    await vi.advanceTimersByTimeAsync(250);

    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qpeer',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    vi.useRealTimers();
  });

  it('defers the first local election on occupied-room joins without topology authority', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 0,
      callSessionId: '',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qpeer',
    ]);

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    const joinPromise = runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });
    await vi.runAllTicks();
    await joinPromise;

    await vi.advanceTimersByTimeAsync(500);
    expect(broadcastTopology).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(broadcastTopology.mock.calls.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  it('re-elects locally once the trusted remote root is no longer in the roster', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qnew', publicKey: 'pub-new' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qpeer',
            standby: 'Qlocal',
          },
        ],
        lastSeen: Date.now(),
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: Date.now(),
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qnew',
    ]);

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    broadcastTopology.mockClear();
    groupCallEventHandler?.('gcall:participant-left', {
      roomId: 'room-1',
      address: 'Qpeer',
    });
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qnew',
      publicKey: 'pub-new',
    });

    await vi.advanceTimersByTimeAsync(250);

    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    vi.useRealTimers();
  });

  it('hydrates missing participants from accepted remote topology for late joiners', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        participants?: Array<{ address: string; role: string }>;
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlate', publicKey: 'pub-late' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-812',
      topologyEpoch: 3,
      rootForwarder: 'Qroot',
      standbyForwarder: 'Qstandby',
      clusters: [
        {
          members: ['Qroot', 'Qstandby', 'Qlate'],
          forwarder: 'Qroot',
          standby: 'Qstandby',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'Qroot', role: 'root-forwarder' }),
        expect.objectContaining({
          address: 'Qstandby',
          role: 'standby-forwarder',
        }),
        expect.objectContaining({ address: 'Qlate', role: 'participant' }),
      ])
    );
  });

  it('hydrates root and standby from accepted remote topology even when cluster members are incomplete', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        participants?: Array<{ address: string; role: string }>;
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });

    getRoomParticipants.mockResolvedValue([{ address: 'Qstandby', publicKey: 'pub-standby' }]);

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qstandby', publicKey: 'pub-standby' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-812',
      topologyEpoch: 5,
      rootForwarder: 'Qroot',
      standbyForwarder: 'Qstandby',
      clusters: [
        {
          members: ['Qstandby'],
          forwarder: 'Qroot',
          standby: 'Qstandby',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'Qroot', role: 'root-forwarder' }),
        expect.objectContaining({
          address: 'Qstandby',
          role: 'standby-forwarder',
        }),
      ])
    );
  });

  it('adds runtime join payloads into the standby roster immediately on rejoin', async () => {
    getRoomParticipants.mockResolvedValue([{ address: 'Qstandby', publicKey: 'pub-standby' }]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      participants: [{ address: 'Qstandby', publicKey: 'pub-standby' }],
      topologyEpoch: 0,
      callSessionId: 'csid-standby',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: true,
    });
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        participants?: Array<{ address: string; role: string }>;
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qstandby', publicKey: 'pub-standby' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'gcall-qortal-812',
      address: 'Qroot',
      publicKey: 'pub-root',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'Qroot' }),
        expect.objectContaining({ address: 'Qstandby' }),
      ])
    );
  });

  it('waits briefly before self-electing in self-only qortal group joins', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlate', publicKey: 'pub-late' },
    ]);
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlate', publicKey: 'pub-late' },
      myStatus: 'online',
    });
    const joinPromise = runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });
    await vi.runAllTicks();
    await joinPromise;

    await vi.advanceTimersByTimeAsync(500);
    expect(broadcastTopology).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    expect(broadcastTopology.mock.calls.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });
});
