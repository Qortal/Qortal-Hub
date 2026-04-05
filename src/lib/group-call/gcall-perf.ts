export interface GcallPerfSeriesSummary {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
}

export interface GcallPerfLongTaskEntry {
  startTime: number;
  duration: number;
  name: string;
}

export interface GcallPerfSnapshot {
  exportedAtMs: number;
  series: Record<string, GcallPerfSeriesSummary>;
  counters: Record<string, number>;
  longTasks: {
    count: number;
    maxMs: number;
    recent: GcallPerfLongTaskEntry[];
  };
  meta?: Record<string, unknown>;
}

const GCALL_PERF_STORAGE_KEY = 'qortal:gcall-perf';
const RECENT_SAMPLE_LIMIT = 512;
const LONG_TASK_LIMIT = 40;

/**
 * GCall perf (tick timing, counters, long-task observer, `window.__qortalGCallPerfStats`)
 * is **on by default** so diagnostics exports include full perf without tester setup.
 *
 * Opt out: `localStorage.setItem('qortal:gcall-perf', '0')` or build with `VITE_GCALL_PERF=0`.
 */
export function readGcallPerfEnabled(): boolean {
  if (
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_GCALL_PERF === '0'
  ) {
    return false;
  }
  try {
    if (typeof localStorage === 'undefined') return true;
    const v = localStorage.getItem(GCALL_PERF_STORAGE_KEY);
    if (v === '0' || v === 'off') return false;
    return true;
  } catch {
    return true;
  }
}

export function summarizePerfSeries(
  values: readonly number[],
  totalMs: number,
  count: number
): GcallPerfSeriesSummary {
  if (count <= 0 || values.length === 0) {
    return { count, totalMs, avgMs: 0, maxMs: 0, p95Ms: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    count,
    totalMs,
    avgMs: totalMs / count,
    maxMs: sorted[sorted.length - 1] ?? 0,
    p95Ms: sorted[idx] ?? 0,
  };
}

interface PerfSeriesState {
  recent: number[];
  totalMs: number;
  count: number;
}

export class GcallPerfCollector {
  private readonly series = new Map<string, PerfSeriesState>();
  private readonly counters = new Map<string, number>();
  private readonly longTasks: GcallPerfLongTaskEntry[] = [];
  private longTaskCount = 0;
  private longTaskMaxMs = 0;

  reset(): void {
    this.series.clear();
    this.counters.clear();
    this.longTasks.length = 0;
    this.longTaskCount = 0;
    this.longTaskMaxMs = 0;
  }

  recordDuration(name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    let state = this.series.get(name);
    if (!state) {
      state = { recent: [], totalMs: 0, count: 0 };
      this.series.set(name, state);
    }
    state.recent.push(durationMs);
    if (state.recent.length > RECENT_SAMPLE_LIMIT) {
      state.recent.splice(0, state.recent.length - RECENT_SAMPLE_LIMIT);
    }
    state.totalMs += durationMs;
    state.count++;
  }

  recordDurationPerSource(
    name: string,
    durationMs: number,
    activeSourceCount: number
  ): void {
    if (activeSourceCount <= 0) return;
    this.recordDuration(name, durationMs / activeSourceCount);
  }

  incrementCounter(name: string, inc = 1): void {
    if (!Number.isFinite(inc) || inc === 0) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + inc);
  }

  recordLongTask(entry: GcallPerfLongTaskEntry): void {
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return;
    this.longTaskCount++;
    if (entry.duration > this.longTaskMaxMs) {
      this.longTaskMaxMs = entry.duration;
    }
    this.longTasks.push(entry);
    if (this.longTasks.length > LONG_TASK_LIMIT) {
      this.longTasks.splice(0, this.longTasks.length - LONG_TASK_LIMIT);
    }
  }

  snapshot(meta?: Record<string, unknown>): GcallPerfSnapshot {
    const series: Record<string, GcallPerfSeriesSummary> = {};
    for (const [name, state] of this.series.entries()) {
      series[name] = summarizePerfSeries(
        state.recent,
        state.totalMs,
        state.count
      );
    }
    const counters: Record<string, number> = {};
    for (const [name, value] of this.counters.entries()) {
      counters[name] = value;
    }
    return {
      exportedAtMs: Date.now(),
      series,
      counters,
      longTasks: {
        count: this.longTaskCount,
        maxMs: this.longTaskMaxMs,
        recent: [...this.longTasks],
      },
      meta,
    };
  }
}
