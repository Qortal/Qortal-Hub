import { beforeEach, describe, expect, it } from 'vitest';
import {
  GcallPerfCollector,
  readGcallPerfEnabled,
  summarizePerfSeries,
} from './gcall-perf';

describe('readGcallPerfEnabled', () => {
  beforeEach(() => {
    localStorage.removeItem('qortal:gcall-perf');
  });

  it('defaults to true in development when localStorage is unset (vitest runs as dev; production defaults off)', () => {
    expect(readGcallPerfEnabled()).toBe(true);
  });

  it('is false when localStorage opts out', () => {
    localStorage.setItem('qortal:gcall-perf', '0');
    expect(readGcallPerfEnabled()).toBe(false);
  });

  it('is false when localStorage is off', () => {
    localStorage.setItem('qortal:gcall-perf', 'off');
    expect(readGcallPerfEnabled()).toBe(false);
  });

  it('is true when localStorage is 1', () => {
    localStorage.setItem('qortal:gcall-perf', '1');
    expect(readGcallPerfEnabled()).toBe(true);
  });
});

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
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.series.tickTotalMs.avgMs).toBe(5);
    expect(snapshot.series.tickTotalPerSourceMs.avgMs).toBe(3);
    expect(snapshot.counters.adaptiveRuns).toBe(1);
    expect(snapshot.counters.adaptivePosts).toBe(2);
    expect(snapshot.longTasks.count).toBe(1);
    expect(snapshot.longTasks.maxMs).toBe(24);
    expect(snapshot.longTasks.recent[0]?.name).toBe('self');
    expect(snapshot.meta?.roomState).toBe('connected');
  });

  it('getLongTaskPressure reports count and recentHeavy without building a full snapshot', () => {
    const perf = new GcallPerfCollector();
    perf.recordLongTask({ startTime: 0, duration: 40, name: 'a' });
    perf.recordLongTask({ startTime: 0, duration: 55, name: 'b' });
    const p = perf.getLongTaskPressure();
    expect(p.count).toBe(2);
    expect(p.recentHeavy).toBe(true);
    const snap = perf.snapshot({ perfCollectionEnabled: false });
    expect(snap.enabled).toBe(false);
    expect(snap.series).toEqual({});
    expect(snap.longTasks.count).toBe(2);
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
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.series).toEqual({});
    expect(snapshot.counters).toEqual({});
    expect(snapshot.longTasks.count).toBe(0);
    expect(snapshot.longTasks.recent).toEqual([]);
  });
});
