/**
 * Qortino's model download as a job of its own. It keeps going when the
 * Qortino panel closes, tries again by itself when peers stop sending (the
 * node keeps every chunk it already has, so a new try picks up where the last
 * one stopped), says when it is done in Hub's notification, and carries on
 * after Hub restarts. The panel (the gate) only watches it;
 * installJobStore.ts holds where it stands.
 */
import i18n from 'i18next';
import { getDefaultStore } from 'jotai';
import { isRunningPublicNodeAtom } from '../atoms/global';
import { isQortinoLlmNativeAvailable } from './qortinoLlm';
import { executeEvent } from '../utils/events';
import { checkDeviceForModel, readDeviceTier } from './deviceTier';
import {
  chooseQortinoModelLayout,
  installQortinoModel,
  QortinoInstallError,
  reclaimOldQortinoFiles,
  savedModelBytes,
  type DownloadProgress,
} from './download';
import {
  getQortinoInstallJob,
  IDLE_QORTINO_INSTALL_JOB,
  isQortinoInstallJobActive,
  isQortinoInstallViewOpen,
  qortinoInstallErrorText,
  qortinoProgressRatio,
  resetQortinoInstallJobStoreForTests,
  updateQortinoInstallJob as set,
  type QortinoInstallJobError,
  type QortinoInstallJobState,
} from './installJobStore';
import {
  hasPendingQortinoInstall,
  setPendingQortinoInstall,
} from './installPending';
import { QORTINO_MODEL_LAYOUTS } from './manifest';
import { loadInstallState } from './store';

/** Waits between tries; a try that moved the download on starts again soon. */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
/** Tries in a row that get no further before the job gives up (~40 min). */
export const MAX_TRIES_WITHOUT_PROGRESS = 12;
/** A damaged part is downloaded whole again; not endlessly. */
const MAX_CHECKSUM_RETRIES = 2;

const RETRYABLE = new Set<QortinoInstallJobError['code']>([
  'stalled',
  'qdn_failed',
  'download',
  'not_published',
  'checksum',
  'generic',
]);

let controller: AbortController | null = null;
let wake: (() => void) | null = null;

const PHASE_RANK: Record<DownloadProgress['phase'], number> = {
  locate: 0,
  fetch: 1,
  save: 2,
  verify: 3,
  finalizing: 4,
  done: 5,
};

/** Grows as the download moves on, so tries can be compared. */
export function progressScore(progress: DownloadProgress): number {
  return (
    progress.partIndex * 1_000 +
    PHASE_RANK[progress.phase] * 100 +
    Math.round(qortinoProgressRatio(progress) * 99)
  );
}

function jobError(e: unknown): QortinoInstallJobError {
  if (e instanceof QortinoInstallError && e.code !== 'cancelled') {
    return { code: e.code, detail: e.detail };
  }
  const detail =
    e instanceof Error
      ? e.message
      : e && typeof e === 'object' && 'errorMessage' in e
        ? String((e as { errorMessage?: string }).errorMessage)
        : undefined;
  return { code: 'generic', detail: detail || undefined };
}

function isRetryable(error: QortinoInstallJobError): boolean {
  if (!RETRYABLE.has(error.code)) return false;
  // Not the desktop app: no try will change that.
  return !(
    error.code === 'download' && error.detail === 'desktop app required'
  );
}

const t = (key: string, options?: Record<string, unknown>): string =>
  String(i18n.t(key, options));

function banner(type: 'success' | 'error' | 'info', message: string): void {
  executeEvent('openGlobalSnackBar', {
    type,
    message,
    dismissible: true,
    duration: 9_000,
  });
}

/** Said once when the window closes while the download goes on. */
export function announceQortinoBackgroundDownload(): void {
  if (!isQortinoInstallJobActive()) return;
  banner('info', t('core:qortino_agent.notify.background'));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      if (wake === done) wake = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    wake = done;
  });
}

function finish(
  status: 'done' | 'failed' | 'cancelled',
  patch: Partial<QortinoInstallJobState> = {}
): void {
  controller = null;
  setPendingQortinoInstall(false);
  const watched = isQortinoInstallViewOpen();
  set({
    ...patch,
    status,
    retryAt: null,
    // The panel keeps an ending the window did not show.
    listed: status !== 'cancelled' && !watched,
  });
  if (status === 'cancelled') return;
  const text =
    status === 'done'
      ? t('core:qortino_agent.notify.ready')
      : qortinoInstallErrorText(getQortinoInstallJob().error, t);
  if (!watched) banner(status === 'done' ? 'success' : 'error', text);
}

