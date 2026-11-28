import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../background/background', () => ({
  getApiKeyFromStorage: vi.fn(async () => stored.value),
}));

import { useLastShown, useNodeActions } from './NodeActionParts';

const NODE = 'https://127.0.0.1:12391';

/** Requests that wait until called off, as a busy node would. */
const signals: AbortSignal[] = [];
const fetchMock = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      if (init?.signal) signals.push(init.signal);
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError'))
      );
    })
);

beforeEach(() => {
  stored.value = { apikey: 'test-key-1', url: NODE };
  signals.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNodeActions', () => {
  it('runs one of each action at a time', async () => {
    const { result } = renderHook(() => useNodeActions(NODE));
    let second: unknown;
    act(() => {
      void result.current.run('restart', '/admin/restart');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      second = await result.current.run('restart', '/admin/restart');
    });
    expect(second).toEqual({ status: 'running' });
    expect(result.current.states.restart).toEqual({ status: 'running' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Another action goes ahead.
    act(() => {
      void result.current.run('stop', '/admin/stop');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('calls off its requests once the window is gone', async () => {
    const { result, unmount } = renderHook(() => useNodeActions(NODE));
    let ended: Promise<unknown>;
    act(() => {
      ended = result.current.run('sync', '/admin/forcesync', {
        body: '203.0.113.5:12392',
        method: 'POST',
      });
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);

    unmount();
    expect(signals[0].aborted).toBe(true);
    expect(await ended).toEqual({ reason: 'failed', status: 'failed' });
  });
});

describe('useLastShown', () => {
  it('keeps the last value while its dialog closes', () => {
    const { rerender, result } = renderHook(
      ({ value }: { value: string | null }) => useLastShown(value),
      { initialProps: { value: null as string | null } }
    );
    expect(result.current).toBeNull();
    rerender({ value: 'restart' });
    expect(result.current).toBe('restart');
    rerender({ value: null });
    expect(result.current).toBe('restart');
    rerender({ value: 'stop' });
    expect(result.current).toBe('stop');
  });
});
