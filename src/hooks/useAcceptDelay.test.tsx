import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcceptDelay } from './useAcceptDelay';

type Props = { active: boolean; resetKey: unknown };

const defineHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
};

const setHidden = (hidden: boolean) => {
  defineHidden(hidden);
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useAcceptDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    defineHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    defineHidden(false);
  });

  const render = (initialProps: Props) =>
    renderHook(
      ({ active, resetKey }: Props) => useAcceptDelay(active, resetKey),
      { initialProps }
    );

  it('allows Accept only after a second', () => {
    const { result } = render({ active: true, resetKey: 1 });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('turns Accept off in the same render that shows a new request', () => {
    const { result, rerender } = render({ active: true, resetKey: 1 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);

    rerender({ active: true, resetKey: 2 });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('is never ready while inactive', () => {
    const { result, rerender } = render({ active: false, resetKey: 1 });
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);

    rerender({ active: true, resetKey: 1 });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
  });

  it('starts over when Hub comes back to the screen', () => {
    const { result } = render({ active: true, resetKey: 1 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);

    act(() => setHidden(true));
    expect(result.current).toBe(false);
    // The delay does not run while Hub is off screen.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);

    act(() => setHidden(false));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
  });
});
