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
const CPU_WARNING_LOAD = 0.5;
const CPU_BLOCKED_LOAD = 0.85;
const MEMORY_WARNING_PRESSURE = 0.8;
const MEMORY_BLOCKED_PRESSURE = 0.9;
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

function readCpuLoad(): number | null {
  const currentCpuSample = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;

  for (let i = 0; i < currentCpuSample.length; i++) {
    const previous = lastCpuSample[i]?.times;
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

  lastCpuSample = currentCpuSample;

  if (totalDelta <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
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
  if (input.memoryPressure > MEMORY_BLOCKED_PRESSURE) {
    blockedReasons.push('memory-pressure');
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
  if (input.memoryPressure > MEMORY_WARNING_PRESSURE) {
    warningReasons.push('memory-elevated');
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

  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryPressure =
    totalMemory > 0 ? Math.max(0, Math.min(1, 1 - freeMemory / totalMemory)) : 0;
  const cpuLoad = readCpuLoad();
  const classification = classifySystemPressure({
    cpuLoad,
    memoryPressure,
    eventLoopLagMs,
  });

  snapshot = {
    ...classification,
    cpuLoad,
    memoryPressure,
    eventLoopLagMs,
    measuredAt: now,
  };
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