async function run(signal: AbortSignal): Promise<void> {
  let best = -1;
  let triesWithoutProgress = 0;
  let checksumRetries = 0;
  try {
    // The old Lite/Standard packs cannot be used any more; their space
    // counts toward the new model.
    await reclaimOldQortinoFiles().catch(() => 0);
    // Three smaller parts on the public node, two on a private one, unless
    // some of one layout is on this computer already.
    let model = await chooseQortinoModelLayout(
      getDefaultStore().get(isRunningPublicNodeAtom)
    );
    let triedOtherLayout = false;
    for (let attempt = 1; ; attempt += 1) {
      if (signal.aborted) throw new QortinoInstallError('cancelled');
      set({ status: 'running', attempt, retryAt: null, error: null });

      const check = checkDeviceForModel(
        await readDeviceTier(),
        await savedModelBytes(model),
        model
      );
      if (!check.enoughStorage) {
        finish('failed', {
          error: {
            code: 'low_storage',
            neededBytes: check.neededBytes,
            freeBytes: check.tier.availStorageBytes,
          },
        });
        return;
      }

      let reached = -1;
      try {
        const install = await installQortinoModel({
          signal,
          model,
          onProgress: (progress) => {
            reached = Math.max(reached, progressScore(progress));
            set({ progress });
          },
        });
        finish('done', { install, error: null });
        return;
      } catch (e) {
        if (signal.aborted) throw new QortinoInstallError('cancelled');
        if (e instanceof QortinoInstallError && e.code === 'cancelled') throw e;
        const error = jobError(e);
        // That layout is not on QDN (yet): the other one may be. Only
        // before any of it is on this computer, and only once.
        if (
          error.code === 'not_published' &&
          !triedOtherLayout &&
          reached < 0 &&
          (await savedModelBytes(model)) === 0
        ) {
          triedOtherLayout = true;
          model =
            QORTINO_MODEL_LAYOUTS.find((layout) => layout !== model) ?? model;
          continue;
        }
        if (error.code === 'checksum') checksumRetries += 1;
        if (reached > best) {
          best = reached;
          triesWithoutProgress = 0;
        } else {
          triesWithoutProgress += 1;
        }
        if (
          !isRetryable(error) ||
          checksumRetries > MAX_CHECKSUM_RETRIES ||
          triesWithoutProgress >= MAX_TRIES_WITHOUT_PROGRESS
        ) {
          finish('failed', { error });
          return;
        }
        const delay =
          RETRY_DELAYS_MS[
            Math.min(triesWithoutProgress, RETRY_DELAYS_MS.length - 1)
          ];
        set({ status: 'retrying', error, retryAt: Date.now() + delay });
        await sleep(delay, signal);
      }
    }
  } catch (e) {
    if (
      signal.aborted ||
      (e instanceof QortinoInstallError && e.code === 'cancelled')
    ) {
      finish('cancelled');
      return;
    }
    finish('failed', { error: jobError(e) });
  }
}

/** Start the download, or do nothing if it is already going. */
export function startQortinoInstallJob(): void {
  if (isQortinoInstallJobActive()) return;
  const next = new AbortController();
  controller = next;
  setPendingQortinoInstall(true);
  set({
    ...IDLE_QORTINO_INSTALL_JOB,
    viewOpen: getQortinoInstallJob().viewOpen,
    status: 'running',
    attempt: 1,
    listed: true,
  });
  void run(next.signal);
}

export function cancelQortinoInstallJob(): void {
  if (!isQortinoInstallJobActive()) return;
  controller?.abort();
}

/** Skip the wait before the next try. */
export function retryQortinoInstallNow(): void {
  if (getQortinoInstallJob().status === 'retrying') wake?.();
}

/** Carry on with a download Hub was closed in the middle of. */
export async function resumeQortinoInstallIfPending(): Promise<void> {
  if (isQortinoInstallJobActive() || !hasPendingQortinoInstall()) return;
  if (!isQortinoLlmNativeAvailable()) return;
  const saved = await loadInstallState().catch(() => null);
  if (saved?.installed && saved.llmPath) {
    setPendingQortinoInstall(false);
    return;
  }
  startQortinoInstallJob();
}

export function resetQortinoInstallJobForTests(): void {
  controller?.abort();
  controller = null;
  wake = null;
  resetQortinoInstallJobStoreForTests();
}
