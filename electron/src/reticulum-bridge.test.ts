import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('./reticulum-daemon', () => ({
  getReticulumBridgeIdentityPath: () =>
    '/tmp/qortal-userdata/reticulum/presence-bridge.identity',
  getReticulumConfigDir: () => '/tmp/qortal-reticulum-test',
  persistReticulumSharedTransportState: vi.fn(),
  resolveReticulumPythonLaunch: () => ({
    error: 'not-used-in-test',
  }),
}));

vi.mock('./presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./presence')>();
  return {
    ...actual,
    getPresenceManager: vi.fn(() => null),
  };
});

import {
  decodeReticulumAudioMessage,
  encodeReticulumAudioBatch,
} from './reticulum-audio-ipc';
import { persistReticulumSharedTransportState } from './reticulum-daemon';
import { base58Decode, getPresenceManager } from './presence';
import type { PresenceEnvelope } from './presence';
import { ReticulumBridge } from './reticulum-bridge';

describe('ReticulumBridge presence subscriptions', () => {
  it('does not spawn a second child while startup is waiting for ready', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'starting';
    internal.child = {
      exitCode: null,
      killed: false,
    };
    internal.spawnAndHandshake = vi.fn(async () => {});

    await bridge.start();

    expect(internal.spawnAndHandshake).not.toHaveBeenCalled();
  });

  it('notifies late subscribers when the bridge is already ready', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const onReady = vi.fn();

    internal.state = 'ready';
    const unsubscribe = bridge.subscribe({
      onEnvelope: vi.fn(),
      onReady,
    });
    await Promise.resolve();
    unsubscribe();

    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

describe('ReticulumBridge group audio support', () => {
  it('opens group audio links through the bridge command channel', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(
      async (action: string, payload: Record<string, unknown>) => ({
        type: 'resp',
        id: '1',
        ok: true,
        payload: {
          linkId: 'link-1',
          established: false,
          action,
          payload,
        },
      })
    );

    const result = await bridge.openGroupAudioLink('peer-hash');

    expect(internal.sendCommand).toHaveBeenCalledWith('open_group_audio_link', {
      peerPresenceHash: 'peer-hash',
    });
    expect(result).toEqual({
      ok: true,
      linkId: 'link-1',
      established: false,
    });
  });

  it('reports no-route when the bridge cannot confirm a path for an audio link', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: '1',
      ok: false,
      payload: {
        code: 'no_route',
        pathState: 'failing',
        pathAwaitSeconds: 2,
      },
      error: 'No confirmed Reticulum path for group audio link',
    }));

    const result = await bridge.openGroupAudioLink('peer-hash');

    expect(result).toEqual({
      ok: false,
      reason: 'no-route',
      error: 'No confirmed Reticulum path for group audio link',
    });
  });

  it('warms packet audio paths through the bridge command channel', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(
      async (action: string, payload: Record<string, unknown>) => ({
        type: 'resp',
        id: '2',
        ok: true,
        payload: { action, payload, pathState: 'fresh', ready: true },
      })
    );

    const result = await bridge.warmGroupAudioPath('peer-hash');

    expect(internal.sendCommand).toHaveBeenCalledWith('warm_group_audio_path', {
      peerPresenceHash: 'peer-hash',
    });
    expect(result).toEqual({ ok: true, pathState: 'fresh', ready: true });
  });

  it('resets per-peer group audio state and drops queued audio for that peer', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.audioFrameQueues.set('packet:peer-hash', [
      {
        routeKey: 'packet:peer-hash',
        transport: 'packet',
        linkId: '',
        roomId: 'room-1',
        peerPresenceHash: 'peer-hash',
        peerDestinationHash: 'call-hash',
        data: Buffer.from([1]),
        queuedAtMs: Date.now(),
        sizeBytes: 1,
      },
    ]);
    internal.audioFrameQueues.set('packet:other-peer', [
      {
        routeKey: 'packet:other-peer',
        transport: 'packet',
        linkId: '',
        roomId: 'room-1',
        peerPresenceHash: 'other-peer',
        peerDestinationHash: 'other-call-hash',
        data: Buffer.from([2]),
        queuedAtMs: Date.now(),
        sizeBytes: 1,
      },
    ]);
    internal.audioQueuedLinkOrder = ['packet:peer-hash', 'packet:other-peer'];
    internal.audioQueuedFrames = 2;
    internal.audioQueuedBytes = 2;
    internal.sendDetailed = vi.fn(async () => ({ ok: true }));

    const result = await bridge.resetGroupAudioPeerState(
      'peer-hash',
      'test-reset'
    );

    expect(result).toEqual({ ok: true });
    expect(internal.sendDetailed).toHaveBeenCalledWith(
      'reset_group_audio_peer_state',
      { peerPresenceHash: 'peer-hash', reason: 'test-reset' }
    );
    expect(internal.audioFrameQueues.has('packet:peer-hash')).toBe(false);
    expect(internal.audioFrameQueues.has('packet:other-peer')).toBe(true);
    expect(internal.audioQueuedFrames).toBe(1);
    expect(internal.audioQueuedBytes).toBe(1);
  });

  it('sends audio-link heartbeat frames through the bridge command channel', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(
      async (action: string, payload: Record<string, unknown>) => ({
        type: 'resp',
        id: '3',
        ok: true,
        payload: { action, payload },
      })
    );

    const result = await bridge.sendGroupAudioLinkHeartbeatDetailed({
      linkId: 'link-1',
      peerPresenceHash: 'peer-hash',
      roomId: 'room-1',
      command: 'PING',
      seq: 7,
    });

    expect(internal.sendCommand).toHaveBeenCalledWith(
      'send_group_audio_link_heartbeat',
      {
        roomId: 'room-1',
        command: 'PING',
        seq: 7,
        linkId: 'link-1',
        peerPresenceHash: 'peer-hash',
      }
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects excess low-priority commands with an overload response', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.child = {
      exitCode: null,
      killed: false,
      kill: vi.fn(),
      stdin: { write: vi.fn(() => true) },
    };
    internal.waitingForDrain = true;
    const queued: Promise<unknown>[] = [];

    for (let i = 0; i < 128; i += 1) {
      queued.push(internal.sendCommand('publish_presence', { seq: i }));
    }

    const resp = await internal.sendCommand('publish_presence', { seq: 999 });

    expect(resp).toMatchObject({
      ok: false,
      error: 'Reticulum bridge queue overloaded: publish_presence',
      payload: { code: 'bridge_overloaded', action: 'publish_presence' },
    });

    bridge.stop();
    await Promise.allSettled(queued);
  });

  it('prioritizes critical control commands ahead of low-priority traffic', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const writes: Array<{ id: string; action: string }> = [];
    internal.child = {
      exitCode: null,
      killed: false,
      kill: vi.fn(),
      stdin: {
        write: vi.fn((wire: string) => {
          const frame = JSON.parse(wire);
          writes.push({ id: frame.id, action: frame.action });
          return true;
        }),
      },
    };
    internal.waitingForDrain = true;

    const low = internal.sendCommand('publish_presence', { seq: 1 });
    const high = internal.sendCommand('send_call', { seq: 2 });

    internal.waitingForDrain = false;
    internal.flushWriteQueue();

    expect(writes.map((entry) => entry.action)).toEqual([
      'send_call',
      'publish_presence',
    ]);

    for (const entry of writes) {
      internal.handleFrame({ type: 'resp', id: entry.id, ok: true });
    }
    await expect(high).resolves.toMatchObject({ ok: true });
    await expect(low).resolves.toMatchObject({ ok: true });

    bridge.stop();
  });

  it('does not re-send a control frame after backpressure drain', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const writes: Array<{ id: string; action: string }> = [];
    let firstWrite = true;
    internal.child = {
      exitCode: null,
      killed: false,
      kill: vi.fn(),
      stdin: {
        write: vi.fn((wire: string) => {
          const frame = JSON.parse(wire);
          writes.push({ id: frame.id, action: frame.action });
          if (firstWrite) {
            firstWrite = false;
            return false;
          }
          return true;
        }),
      },
    };

    const pending = internal.sendCommand('send_call', { seq: 1 });

    expect(writes.map((entry) => entry.action)).toEqual(['send_call']);
    internal.waitingForDrain = false;
    internal.flushWriteQueue();
    expect(writes.map((entry) => entry.action)).toEqual(['send_call']);

    internal.handleFrame({ type: 'resp', id: writes[0]!.id, ok: true });
    await expect(pending).resolves.toMatchObject({ ok: true });

    bridge.stop();
  });

  it('enqueueGroupAudio returns not-ready when bridge is down', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'stopped';
    internal.child = null;
    const result = bridge.enqueueGroupAudio(
      'link-1',
      'room-1',
      Buffer.from([1, 2, 3])
    );
    expect(result).toEqual({ ok: false, reason: 'bridge-not-ready' });
  });

  it('writes encoded batches to fd3 after enqueue', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    const writes: Buffer[] = [];
    internal.child = {
      exitCode: null,
      stdio: [
        null,
        null,
        null,
        {
          write: vi.fn((buf: Buffer) => {
            writes.push(Buffer.from(buf));
            return true;
          }),
          once: vi.fn(),
        },
      ],
    };
    const queuedAtMs = Date.now();
    const payload = Buffer.from([9, 9]);
    Object.defineProperty(
      payload,
      Symbol.for('qortal.reticulumAudioQueuedAtMs'),
      {
        value: queuedAtMs,
        enumerable: false,
      }
    );
    const r = bridge.enqueueGroupAudio('link-1', 'room-1', payload);
    expect(r.ok).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes.length).toBeGreaterThan(0);
    const decoded = writes.flatMap((buf) => decodeReticulumAudioMessage(buf));
    expect(decoded[0]?.receivedAtWallMs).toBe(queuedAtMs);
  });

  it('writes packet-mode audio batches without a link id', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    const writes: Buffer[] = [];
    internal.child = {
      exitCode: null,
      stdio: [
        null,
        null,
        null,
        {
          write: vi.fn((buf: Buffer) => {
            writes.push(Buffer.from(buf));
            return true;
          }),
          once: vi.fn(),
        },
      ],
    };

    expect(
      bridge.enqueuePacketGroupAudio(
        'peer-hash',
        'room-1',
        Buffer.from([7, 7]),
        'call-hash'
      ).ok
    ).toBe(true);

    await new Promise<void>((resolve) => setImmediate(resolve));

    const decoded = writes.flatMap((buf) => decodeReticulumAudioMessage(buf));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      linkId: '',
      roomId: 'room-1',
      peerPresenceHash: 'peer-hash',
      peerDestinationHash: 'call-hash',
    });
    expect(Buffer.compare(decoded[0]!.payload, Buffer.from([7, 7]))).toBe(0);
  });

  it('round-robins queued audio across links and tracks queue state from Python', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    const writes: Buffer[] = [];
    internal.child = {
      exitCode: null,
      stdio: [
        null,
        null,
        null,
        {
          write: vi.fn((buf: Buffer) => {
            writes.push(Buffer.from(buf));
            return true;
          }),
          once: vi.fn(),
        },
      ],
    };

    expect(
      bridge.enqueueGroupAudio('link-a', 'room-1', Buffer.from([1])).ok
    ).toBe(true);
    expect(
      bridge.enqueueGroupAudio('link-a', 'room-1', Buffer.from([2])).ok
    ).toBe(true);
    expect(
      bridge.enqueueGroupAudio('link-b', 'room-1', Buffer.from([3])).ok
    ).toBe(true);

    await new Promise<void>((resolve) => setImmediate(resolve));

    const decoded = writes.flatMap((buf) => decodeReticulumAudioMessage(buf));
    expect(decoded.map((frame) => frame.linkId)).toEqual([
      'link-a',
      'link-b',
      'link-a',
    ]);

    internal.handleFrame({
      type: 'event',
      event: 'group_audio_queue_state',
      payload: {
        decodedQueueDepth: 3,
        decodedQueueDrops: 2,
        binaryOutQueueDepth: 1,
        binaryOutQueueDrops: 4,
        jsonOutQueueDrops: 5,
        staleDrops: 6,
        packetSendFailures: 7,
        executorLoopGapMsMax: 121,
        executorGapWhileQueuedMsMax: 122,
        executorAudioPassMsMax: 83,
        processBatchMsMax: 84,
        processBatchFramesMax: 5,
        rnsSendSlowCount: 2,
        executorStallCount: 3,
        executorCommandMsMax: 91,
        executorCommandWhileQueuedMsMax: 92,
        executorCommandSlowCount: 4,
        rnsCallbackSchedulerGapMsMax: 501,
        rnsCallbackSchedulerGapOver100Count: 6,
        rnsCallbackSchedulerGapOver250Count: 3,
        rnsCallbackSchedulerGapOver500Count: 1,
        rnsCallbackSchedulerGapOver1000Count: 0,
        mediaRouteDiagnostics: [
          {
            transport: 'link',
            routeKey: 'link-a',
            linkId: 'link-a',
            peerPresenceHash: 'peer-hash',
            peerDestinationHash: 'dest-hash',
            incoming: false,
            sentFrames: 10,
            sentBytes: 1200,
            sendFailures: 1,
            receivedFrames: 0,
            receivedBytes: 0,
            fd4EnqueuedFrames: 0,
            fd4EnqueueFailures: 0,
            lastSendAtMs: 1000,
            lastSendFailureAtMs: 900,
            lastReceiveAtMs: 0,
            lastFd4EnqueueAtMs: 0,
            lastActivityAtMs: 1000,
            lastRoomId: 'room-1',
          },
        ],
      },
    });

    expect(bridge.getAudioQueueSnapshot()).toMatchObject({
      decodedQueueDepth: 3,
      decodedQueueDrops: 2,
      binaryOutQueueDepth: 1,
      binaryOutQueueDrops: 4,
      jsonOutQueueDrops: 5,
      staleDrops: 6,
      packetSendFailures: 7,
      packetPathRequests: 0,
      executorLoopGapMsMax: 121,
      executorGapWhileQueuedMsMax: 122,
      executorAudioPassMsMax: 83,
      processBatchMsMax: 84,
      processBatchFramesMax: 5,
      rnsSendSlowCount: 2,
      executorStallCount: 3,
      executorCommandMsMax: 91,
      executorCommandWhileQueuedMsMax: 92,
      executorCommandSlowCount: 4,
      rnsCallbackSchedulerGapMsMax: 501,
      rnsCallbackSchedulerGapOver100Count: 6,
      rnsCallbackSchedulerGapOver250Count: 3,
      rnsCallbackSchedulerGapOver500Count: 1,
      rnsCallbackSchedulerGapOver1000Count: 0,
      mediaRouteDiagnostics: [
        {
          transport: 'link',
          routeKey: 'link-a',
          linkId: 'link-a',
          peerPresenceHash: 'peer-hash',
          sentFrames: 10,
          sendFailures: 1,
          lastRoomId: 'room-1',
        },
      ],
    });
  });

  it('tracks recent queue-pressure drop rates in bridge snapshots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.child = {
      exitCode: null,
      stdio: [null, null, null, { write: vi.fn(() => true), once: vi.fn() }],
    };
    internal.audioFrameQueueMax = 1;

    expect(
      bridge.enqueueGroupAudio('link-a', 'room-1', Buffer.from([1])).ok
    ).toBe(true);
    expect(
      bridge.enqueueGroupAudio('link-a', 'room-1', Buffer.from([2])).ok
    ).toBe(true);
    expect(bridge.getAudioQueueSnapshot().queuePressureDropsLast5s).toBe(1);

    vi.setSystemTime(6_000);
    expect(bridge.getAudioQueueSnapshot().queuePressureDropsLast5s).toBe(0);
    vi.useRealTimers();
  });

  it('emits group audio from binary fd4 path', () => {
    const bridge = new ReticulumBridge();
    const seen: Array<{ data: Buffer }> = [];
    bridge.on('group-audio-packet', (p: any) => seen.push(p));
    const internal = bridge as any;
    const wire = encodeReticulumAudioBatch([
      { linkId: 'link-1', roomId: 'room-1', payload: Buffer.from([1, 2, 3]) },
    ]);
    internal.appendAudioInData(wire);
    expect(seen.length).toBe(1);
    expect(Buffer.compare(seen[0]!.data, Buffer.from([1, 2, 3]))).toBe(0);
  });

  it('emits packet-mode group audio metadata from binary fd4 path', () => {
    const bridge = new ReticulumBridge();
    const seen: Array<Record<string, unknown>> = [];
    bridge.on('group-audio-packet', (p: any) => seen.push(p));
    const internal = bridge as any;
    const wire = encodeReticulumAudioBatch([
      {
        linkId: '',
        roomId: 'room-1',
        peerPresenceHash: 'peer-hash',
        peerDestinationHash: 'call-hash',
        payload: Buffer.from([4, 5, 6]),
      },
    ]);
    internal.appendAudioInData(wire);
    expect(seen).toEqual([
      {
        linkId: '',
        routeKey: 'packet:peer-hash',
        transport: 'packet',
        roomId: 'room-1',
        data: Buffer.from([4, 5, 6]),
        peerPresenceHash: 'peer-hash',
        peerDestinationHash: 'call-hash',
        incoming: true,
      },
    ]);
  });

  it('emits group_audio_send_failed from JSON event', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: unknown[] = [];
    bridge.on('group-audio-send-failed', (p) => seen.push(p));
    internal.handleFrame({
      type: 'event',
      event: 'group_audio_send_failed',
      payload: {
        linkId: 'link-1',
        reason: 'x',
        code: 'packet_send_false',
        error: 'e',
      },
    });
    expect(seen).toEqual([
      {
        linkId: 'link-1',
        peerPresenceHash: '',
        transport: 'link',
        reason: 'x',
        code: 'packet_send_false',
        error: 'e',
        pathState: '',
      },
    ]);
  });

  it('tracks transport reachability snapshots from bridge events', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: Array<Record<string, unknown>> = [];
    vi.mocked(persistReticulumSharedTransportState).mockClear();

    bridge.on('transport-state', (payload) => {
      seen.push(payload as Record<string, unknown>);
    });

    internal.state = 'ready';
    internal.handleFrame({
      type: 'event',
      event: 'transport_state',
      payload: {
        reachability: 'hub-connected',
        transportEnabled: false,
        configuredHubInterfaces: 2,
        onlineHubInterfaces: 1,
        configuredRemoteHubInterfaces: 2,
        onlineRemoteHubInterfaces: 1,
        hubSummary: 'Hub A=online, Hub B=offline',
      },
    });

    expect(bridge.getConnectivitySnapshot()).toEqual({
      bridgeState: 'ready',
      reachability: 'hub-connected',
      transportEnabled: false,
      configuredHubInterfaces: 2,
      onlineHubInterfaces: 1,
      configuredRemoteHubInterfaces: 2,
      onlineRemoteHubInterfaces: 1,
      hubSummary: 'Hub A=online, Hub B=offline',
      meshListenOnline: false,
      overlayLinksConnected: 0,
    });
    expect(seen).toEqual([
      {
        bridgeState: 'ready',
        reachability: 'hub-connected',
        transportEnabled: false,
        configuredHubInterfaces: 2,
        onlineHubInterfaces: 1,
        configuredRemoteHubInterfaces: 2,
        onlineRemoteHubInterfaces: 1,
        hubSummary: 'Hub A=online, Hub B=offline',
        meshListenOnline: false,
        overlayLinksConnected: 0,
      },
    ]);
    expect(persistReticulumSharedTransportState).toHaveBeenCalledWith({
      reachability: 'hub-connected',
      transportEnabled: false,
      configuredHubInterfaces: 2,
      onlineHubInterfaces: 1,
      configuredRemoteHubInterfaces: 2,
      onlineRemoteHubInterfaces: 1,
      hubSummary: 'Hub A=online, Hub B=offline',
    });
  });

  it('does not overwrite shared transport cache with interface-stat collector failures', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    vi.mocked(persistReticulumSharedTransportState).mockClear();

    internal.state = 'ready';
    internal.handleFrame({
      type: 'event',
      event: 'transport_state',
      payload: {
        reachability: 'unknown',
        transportEnabled: false,
        configuredHubInterfaces: 0,
        onlineHubInterfaces: 0,
        configuredRemoteHubInterfaces: 0,
        onlineRemoteHubInterfaces: 0,
        hubSummary: 'Unable to read Reticulum interface stats',
        reason: 'shared-client stats unsupported',
      },
    });

    expect(persistReticulumSharedTransportState).not.toHaveBeenCalled();
  });

  it('emits overlay link lifecycle snapshots from JSON events', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: unknown[] = [];

    bridge.on('overlay-link-state', (payload) => {
      seen.push(payload);
    });

    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: true,
        reason: 'established',
        queuedPackets: 2,
        closedByReticulum: false,
      },
    });

    expect(bridge.getConnectivitySnapshot().overlayLinksConnected).toBe(1);
    expect(bridge.getOverlayLinkSnapshots()).toEqual([
      {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        connectedAt: expect.any(Number),
        lastRxAt: expect.any(Number),
      },
    ]);

    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: false,
        reason: 'pruned',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });

    expect(bridge.getConnectivitySnapshot().overlayLinksConnected).toBe(0);
    expect(bridge.getOverlayLinkSnapshots()).toEqual([]);

    expect(seen).toEqual([
      {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: true,
        reason: 'established',
        queuedPackets: 2,
        closedByReticulum: false,
      },
      {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: false,
        reason: 'pruned',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    ]);
  });

  it('prunes overlay snapshots when inbound traffic goes idle', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(200_000);
    const seen: unknown[] = [];

    bridge.on('overlay-link-closed', (payload) => {
      seen.push(payload);
    });

    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: true,
        established: true,
        reason: 'rx_presence',
        queuedPackets: 0,
        closedByReticulum: false,
        lastRxAt: 100_000,
      },
    });

    expect(bridge.getOverlayLinkSnapshots()).toEqual([]);
    expect(bridge.getConnectivitySnapshot().overlayLinksConnected).toBe(0);
    expect(seen).toEqual([
      { peerHash: 'peer-hash', reason: 'rx_idle_timeout' },
    ]);

    nowSpy.mockRestore();
  });

  it('emits overlay-link-closed for Reticulum-driven closes when peer hash is known', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: unknown[] = [];

    bridge.on('overlay-link-closed', (payload) => {
      seen.push(payload);
    });

    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: false,
        reason: 'closed',
        queuedPackets: 0,
        closedByReticulum: true,
      },
    });
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-2',
        peerPresenceHash: 'peer-hash-2',
        incoming: true,
        established: false,
        reason: 'closed',
        queuedPackets: 0,
        closedByReticulum: true,
      },
    });
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-3',
        peerPresenceHash: 'peer-hash-3',
        incoming: false,
        established: false,
        reason: 'pruned',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });

    expect(seen).toEqual([
      { peerHash: 'peer-hash', reason: 'closed' },
      { peerHash: 'peer-hash-2', reason: 'closed' },
    ]);
  });

  it('does not emit overlay-link-closed when a duplicate closes but another link remains', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: unknown[] = [];

    bridge.on('overlay-link-closed', (payload) => {
      seen.push(payload);
    });

    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-keep',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: false,
        established: true,
        reason: 'established',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-duplicate',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: true,
        established: true,
        reason: 'established',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-duplicate',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: true,
        established: false,
        reason: '3',
        queuedPackets: 0,
        closedByReticulum: true,
      },
    });

    expect(seen).toEqual([]);
    expect(bridge.getOverlayLinkSnapshots()).toEqual([
      expect.objectContaining({ linkId: 'overlay-keep' }),
    ]);
  });

  it('dedupes overlay snapshots by peer presence hash', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-a',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: false,
        established: true,
        reason: 'established',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-b',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: true,
        established: true,
        reason: 'established',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });
    expect(bridge.getConnectivitySnapshot().overlayLinksConnected).toBe(1);
    expect(bridge.getOverlayLinkSnapshots()).toHaveLength(1);
  });

  it('keeps the oldest overlay snapshot when duplicate links exist for a peer', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-old',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: true,
        established: true,
        reason: 'established',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });
    const firstConnectedAt = bridge.getOverlayLinkSnapshots()[0]?.connectedAt;

    await new Promise((resolve) => setTimeout(resolve, 1));

    internal.handleFrame({
      type: 'event',
      event: 'overlay_link_state',
      payload: {
        linkId: 'overlay-new',
        peerPresenceHash: 'samepeerhash0123456789abcdef',
        incoming: false,
        established: true,
        reason: 'established',
        queuedPackets: 0,
        closedByReticulum: false,
      },
    });

    expect(bridge.getOverlayLinkSnapshots()).toEqual([
      expect.objectContaining({
        linkId: 'overlay-old',
        connectedAt: firstConnectedAt,
      }),
    ]);
  });

  it('emits presence-envelope with origin and via hashes from forwarded presence', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: Array<{ envelope: unknown; route: unknown }> = [];
    bridge.on('presence-envelope', (envelope, route) => {
      seen.push({ envelope, route });
    });

    const envelope: PresenceEnvelope = {
      id: 'e-forwarded',
      type: 'PRESENCE_ANNOUNCE',
      senderAddress: 'Q-forwarded',
      timestamp: 1234,
      payload: {
        address: 'Q-forwarded',
        publicKey: 'pk-forwarded',
        sessionId: 'sid-forwarded',
        status: 'online',
        clientVersion: '1',
      },
      signature: 'sig-forwarded',
    };

    internal.handleFrame({
      type: 'event',
      event: 'presence_message',
      payload: {
        envelope,
        route: {
          kind: 'reticulum',
          destinationHash: 'origin-hash',
          viaDestinationHash: 'via-hash',
          overlayHopsRemaining: 2,
          linkId: 'link-forwarded',
        },
      },
    });

    expect(seen).toEqual([
      {
        envelope,
        route: {
          kind: 'reticulum',
          destinationHash: 'origin-hash',
          viaDestinationHash: 'via-hash',
          overlayHopsRemaining: 2,
          linkId: 'link-forwarded',
        },
      },
    ]);
  });

  it('marks decoded call and group call senders as verified overlay peers', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const markReticulumOverlayPeerVerified = vi.fn();
    vi.mocked(getPresenceManager).mockReturnValue({
      markReticulumOverlayPeerVerified,
    } as any);

    internal.handleFrame({
      type: 'event',
      event: 'call_message',
      payload: {
        wire: { t: 'CA' },
        senderDestinationHash: 'sender-call-hash',
        peerPresenceHash: 'peer-call-hash',
      },
    });
    internal.handleFrame({
      type: 'event',
      event: 'group_call_message',
      payload: {
        wire: { t: 'GA' },
        senderDestinationHash: 'sender-group-hash',
        peerPresenceHash: 'peer-group-hash',
      },
    });

    expect(markReticulumOverlayPeerVerified).toHaveBeenCalledWith(
      'peer-call-hash',
      'call_signal'
    );
    expect(markReticulumOverlayPeerVerified).toHaveBeenCalledWith(
      'peer-group-hash',
      'group_signal'
    );
  });
});

