import { describe, expect, it, vi } from 'vitest';
import { createExplorerCache } from './cache';

const later = () => {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createExplorerCache', () => {
  it('keeps an answer for its time, then reads again', async () => {
    let now = 0;
    const cache = createExplorerCache(() => now);
    const load = vi.fn(async () => 'answer');
    await cache.read('key', load, { ttlMs: 1000 });
    await cache.read('key', load, { ttlMs: 1000 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.peek('key')).toBe('answer');
    now = 1000;
    expect(cache.peek('key')).toBeUndefined();
    await cache.read('key', load, { ttlMs: 1000 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares a read already on its way', async () => {
    const cache = createExplorerCache();
    const pending = later();
    const load = vi.fn(() => pending.promise);
    const first = cache.read('key', load);
    const second = cache.read('key', load);
    pending.resolve('answer');
    await expect(first).resolves.toBe('answer');
    await expect(second).resolves.toBe('answer');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never keeps a failed read: the next ask reads again', async () => {
    const cache = createExplorerCache();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce('answer');
    await expect(cache.read('key', load)).rejects.toThrow('busy');
    expect(cache.peek('key')).toBeUndefined();
    await expect(cache.read('key', load)).resolves.toBe('answer');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the read started last when a forced read overlaps an older one', async () => {
    const cache = createExplorerCache();
    const older = later();
    const newer = later();
    const first = cache.read('key', () => older.promise);
    const second = cache.read('key', () => newer.promise, { force: true });
    newer.resolve('new');
    await second;
    older.resolve('old');
    await first;
    expect(cache.peek('key')).toBe('new');
  });

  it("doesn't keep a read started before it was forgotten", async () => {
    const cache = createExplorerCache();
    const pending = later();
    const read = cache.read('account:Q1', () => pending.promise);
    cache.forget((key) => key.endsWith(':Q1'));
    pending.resolve('stale');
    await read;
    expect(cache.peek('account:Q1')).toBeUndefined();
  });

  it("doesn't keep a read started before it was cleared", async () => {
    const cache = createExplorerCache();
    const pending = later();
    const read = cache.read('key', () => pending.promise);
    cache.clear();
    pending.resolve('stale');
    await read;
    expect(cache.peek('key')).toBeUndefined();
  });
});
