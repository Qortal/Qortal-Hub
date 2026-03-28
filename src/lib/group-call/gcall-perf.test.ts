import { describe, expect, it } from 'vitest';
import {
  GcallPerfCollector,
  summarizePerfSeries,
} from './gcall-perf';

describe('gcall-perf', () => {
  it('summarizes avg, max, and p95 from recent samples', () => {
    const summary = summarizePerfSeries([1, 2, 3, 4, 10], 20, 5);
    expect(summary.count).toBe(5);
    expect(summary.totalMs).toBe(20);
    expect(summary.avgMs).toBe(4);
    expect(summary.maxMs).toBe(10);
    expect(summary.p95Ms).toBe(10);
  });

  it('tracks counters, per-source timings, and long tasks', () => {
    const perf = new GcallPerfCollector();
    perf.recordDuration('tickTotalMs', 6);
    perf.recordDuration('tickTotalMs', 4);
    perf.recordDurationPerSource('tickTotalPerSourceMs', 9, 3);
    perf.incrementCounter('adaptiveRuns');
    perf.incrementCounter('adaptivePosts', 2);
    perf.recordLongTask({
      startTime: 10,
      duration: 24,
      name: 'self',
    });

    const snapshot = perf.snapshot({ roomState: 'connected' });
    expect(snapshot.series.tickTotalMs.avgMs).toBe(5);
    expect(snapshot.series.tickTotalPerSourceMs.avgMs).toBe(3);
    expect(snapshot.counters.adaptiveRuns).toBe(1);
    expect(snapshot.counters.adaptivePosts).toBe(2);
    expect(snapshot.longTasks.count).toBe(1);
    expect(snapshot.longTasks.maxMs).toBe(24);
    expect(snapshot.longTasks.recent[0]?.name).toBe('self');
    expect(snapshot.meta?.roomState).toBe('connected');
  });

  it('reset clears previous measurements', () => {
    const perf = new GcallPerfCollector();
    perf.recordDuration('tickTotalMs', 5);
    perf.incrementCounter('ticks');
    perf.recordLongTask({
      startTime: 0,
      duration: 12,
      name: 'old',
    });
    perf.reset();

    const snapshot = perf.snapshot();
    expect(snapshot.series).toEqual({});
    expect(snapshot.counters).toEqual({});
    expect(snapshot.longTasks.count).toBe(0);
    expect(snapshot.longTasks.recent).toEqual([]);
  });
});
