import { describe, expect, it, vi } from 'vitest';
import {
  SingleFlightReadiness,
  type ReadinessStatus,
} from './single-flight-readiness';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('SingleFlightReadiness', () => {
  it('is a no-op when the target is already ready', async () => {
    const start = vi.fn(async () => undefined);
    const onStatusChange = vi.fn();
    const readiness = new SingleFlightReadiness({
      isReady: () => true,
      onStatusChange,
      start,
    });

    await expect(readiness.ensureReady()).resolves.toBeUndefined();
    await expect(readiness.ensureReady()).resolves.toBeUndefined();

    expect(start).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(readiness.getStatus()).toEqual({ state: 'ready', revision: 0 });
  });

  it('shares one startup attempt between concurrent callers', async () => {
    const startup = deferred();
    let ready = false;
    const start = vi.fn(() => startup.promise);
    const readiness = new SingleFlightReadiness({
      isReady: () => ready,
      start,
    });

    const first = readiness.ensureReady();
    const second = readiness.ensureReady();
    expect(first).toBe(second);
    expect(readiness.getStatus()).toEqual({ state: 'starting', revision: 1 });

    ready = true;
    expect(readiness.getStatus()).toEqual({ state: 'ready', revision: 1 });
    startup.resolve();
    await Promise.all([first, second]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(readiness.getStatus()).toEqual({ state: 'ready', revision: 2 });
  });

  it('reports a failed attempt and permits a later recovery attempt', async () => {
    let ready = false;
    const statuses: ReadinessStatus[] = [];
    const start = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockImplementationOnce(async () => {
        ready = true;
      });
    const readiness = new SingleFlightReadiness({
      isReady: () => ready,
      onStatusChange: (status) => statuses.push(status),
      start,
    });

    await expect(readiness.ensureReady()).rejects.toThrow('bridge unavailable');
    expect(readiness.getStatus()).toEqual({
      state: 'failed',
      revision: 2,
      error: 'bridge unavailable',
    });

    await expect(readiness.ensureReady()).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledTimes(2);
    expect(readiness.getStatus()).toEqual({ state: 'ready', revision: 4 });
    expect(statuses.map(({ state }) => state)).toEqual([
      'starting',
      'failed',
      'starting',
      'ready',
    ]);
    expect(statuses.map(({ revision }) => revision)).toEqual([1, 2, 3, 4]);
  });

  it('treats a partially failed recovery as ready when the target exists', async () => {
    let ready = false;
    const readiness = new SingleFlightReadiness({
      isReady: () => ready,
      start: async () => {
        ready = true;
        throw new Error('optional recovery step failed');
      },
    });

    await expect(readiness.ensureReady()).rejects.toThrow(
      'optional recovery step failed'
    );
    expect(readiness.getStatus()).toEqual({ state: 'ready', revision: 2 });
  });

  it('ignores completion from a startup attempt that was reset', async () => {
    const startup = deferred();
    let ready = false;
    const readiness = new SingleFlightReadiness({
      isReady: () => ready,
      start: () => startup.promise,
    });

    const pending = readiness.ensureReady();
    readiness.reset();
    startup.resolve();
    await pending;

    expect(readiness.getStatus()).toEqual({ state: 'idle', revision: 2 });
  });
});
