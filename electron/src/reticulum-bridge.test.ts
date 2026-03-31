import { describe, expect, it, vi } from 'vitest';

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

import { encodeReticulumAudioBatch } from './reticulum-audio-ipc';
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
    });
    expect(seen).toEqual([
      {
        bridgeState: 'ready',
        reachability: 'hub-connected',
        transportEnabled: false,
        configuredHubInterfaces: 2,
        onlineHubInterfaces: 1,
        hubSummary: 'Hub A=online, Hub B=offline',
      },
    ]);
  });
});
