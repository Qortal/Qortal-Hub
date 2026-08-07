import { app } from 'electron';
import inspector from 'inspector';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { log as loggerLog, warn as loggerWarn } from './logger';

type MainPressureMetadata = Record<string, unknown>;

type MainPressureTask = {
  id: number;
  name: string;
  startedAtMs: number;
  metadata?: MainPressureMetadata;
};

type CompletedMainPressureTask = {
  name: string;
  durationMs: number;
  endedAtMs: number;
  metadata?: MainPressureMetadata;
};

const TASK_SLOW_THRESHOLD_MS = readNumberEnv(
  'QORTAL_MAIN_PRESSURE_TASK_SLOW_MS',
  50
);
const PROFILE_STALL_THRESHOLD_MS = readNumberEnv(
  'QORTAL_MAIN_PRESSURE_PROFILE_STALL_MS',
  150
);
const PROFILE_DURATION_MS = readNumberEnv(
  'QORTAL_MAIN_PRESSURE_PROFILE_DURATION_MS',
  4_000
);
const PROFILE_COOLDOWN_MS = readNumberEnv(
  'QORTAL_MAIN_PRESSURE_PROFILE_COOLDOWN_MS',
  60_000
);
const PROFILER_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QORTAL_MAIN_PRESSURE_PROFILER ?? '0').trim().toLowerCase()
);
const RECENT_SLOW_LIMIT = 12;

let nextTaskId = 1;
let lastProfileStartedAtMs = 0;
let profileInFlight = false;
const activeTasks: MainPressureTask[] = [];
const recentSlowTasks: CompletedMainPressureTask[] = [];

function readNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function nowMs(): number {
  return Date.now();
}

function sanitizeProfileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function metadataToLog(metadata?: MainPressureMetadata): string {
  if (!metadata) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value).slice(0, 120)}`);
    }
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function finishTask(task: MainPressureTask): void {
  const idx = activeTasks.findIndex((entry) => entry.id === task.id);
  if (idx >= 0) {
    activeTasks.splice(idx, 1);
  }
  const endedAtMs = nowMs();
  const durationMs = endedAtMs - task.startedAtMs;
  if (durationMs < TASK_SLOW_THRESHOLD_MS) return;
  recentSlowTasks.push({
    name: task.name,
    durationMs,
    endedAtMs,
    metadata: task.metadata,
  });
  while (recentSlowTasks.length > RECENT_SLOW_LIMIT) {
    recentSlowTasks.shift();
  }
  loggerLog(
    `[MainPressure] stage=slow-task task=${task.name} duration_ms=${Math.round(
      durationMs
    )}${metadataToLog(task.metadata)}`
  );
}

export function runMainPressureTask<T>(
  name: string,
  metadata: MainPressureMetadata | undefined,
  fn: () => T
): T {
  const task: MainPressureTask = {
    id: nextTaskId++,
    name,
    startedAtMs: nowMs(),
    metadata,
  };
  activeTasks.push(task);
  try {
    return fn();
  } finally {
    finishTask(task);
  }
}

export async function runMainPressureTaskAsync<T>(
  name: string,
  metadata: MainPressureMetadata | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const task: MainPressureTask = {
    id: nextTaskId++,
    name,
    startedAtMs: nowMs(),
    metadata,
  };
  activeTasks.push(task);
  try {
    return await fn();
  } finally {
    finishTask(task);
  }
}

export function describeMainPressureState(): string {
  const now = nowMs();
  const active = activeTasks
    .slice(-4)
    .map((task) => {
      const ageMs = Math.max(0, now - task.startedAtMs);
      return `${task.name}:${Math.round(ageMs)}ms${metadataToLog(task.metadata)}`;
    })
    .join('|');
  const recent = recentSlowTasks
    .slice(-4)
    .map((task) => {
      const ageMs = Math.max(0, now - task.endedAtMs);
      return `${task.name}:${Math.round(task.durationMs)}ms:${Math.round(ageMs)}ms_ago${metadataToLog(task.metadata)}`;
    })
    .join('|');
  return `active_tasks=${active || 'none'} recent_slow_tasks=${recent || 'none'}`;
}

export function noteMainLoopStallForProfiling(delayMs: number): void {
  if (!PROFILER_ENABLED) return;
  if (delayMs < PROFILE_STALL_THRESHOLD_MS) return;
  const now = nowMs();
  if (profileInFlight || now - lastProfileStartedAtMs < PROFILE_COOLDOWN_MS) {
    return;
  }
  lastProfileStartedAtMs = now;
  profileInFlight = true;
  void captureMainCpuProfile(delayMs)
    .catch((err) => {
      loggerWarn(
        `[MainPressure] stage=cpu-profile-failed error=${
          err instanceof Error ? err.message : String(err)
        }`
      );
    })
    .finally(() => {
      profileInFlight = false;
    });
}

function postInspector<T>(
  session: inspector.Session,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result as T);
      }
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureMainCpuProfile(triggerDelayMs: number): Promise<void> {
  const session = new inspector.Session();
  const startedAtMs = nowMs();
  const timestamp = new Date(startedAtMs).toISOString().replace(/[:.]/g, '-');
  const dir = app.isReady()
    ? path.join(app.getPath('userData'), 'main-pressure-profiles')
    : path.join(process.cwd(), 'main-pressure-profiles');
  const fileName = sanitizeProfileName(
    `main-stall-${timestamp}-${Math.round(triggerDelayMs)}ms.cpuprofile`
  );
  const filePath = path.join(dir, fileName);
  try {
    session.connect();
    await postInspector(session, 'Profiler.enable');
    await postInspector(session, 'Profiler.start');
    loggerLog(
      `[MainPressure] stage=cpu-profile-start trigger_delay_ms=${Math.round(
        triggerDelayMs
      )} duration_ms=${PROFILE_DURATION_MS} ${describeMainPressureState()}`
    );
    await delay(PROFILE_DURATION_MS);
    const result = await postInspector<{ profile: unknown }>(
      session,
      'Profiler.stop'
    );
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(result.profile));
    loggerLog(
      `[MainPressure] stage=cpu-profile-saved path=${filePath} duration_ms=${Math.round(
        nowMs() - startedAtMs
      )}`
    );
  } finally {
    try {
      session.disconnect();
    } catch {
      /* ignore */
    }
  }
}
