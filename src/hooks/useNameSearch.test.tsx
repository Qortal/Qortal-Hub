import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNameSearch } from './useNameSearch';

vi.mock('../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

type Pending = {
  resolve: (names: string[]) => void;
  signal?: AbortSignal;
  url: string;
};

let pending: Pending[] = [];

const answer = (names: string[]) =>
  ({
    json: async () => names.map((name) => ({ name, owner: `Q${name}` })),
  }) as Response;

describe('useNameSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pending = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            pending.push({
              resolve: (names) => resolve(answer(names)),
              signal: init?.signal ?? undefined,
              url,
            });
          })
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks once typing has stopped for the delay', async () => {
    const { rerender, result } = renderHook(
      ({ value }) => useNameSearch(value, 8, { delayMs: 250, minLength: 2 }),
      { initialProps: { value: 'al' } }
    );

    act(() => vi.advanceTimersByTime(200));
    rerender({ value: 'ali' });
    act(() => vi.advanceTimersByTime(249));
    expect(pending).toHaveLength(0);
    expect(result.current.isLoading).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(pending.map(({ url }) => url)).toEqual([
      'http://node.test/names/search?query=ali&prefix=true&limit=8',
    ]);

    await act(async () => pending[0].resolve(['alice', 'alina']));
    expect(result.current.results).toEqual([
      { address: 'Qalice', name: 'alice' },
      { address: 'Qalina', name: 'alina' },
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not look up a value shorter than the minimum', () => {
    const { result } = renderHook(() =>
      useNameSearch('a', 8, { delayMs: 250, minLength: 2 })
    );

    act(() => vi.advanceTimersByTime(1000));

    expect(pending).toHaveLength(0);
    expect(result.current).toEqual({ isLoading: false, results: [] });
  });

  it('drops the answer for an older value and cancels its request', async () => {
    const { rerender, result } = renderHook(
      ({ value }) => useNameSearch(value),
      { initialProps: { value: 'al' } }
    );
    act(() => vi.advanceTimersByTime(300));
    rerender({ value: 'ali' });
    act(() => vi.advanceTimersByTime(300));

    expect(pending).toHaveLength(2);
    expect(pending[0].signal?.aborted).toBe(true);
    expect(pending[1].signal?.aborted).toBe(false);

    await act(async () => pending[1].resolve(['alice']));
    await act(async () => pending[0].resolve(['alan', 'alice']));

    expect(result.current.results).toEqual([
      { address: 'Qalice', name: 'alice' },
    ]);
  });

  it('sends the value as one query parameter', () => {
    renderHook(() => useNameSearch('a&b #c'));
    act(() => vi.advanceTimersByTime(300));

    expect(pending[0].url).toBe(
      'http://node.test/names/search?query=a%26b%20%23c&prefix=true&limit=20'
    );
  });
});
