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

  it('maps group audio send failures from bridge codes', async () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    internal.state = 'ready';
    internal.start = vi.fn(async () => {});
    internal.sendCommand = vi.fn(async () => ({
      type: 'resp',
      id: '1',
      ok: false,
      payload: { code: 'unknown_link_id' },
      error: 'Unknown audio link id',
    }));

    const result = await bridge.sendGroupAudio('link-1', 'room-1', 'AQID');

    expect(result).toEqual({
      ok: false,
      reason: 'unknown-link-id',
      error: 'Unknown audio link id',
    });
  });

  it('emits decoded group audio packet events', () => {
    const bridge = new ReticulumBridge();
    const internal = bridge as any;
    const seen: Array<Record<string, unknown>> = [];

    bridge.on('group-audio-packet', (payload) => {
      seen.push(payload as Record<string, unknown>);
    });

    internal.handleFrame({
      type: 'event',
      event: 'group_audio_packet',
      payload: {
        linkId: 'link-1',
        roomId: 'room-1',
        data: 'AQID',
        peerPresenceHash: 'peer-hash',
        peerCallHash: 'call-hash',
        incoming: true,
      },
    });

    expect(seen).toEqual([
      {
        linkId: 'link-1',
        roomId: 'room-1',
        data: 'AQID',
        peerPresenceHash: 'peer-hash',
        peerCallHash: 'call-hash',
        incoming: true,
      },
    ]);
  });
});
