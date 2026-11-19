/**
 * Where Qortino's model download stands (installJob.ts runs it). Kept apart
 * from the runner so other parts of Hub can show the download
 * without loading any of the download code.
 */
import type { DownloadProgress, QortinoInstallErrorCode } from './download';
import { formatBytes } from './manifest';
import type { QortinoInstallState } from './store';

export type QortinoInstallJobError =
  | {
      code: Exclude<QortinoInstallErrorCode, 'cancelled'> | 'generic';
      detail?: string;
    }
  | { code: 'low_storage'; neededBytes: number; freeBytes: number };

export type QortinoInstallJobStatus =
  | 'idle'
  | 'running'
  /** Between tries: peers stopped sending, the next try starts at retryAt. */
  | 'retrying'
  | 'done'
  | 'failed'
  | 'cancelled';

export type QortinoInstallJobState = {
  status: QortinoInstallJobStatus;
  progress: DownloadProgress | null;
  /** Why the last try failed: the reason given up on, or being retried. */
  error: QortinoInstallJobError | null;
  retryAt: number | null;
  attempt: number;
  install: QortinoInstallState | null;
  /**
   * Worth showing outside the Qortino panel (GO lists it in its notifications
   * panel): while it runs, and once it ended until it is seen in the panel.
   */
  listed: boolean;
  /** The Qortino window is showing the download. */
  viewOpen: boolean;
};

export const IDLE_QORTINO_INSTALL_JOB: QortinoInstallJobState = {
  status: 'idle',
  progress: null,
  error: null,
  retryAt: null,
  attempt: 0,
  install: null,
  listed: false,
  viewOpen: false,
};

let state: QortinoInstallJobState = IDLE_QORTINO_INSTALL_JOB;
let openViews = 0;
const listeners = new Set<() => void>();

export function updateQortinoInstallJob(
  patch: Partial<QortinoInstallJobState>
): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeQortinoInstallJob(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getQortinoInstallJob(): QortinoInstallJobState {
  return state;
}

export function isQortinoInstallJobActive(
  job: QortinoInstallJobState = state
): boolean {
  return job.status === 'running' || job.status === 'retrying';
}

/**
 * The Qortino window is showing the download. While it is, the window tells
 * how it ends; a download that already ended leaves the panel once seen here.
 */
export function attachQortinoInstallView(): () => void {
  openViews += 1;
  const ended = state.status === 'done' || state.status === 'failed';
  updateQortinoInstallJob({
    viewOpen: true,
    ...(ended ? { listed: false } : {}),
  });
  return () => {
    openViews = Math.max(0, openViews - 1);
    updateQortinoInstallJob({ viewOpen: openViews > 0 });
  };
}

export function isQortinoInstallViewOpen(): boolean {
  return openViews > 0;
}

/** Remove a finished or failed download from the notifications panel. */
export function dismissQortinoInstallRow(): void {
  if (isQortinoInstallJobActive()) return;
  updateQortinoInstallJob({ listed: false });
}

/** What the download adds to the bell's badge: itself, while out of sight. */
export function qortinoInstallUnseen(
  job: QortinoInstallJobState = state
): number {
  return job.listed && !job.viewOpen ? 1 : 0;
}

/** What a repeated try is waiting out, for the words shown meanwhile. */
export type QortinoRetryCause = 'peers' | 'connection' | 'damaged';

export function qortinoRetryCause(
  error: QortinoInstallJobError | null
): QortinoRetryCause {
  switch (error?.code) {
    // Saving broke off (the next try carries on from the saved bytes).
    case 'download':
    case 'generic':
      return 'connection';
    case 'checksum':
      return 'damaged';
    default:
      return 'peers';
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Share of the current step that is done, 0-1. */
export function qortinoProgressRatio(
  progress: DownloadProgress | null
): number {
  if (!progress) return 0;
  if (progress.bytesTotal > 0) {
    return Math.min(1, progress.bytesDone / progress.bytesTotal);
  }
  return progress.phase === 'done' ? 1 : 0;
}

export function qortinoProgressText(
  progress: DownloadProgress | null,
  t: Translate
): string {
  if (!progress) return '';
  const part = { part: progress.partIndex, count: progress.partCount };
  switch (progress.phase) {
    case 'locate':
      return t('core:qortino_agent.progress.locate');
    case 'fetch':
      return t('core:qortino_agent.progress.fetch', {
        ...part,
        percent: Math.round(qortinoProgressRatio(progress) * 100),
      });
    case 'save':
      return t('core:qortino_agent.progress.save', part);
    case 'verify':
      return t('core:qortino_agent.progress.verify', part);
    default:
      return t('core:qortino_agent.progress.finalizing');
  }
}

export function qortinoInstallErrorText(
  error: QortinoInstallJobError | null,
  t: Translate
): string {
  if (!error) return '';
  if (error.code === 'low_storage') {
    return t('core:qortino_agent.gate.low_storage', {
      needed: formatBytes(error.neededBytes),
      free: formatBytes(error.freeBytes),
    });
  }
  return t(`core:qortino_agent.error.${error.code}`);
}

export function resetQortinoInstallJobStoreForTests(): void {
  openViews = 0;
  state = IDLE_QORTINO_INSTALL_JOB;
  listeners.clear();
}
