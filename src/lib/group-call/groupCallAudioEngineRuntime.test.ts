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
import Base58 from '../../encryption/Base58.js';
import nacl from '../../encryption/nacl-fast';

type GroupCallEventHandler = (event: string, payload: unknown) => void;

describe('GroupCallAudioEngineRuntime', () => {
  const join = vi.fn();
  const leave = vi.fn();
  const setLocalAddresses = vi.fn();
  const sendAudio = vi.fn();
  const sendAudioBatch = vi.fn();
  const broadcastTopology = vi.fn();
  const sendKey = vi.fn();
  const sendKeyRequest = vi.fn();
  const getRoomParticipants = vi.fn();
  const getRoomBootstrapState = vi.fn();
  const setQortalGroupReticulumTargets = vi.fn();
  const requestPeerMediaRecovery = vi.fn();
  let groupCallEventHandler: GroupCallEventHandler | null = null;
  const runtimes = new Set<GroupCallAudioEngineRuntime>();
  let latestCapturePort: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  } | null = null;
  let nextAudioContextInitialState: 'running' | 'suspended' = 'running';
  let latestAudioContextResume: ReturnType<typeof vi.fn> | null = null;

  beforeEach(() => {
    join.mockReset();
    leave.mockReset();
    setLocalAddresses.mockReset();
    sendAudio.mockReset();
    sendAudioBatch.mockReset();
    broadcastTopology.mockReset();
    sendKey.mockReset();
    sendKeyRequest.mockReset();
    getRoomParticipants.mockReset();
    getRoomBootstrapState.mockReset();
    setQortalGroupReticulumTargets.mockReset();
    requestPeerMediaRecovery.mockReset();
    getGroupMembers.mockReset();
    groupCallEventHandler = null;
    latestCapturePort = null;
    nextAudioContextInitialState = 'running';
    latestAudioContextResume = null;
    join.mockResolvedValue({ success: true, callSessionId: 'csid-1' });
    leave.mockResolvedValue({ success: true });
    setLocalAddresses.mockResolvedValue({ success: true });
    sendAudio.mockResolvedValue({ success: true });
    sendAudioBatch.mockResolvedValue({ success: true });
    broadcastTopology.mockResolvedValue({ success: true });
    sendKey.mockResolvedValue({ success: true });
    sendKeyRequest.mockResolvedValue({ success: true });
    setQortalGroupReticulumTargets.mockResolvedValue({ success: true });
    requestPeerMediaRecovery.mockResolvedValue({ success: true });
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
        state = nextAudioContextInitialState;
        destination = { connect: vi.fn(), disconnect: vi.fn() };
        audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
        resume = vi.fn().mockImplementation(async () => {
          this.state = 'running';
        });
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
        constructor() {
          latestAudioContextResume = this.resume;
        }
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
      sendKeyRequest,
      getRoomParticipants,
      getRoomBootstrapState,
      setQortalGroupReticulumTargets,
      requestPeerMediaRecovery,
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
    const events: Array<{
      type: string;
      snapshot?: {
        roomState: string;
        participants: Array<{ address: string }>;
      };
    }> = [];
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
    expect(
      lastSnapshot?.snapshot?.participants.map(
        (participant) => participant.address
      )
    ).toEqual(['Qlocal', 'Qpeer']);

    const leaveResult = await runtime.handleCommand({
      type: 'leave-group-call',
    });
    expect(leaveResult.ok).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('does not re-add a recently left participant from stale topology', async () => {
    vi.useFakeTimers();
    try {
      const runtime = new GroupCallAudioEngineRuntime();
      runtimes.add(runtime);
      const events: Array<{
        type: string;
        snapshot?: { participants: Array<{ address: string }> };
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
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
      });
      await vi.runAllTicks();

      groupCallEventHandler?.('gcall:participant-left', {
        roomId: 'room-1',
        address: 'Qpeer',
      });
      groupCallEventHandler?.('gcall:topology', {
        roomId: 'room-1',
        topologyEpoch: 1,
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
      });
      await vi.runAllTicks();

      const lastSnapshot = [...events]
        .reverse()
        .find((event) => event.type === 'snapshot');
      expect(lastSnapshot?.snapshot?.participants).toEqual([
        expect.objectContaining({ address: 'Qlocal' }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts a crashed peer after repeated authoritative roster absence and re-elects topology', async () => {
    vi.useFakeTimers();
    try {
      let roster = [
        { address: 'Qlocal', publicKey: 'pub-local' },
        { address: 'Qpeer', publicKey: 'pub-peer' },
      ];
      getRoomParticipants.mockImplementation(async () => roster);

      const runtime = new GroupCallAudioEngineRuntime();
      runtimes.add(runtime);
      const events: Array<{
        type: string;
        snapshot?: { participants: Array<{ address: string }> };
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
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
      });
      await vi.runAllTicks();

      roster = [{ address: 'Qlocal', publicKey: 'pub-local' }];
      broadcastTopology.mockClear();

      await vi.advanceTimersByTimeAsync(16_000);

      const lastSnapshot = [...events]
        .reverse()
        .find((event) => event.type === 'snapshot');
      expect(lastSnapshot?.snapshot?.participants).toEqual([
        expect.objectContaining({ address: 'Qlocal' }),
      ]);
      expect(broadcastTopology).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          topologyEpoch: expect.any(Number),
          rootForwarder: 'Qlocal',
        }),
        expect.any(String),
        'pub-local',
        expect.any(Number)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not evict an authoritatively absent root while recent root media is still arriving', async () => {
    vi.useFakeTimers();
    try {
      let roster = [
        { address: 'Qlocal', publicKey: 'pub-local' },
        { address: 'Qpeer', publicKey: 'pub-peer' },
      ];
      getRoomParticipants.mockImplementation(async () => roster);

      const runtime = new GroupCallAudioEngineRuntime();
      runtimes.add(runtime);
      const events: Array<{
        type: string;
        snapshot?: { participants: Array<{ address: string }> };
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
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qpeer',
            standby: 'Qlocal',
          },
        ],
      });
      await vi.runAllTicks();

      roster = [{ address: 'Qlocal', publicKey: 'pub-local' }];
      broadcastTopology.mockClear();

      (runtime as any).noteDecodedPacketActivity([
        { sourceAddr: 'Qpeer', seq: 1, vad: false, timestampMs: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(5_000);
      (runtime as any).noteDecodedPacketActivity([
        { sourceAddr: 'Qpeer', seq: 2, vad: false, timestampMs: 20 },
      ]);
      await vi.advanceTimersByTimeAsync(5_000);
      (runtime as any).noteDecodedPacketActivity([
        { sourceAddr: 'Qpeer', seq: 3, vad: false, timestampMs: 40 },
      ]);
      await vi.advanceTimersByTimeAsync(2_000);

      const lastSnapshot = [...events]
        .reverse()
        .find((event) => event.type === 'snapshot');
      expect(
        lastSnapshot?.snapshot?.participants.map(
          (participant) => participant.address
        )
      ).toEqual(['Qlocal', 'Qpeer']);
      expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not evict an authoritatively absent standby while recent inbound peer evidence still exists', async () => {
    vi.useFakeTimers();
    try {
      let roster = [
        { address: 'Qlocal', publicKey: 'pub-local' },
        { address: 'Qpeer', publicKey: 'pub-peer' },
      ];
      getRoomParticipants.mockImplementation(async () => roster);

      const runtime = new GroupCallAudioEngineRuntime();
      runtimes.add(runtime);
      const events: Array<{
        type: string;
        snapshot?: { participants: Array<{ address: string }> };
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
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
      });
      await vi.runAllTicks();

      roster = [{ address: 'Qlocal', publicKey: 'pub-local' }];
      broadcastTopology.mockClear();

      (runtime as any).noteParticipantLiveEvidence('Qpeer', Date.now());
      await vi.advanceTimersByTimeAsync(16_000);

      const lastSnapshot = [...events]
        .reverse()
        .find((event) => event.type === 'snapshot');
      expect(
        lastSnapshot?.snapshot?.participants.map(
          (participant) => participant.address
        )
      ).toEqual(['Qlocal', 'Qpeer']);
      expect((runtime as any).topology?.standbyForwarder).toBe('Qpeer');
      expect(broadcastTopology).not.toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          rootForwarder: 'Qlocal',
          standbyForwarder: '',
        }),
        expect.any(String),
        'pub-local',
        expect.any(Number)
      );
    } finally {
      vi.useRealTimers();
    }
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
    });
    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    expect(result.ok).toBe(true);
    expect(
      typeof result.ok === 'boolean' && result.ok ? typeof result.payload : null
    ).toBe('string');
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      liveMetricsSnapshot?: {
        role?: string;
        topologyRole?: string;
        forwardRecipientCount?: number;
      };
      audioSurfaceRuntimeDiagnostics?: {
        pipelineMode?: { sharedArrayBufferDefined?: boolean };
        rendererThread?: {
          monitorActive?: boolean;
          eventLoopLag?: { count?: number; maxDelayMs?: number };
          longTasks?: { supported?: boolean; count?: number; maxMs?: number };
        };
        sessionState?: {
          roomId?: string | null;
          roomState?: string;
          role?: string;
          forwardRecipientCount?: number;
        };
        keyExchange?: { countByTag?: Record<string, number> };
        recentEvents?: Array<{ tag: string }>;
      };
      recentWindowTrends?: Array<{
        adaptiveNetworkMode?: string;
        reason?: string[] | null;
      }>;
    };
    expect(parsed.liveMetricsSnapshot?.role).toBe('standby-forwarder');
    expect(parsed.liveMetricsSnapshot?.topologyRole).toBe('standby-forwarder');
    expect(parsed.liveMetricsSnapshot?.forwardRecipientCount).toBe(1);
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.roomId).toBe(
      'room-1'
    );
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.roomState).toBe(
      'connected'
    );
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.role).toBe(
      'standby-forwarder'
    );
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.forwardRecipientCount
    ).toBe(1);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.pipelineMode
        ?.sharedArrayBufferDefined
    ).toBeTypeOf('boolean');
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.rendererThread?.monitorActive
    ).toBe(true);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.rendererThread?.eventLoopLag?.count
    ).toBeTypeOf('number');
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.rendererThread?.longTasks?.count
    ).toBeTypeOf('number');
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.keyExchange?.countByTag
    ).toBeTypeOf('object');
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) => event.tag === 'join-start'
      )
    ).toBe(true);
    expect(Array.isArray(parsed.recentWindowTrends)).toBe(true);
  });

  it('exports runtime recentWindowTrends from the live diagnostics path', async () => {
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

    const baseMetrics = { ...(runtime as any).snapshot.metrics };
    (runtime as any).recordRecentWindowTrend({
      ...baseMetrics,
      adaptiveNetworkMode: 'low-latency',
      playoutUnderTargetFraction: 0.01,
      missingFrames: 10,
      concealmentTicks: 5,
    });
    (runtime as any).recordRecentWindowTrend({
      ...baseMetrics,
      adaptiveNetworkMode: 'recovery',
      playoutUnderTargetFraction: 0.12,
      missingFrames: 520,
      concealmentTicks: 140,
    });

    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      recentWindowTrends?: Array<{
        adaptiveNetworkMode?: string;
        reason?: string[] | null;
        missingFramesDelta?: number;
        concealmentTicksDelta?: number;
        rendererStallCount?: number;
        rendererLongTaskCount?: number;
        receiveProfiles?: Array<{ peerAddress: string; profile: string }>;
      }>;
      recentWindowSummary?: {
        sampleCount?: number;
        totalMissingFramesDelta?: number;
        totalConcealmentTicksDelta?: number;
      };
      audioSurfaceRuntimeDiagnostics?: {
        recentEvents?: Array<{
          tag: string;
          timestampMs?: number;
          payload?: { reasons?: string[] };
        }>;
      };
    };

    expect(parsed.recentWindowTrends?.length ?? 0).toBeGreaterThanOrEqual(2);
    const lastTrend = parsed.recentWindowTrends?.at(-1);
    expect(lastTrend?.adaptiveNetworkMode).toBe('recovery');
    expect(lastTrend?.missingFramesDelta).toBeGreaterThan(0);
    expect(lastTrend?.concealmentTicksDelta).toBeGreaterThan(0);
    expect(Array.isArray(lastTrend?.receiveProfiles)).toBe(true);
    expect(lastTrend?.rendererStallCount).toBeTypeOf('number');
    expect(lastTrend?.rendererLongTaskCount).toBeTypeOf('number');
    expect(lastTrend?.reason).toEqual(
      expect.arrayContaining(['entered-recovery', 'under-target-spike'])
    );
    expect(parsed.recentWindowSummary?.sampleCount).toBeGreaterThanOrEqual(2);
    expect(parsed.recentWindowSummary?.totalMissingFramesDelta).toBeGreaterThan(
      0
    );
    expect(
      parsed.recentWindowSummary?.totalConcealmentTicksDelta
    ).toBeGreaterThan(0);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) =>
          event.tag === 'call-quality-worsened' &&
          typeof event.timestampMs === 'number'
      )
    ).toBe(true);
  });

  it('installs a room key and sends encoded audio through the hidden runtime', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        metrics?: {
          packetsReceived: number;
          packetsDecoded: number;
          reticulumAudioInboundLinkSamples?: number;
          reticulumAudioInboundTransportLast?: 'link' | 'packet' | null;
        };
      };
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
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
      data: encodeAudioPacketV2(
        'Qpeer',
        true,
        1,
        10,
        new Uint8Array([9, 8, 7]),
        roomKey
      ).buffer,
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
    expect(
      lastSnapshot?.snapshot?.metrics?.reticulumAudioInboundLinkSamples
    ).toBe(1);
    expect(
      lastSnapshot?.snapshot?.metrics?.reticulumAudioInboundTransportLast
    ).toBe('link');
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
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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

  it('tears down a leaving source so same-address rejoin does not inherit stale jitter state', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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

    for (let seq = 100; seq < 104; seq++) {
      groupCallEventHandler?.('gcall:audio', {
        roomId: 'room-1',
        data: encodeAudioPacketV2(
          'Qpeer',
          false,
          seq,
          seq * 10,
          new Uint8Array([9, 8, 7]),
          roomKey
        ).buffer,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:participant-left', {
      roomId: 'room-1',
      address: 'Qpeer',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    let parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      audioSurfaceRuntimeDiagnostics?: {
        receiveEngine?: {
          playoutCount?: number;
          playouts?: Array<{
            peerAddress?: string;
            jitterBufferedFrames?: number;
          }>;
        };
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playoutCount
    ).toBe(0);

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: 'pub-peer',
    });
    for (let seq = 1; seq < 5; seq++) {
      groupCallEventHandler?.('gcall:audio', {
        roomId: 'room-1',
        data: encodeAudioPacketV2(
          'Qpeer',
          false,
          seq,
          seq * 10,
          new Uint8Array([9, 8, 7]),
          roomKey
        ).buffer,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      audioSurfaceRuntimeDiagnostics?: {
        receiveEngine?: {
          playoutCount?: number;
          playouts?: Array<{
            peerAddress?: string;
            jitterBufferedFrames?: number;
          }>;
        };
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playoutCount
    ).toBe(1);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playouts?.[0]
    ).toEqual(
      expect.objectContaining({
        peerAddress: 'Qpeer',
        jitterBufferedFrames: expect.any(Number),
      })
    );
    expect(
      (parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playouts?.[0]
        ?.jitterBufferedFrames ?? 0) > 0
    ).toBe(true);
  });

  it('tears down receive state for a fresh same-address join even if the leave event was missed', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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

    for (let seq = 100; seq < 104; seq++) {
      groupCallEventHandler?.('gcall:audio', {
        roomId: 'room-1',
        data: encodeAudioPacketV2(
          'Qpeer',
          false,
          seq,
          seq * 10,
          new Uint8Array([9, 8, 7]),
          roomKey
        ).buffer,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: 'pub-peer',
      timestamp: 2_000,
      joinGeneration: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    let result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    let parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      audioSurfaceRuntimeDiagnostics?: {
        receiveEngine?: {
          playoutCount?: number;
          playouts?: Array<{
            peerAddress?: string;
            jitterBufferedFrames?: number;
          }>;
        };
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playoutCount
    ).toBe(0);

    for (let seq = 1; seq < 5; seq++) {
      groupCallEventHandler?.('gcall:audio', {
        roomId: 'room-1',
        data: encodeAudioPacketV2(
          'Qpeer',
          false,
          seq,
          seq * 10,
          new Uint8Array([9, 8, 7]),
          roomKey
        ).buffer,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      audioSurfaceRuntimeDiagnostics?: {
        receiveEngine?: {
          playoutCount?: number;
          playouts?: Array<{
            peerAddress?: string;
            jitterBufferedFrames?: number;
          }>;
        };
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playoutCount
    ).toBe(1);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playouts?.[0]
    ).toEqual(
      expect.objectContaining({
        peerAddress: 'Qpeer',
        jitterBufferedFrames: expect.any(Number),
      })
    );
    expect(
      (parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playouts?.[0]
        ?.jitterBufferedFrames ?? 0) > 0
    ).toBe(true);
  });

  it('does not reset receive playout for duplicate room key replays', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const encryptedKey = btoa(
      String.fromCharCode(...new Uint8Array(64).fill(1))
    );
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
    });
    const keyPayload = {
      roomId: 'room-1',
      encryptedKey,
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      keyMessageVersion: 3,
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
      keyCommitment,
      verified: true,
    };
    groupCallEventHandler?.('gcall:key', keyPayload);
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

    groupCallEventHandler?.('gcall:key', keyPayload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      audioSurfaceRuntimeDiagnostics?: {
        receiveEngine?: { playoutCount?: number };
        recentEvents?: Array<{ tag?: string }>;
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.receiveEngine?.playoutCount
    ).toBe(1);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) => event.tag === 'room-key-duplicate-ignored'
      )
    ).toBe(true);
  });

  it('holds early media while awaiting the authoritative key and flushes it after key apply', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const events: Array<{
      type: string;
      snapshot?: {
        metrics?: { packetsReceived: number; packetsDecoded: number };
      };
      json?: string;
    }> = [];
    runtime.onEvent((event) => {
      events.push(event as never);
    });
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:audio', {
      roomId: 'room-1',
      data: encodeAudioPacketV2(
        'Qpeer',
        true,
        1,
        10,
        new Uint8Array([9, 8, 7]),
        roomKey
      ).buffer,
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
    const parsed = JSON.parse(
      String(exported.ok ? exported.payload : 'null')
    ) as {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
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

  it('accepts a verified two-party room key while topology authority is still catching up', async () => {
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const roomKey = new Uint8Array(32).fill(12);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
      rootForwarder: 'Qlocal',
      standbyForwarder: '',
      clusters: [
        {
          members: ['Qlocal'],
          forwarder: 'Qlocal',
          standby: 'Qlocal',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

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

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      ownsRoomKey: boolean;
      selfMintedRoomKey: boolean;
      awaitingAuthoritativeKey: boolean;
      appliedRoomKeyCommitment: string;
      diagEvents: Array<{ tag: string }>;
    };
    expect(Array.from(runtimeState.roomKey ?? [])).toEqual(Array.from(roomKey));
    expect(runtimeState.ownsRoomKey).toBe(false);
    expect(runtimeState.awaitingAuthoritativeKey).toBe(false);
    expect(runtimeState.appliedRoomKeyCommitment).toBe(keyCommitment);
    expect(runtimeState.diagEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'room-key-accepted-during-authority-lag',
        }),
        expect.objectContaining({ tag: 'room-key-applied' }),
      ])
    );

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 2,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Array.from(runtimeState.roomKey ?? [])).toEqual(Array.from(roomKey));
    expect(runtimeState.ownsRoomKey).toBe(true);
    expect(runtimeState.selfMintedRoomKey).toBe(false);
    expect(runtimeState.appliedRoomKeyCommitment).toBe(keyCommitment);
    expect(runtimeState.diagEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'root-authority-ensured-room-key',
          payload: expect.objectContaining({
            rotated: false,
            adoptedExistingRoomKey: true,
          }),
        }),
      ])
    );
  });

  it('triggers authoritative-key recovery on repeated worker decode failures', async () => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
    });

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      awaitingAuthoritativeKey: boolean;
      keyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null;
      handleDecryptPoolEntry: (entry: {
        id: number;
        status: 'decode-failed';
      }) => Promise<void>;
    };
    runtimeState.roomKey = new Uint8Array(32).fill(9);
    runtimeState.awaitingAuthoritativeKey = false;

    for (let i = 0; i < 7; i++) {
      await runtimeState.handleDecryptPoolEntry({
        id: i + 1,
        status: 'decode-failed',
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendKeyRequest).not.toHaveBeenCalled();

    await runtimeState.handleDecryptPoolEntry({
      id: 8,
      status: 'decode-failed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeState.awaitingAuthoritativeKey).toBe(true);
    expect(runtimeState.keyRecoveryRetryTimer).not.toBeNull();
    expect(sendKeyRequest).toHaveBeenCalledTimes(1);
    expect(sendKeyRequest).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      'csid-1',
      1
    );

    await runtimeState.handleDecryptPoolEntry({
      id: 9,
      status: 'decode-failed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendKeyRequest).toHaveBeenCalledTimes(1);
  });

  it('clears stale decode-failure metrics when the authoritative room key is applied', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const roomKey = new Uint8Array(32).fill(7);
    const decryptedKey = btoa(String.fromCharCode(...roomKey));
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
    });

    const runtimeState = runtime as unknown as {
      receiveEngine: {
        getSnapshot: () => {
          packetsDroppedDecodeFailure: number;
          packetsDropped: number;
        };
      };
      handleDecryptPoolEntry: (entry: {
        id: number;
        status: 'decode-failed';
      }) => Promise<void>;
    };
    await runtimeState.handleDecryptPoolEntry({
      id: 1,
      status: 'decode-failed',
    });
    expect(
      runtimeState.receiveEngine.getSnapshot().packetsDroppedDecodeFailure
    ).toBe(1);

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

    const snapshotAfterKey = runtimeState.receiveEngine.getSnapshot();
    expect(snapshotAfterKey.packetsDroppedDecodeFailure).toBe(0);
    expect(snapshotAfterKey.packetsDropped).toBe(0);
  });

  it('replays a targeted room key when the root sees repeated worker decode failures from a peer', async () => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-root',
      mediaSessionGeneration: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runtimeState = runtime as unknown as {
      pendingDecryptIngressById: Map<number, string>;
      roomKey: Uint8Array | null;
      handleDecryptPoolEntry: (entry: {
        id: number;
        status: 'decode-failed';
      }) => Promise<void>;
    };
    expect(runtimeState.roomKey).toBeInstanceOf(Uint8Array);

    for (let id = 1; id <= 7; id++) {
      runtimeState.pendingDecryptIngressById.set(id, 'Qpeer');
      await runtimeState.handleDecryptPoolEntry({
        id,
        status: 'decode-failed',
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendTargetedRoomKey).not.toHaveBeenCalled();

    runtimeState.pendingDecryptIngressById.set(8, 'Qpeer');
    await runtimeState.handleDecryptPoolEntry({
      id: 8,
      status: 'decode-failed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendTargetedRoomKey).toHaveBeenCalledTimes(1);
    expect(sendTargetedRoomKey).toHaveBeenLastCalledWith(
      expect.any(Uint8Array),
      'Qpeer',
      'pub-peer',
      'root-worker-decode-failure'
    );
    expect(sendKeyRequest).not.toHaveBeenCalled();

    runtimeState.pendingDecryptIngressById.set(9, 'Qpeer');
    await runtimeState.handleDecryptPoolEntry({
      id: 9,
      status: 'decode-failed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendTargetedRoomKey).toHaveBeenCalledTimes(1);
  });

  it('proactively sends the room key when a participant joins an active rooted room', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const peerPublicKey = Base58.encode(nacl.sign.keyPair().publicKey);
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
      rootForwarder: 'Qlocal',
      standbyForwarder: '',
      clusters: [{ members: ['Qlocal'], forwarder: 'Qlocal', standby: '' }],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    sendKey.mockClear();

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: peerPublicKey,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendKey).toHaveBeenCalledTimes(1);
    expect(sendKey).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      expect.any(String),
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      expect.objectContaining({
        keyMessageVersion: 3,
        callSessionId: 'csid-1',
        mediaSessionGeneration: 1,
      })
    );
  });

  it('distributes room keys with targeted messages', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const peerPublicKey = Base58.encode(nacl.sign.keyPair().publicKey);

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
    (runtime as any).snapshot = {
      ...(runtime as any).snapshot,
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', role: 'root-forwarder' },
        {
          address: 'Qpeer',
          publicKey: peerPublicKey,
          role: 'standby-forwarder',
        },
      ],
    };
    (runtime as any).topology = {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
      lastSeen: Date.now(),
    };

    await (runtime as any).distributeRoomKey(new Uint8Array(32).fill(8));
    expect(sendKey).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      expect.any(String),
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      expect.objectContaining({
        keyMessageVersion: 3,
        callSessionId: 'csid-1',
        mediaSessionGeneration: 1,
      })
    );
    expect((runtime as any).diagEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'room-key-targeted-distribution-sent',
        }),
      ])
    );
  });

  it('retries a targeted room key after a participant joins an active rooted room', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const peerPublicKey = Base58.encode(nacl.sign.keyPair().publicKey);
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
      rootForwarder: 'Qlocal',
      standbyForwarder: '',
      clusters: [{ members: ['Qlocal'], forwarder: 'Qlocal', standby: '' }],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    sendKey.mockClear();

    vi.useFakeTimers();
    try {
      groupCallEventHandler?.('gcall:participant-joined', {
        roomId: 'room-1',
        address: 'Qpeer',
        publicKey: peerPublicKey,
      });
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      expect(sendKey).toHaveBeenCalledTimes(1);

      for (let attempt = 1; attempt <= 6; attempt++) {
        await vi.advanceTimersByTimeAsync(2_000);
        await Promise.resolve();
        expect(sendKey).toHaveBeenCalledTimes(1 + attempt);
      }

      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
      expect(sendKey).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels targeted room key retries when that participant leaves', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const peerPublicKey = Base58.encode(nacl.sign.keyPair().publicKey);
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
      rootForwarder: 'Qlocal',
      standbyForwarder: '',
      clusters: [{ members: ['Qlocal'], forwarder: 'Qlocal', standby: '' }],
    });
    groupCallEventHandler?.('gcall:session-updated', {
      roomId: 'room-1',
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    sendKey.mockClear();

    vi.useFakeTimers();
    try {
      groupCallEventHandler?.('gcall:participant-joined', {
        roomId: 'room-1',
        address: 'Qpeer',
        publicKey: peerPublicKey,
      });
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      expect(sendKey).toHaveBeenCalledTimes(1);

      groupCallEventHandler?.('gcall:participant-left', {
        roomId: 'room-1',
        address: 'Qpeer',
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();

      expect(sendKey).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a participant event public key when the main roster is missing it during root key distribution', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const peerPublicKey = Base58.encode(nacl.sign.keyPair().publicKey);
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: '' },
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

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: peerPublicKey,
    });
    sendKey.mockClear();

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendKey).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      expect.any(String),
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      expect.objectContaining({
        keyMessageVersion: 3,
        callSessionId: 'csid-1',
        mediaSessionGeneration: 1,
      })
    );
  });

  it('requests media recovery when a connected sender has zero inbound media from its target', async () => {
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
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      outboundSendSuccesses: number;
      snapshot: { metrics: Record<string, unknown> };
      recordRecentWindowTrend: (metrics: Record<string, unknown>) => void;
    };
    runtimeState.roomKey = new Uint8Array(32).fill(9);
    runtimeState.outboundSendSuccesses = 100;
    requestPeerMediaRecovery.mockClear();

    runtimeState.recordRecentWindowTrend({
      ...runtimeState.snapshot.metrics,
      packetsReceived: 0,
      packetsDecoded: 0,
      adaptiveNetworkMode: 'low-latency',
      reticulumAudioPacketPathTimeouts: 0,
    });

    expect(requestPeerMediaRecovery).toHaveBeenCalledTimes(1);
    expect(requestPeerMediaRecovery).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      'path-degraded-warm'
    );
  });

  it('requests media recovery when inbound media is nonzero but badly underfed versus outbound sends', async () => {
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
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      outboundSendSuccesses: number;
      snapshot: { metrics: Record<string, unknown> };
      recordRecentWindowTrend: (metrics: Record<string, unknown>) => void;
    };
    runtimeState.roomKey = new Uint8Array(32).fill(9);
    runtimeState.outboundSendSuccesses = 1_000;
    requestPeerMediaRecovery.mockClear();

    runtimeState.recordRecentWindowTrend({
      ...runtimeState.snapshot.metrics,
      packetsReceived: 200,
      packetsDecoded: 190,
      adaptiveNetworkMode: 'recovery',
      playoutUnderTargetFraction: 0.25,
      playoutRateFractionBelow097: 0.2,
      concealmentTicks: 150,
      reticulumAudioPacketPathTimeouts: 0,
    });

    expect(requestPeerMediaRecovery).toHaveBeenCalledTimes(1);
    expect(requestPeerMediaRecovery).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      'path-degraded-warm'
    );
    expect((runtime as any).diagEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'low-inbound-media-recovery-requested',
          payload: expect.objectContaining({
            packetsReceived: 200,
            outboundSendSuccesses: 1_000,
          }),
        }),
      ])
    );
  });

  it('requests media recovery when inbound media is bursty despite normal packet ratio', async () => {
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
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      outboundSendSuccesses: number;
      snapshot: { metrics: Record<string, unknown> };
      recordRecentWindowTrend: (metrics: Record<string, unknown>) => void;
    };
    runtimeState.roomKey = new Uint8Array(32).fill(9);
    runtimeState.outboundSendSuccesses = 1_000;
    requestPeerMediaRecovery.mockClear();

    runtimeState.recordRecentWindowTrend({
      ...runtimeState.snapshot.metrics,
      packetsReceived: 980,
      packetsDecoded: 980,
      adaptiveNetworkMode: 'recovery',
      playoutUnderTargetFraction: 0.04,
      playoutRateFractionBelow097: 0.03,
      concealmentTicks: 180,
      missingFrames: 320,
      maxIncomingPacketMs: 3_364,
      maxReticulumAudioBridgeToRendererIngressMs: 1_081,
      reticulumAudioPacketPathTimeouts: 0,
    });

    expect(requestPeerMediaRecovery).toHaveBeenCalledTimes(1);
    expect(requestPeerMediaRecovery).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      'path-degraded-warm'
    );
    expect((runtime as any).diagEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'low-inbound-media-recovery-requested',
          payload: expect.objectContaining({
            burstyInboundDamage: true,
            maxIncomingPacketMs: 3_364,
            maxReticulumAudioBridgeToRendererIngressMs: 1_081,
          }),
        }),
      ])
    );
  });

  it('records a diagnostic if low-inbound recovery cannot call the preload IPC', async () => {
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
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      outboundSendSuccesses: number;
      snapshot: { metrics: Record<string, unknown> };
      recordRecentWindowTrend: (metrics: Record<string, unknown>) => void;
    };
    runtimeState.roomKey = new Uint8Array(32).fill(9);
    runtimeState.outboundSendSuccesses = 1_000;
    requestPeerMediaRecovery.mockClear();
    delete window.groupCall!.requestPeerMediaRecovery;

    runtimeState.recordRecentWindowTrend({
      ...runtimeState.snapshot.metrics,
      packetsReceived: 200,
      packetsDecoded: 190,
      adaptiveNetworkMode: 'recovery',
      playoutUnderTargetFraction: 0.25,
      playoutRateFractionBelow097: 0.2,
      concealmentTicks: 150,
      reticulumAudioPacketPathTimeouts: 0,
    });

    expect(requestPeerMediaRecovery).not.toHaveBeenCalled();
    expect((runtime as any).diagEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'media-recovery-api-unavailable',
          payload: expect.objectContaining({
            context: 'low-inbound-media-recovery',
            hasGroupCallApi: true,
          }),
        }),
      ])
    );
  });

  it('retains the old room key and requests a new one when the remote root changes', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const roomKey = new Uint8Array(32).fill(4);
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
      rootForwarder: 'Qoldroot',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qoldroot'],
          forwarder: 'Qoldroot',
          standby: 'Qlocal',
        },
      ],
    });
    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      awaitingAuthoritativeKey: boolean;
      ownsRoomKey: boolean;
      selfMintedRoomKey: boolean;
      decryptPoolAppliedKeyVersion: number;
      decryptPoolKeyVersion: number;
    };
    runtimeState.roomKey = roomKey;
    runtimeState.awaitingAuthoritativeKey = false;
    runtimeState.ownsRoomKey = false;
    runtimeState.selfMintedRoomKey = false;
    sendKeyRequest.mockClear();

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 2,
      rootForwarder: 'Qnewroot',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qnewroot'],
          forwarder: 'Qnewroot',
          standby: 'Qlocal',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeState.roomKey).toBe(roomKey);
    expect(runtimeState.awaitingAuthoritativeKey).toBe(true);
    expect(sendKeyRequest).toHaveBeenCalledTimes(1);
    expect(sendKeyRequest).toHaveBeenCalledWith(
      'room-1',
      'Qnewroot',
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      'csid-1',
      1
    );
  });

  it('retains a self-minted room key for transfer when remote topology demotes the local root', async () => {
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

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runtimeState = runtime as unknown as {
      roomKey: Uint8Array | null;
      awaitingAuthoritativeKey: boolean;
      ownsRoomKey: boolean;
      selfMintedRoomKey: boolean;
    };
    expect(runtimeState.roomKey).not.toBeNull();
    expect(runtimeState.ownsRoomKey).toBe(true);
    expect(runtimeState.selfMintedRoomKey).toBe(true);

    sendKeyRequest.mockClear();
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 2,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeState.roomKey).not.toBeNull();
    expect(runtimeState.ownsRoomKey).toBe(false);
    expect(runtimeState.selfMintedRoomKey).toBe(false);
    expect(runtimeState.awaitingAuthoritativeKey).toBe(true);
    expect(sendKeyRequest).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      'csid-1',
      1
    );

    groupCallEventHandler?.('gcall:key-request', {
      roomId: 'room-1',
      toAddress: 'Qlocal',
      fromAddress: 'Qpeer',
      fromPublicKey: 'pub-peer',
      callSessionId: 'csid-1',
      mediaSessionGeneration: 1,
      verified: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendTargetedRoomKey).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'Qpeer',
      'pub-peer',
      'key-request-demoted-root-transfer'
    );
  });

  it('uses inbound live media evidence to re-elect topology when control join is missing', async () => {
    vi.useFakeTimers();
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qpeer',
      'Qlocal',
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

    await (runtime as any).applyTopology(
      {
        roomId: 'room-1',
        topologyEpoch: 1,
        rootForwarder: 'Qlocal',
        standbyForwarder: '',
        clusters: [
          {
            members: ['Qlocal'],
            forwarder: 'Qlocal',
            standby: '',
          },
        ],
        lastSeen: Date.now(),
      },
      'local-election'
    );

    (runtime as any).noteParticipantLiveEvidence('Qpeer', Date.now());
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.runAllTicks();

    expect(
      (runtime as any).snapshot.participants as Array<{ address: string }>
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: 'Qpeer' })])
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    expect(
      (
        (runtime as any).diagEvents as Array<{ tag: string; payload?: any }>
      ).some(
        (event) =>
          event.tag === 'live-evidence-topology-election-requested' &&
          event.payload?.address === 'Qpeer'
      )
    ).toBe(true);
    vi.useRealTimers();
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
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

  it('hydrates participants from bootstrap topology when recent roster only has self', async () => {
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 10 },
      ],
      topologyEpoch: 4,
      lastTopology: {
        topologyEpoch: 4,
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qpeer', 'Qlocal'],
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
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    await runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });

    const lastSnapshot = [...events]
      .reverse()
      .find((event) => event.type === 'snapshot');
    expect(lastSnapshot?.snapshot?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'Qpeer', role: 'root-forwarder' }),
        expect.objectContaining({
          address: 'Qlocal',
          role: 'standby-forwarder',
        }),
      ])
    );
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

  it('clears stale remote-root authority state when bootstrap topology already makes us root', async () => {
    const nowMs = Date.now();
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
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    (runtime as any).trustedRemoteRoot = 'Qold';
    (runtime as any).trustedRemoteRootLastSeenAt = nowMs - 5_000;
    (runtime as any).conflictingRemoteRoot = 'Qconflict';
    (runtime as any).conflictingRemoteRootLastSeenAt = nowMs - 1_000;
    (runtime as any).authoritySettleUntilMs = nowMs + 5_000;
    (runtime as any).rootPeerLiveness = {
      currentRoot: 'Qold',
      lastHeartbeatAt: nowMs - 2_000,
      lastDecodedMediaAt: 0,
      lastVerifiedControlAt: nowMs - 2_000,
      lastVerifiedKeyAt: 0,
      lastSpeakerActivityAt: 0,
      lastAnyRootEvidenceAt: nowMs - 2_000,
    };

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

    expect((runtime as any).trustedRemoteRoot).toBe('');
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs)
    ).toBeNull();
    expect((runtime as any).authoritySettleUntilMs).toBe(0);
    const liveness = (runtime as any).getRootPeerLivenessSnapshot(nowMs);
    expect(liveness.currentRoot).toBe('Qlocal');
    expect(liveness.lastAnyRootEvidenceAt).toBe(0);
  });

  it('evicts a missing roster peer even when outbound media attempts are recent', async () => {
    const nowMs = Date.now();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    (runtime as any).userInfo = { address: 'Qlocal', publicKey: 'pub-local' };
    (runtime as any).snapshot = {
      ...(runtime as any).snapshot,
      roomId: 'room-1',
      roomState: 'connected',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', speaking: false },
        { address: 'Qpeer', publicKey: 'pub-peer', speaking: false },
      ],
    };
    (runtime as any).participantRosterMissingSinceMs.set(
      'Qpeer',
      nowMs - 60_000
    );
    (runtime as any).getOutboundTargetDiagnostics('Qpeer').lastAttemptAtMs =
      nowMs - 20_000;

    await (runtime as any).refreshAuthoritativeParticipantRoster('periodic');

    expect(
      (runtime as any).snapshot.participants.some(
        (participant: { address: string }) => participant.address === 'Qpeer'
      )
    ).toBe(false);
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
    const events: Array<{
      type: string;
      snapshot?: { memberPrimaryNames?: Record<string, string> };
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
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      'csid-1',
      1
    );
    (
      window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
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
        true,
        1,
        10,
        new Uint8Array([9, 8, 7]),
        roomKey
      ).buffer,
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
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
    expect(lastSnapshot?.snapshot?.activeSpeakers ?? []).not.toContain(
      'Qlocal'
    );
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
      participants: [
        {
          address: 'Qpeer',
          publicKey: 'pub-peer',
          speaking: false,
          role: 'participant',
        },
      ],
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
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

  it('retries sender sync after a transient startup failure', async () => {
    vi.useFakeTimers();
    try {
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

      const startOrUpdate = vi
        .spyOn((runtime as any).senderEngine, 'startOrUpdate')
        .mockRejectedValueOnce(new Error('mic-init-failed'))
        .mockResolvedValue(undefined);

      (runtime as any).roomKey = new Uint8Array(32).fill(3);
      groupCallEventHandler?.('gcall:topology', {
        roomId: 'room-1',
        topologyEpoch: 1,
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
      });

      await (runtime as any).syncSenderState();
      const beforeRetry = startOrUpdate.mock.calls.length;
      expect(beforeRetry).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(startOrUpdate.mock.calls.length).toBeGreaterThan(beforeRetry);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a suspended sender audio context before capture runs', async () => {
    nextAudioContextInitialState = 'suspended';
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

    (runtime as any).roomKey = new Uint8Array(32).fill(3);
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
    });
    await (runtime as any).syncSenderState();

    expect(latestAudioContextResume).not.toBeNull();
    expect(latestAudioContextResume).toHaveBeenCalled();
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

  it('suppresses duplicate local topology elections when structure is unchanged', async () => {
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    (runtime as any).snapshot = {
      ...(runtime as any).snapshot,
      roomId: 'room-1',
      roomState: 'connected',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local' },
        { address: 'Qpeer', publicKey: 'pub-peer' },
      ],
    };
    (runtime as any).topology = {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
      lastSeen: Date.now(),
    };
    (runtime as any).lastObservedTopologyEpoch = 1;
    (runtime as any).topologyAsyncGeneration = 1;
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qpeer',
    ]);

    await (runtime as any).runTopologyElection(1, 'duplicate-startup');

    expect((runtime as any).topology.topologyEpoch).toBe(1);
    expect(broadcastTopology).not.toHaveBeenCalled();
  });

  it('still publishes a local topology election when the structure changes', async () => {
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
      { address: 'Qnew', publicKey: 'pub-new' },
    ]);
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qlocal', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    (runtime as any).snapshot = {
      ...(runtime as any).snapshot,
      roomId: 'room-1',
      roomState: 'connected',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local' },
        { address: 'Qpeer', publicKey: 'pub-peer' },
        { address: 'Qnew', publicKey: 'pub-new' },
      ],
    };
    (runtime as any).topology = {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
      lastSeen: Date.now(),
    };
    (runtime as any).lastObservedTopologyEpoch = 1;
    (runtime as any).topologyAsyncGeneration = 1;
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qpeer',
      'Qnew',
    ]);

    await (runtime as any).runTopologyElection(1, 'roster-expanded');

    expect((runtime as any).topology.topologyEpoch).toBe(2);
    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        topologyEpoch: 2,
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
        clusters: [
          expect.objectContaining({
            members: ['Qlocal', 'Qpeer', 'Qnew'],
          }),
        ],
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

  it('keeps the occupied-room election delay when a verified remote participant joins without topology', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
      ],
      topologyEpoch: 0,
      callSessionId: 'existing-session',
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

    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qpeer',
      publicKey: 'pub-peer',
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(broadcastTopology).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    vi.useRealTimers();
  });

  it('demotes a provisional local root when incumbent remote topology arrives later', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
      callSessionId: 'existing-session',
      mediaSessionGeneration: 1,
      updatedAtMs: nowMs,
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

    await vi.advanceTimersByTimeAsync(5_500);

    expect((runtime as any).topology?.rootForwarder).toBe('Qlocal');
    expect((runtime as any).isProvisionalLocalRootActive()).toBe(true);

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs + 5_600,
    });
    await vi.runAllTicks();

    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    expect((runtime as any).trustedRemoteRoot).toBe('Qpeer');
    expect((runtime as any).isProvisionalLocalRootActive()).toBe(false);
    vi.useRealTimers();
  });

  it('reconciles a provisional local root from a later incumbent heartbeat', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
      callSessionId: 'existing-session',
      mediaSessionGeneration: 1,
      updatedAtMs: nowMs,
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

    await vi.advanceTimersByTimeAsync(5_500);

    expect((runtime as any).topology?.rootForwarder).toBe('Qlocal');
    expect((runtime as any).isProvisionalLocalRootActive()).toBe(true);
    broadcastTopology.mockClear();

    groupCallEventHandler?.('gcall:heartbeat', {
      roomId: 'room-1',
      rootForwarder: 'Qpeer',
      lastSeen: nowMs + 5_600,
    });
    await vi.advanceTimersByTimeAsync(250);

    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    expect((runtime as any).trustedRemoteRoot).toBe('Qpeer');
    expect((runtime as any).isProvisionalLocalRootActive()).toBe(false);
    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    vi.useRealTimers();
  });

  it('demotes a self-minted two-person root after repeated peer decode failures when the peer is deterministic root', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qaaaa', publicKey: 'pub-local' },
      { address: 'Qbbbb', publicKey: 'pub-peer' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qaaaa', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qbbbb', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 0,
      callSessionId: 'existing-session',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);

    await runtime.handleCommand({
      type: 'set-user',
      userInfo: { address: 'Qaaaa', publicKey: 'pub-local' },
      myStatus: 'online',
    });
    const joinPromise = runtime.handleCommand({
      type: 'join-group-call',
      roomId: 'room-1',
      chatId: 'chat-1',
    });
    await vi.runAllTicks();
    await joinPromise;

    await (runtime as any).applyTopology(
      {
        roomId: 'room-1',
        topologyEpoch: 1,
        rootForwarder: 'Qaaaa',
        standbyForwarder: 'Qbbbb',
        clusters: [
          {
            members: ['Qaaaa', 'Qbbbb'],
            forwarder: 'Qaaaa',
            standby: 'Qbbbb',
          },
        ],
        lastSeen: Date.now(),
      },
      'local-election'
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qaaaa');
    expect((runtime as any).selfMintedRoomKey).toBe(true);

    broadcastTopology.mockClear();
    for (let index = 0; index < 8; index += 1) {
      (runtime as any).noteRootDecodeFailureForPeerKeyReplay('Qbbbb');
    }
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTicks();

    expect((runtime as any).topology?.rootForwarder).toBe('Qbbbb');
    expect((runtime as any).trustedRemoteRoot).toBe('Qbbbb');
    expect((runtime as any).selfMintedRoomKey).toBe(false);
    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qbbbb',
        standbyForwarder: 'Qaaaa',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
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

  it('promotes one-to-one standby to root after the extended root heartbeat timeout', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
    ]);
    const receiveConfigureSpy = vi.spyOn(
      (runtime as any).receiveEngine,
      'configure'
    );

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
    (runtime as any).awaitingAuthoritativeKey = false;

    broadcastTopology.mockClear();
    await vi.advanceTimersByTimeAsync(34_000);

    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect(receiveConfigureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        postFailoverRootHoldUntilMs: expect.any(Number),
      })
    );
    expect(
      (
        (runtime as any).snapshot.participants as Array<{ address: string }>
      ).some((participant) => participant.address === 'Qpeer')
    ).toBe(true);
    vi.useRealTimers();
  });

  it('does not promote one-to-one standby to root while awaiting the authoritative room key', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const computeElectionOrderSpy = vi
      .spyOn(runtime as any, 'computeElectionOrder')
      .mockResolvedValue(['Qlocal']);

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
    (runtime as any).awaitingAuthoritativeKey = true;

    broadcastTopology.mockClear();
    await vi.advanceTimersByTimeAsync(34_000);

    expect(computeElectionOrderSpy).not.toHaveBeenCalled();
    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    expect(
      ((runtime as any).diagEvents as Array<{ tag: string }>).some(
        (event) =>
          event.tag ===
          'root-heartbeat-timeout-suppressed-awaiting-authoritative-key'
      )
    ).toBe(true);
    vi.useRealTimers();
  });

  it('reconverges a two-person room from link-closed diagnostics without excluding the peer', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
      topologyEpoch: 4,
      lastTopology: {
        topologyEpoch: 4,
        rootForwarder: 'Qlocal',
        standbyForwarder: null,
        clusters: [
          {
            members: ['Qlocal'],
            forwarder: 'Qlocal',
            standby: null,
          },
        ],
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qpeer',
      'Qlocal',
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
    sendKeyRequest.mockClear();
    (runtime as any).recordOutboundMainDiagnostics({
      targetAddress: 'Qpeer',
      transport: 'link',
      linkEstablished: false,
      lastLinkUnreadyReason: 'bridge-link-closed:1',
      lastLinkUnreadyAtMs: Date.now(),
    });
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);

    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    expect((runtime as any).topology?.clusters?.[0]?.members).toEqual([
      'Qpeer',
      'Qlocal',
    ]);
    expect(
      ((runtime as any).snapshot.participants as Array<{ address: string }>)
        .map((participant) => participant.address)
        .sort()
    ).toEqual(['Qlocal', 'Qpeer']);
    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
        clusters: [expect.objectContaining({ members: ['Qlocal'] })],
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect(sendKeyRequest).toHaveBeenLastCalledWith(
      'room-1',
      'Qpeer',
      'Qlocal',
      expect.any(String),
      'pub-local',
      expect.any(Number),
      'csid-bootstrap',
      2
    );
    expect(
      ((runtime as any).diagEvents as Array<{ tag: string }>).some(
        (event) => event.tag === 'two-party-link-resync-topology'
      )
    ).toBe(true);
    vi.useRealTimers();
  });

  it('does not let link recovery flip a fresh local room-key authority', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
    ]);
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const applyTopology = vi.spyOn(runtime as any, 'applyTopology');
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qpeer',
      'Qlocal',
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
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qlocal', standby: 'Qpeer' },
      ],
      lastSeen: nowMs,
    });
    await vi.advanceTimersByTimeAsync(0);
    applyTopology.mockClear();

    (runtime as any).recordOutboundMainDiagnostics({
      targetAddress: 'Qpeer',
      transport: 'link',
      linkEstablished: false,
      lastLinkUnreadyReason: 'link-heartbeat-send-failed:unknown-link-id',
      lastLinkUnreadyAtMs: Date.now(),
    });
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);

    expect(applyTopology).not.toHaveBeenCalled();
    expect((runtime as any).topology?.rootForwarder).toBe('Qlocal');
    expect(
      (
        (runtime as any).diagEvents as Array<{
          tag: string;
          payload?: { skippedReason?: string };
        }>
      ).some(
        (event) =>
          event.tag === 'two-party-link-resync-skipped' &&
          event.payload?.skippedReason === 'fresh-local-key-authority'
      )
    ).toBe(true);
    vi.useRealTimers();
  });

  it('does not promote standby to root on heartbeat timeout while recent root activity still exists', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
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
    await vi.advanceTimersByTimeAsync(16_000);
    (runtime as any).noteRootVerifiedControl('Qpeer', Date.now());
    await vi.advanceTimersByTimeAsync(1_500);

    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    vi.useRealTimers();
  });

  it('does not promote standby to root on heartbeat timeout while conflicting remote root authority is still settling', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
      { address: 'Qother', publicKey: 'pub-other' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
        { address: 'Qother', publicKey: 'pub-other', joinedAt: 3 },
      ],
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer', 'Qother'],
            forwarder: 'Qpeer',
            standby: 'Qlocal',
          },
        ],
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qother',
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

    await vi.advanceTimersByTimeAsync(16_000);
    groupCallEventHandler?.('gcall:heartbeat', {
      roomId: 'room-1',
      rootForwarder: 'Qother',
      lastSeen: Date.now(),
    });
    broadcastTopology.mockClear();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(Date.now())
    ).toBe('Qother');
    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qpeer');
    vi.useRealTimers();
  });

  it('treats accepted topology from the current root as heartbeat freshness for liveness', async () => {
    const nowMs = Date.now();
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
      lastSeen: nowMs,
    });

    const rootLiveness = (runtime as any).getRootPeerLivenessSnapshot(nowMs);
    expect(rootLiveness.currentRoot).toBe('Qpeer');
    expect(rootLiveness.lastHeartbeatAt).toBe(nowMs);
    expect(rootLiveness.lastVerifiedControlAt).toBe(nowMs);
  });

  it('treats accepted duplicate topology heartbeat from the current root as freshness for liveness', async () => {
    const nowMs = Date.now();
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
      lastSeen: nowMs,
    });

    const firstLiveness = (runtime as any).getRootPeerLivenessSnapshot(nowMs);
    expect(firstLiveness.lastHeartbeatAt).toBe(nowMs);
    expect(firstLiveness.lastVerifiedControlAt).toBe(nowMs);

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
      lastSeen: nowMs + 4_000,
    });

    const secondLiveness = (runtime as any).getRootPeerLivenessSnapshot(
      nowMs + 4_000
    );
    expect(secondLiveness.lastHeartbeatAt).toBe(nowMs + 4_000);
    expect(secondLiveness.lastVerifiedControlAt).toBe(nowMs + 4_000);
  });

  it('does not update root-key liveness or conflict state from a verified key for the wrong room or wrong version', async () => {
    const nowMs = Date.now();
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
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    });
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qother',
      publicKey: 'pub-other',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-2',
      fromAddress: 'Qpeer',
      verified: true,
      keyMessageVersion: 1,
      encryptedKey: 'abcd',
    });
    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-1',
      fromAddress: 'Qother',
      verified: true,
      keyMessageVersion: 999,
      encryptedKey: 'abcd',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rootLiveness = (runtime as any).getRootPeerLivenessSnapshot(
      nowMs + 1_000
    );
    expect(rootLiveness.lastVerifiedKeyAt).toBe(0);
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 1_000)
    ).toBe(null);
  });

  it('records conflicting-root authority from a validated in-room untrusted verified key', async () => {
    const nowMs = Date.now();
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
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    });
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qother',
      publicKey: 'pub-other',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:key', {
      roomId: 'room-1',
      fromAddress: 'Qother',
      verified: true,
      keyMessageVersion: 3,
      encryptedKey: 'abcd',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 1_000)
    ).toBe('Qother');
    expect((runtime as any).authoritySettleUntilMs).toBeGreaterThan(nowMs);
  });

  it('clears conflicting-root authority state when accepted topology adopts that competing root', async () => {
    const nowMs = Date.now();
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
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    });
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qother',
      publicKey: 'pub-other',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:heartbeat', {
      roomId: 'room-1',
      rootForwarder: 'Qother',
      lastSeen: nowMs + 1_000,
    });

    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 1_000)
    ).toBe('Qother');

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 2,
      rootForwarder: 'Qother',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qother',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs + 2_000,
    });

    expect((runtime as any).topology?.rootForwarder).toBe('Qother');
    expect((runtime as any).trustedRemoteRoot).toBe('Qother');
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 2_000)
    ).toBe(null);
    expect((runtime as any).authoritySettleUntilMs).toBe(0);
  });

  it('clears stale remote-root authority state when accepted remote topology makes us root', async () => {
    const nowMs = Date.now();
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
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    });
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qother',
      publicKey: 'pub-other',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    groupCallEventHandler?.('gcall:heartbeat', {
      roomId: 'room-1',
      rootForwarder: 'Qother',
      lastSeen: nowMs + 1_000,
    });

    expect((runtime as any).trustedRemoteRoot).toBe('Qpeer');
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 1_000)
    ).toBe('Qother');

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 2,
      rootForwarder: 'Qlocal',
      standbyForwarder: 'Qpeer',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer'],
          forwarder: 'Qlocal',
          standby: 'Qpeer',
        },
      ],
      lastSeen: nowMs + 2_000,
    });

    expect((runtime as any).trustedRemoteRoot).toBe('');
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 2_000)
    ).toBe(null);
    expect((runtime as any).authoritySettleUntilMs).toBe(0);
    const liveness = (runtime as any).getRootPeerLivenessSnapshot(
      nowMs + 2_000
    );
    expect(liveness.currentRoot).toBe('Qlocal');
    expect(liveness.lastAnyRootEvidenceAt).toBe(0);
  });

  it('arms a short authority settle window after an accepted topology transition', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    });
    const firstDelay = (runtime as any).topologyElectionDelayUntilMs;

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'room-1',
      topologyEpoch: 2,
      rootForwarder: 'Qother',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qother',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs + 1_000,
    });

    expect((runtime as any).topologyElectionDelayUntilMs).toBeGreaterThan(
      firstDelay
    );
    expect((runtime as any).topologyElectionDelayUntilMs).toBeGreaterThan(
      nowMs
    );
    vi.useRealTimers();
  });

  it('preserves conflicting-root authority state when the current root leaves', async () => {
    const nowMs = Date.now();
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
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    });
    groupCallEventHandler?.('gcall:participant-joined', {
      roomId: 'room-1',
      address: 'Qother',
      publicKey: 'pub-other',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    groupCallEventHandler?.('gcall:heartbeat', {
      roomId: 'room-1',
      rootForwarder: 'Qother',
      lastSeen: nowMs + 1_000,
    });

    expect((runtime as any).trustedRemoteRoot).toBe('Qpeer');
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 1_000)
    ).toBe('Qother');

    groupCallEventHandler?.('gcall:participant-left', {
      roomId: 'room-1',
      address: 'Qpeer',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((runtime as any).trustedRemoteRoot).toBe('');
    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(nowMs + 1_000)
    ).toBe('Qother');
    expect((runtime as any).authoritySettleUntilMs).toBeGreaterThan(
      nowMs + 1_000
    );
  });

  it('defers local topology election while conflicting remote root authority is still settling', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    const applyTopologySpy = vi.spyOn(runtime as any, 'applyTopology');

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

    (runtime as any).snapshot = {
      ...(runtime as any).snapshot,
      roomState: 'connected',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
        { address: 'Qother', publicKey: 'pub-other', joinedAt: 3 },
      ],
    };
    (runtime as any).topology = {
      roomId: 'room-1',
      topologyEpoch: 1,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlocal',
      clusters: [
        {
          members: ['Qlocal', 'Qpeer', 'Qother'],
          forwarder: 'Qpeer',
          standby: 'Qlocal',
        },
      ],
      lastSeen: nowMs,
    };
    (runtime as any).topologyAsyncGeneration = 1;
    (runtime as any).noteConflictingRemoteRoot(
      'Qother',
      nowMs + 500,
      'heartbeat'
    );
    applyTopologySpy.mockClear();

    await (runtime as any).runTopologyElection(1, 'test-conflict');

    expect(applyTopologySpy).not.toHaveBeenCalled();
    expect((runtime as any).topologyElectionDelayUntilMs).toBeGreaterThan(
      nowMs + 500
    );
    vi.useRealTimers();
  });

  it('clears stale authority-settle delay when the conflicting root is resolved by departure', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
      { address: 'Qother', publicKey: 'pub-other' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
        { address: 'Qother', publicKey: 'pub-other', joinedAt: 3 },
      ],
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qpeer',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer', 'Qother'],
            forwarder: 'Qpeer',
            standby: 'Qlocal',
          },
        ],
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
      'Qother',
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

    await vi.advanceTimersByTimeAsync(16_000);
    groupCallEventHandler?.('gcall:heartbeat', {
      roomId: 'room-1',
      rootForwarder: 'Qother',
      lastSeen: Date.now(),
    });
    expect((runtime as any).authoritySettleUntilMs).toBeGreaterThan(Date.now());

    groupCallEventHandler?.('gcall:participant-left', {
      roomId: 'room-1',
      address: 'Qother',
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(
      (runtime as any).getConflictingRemoteRootForAuthorityWait(Date.now())
    ).toBeNull();
    expect((runtime as any).authoritySettleUntilMs).toBe(0);

    broadcastTopology.mockClear();
    await vi.advanceTimersByTimeAsync(1_500);
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

  it('reschedules suppressed failover from fresh root evidence instead of the stale heartbeat baseline', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
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

    await vi.advanceTimersByTimeAsync(16_000);
    (runtime as any).noteRootVerifiedControl('Qpeer', Date.now());
    await vi.advanceTimersByTimeAsync(1_500);
    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );

    broadcastTopology.mockClear();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(broadcastTopology).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not promote a one-to-one standby at the first root heartbeat timeout', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qroot', publicKey: 'pub-root' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qroot', publicKey: 'pub-root', joinedAt: 2 },
      ],
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qroot',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qroot', 'Qlocal'],
            forwarder: 'Qroot',
            standby: 'Qlocal',
          },
        ],
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
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

    await vi.advanceTimersByTimeAsync(17_000);

    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        topologyEpoch: 4,
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qroot');
    vi.useRealTimers();
  });

  it('anchors one-to-one standby failover grace to a fresh rejoin', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qroot', publicKey: 'pub-root' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'room-1',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qroot', publicKey: 'pub-root', joinedAt: 2 },
      ],
      topologyEpoch: 3,
      lastTopology: {
        topologyEpoch: 3,
        rootForwarder: 'Qroot',
        standbyForwarder: 'Qlocal',
        clusters: [
          {
            members: ['Qroot', 'Qlocal'],
            forwarder: 'Qroot',
            standby: 'Qlocal',
          },
        ],
        lastSeen: nowMs - 6_000,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: true,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
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

    await vi.advanceTimersByTimeAsync(28_000);

    expect(broadcastTopology).not.toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        topologyEpoch: 4,
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    expect((runtime as any).topology?.rootForwarder).toBe('Qroot');

    await vi.advanceTimersByTimeAsync(5_500);

    expect(broadcastTopology).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        topologyEpoch: 4,
        rootForwarder: 'Qlocal',
      }),
      expect.any(String),
      'pub-local',
      expect.any(Number)
    );
    vi.useRealTimers();
  });

  it('keeps non-root topology members in standby failover candidates even if the roster snapshot is incomplete', async () => {
    vi.useFakeTimers();
    try {
      const nowMs = Date.now();
      getRoomParticipants.mockResolvedValue([
        { address: 'Qlocal', publicKey: 'pub-local' },
      ]);
      getRoomBootstrapState.mockResolvedValue({
        roomId: 'room-1',
        participants: [
          { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
          { address: 'Qroot', publicKey: 'pub-root', joinedAt: 2 },
          { address: 'Qmember', publicKey: 'pub-member', joinedAt: 3 },
        ],
        topologyEpoch: 3,
        lastTopology: {
          topologyEpoch: 3,
          rootForwarder: 'Qroot',
          standbyForwarder: 'Qlocal',
          clusters: [
            {
              members: ['Qroot', 'Qlocal', 'Qmember'],
              forwarder: 'Qroot',
              standby: 'Qlocal',
            },
          ],
          lastSeen: nowMs,
        },
        callSessionId: 'csid-bootstrap',
        mediaSessionGeneration: 2,
        updatedAtMs: nowMs,
        fromRecentCache: false,
      });

      const runtime = new GroupCallAudioEngineRuntime();
      runtimes.add(runtime);
      const electionSpy = vi
        .spyOn(runtime as any, 'computeElectionOrder')
        .mockImplementation(async (addresses: string[]) =>
          ['Qlocal', 'Qmember'].filter((address) => addresses.includes(address))
        );

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

      (runtime as any).snapshot = {
        ...(runtime as any).snapshot,
        participants: [
          { address: 'Qlocal', publicKey: 'pub-local', speaking: false },
        ],
      };

      await vi.advanceTimersByTimeAsync(34_000);

      expect(electionSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['Qlocal', 'Qmember']),
        'room-1'
      );
      expect(broadcastTopology).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({
          rootForwarder: 'Qlocal',
          standbyForwarder: 'Qmember',
        }),
        'sig',
        'pub-local',
        expect.any(Number)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to recent live participants when malformed topology produces no media targets', async () => {
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
      topologyEpoch: 4,
      rootForwarder: 'Qlocal',
      standbyForwarder: '',
      clusters: [
        { members: ['Qlocal'], forwarder: 'Qlocal', standby: 'Qlocal' },
      ],
      lastSeen: Date.now(),
    });
    (runtime as any).roomKey = new Uint8Array(32).fill(4);
    (runtime as any).noteParticipantLiveEvidence('Qpeer', Date.now());

    await (runtime as any).dispatchEncodedFrame(new Uint8Array([1, 2, 3]));

    expect(sendAudio).toHaveBeenCalledWith(
      'room-1',
      'Qpeer',
      expect.any(Uint8Array)
    );
  });

  it('clears root liveness and trusted-root state when the current root leaves', async () => {
    const nowMs = Date.now();
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
      clusters: [
        { members: ['Qlocal', 'Qpeer'], forwarder: 'Qpeer', standby: 'Qlocal' },
      ],
      lastSeen: nowMs,
    });

    expect((runtime as any).trustedRemoteRoot).toBe('Qpeer');
    expect(
      (runtime as any).getRootPeerLivenessSnapshot(nowMs).currentRoot
    ).toBe('Qpeer');

    groupCallEventHandler?.('gcall:participant-left', {
      roomId: 'room-1',
      address: 'Qpeer',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((runtime as any).trustedRemoteRoot).toBe('');
    expect(
      (runtime as any).getRootPeerLivenessSnapshot(nowMs).currentRoot
    ).toBe('Qpeer');
    expect(
      (runtime as any).getRootPeerLivenessSnapshot(nowMs).lastAnyRootEvidenceAt
    ).toBe(0);
  });

  it('does not arm post-failover receive protection when failover topology application fails', async () => {
    vi.useFakeTimers();
    const nowMs = Date.now();
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
        lastSeen: nowMs,
      },
      callSessionId: 'csid-bootstrap',
      mediaSessionGeneration: 2,
      updatedAtMs: nowMs,
      fromRecentCache: false,
    });

    const runtime = new GroupCallAudioEngineRuntime();
    runtimes.add(runtime);
    vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
      'Qlocal',
    ]);
    vi.spyOn(runtime as any, 'applyTopology').mockResolvedValue(false);
    const receiveConfigureSpy = vi.spyOn(
      (runtime as any).receiveEngine,
      'configure'
    );

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

    receiveConfigureSpy.mockClear();
    broadcastTopology.mockClear();
    await vi.advanceTimersByTimeAsync(17_000);

    expect(broadcastTopology).not.toHaveBeenCalled();
    expect(receiveConfigureSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        postFailoverRootHoldUntilMs: expect.any(Number),
      })
    );
    vi.useRealTimers();
  });

  it('adopts the existing room key on standby failover instead of rotating immediately', async () => {
    vi.useFakeTimers();
    try {
      const nowMs = Date.now();
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
          lastSeen: nowMs,
        },
        callSessionId: 'csid-bootstrap',
        mediaSessionGeneration: 2,
        updatedAtMs: nowMs,
        fromRecentCache: false,
      });

      const runtime = new GroupCallAudioEngineRuntime();
      runtimes.add(runtime);
      vi.spyOn(runtime as any, 'computeElectionOrder').mockResolvedValue([
        'Qlocal',
      ]);

      const originalKey = new Uint8Array(32).fill(7);
      const decryptedKey = btoa(String.fromCharCode(...originalKey));
      const keyCommitment = await buildMediaKeyCommitmentHex(
        originalKey,
        'csid-bootstrap',
        2
      );
      (
        window as unknown as { sendMessage: ReturnType<typeof vi.fn> }
      ).sendMessage = vi.fn().mockImplementation(async (action: string) => {
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
        callSessionId: 'csid-bootstrap',
        mediaSessionGeneration: 2,
        keyCommitment,
        verified: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      broadcastTopology.mockClear();

      await vi.advanceTimersByTimeAsync(34_000);

      const exportResult = await runtime.handleCommand({
        type: 'export-diagnostics',
        options: { download: false, clipboard: false },
      });
      const parsed = JSON.parse(
        String(exportResult.ok ? exportResult.payload : 'null')
      ) as {
        audioSurfaceRuntimeDiagnostics?: {
          sessionState?: { ownsRoomKey?: boolean; selfMintedRoomKey?: boolean };
          recentEvents?: Array<{
            tag: string;
            payload?: { rotated?: boolean; adoptedExistingRoomKey?: boolean };
          }>;
        };
      };
      expect(
        parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.ownsRoomKey
      ).toBe(true);
      expect(
        parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.selfMintedRoomKey
      ).toBe(false);
      const authorityEvent =
        parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.find(
          (event) => event.tag === 'root-authority-ensured-room-key'
        );
      expect(authorityEvent?.payload?.rotated).toBe(false);
      expect(authorityEvent?.payload?.adoptedExistingRoomKey).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

    getRoomParticipants.mockResolvedValue([
      { address: 'Qstandby', publicKey: 'pub-standby' },
    ]);

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
    getRoomParticipants.mockResolvedValue([
      { address: 'Qstandby', publicKey: 'pub-standby' },
    ]);
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

  it('does not self-elect early on self-only qortal rejoin when prior room evidence exists', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlate', publicKey: 'pub-late' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      participants: [{ address: 'Qlate', publicKey: 'pub-late', joinedAt: 1 }],
      topologyEpoch: 0,
      callSessionId: 'csid-prior-room',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: false,
    });
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

    await vi.advanceTimersByTimeAsync(5_000);
    expect(broadcastTopology).not.toHaveBeenCalled();
    expect(sendKey).not.toHaveBeenCalled();

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-812',
      topologyEpoch: 3,
      rootForwarder: 'Qpeer',
      standbyForwarder: 'Qlate',
      clusters: [
        {
          members: ['Qlate', 'Qpeer'],
          forwarder: 'Qpeer',
          standby: 'Qlate',
        },
      ],
      lastSeen: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      liveMetricsSnapshot?: { topologyRole?: string };
      audioSurfaceRuntimeDiagnostics?: {
        sessionState?: {
          role?: string;
          ownsRoomKey?: boolean;
          selfMintedRoomKey?: boolean;
        };
      };
    };
    expect(parsed.liveMetricsSnapshot?.topologyRole).toBe('standby-forwarder');
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.role).toBe(
      'standby-forwarder'
    );
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.ownsRoomKey
    ).toBe(false);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.selfMintedRoomKey
    ).toBe(false);
    vi.useRealTimers();
  });

  it('does not restore cached local root authority on occupied-room rejoin from recent cache', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
      { address: 'Qpeer', publicKey: 'pub-peer' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 5,
      lastTopology: {
        topologyEpoch: 5,
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
        lastSeen: Date.now(),
      },
      callSessionId: 'csid-recent',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: true,
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
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });

    broadcastTopology.mockClear();
    sendKey.mockClear();

    await vi.advanceTimersByTimeAsync(500);

    expect(broadcastTopology).not.toHaveBeenCalled();
    expect(sendKey).not.toHaveBeenCalled();

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-812',
      topologyEpoch: 6,
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
    });
    await vi.advanceTimersByTimeAsync(0);

    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      liveMetricsSnapshot?: { topologyRole?: string };
      audioSurfaceRuntimeDiagnostics?: {
        sessionState?: { role?: string; ownsRoomKey?: boolean };
        recentEvents?: Array<{ tag: string }>;
      };
    };
    expect(parsed.liveMetricsSnapshot?.topologyRole).toBe('standby-forwarder');
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.role).toBe(
      'standby-forwarder'
    );
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.ownsRoomKey
    ).toBe(false);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) => event.tag === 'cached-local-root-authority-suppressed'
      )
    ).toBe(true);
    vi.useRealTimers();
  });

  it('does not use recent-cache participants or topology as media targets until live evidence arrives', async () => {
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
        { address: 'Qpeer', publicKey: 'pub-peer', joinedAt: 2 },
      ],
      topologyEpoch: 5,
      lastTopology: {
        topologyEpoch: 5,
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
      callSessionId: 'csid-recent',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: true,
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
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });

    expect(sendKeyRequest).not.toHaveBeenCalled();

    (runtime as any).roomKey = new Uint8Array(32).fill(3);
    await (runtime as any).syncSenderState();
    latestCapturePort?.onmessage?.({
      data: { frame: new Float32Array([0]), vad: true },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendAudio).not.toHaveBeenCalled();
    expect(sendAudioBatch).not.toHaveBeenCalled();
    const startupDiag = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const startupParsed = JSON.parse(
      startupDiag.ok ? (startupDiag.payload as string) : '{}'
    ) as {
      audioSurfaceRuntimeDiagnostics?: {
        outboundMedia?: {
          packetBuildAttempts?: number;
          skippedNoTargets?: number;
          lastSkipReason?: string;
        };
        recentEvents?: Array<{ tag: string }>;
      };
    };
    expect(
      startupParsed.audioSurfaceRuntimeDiagnostics?.outboundMedia
        ?.packetBuildAttempts
    ).toBe(0);
    expect(
      startupParsed.audioSurfaceRuntimeDiagnostics?.outboundMedia
        ?.skippedNoTargets
    ).toBe(0);
    expect(
      startupParsed.audioSurfaceRuntimeDiagnostics?.outboundMedia
        ?.lastSkipReason
    ).toBe('startup-target-wait');
    expect(
      startupParsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) => event.tag === 'outbound-media-startup-target-wait'
      )
    ).toBe(true);

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-812',
      topologyEpoch: 6,
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
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    latestCapturePort?.onmessage?.({
      data: { frame: new Float32Array([0]), vad: true },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendAudio).toHaveBeenCalledWith(
      'gcall-qortal-812',
      'Qpeer',
      expect.any(Uint8Array)
    );
  });

  it('waits during self-only startup instead of counting no-target skips before a remote appears', async () => {
    vi.useFakeTimers();
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
      roomId: 'gcall-qortal-937',
      chatId: 'group:937',
    });
    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-937',
      topologyEpoch: 1,
      rootForwarder: 'Qlocal',
      standbyForwarder: '',
      clusters: [
        {
          members: ['Qlocal'],
          forwarder: 'Qlocal',
          standby: 'Qlocal',
        },
      ],
      lastSeen: Date.now(),
    });
    await vi.runOnlyPendingTimersAsync();

    (runtime as any).roomKey = new Uint8Array(32).fill(3);
    await (runtime as any).syncSenderState();
    vi.advanceTimersByTime(30_000);
    latestCapturePort?.onmessage?.({
      data: { frame: new Float32Array([0]), vad: true },
    } as MessageEvent);
    await vi.runOnlyPendingTimersAsync();

    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(result.ok ? result.payload : '{}')) as {
      audioSurfaceRuntimeDiagnostics?: {
        outboundMedia?: {
          skippedNoTargets?: number;
          lastSkipReason?: string;
        };
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.outboundMedia?.skippedNoTargets
    ).toBe(0);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.outboundMedia?.lastSkipReason
    ).toBe('startup-target-wait');
    expect(sendAudio).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not restore cached local root authority on self-only rejoin from recent cache', async () => {
    vi.useFakeTimers();
    getRoomParticipants.mockResolvedValue([
      { address: 'Qlocal', publicKey: 'pub-local' },
    ]);
    getRoomBootstrapState.mockResolvedValue({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      participants: [
        { address: 'Qlocal', publicKey: 'pub-local', joinedAt: 1 },
      ],
      topologyEpoch: 5,
      lastTopology: {
        topologyEpoch: 5,
        rootForwarder: 'Qlocal',
        standbyForwarder: 'Qpeer',
        clusters: [
          {
            members: ['Qlocal', 'Qpeer'],
            forwarder: 'Qlocal',
            standby: 'Qpeer',
          },
        ],
        lastSeen: Date.now(),
      },
      callSessionId: 'csid-recent',
      mediaSessionGeneration: 1,
      updatedAtMs: Date.now(),
      fromRecentCache: true,
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
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(broadcastTopology).not.toHaveBeenCalled();
    expect(sendKey).not.toHaveBeenCalled();

    groupCallEventHandler?.('gcall:topology', {
      roomId: 'gcall-qortal-812',
      topologyEpoch: 6,
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
    });
    await vi.advanceTimersByTimeAsync(0);

    const result = await runtime.handleCommand({
      type: 'export-diagnostics',
      options: { download: false, clipboard: false },
    });
    const parsed = JSON.parse(String(result.ok ? result.payload : 'null')) as {
      liveMetricsSnapshot?: { topologyRole?: string };
      audioSurfaceRuntimeDiagnostics?: {
        sessionState?: { role?: string; ownsRoomKey?: boolean };
        recentEvents?: Array<{ tag: string }>;
      };
    };
    expect(parsed.liveMetricsSnapshot?.topologyRole).toBe('standby-forwarder');
    expect(parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.role).toBe(
      'standby-forwarder'
    );
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.sessionState?.ownsRoomKey
    ).toBe(false);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents?.some(
        (event) => event.tag === 'cached-local-root-authority-suppressed'
      )
    ).toBe(true);
    vi.useRealTimers();
  });
});
