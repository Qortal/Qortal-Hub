import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateTransportSidecar } from './private-transport-sidecar';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const sidecar = new PrivateTransportSidecar({ requestTimeoutMs: 20 });
  const requests: any[] = [];
  const child = {
    stdin: {
      writable: true,
      write(buffer: Buffer, callback: () => void) {
        requests.push(JSON.parse(buffer.toString()));
        callback();
      },
    },
    kill: vi.fn(),
  };
  const internal = sidecar as any;
  internal.child = child;
  return {
    sidecar,
    child,
    requests,
    request: (operation: string, params = {}) =>
      internal.request(operation, params).catch((error: any) => error.code),
    reply: (requestId: string, result = {}) =>
      internal.handleStdout(
        child,
        Buffer.from(
          JSON.stringify({ version: 2, requestId, ok: true, result }) + '\n'
        )
      ),
    stop: () => internal.handleDeath(child, 'SIDECAR_EXITED'),
  };
}

describe('sidecar request lifetime', () => {
  it.each([
    ['openPrivateSession', 'sessionId', 'closePrivateSession'],
    ['openMoqSession', 'moqSessionId', 'closeMoqSession'],
    ['openMasqueTunnel', 'tunnelId', 'closeTunnel'],
    ['prepareRelay', 'handle', 'closeRelay'],
  ])(
    'cleans up a late %s result exactly once while ordinary admission is full',
    async (operation, field, close) => {
      const { sidecar, child, requests, request, reply, stop } = setup();
      const opening = request(operation);
      await vi.advanceTimersByTimeAsync(21);
      expect(await opening).toBe('SIDECAR_REQUEST_TIMEOUT');
      const pending = Array.from({ length: 512 }, () => request('health'));
      expect(await request('health')).toBe('SIDECAR_QUEUE_FULL');
      reply(requests[0].requestId, { [field]: 'late-resource' });
      reply(requests[0].requestId, { [field]: 'late-resource' });
      const cleanup = requests.filter((item) => item.operation === close);
      expect(cleanup).toHaveLength(1);
      expect(cleanup[0].params).toEqual({ [field]: 'late-resource' });
      reply(cleanup[0].requestId);
      expect(sidecar.isRunning()).toBe(true);
      expect(child.kill).not.toHaveBeenCalled();
      stop();
      await Promise.all(pending);
    }
  );

  it('bounds timed-out resource creation without killing healthy sessions', async () => {
    const { request, requests, sidecar, stop } = setup();
    const pending = Array.from({ length: 64 }, () => request('openMoqSession'));
    await vi.advanceTimersByTimeAsync(21);
    await Promise.all(pending);
    expect(await request('openMoqSession')).toBe('SIDECAR_QUEUE_FULL');
    const health = request('health');
    expect(requests.at(-1).operation).toBe('health');
    expect(sidecar.isRunning()).toBe(true);
    stop();
    await health;
  });

  it('still kills a sidecar that replies to an unissued request', async () => {
    const { request, reply, child, sidecar } = setup();
    const pending = request('health');
    reply('invented-request');
    expect(await pending).toBe('MALFORMED_RESPONSE');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(sidecar.isRunning()).toBe(false);
  });
});
