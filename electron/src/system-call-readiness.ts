import os from 'os';

export type SystemCallReadinessStatus =
  | 'good'
  | 'warning'
  | 'blocked'
  | 'unknown';

export type SystemCallReadinessSnapshot = {
  status: SystemCallReadinessStatus;
  reasons: string[];
  cpuLoad: number | null;
  memoryPressure: number;
  eventLoopLagMs: number;
  measuredAt: number;
};

const SAMPLE_INTERVAL_MS = 15_000;
const LIVE_SAMPLE_INTERVAL_MS = 250;
const CPU_WARNING_LOAD = 0.5;
const CPU_BLOCKED_LOAD = 0.85;
const EVENT_LOOP_WARNING_LAG_MS = 100;
const EVENT_LOOP_BLOCKED_LAG_MS = 250;

let snapshot: SystemCallReadinessSnapshot = {
  status: 'unknown',
  reasons: ['not-measured-yet'],
  cpuLoad: null,
  memoryPressure: 0,
  eventLoopLagMs: 0,
  measuredAt: 0,
};

let timer: ReturnType<typeof setInterval> | null = null;
let lastCpuSample = os.cpus();
let nextExpectedTickMs = Date.now() + SAMPLE_INTERVAL_MS;

function computeCpuLoad(
  previousCpuSample: os.CpuInfo[],
  currentCpuSample: os.CpuInfo[]
): number | null {
  let idleDelta = 0;
  let totalDelta = 0;

  for (let i = 0; i < currentCpuSample.length; i++) {
    const previous = previousCpuSample[i]?.times;
    const current = currentCpuSample[i].times;
    if (!previous) continue;

    const previousTotal = Object.values(previous).reduce(
      (total, value) => total + value,
      0
    );
    const currentTotal = Object.values(current).reduce(
      (total, value) => total + value,
      0
    );

    idleDelta += current.idle - previous.idle;
    totalDelta += currentTotal - previousTotal;
  }

  if (totalDelta <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
}

function readCpuLoad(): number | null {
  const currentCpuSample = os.cpus();
  const cpuLoad = computeCpuLoad(lastCpuSample, currentCpuSample);
  lastCpuSample = currentCpuSample;
  return cpuLoad;
}

function readMemoryPressure(): number {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  // Keep this as a diagnostic metric only. Raw free-memory ratios are misleading
  // on macOS and can also be noisy on Windows because reclaimable/cache memory is
  // not the same thing as call-breaking memory pressure.
  return totalMemory > 0
    ? Math.max(0, Math.min(1, 1 - freeMemory / totalMemory))
    : 0;
}

function buildReadinessSnapshot(input: {
  cpuLoad: number | null;
  memoryPressure: number;
  eventLoopLagMs: number;
  measuredAt: number;
}): SystemCallReadinessSnapshot {
  const classification = classifySystemPressure({
    cpuLoad: input.cpuLoad,
    memoryPressure: input.memoryPressure,
    eventLoopLagMs: input.eventLoopLagMs,
  });

  return {
    ...classification,
    cpuLoad: input.cpuLoad,
    memoryPressure: input.memoryPressure,
    eventLoopLagMs: input.eventLoopLagMs,
    measuredAt: input.measuredAt,
  };
}

function classifySystemPressure(input: {
  cpuLoad: number | null;
  memoryPressure: number;
  eventLoopLagMs: number;
}): Pick<SystemCallReadinessSnapshot, 'status' | 'reasons'> {
  const blockedReasons: string[] = [];

  if (input.cpuLoad !== null && input.cpuLoad > CPU_BLOCKED_LOAD) {
    blockedReasons.push('cpu-busy');
  }
  if (input.eventLoopLagMs > EVENT_LOOP_BLOCKED_LAG_MS) {
    blockedReasons.push('main-loop-lag');
  }

  if (blockedReasons.length > 0) {
    return { status: 'blocked', reasons: blockedReasons };
  }

  const warningReasons: string[] = [];

  if (input.cpuLoad !== null && input.cpuLoad > CPU_WARNING_LOAD) {
    warningReasons.push('cpu-elevated');
  }
  if (input.eventLoopLagMs > EVENT_LOOP_WARNING_LAG_MS) {
    warningReasons.push('main-loop-lag-elevated');
  }

  if (warningReasons.length > 0) {
    return { status: 'warning', reasons: warningReasons };
  }

  if (input.cpuLoad === null) {
    return { status: 'unknown', reasons: ['cpu-load-unavailable'] };
  }

  return { status: 'good', reasons: [] };
}

function sampleSystemCallReadiness(): void {
  const now = Date.now();
  const eventLoopLagMs = Math.max(0, now - nextExpectedTickMs);
  nextExpectedTickMs = now + SAMPLE_INTERVAL_MS;
  const cpuLoad = readCpuLoad();

  snapshot = buildReadinessSnapshot({
    cpuLoad,
    memoryPressure: readMemoryPressure(),
    eventLoopLagMs,
    measuredAt: now,
  });
}

export function startSystemCallReadinessMonitor(): void {
  if (timer) return;

  nextExpectedTickMs = Date.now() + SAMPLE_INTERVAL_MS;
  timer = setInterval(sampleSystemCallReadiness, SAMPLE_INTERVAL_MS);
  timer.unref?.();
}

export function stopSystemCallReadinessMonitor(): void {
  if (!timer) return;

  clearInterval(timer);
  timer = null;
}

export function getSystemCallReadinessSnapshot(): SystemCallReadinessSnapshot {
  return snapshot;
}

export async function refreshSystemCallReadinessSnapshot(): Promise<SystemCallReadinessSnapshot> {
  const startCpuSample = os.cpus();
  const expectedWakeMs = Date.now() + LIVE_SAMPLE_INTERVAL_MS;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, LIVE_SAMPLE_INTERVAL_MS);
    timeout.unref?.();
  });

  const measuredAt = Date.now();
  const eventLoopLagMs = Math.max(0, measuredAt - expectedWakeMs);
  const cpuLoad = computeCpuLoad(startCpuSample, os.cpus());

  snapshot = buildReadinessSnapshot({
    cpuLoad,
    memoryPressure: readMemoryPressure(),
    eventLoopLagMs,
    measuredAt,
  });

  return snapshot;
}
