type ReticulumBadgeSummary = {
  mentionCount?: number;
  unreadCount?: number;
};

type SequenceRef = {
  current: number;
};

type TimerRef = {
  current: ReturnType<typeof setTimeout> | null;
};

type TimestampRef = {
  current: number | null;
};

export const getReticulumTotalBadgeCount = (
  summaries: Record<string, ReticulumBadgeSummary>
): number =>
  Object.values(summaries || {}).reduce(
    (total, summary) =>
      total +
      Math.max(0, Number(summary?.mentionCount) || 0) +
      Math.max(0, Number(summary?.unreadCount) || 0),
    0
  );

export const beginReticulumSummaryRefresh = (
  sequenceRef: SequenceRef
): (() => boolean) => {
  const refreshSequence = ++sequenceRef.current;
  return () => refreshSequence !== sequenceRef.current;
};

export const scheduleReticulumSummaryRefresh = (
  timerRef: TimerRef,
  refreshWindowStartedAtRef: TimestampRef,
  refresh: () => void | Promise<unknown>,
  debounceMs = 150,
  maxWaitMs = 500
): void => {
  const now = Date.now();
  if (refreshWindowStartedAtRef.current === null) {
    refreshWindowStartedAtRef.current = now;
  }

  if (timerRef.current) {
    clearTimeout(timerRef.current);
  }

  const elapsed = Math.max(0, now - refreshWindowStartedAtRef.current);
  const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    refreshWindowStartedAtRef.current = null;
    void refresh();
  }, delay);
};
