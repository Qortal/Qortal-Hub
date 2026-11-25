import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginReticulumSummaryRefresh,
  getReticulumTotalBadgeCount,
  scheduleReticulumSummaryRefresh,
} from './reticulumSummaryRefresh';

describe('Reticulum summary refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows an authoritative mention count to decrease after reads', () => {
    expect(
      getReticulumTotalBadgeCount({
        '519': { mentionCount: 3, unreadCount: 0 },
        '716': { mentionCount: 2, unreadCount: 0 },
      })
    ).toBe(5);
    expect(
      getReticulumTotalBadgeCount({
        '519': { mentionCount: 0, unreadCount: 0 },
        '716': { mentionCount: 0, unreadCount: 0 },
      })
    ).toBe(0);
  });

  it('includes unreadCount in the badge total', () => {
    expect(
      getReticulumTotalBadgeCount({
        '519': { mentionCount: 2, unreadCount: 5 },
        '716': { mentionCount: 0, unreadCount: 3 },
      })
    ).toBe(10);
  });

  it('rejects an older refresh after a newer refresh starts', () => {
    const sequence = { current: 0 };
    const firstWasSuperseded = beginReticulumSummaryRefresh(sequence);
    expect(firstWasSuperseded()).toBe(false);

    const secondWasSuperseded = beginReticulumSummaryRefresh(sequence);
    expect(firstWasSuperseded()).toBe(true);
    expect(secondWasSuperseded()).toBe(false);
  });

  it('debounces a short burst of summary changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const timerRef: {
      current: ReturnType<typeof setTimeout> | null;
    } = { current: null };
    const refreshWindowStartedAtRef: { current: number | null } = {
      current: null,
    };
    const refresh = vi.fn();

    scheduleReticulumSummaryRefresh(
      timerRef,
      refreshWindowStartedAtRef,
      refresh
    );
    vi.advanceTimersByTime(100);
    scheduleReticulumSummaryRefresh(
      timerRef,
      refreshWindowStartedAtRef,
      refresh
    );
    vi.advanceTimersByTime(149);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timerRef.current).toBeNull();
    expect(refreshWindowStartedAtRef.current).toBeNull();
  });

  it('cannot be postponed indefinitely by continuous summary changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const timerRef: {
      current: ReturnType<typeof setTimeout> | null;
    } = { current: null };
    const refreshWindowStartedAtRef: { current: number | null } = {
      current: null,
    };
    const refresh = vi.fn();

    for (let elapsed = 0; elapsed <= 400; elapsed += 100) {
      if (elapsed > 0) vi.advanceTimersByTime(100);
      scheduleReticulumSummaryRefresh(
        timerRef,
        refreshWindowStartedAtRef,
        refresh
      );
    }
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
