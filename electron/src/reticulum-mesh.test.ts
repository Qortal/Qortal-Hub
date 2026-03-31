import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('electron-is-dev', () => ({
  default: false,
}));

import { peekFanoutProbeBatch } from './reticulum-mesh';

describe('peekFanoutProbeBatch', () => {
  it('returns all fresh hashes when under cap', () => {
    const seen = new Set<string>();
    const { batch, deferredRemaining } = peekFanoutProbeBatch(
      ['a', 'b'],
      seen,
      8
    );
    expect(batch).toEqual(['a', 'b']);
    expect(deferredRemaining).toBe(0);
  });

  it('skips hashes already in seen', () => {
    const seen = new Set(['a']);
    const { batch, deferredRemaining } = peekFanoutProbeBatch(
      ['a', 'b', 'c'],
      seen,
      8
    );
    expect(batch).toEqual(['b', 'c']);
    expect(deferredRemaining).toBe(0);
  });

  it('caps batch and reports deferred remainder', () => {
    const seen = new Set<string>();
    const current = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'];
    const { batch, deferredRemaining } = peekFanoutProbeBatch(current, seen, 8);
    expect(batch).toHaveLength(8);
    expect(batch[0]).toBe('h1');
    expect(batch[7]).toBe('h8');
    expect(deferredRemaining).toBe(2);
  });

  it('second emit with same hashes yields empty batch when seen is populated', () => {
    const seen = new Set(['x']);
    const first = peekFanoutProbeBatch(['x'], seen, 8);
    expect(first.batch).toEqual([]);
    expect(first.deferredRemaining).toBe(0);
  });
});
