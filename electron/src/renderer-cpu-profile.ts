import { app, type WebContents } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { log as loggerLog, warn as loggerWarn } from './logger';

const DEFAULT_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 60 * 60;
const DEFAULT_DELAY_SECONDS = 0;
const PROFILE_ARGUMENT = '--profile-renderer';
const PROFILE_DELAY_ARGUMENT = '--profile-renderer-delay';
const profiledContents = new WeakSet<WebContents>();

function parsePositiveSeconds(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_DURATION_SECONDS;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(MAX_DURATION_SECONDS, Math.round(parsed)));
}

export function rendererCpuProfileDurationSeconds(
  argv = process.argv
): number | null {
  const argument = argv.find(
    (value) =>
      value === PROFILE_ARGUMENT || value.startsWith(`${PROFILE_ARGUMENT}=`)
  );
  if (argument) {
    return parsePositiveSeconds(argument.split('=', 2)[1]);
  }
  return null;
}

function rendererCpuProfileDelaySeconds(
  argv = process.argv,
  environmentValue = process.env.QORTAL_RENDERER_PROFILE_DELAY_SECONDS
): number {
  const argument = argv.find((value) =>
    value.startsWith(`${PROFILE_DELAY_ARGUMENT}=`)
  );
  const raw = argument?.split('=', 2)[1] ?? environmentValue;
  if (raw === undefined) return DEFAULT_DELAY_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DELAY_SECONDS;
  return Math.min(MAX_DURATION_SECONDS, Math.round(parsed));
}

function safeLabel(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Race debugger commands as well as timers: Electron may not settle a command
// when its renderer disappears. Always remove the cancellation listener.
async function cancellable<T>(
  work: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  let cancel: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('Renderer profile cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await cancellable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      signal
    );
  } finally {
    clearTimeout(timer);
  }
}

export function maybeStartRendererCpuProfile(
  contents: WebContents,
  label: string
): void {
  const durationSeconds = rendererCpuProfileDurationSeconds();
  if (
    durationSeconds === null ||
    app.isPackaged ||
    contents.isDestroyed() ||
    profiledContents.has(contents)
  )
    return;
  profiledContents.add(contents);

  const controller = new AbortController();
  const cancel = () => controller.abort();
  contents.once('destroyed', cancel);
  contents.once('render-process-gone', cancel);
  const delaySeconds = rendererCpuProfileDelaySeconds();
  loggerLog('[RendererProfile] capture scheduled', {
    label,
    webContentsId: contents.id,
    delaySeconds,
    durationSeconds,
  });

  void delay(delaySeconds * 1_000, controller.signal)
    .then(() =>
      captureRendererCpuProfile(contents, label, durationSeconds, controller)
    )
    .catch((error) => {
      loggerWarn(
        controller.signal.aborted
          ? '[RendererProfile] capture cancelled (renderer closed or debugger detached)'
          : '[RendererProfile] capture failed',
        {
          label,
          webContentsId: contents.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    })
    .finally(() => {
      contents.removeListener('destroyed', cancel);
      contents.removeListener('render-process-gone', cancel);
    });
}

async function captureRendererCpuProfile(
  contents: WebContents,
  label: string,
  durationSeconds: number,
  controller: AbortController
): Promise<void> {
  if (controller.signal.aborted || contents.isDestroyed()) return;
  const debuggerClient = contents.debugger;
  if (debuggerClient.isAttached() || contents.isDevToolsOpened()) {
    throw new Error(
      'Chromium debugger is already attached; close DevTools before profiling'
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = path.join(
    app.getPath('userData'),
    'renderer-profiles'
  );
  const fileName = `${safeLabel(label) || 'renderer'}-${contents.id}-${timestamp}.cpuprofile`;
  const filePath = path.join(outputDirectory, fileName);
  let ownsDebugger = false;
  const onDetach = () => {
    ownsDebugger = false;
    controller.abort();
  };
  const command = (method: string, params?: object) => {
    if (controller.signal.aborted || !ownsDebugger) {
      throw new Error('Renderer profile cancelled');
    }
    return cancellable(
      debuggerClient.sendCommand(method, params),
      controller.signal
    );
  };

  try {
    debuggerClient.attach('1.3');
    ownsDebugger = true;
    debuggerClient.on('detach', onDetach);
    await command('Profiler.enable');
    await command('Profiler.setSamplingInterval', { interval: 1_000 });
    await command('Profiler.start');
    loggerLog('[RendererProfile] capture started', {
      label,
      webContentsId: contents.id,
      durationSeconds,
      filePath,
    });

    await delay(durationSeconds * 1_000, controller.signal);
    const result = (await command('Profiler.stop')) as { profile?: unknown };
    if (!result?.profile) throw new Error('Chromium returned no CPU profile');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(filePath, JSON.stringify(result.profile), 'utf8');
    loggerLog('[RendererProfile] capture saved', {
      label,
      webContentsId: contents.id,
      durationSeconds,
      filePath,
    });
  } finally {
    debuggerClient.removeListener('detach', onDetach);
    // A detach event relinquishes ownership, even if another client reattaches.
    if (
      ownsDebugger &&
      !contents.isDestroyed() &&
      debuggerClient.isAttached()
    ) {
      debuggerClient.detach();
    }
  }
}