describe('ReticulumBridge publish_presence payload', () => {
  beforeEach(() => {
    vi.mocked(getPresenceManager).mockReturnValue(null);
  });

  it('matches Python qortal_base58_decode for a golden vector (TS↔bridge Base58)', () => {
    // Keep in sync with presence_bridge.qortal_base58_decode('2MyQRb').hex()
    expect(Buffer.from(base58Decode('2MyQRb')).toString('hex')).toBe(
      '3544a76e'
    );
  });

  it('sends overlayNeighborHashes from PresenceManager (empty when null)', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: '1',
      ok: true,
      payload: {},
    }));

    const envelope: PresenceEnvelope = {
      id: 'e1',
      type: 'PRESENCE_ANNOUNCE',
      senderAddress: 'addr1',
      timestamp: Date.now(),
      payload: {
        address: 'addr1',
        publicKey: 'pk',
        sessionId: 'sid',
        status: 'online',
        clientVersion: '1',
      },
      signature: 'sig',
    };

    await bridge.publish(envelope);

    expect(internal.sendCommand).toHaveBeenCalledWith('publish_presence', {
      envelope,
      overlayNeighborHashes: [],
    });
  });

  it('sends active overlay neighbor hashes from PresenceManager', async () => {
    vi.mocked(getPresenceManager).mockReturnValue({
      getReticulumActiveNeighborHashes: () => [
        'aa112233445566778899aabbccddeeff',
        'bb00112233445566778899aabbccddee',
      ],
    } as any);

    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: '1',
      ok: true,
      payload: {},
    }));

    const envelope: PresenceEnvelope = {
      id: 'e2',
      type: 'PRESENCE_ANNOUNCE',
      senderAddress: 'addr2',
      timestamp: Date.now(),
      payload: {
        address: 'addr2',
        publicKey: 'pk2',
        sessionId: 'sid2',
        status: 'online',
        clientVersion: '1',
      },
      signature: 'sig2',
    };

    await bridge.publish(envelope);

    expect(internal.sendCommand).toHaveBeenCalledWith('publish_presence', {
      envelope,
      overlayNeighborHashes: [
        'aa112233445566778899aabbccddeeff',
        'bb00112233445566778899aabbccddee',
      ],
    });
  });

  it('falls back to verified overlay neighbors when active publish fanout is empty', async () => {
    vi.mocked(getPresenceManager).mockReturnValue({
      getReticulumActiveNeighborHashes: () => [],
      getReticulumVerifiedNeighborHashes: () => [
        'aa112233445566778899aabbccddeeff',
        'bb00112233445566778899aabbccddee',
      ],
    } as any);

    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: '1',
      ok: true,
      payload: {},
    }));

    const envelope: PresenceEnvelope = {
      id: 'e-fallback',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'addr-fallback',
      timestamp: Date.now(),
      payload: {
        address: 'addr-fallback',
        publicKey: 'pk-fallback',
        sessionId: 'sid-fallback',
        status: 'online',
      },
      signature: 'sig-fallback',
    };

    await bridge.publish(envelope);

    expect(internal.sendCommand).toHaveBeenCalledWith('publish_presence', {
      envelope,
      overlayNeighborHashes: [
        'aa112233445566778899aabbccddeeff',
        'bb00112233445566778899aabbccddee',
      ],
    });
  });

  it('sends bridge-owned call fanout with active overlay neighbor hashes and exclusions', async () => {
    vi.mocked(getPresenceManager).mockReturnValue({
      getReticulumActiveNeighborHashes: (
        excludePeerPresenceHashes?: string[]
      ) =>
        excludePeerPresenceHashes?.length
          ? [
              'aa112233445566778899aabbccddeeff',
              'cc112233445566778899aabbccddeeff',
            ]
          : [
              'aa112233445566778899aabbccddeeff',
              'bb00112233445566778899aabbccddee',
            ],
    } as any);

    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: 'fanout-call-1',
      ok: true,
      payload: {},
    }));

    await bridge.fanoutCallDetailed(
      [{ t: 'CR', c: 'call-1', a: 'Q-local' }],
      ['bb00112233445566778899aabbccddee']
    );

    expect(internal.sendCommand).toHaveBeenCalledWith('fanout_call', {
      messages: [{ t: 'CR', c: 'call-1', a: 'Q-local' }],
      overlayNeighborHashes: [
        'aa112233445566778899aabbccddeeff',
        'cc112233445566778899aabbccddeeff',
      ],
      excludePeerPresenceHashes: ['bb00112233445566778899aabbccddee'],
    });
  });

  it('sends bridge-owned group-call fanout with active overlay neighbor hashes and exclusions', async () => {
    vi.mocked(getPresenceManager).mockReturnValue({
      getReticulumActiveNeighborHashes: (
        excludePeerPresenceHashes?: string[]
      ) =>
        excludePeerPresenceHashes?.length
          ? [
              'aa112233445566778899aabbccddeeff',
              'cc112233445566778899aabbccddeeff',
            ]
          : [
              'aa112233445566778899aabbccddeeff',
              'bb00112233445566778899aabbccddee',
            ],
    } as any);

    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: 'fanout-1',
      ok: true,
      payload: {},
    }));

    await bridge.fanoutGroupCallDetailed(
      [{ t: 'GJ', R: 'room-1' }],
      ['bb00112233445566778899aabbccddee']
    );

    expect(internal.sendCommand).toHaveBeenCalledWith('fanout_group_call', {
      messages: [{ t: 'GJ', R: 'room-1' }],
      overlayNeighborHashes: [
        'aa112233445566778899aabbccddeeff',
        'cc112233445566778899aabbccddeeff',
      ],
      excludePeerPresenceHashes: ['bb00112233445566778899aabbccddee'],
    });
  });

  it('maps no-route failures for bridge-owned group-call fanout', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: 'fanout-2',
      ok: false,
      payload: { code: 'no_route' },
      error: 'No overlay route',
    }));

    const result = await bridge.fanoutGroupCallDetailed([
      { t: 'GK', R: 'room-1' },
    ]);

    expect(result).toEqual({
      ok: false,
      reason: 'no-route',
      error: 'No overlay route',
    });
  });

  it('forwards presence with original sender hash and previous-hop exclusion', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: 'forward-1',
      ok: true,
      payload: {},
    }));

    const envelope: PresenceEnvelope = {
      id: 'e3',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'addr3',
      timestamp: Date.now(),
      payload: {
        address: 'addr3',
        publicKey: 'pk3',
        sessionId: 'sid3',
        status: 'online',
      },
      signature: 'sig3',
    };

    await bridge.forwardPresence(envelope, 1, ['via-hash-1'], 'origin-hash-1');

    expect(internal.sendCommand).toHaveBeenCalledWith('forward_presence', {
      envelope,
      overlayHopsRemaining: 1,
      excludeDestinationHashes: ['via-hash-1'],
      originalSenderHash: 'origin-hash-1',
    });
  });

  it('suppresses repeated heartbeats with the same semantic status inside the minimum interval', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: 'hb-1',
      ok: true,
      payload: {},
    }));

    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const envelope: PresenceEnvelope = {
      id: 'heartbeat-1',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'addr-hb',
      timestamp: 1_000,
      payload: {
        address: 'addr-hb',
        publicKey: 'pk-hb',
        sessionId: 'sid-hb',
        status: 'online',
      },
      signature: 'sig-hb',
    };

    await bridge.publish(envelope);
    await bridge.publish({
      ...envelope,
      id: 'heartbeat-2',
      timestamp: 1_100,
    });

    expect(internal.sendCommand).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not suppress heartbeat transmission when the status changes inside the minimum interval', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: 'hb-2',
      ok: true,
      payload: {},
    }));

    vi.useFakeTimers();
    vi.setSystemTime(2_000);

    await bridge.publish({
      id: 'heartbeat-online',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'addr-hb2',
      timestamp: 2_000,
      payload: {
        address: 'addr-hb2',
        publicKey: 'pk-hb2',
        sessionId: 'sid-hb2',
        status: 'online',
      },
      signature: 'sig-hb2',
    });

    await bridge.publish({
      id: 'heartbeat-busy',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'addr-hb2',
      timestamp: 2_100,
      payload: {
        address: 'addr-hb2',
        publicKey: 'pk-hb2',
        sessionId: 'sid-hb2',
        status: 'busy',
      },
      signature: 'sig-hb2b',
    });

    expect(internal.sendCommand).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
