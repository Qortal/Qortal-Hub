import { EventEmitter } from 'events';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dgram', () => ({
  createSocket: vi.fn(),
}));

import * as dgram from 'dgram';
import { StunUdpServer } from './stun-udp-server';

describe('StunUdpServer.tryBind', () => {
  beforeEach(() => {
    vi.mocked(dgram.createSocket).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves false on EADDRINUSE', async () => {
    const sock = new EventEmitter() as EventEmitter & {
      bind: (p: number, h: string, cb?: () => void) => void;
      close: () => void;
      off: EventEmitter['off'];
    };
    sock.bind = vi.fn((_p, _h, _cb) => {
      queueMicrotask(() =>
        sock.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }))
      );
    });
    sock.close = vi.fn();
    vi.mocked(dgram.createSocket).mockReturnValue(sock as ReturnType<typeof dgram.createSocket>);

    const srv = new StunUdpServer(47321);
    const ok = await srv.tryBind();
    expect(ok).toBe(false);
    expect(sock.close).toHaveBeenCalled();
    srv.stop();
  });

  it('resolves true on listening', async () => {
    const sock = new EventEmitter() as EventEmitter & {
      bind: (p: number, h: string, cb?: () => void) => void;
      close: () => void;
      on: EventEmitter['on'];
      once: EventEmitter['once'];
      off: EventEmitter['off'];
    };
    sock.bind = vi.fn((_p, _h, cb) => {
      queueMicrotask(() => {
        sock.emit('listening');
        cb?.();
      });
    });
    sock.close = vi.fn();
    vi.mocked(dgram.createSocket).mockReturnValue(sock as ReturnType<typeof dgram.createSocket>);

    const srv = new StunUdpServer(47321);
    const ok = await srv.tryBind();
    expect(ok).toBe(true);
    srv.stop();
    expect(sock.close).toHaveBeenCalled();
  });
});
