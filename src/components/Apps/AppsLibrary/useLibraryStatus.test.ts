import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { LOADING_GRACE_MS } from './libraryLayout';
import { useLibraryStatus } from './useLibraryStatus';

describe('useLibraryStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is loading at first, and empty once the grace time is over', () => {
    const { result } = renderHook(() => useLibraryStatus(0, 0));
    expect(result.current).toBe('loading');

    act(() => {
      vi.advanceTimersByTime(LOADING_GRACE_MS - 1);
    });
    expect(result.current).toBe('loading');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('empty');
  });

  it('is empty after a refresh that brought nothing', () => {
    const { result, rerender } = renderHook(
      ({ settled }) => useLibraryStatus(0, settled),
      { initialProps: { settled: 0 } }
    );
    rerender({ settled: 1 });
    expect(result.current).toBe('empty');
  });

  it('is ready as soon as there are apps', () => {
    const { result, rerender } = renderHook(
      ({ count }) => useLibraryStatus(count, 0),
      { initialProps: { count: 0 } }
    );
    rerender({ count: 3 });
    expect(result.current).toBe('ready');

    act(() => {
      vi.advanceTimersByTime(LOADING_GRACE_MS);
    });
    expect(result.current).toBe('ready');
  });
});
