import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('./reticulum-daemon', () => ({
  getReticulumConfigDir: () => '/tmp/qortal-reticulum-test',
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

import { encodeReticulumAudioBatch } from './reticulum-audio-ipc';
import { base58Decode, getPresenceManager } from './presence';
import type { PresenceEnvelope } from './presence';
import { ReticulumBridge } from './reticulum-bridge';

describe('ReticulumBridge group audio support', () => {
  it('opens group audio links through the bridge command channel', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async (action: string, payload: Record<string, unknown>) => ({
      type: 'resp',
      id: '1',
      ok: true,
      payload: {
        linkId: 'link-1',
        established: false,
        action,
        payload,
      },
    }));

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
    const r = bridge.enqueueGroupAudio('link-1', 'room-1', Buffer.from([9, 9]));
    expect(r.ok).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes.length).toBeGreaterThan(0);
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
        reason: 'x',
        code: 'packet_send_false',
        error: 'e',
      },
    ]);
  });

  it('tracks transport reachability snapshots from bridge events', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: Array<Record<string, unknown>> = [];

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
        hubSummary: 'Hub A=online, Hub B=offline',
      },
    });

    expect(bridge.getConnectivitySnapshot()).toEqual({
      bridgeState: 'ready',
      reachability: 'hub-connected',
      transportEnabled: false,
      configuredHubInterfaces: 2,
      onlineHubInterfaces: 1,
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
        hubSummary: 'Hub A=online, Hub B=offline',
        meshListenOnline: false,
        overlayLinksConnected: 0,
      },
    ]);
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
      },
    });

    expect(bridge.getConnectivitySnapshot().overlayLinksConnected).toBe(1);

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
      },
    });

    expect(bridge.getConnectivitySnapshot().overlayLinksConnected).toBe(0);

    expect(seen).toEqual([
      {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: true,
        reason: 'established',
        queuedPackets: 2,
      },
      {
        linkId: 'overlay-1',
        peerPresenceHash: 'peer-hash',
        incoming: false,
        established: false,
        reason: 'pruned',
        queuedPackets: 0,
      },
    ]);
  });
});

describe('ReticulumBridge publish_presence payload', () => {
  beforeEach(() => {
    vi.mocked(getPresenceManager).mockReturnValue(null);
  });

  it('matches Python qortal_base58_decode for a golden vector (TS↔bridge Base58)', () => {
    // Keep in sync with presence_bridge.qortal_base58_decode('2MyQRb').hex()
    expect(Buffer.from(base58Decode('2MyQRb')).toString('hex')).toBe('3544a76e');
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
});
