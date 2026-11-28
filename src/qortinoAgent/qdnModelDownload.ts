/**
 * Downloading one of the QDN_OTHER_MODELS with the same patience as
 * Qortino's own model (installJob.ts): when peers stop sending, it waits and
 * tries again (the node keeps every chunk it already has, and the parts saved
 * on this computer stay), and it gives up only after many tries that got no
 * further. Before each try the free space is checked against what is left
 * to download. models.ts keeps where it stands.
 *
 * These models download through the user's own node only: their parts are
 * bigger than the public node carries (it cuts transfers near 1 GiB), and
 * unlike Qortino's own model they have no layout in smaller parts.
 */
import { getDefaultStore } from 'jotai';
import { isRunningPublicNodeAtom } from '../atoms/global';
import { checkDeviceForModel, readDeviceTier } from './deviceTier';
import {
  downloadQdnModel,
  QortinoInstallError,
  savedModelBytes,
  type DownloadProgress,
} from './download';
import {
  isRetryable,
  jobError,
  MAX_CHECKSUM_RETRIES,
  MAX_TRIES_WITHOUT_PROGRESS,
  progressScore,
  RETRY_DELAYS_MS,
} from './installJob';
import type { QortinoInstallJobError } from './installJobStore';
import type { QortinoModelSpec } from './manifest';

/** Waiting before the next try, and why. */
export type QdnModelRetry = {
  error: QortinoInstallJobError;
  retryAt: number;
};

/** Why a download gave up: as Qortino's own, or Hub is on the public node. */
export type QdnModelFailure = QortinoInstallJobError | { code: 'public_node' };

/** The download gave up; `failure` says why. */
export class QdnModelDownloadError extends Error {
  readonly failure: QdnModelFailure;

  constructor(failure: QdnModelFailure) {
    super(failure.code);
    this.name = 'QdnModelDownloadError';
    this.failure = failure;
  }
}

function wait(
  ms: number,
  signal: AbortSignal,
  onWait?: (wake: () => void) => void
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    onWait?.(done);
  });
}

export async function downloadQdnModelWithRetries(
  model: QortinoModelSpec,
  options: {
    signal: AbortSignal;
    onProgress: (progress: DownloadProgress) => void;
    /** A wait before the next try begins (null: a try begins). */
    onRetry: (retry: QdnModelRetry | null) => void;
    /** Hands over what ends the wait at once ("Try now"). */
    onWait?: (wake: () => void) => void;
  }
): Promise<{ path: string }> {
  const { signal } = options;
  let best = -1;
  let triesWithoutProgress = 0;
  // Damaged copies of each part: one part that keeps arriving damaged ends
  // the download, not a few parts that were each damaged once.
  const damaged = new Map<string, number>();
  // Parts checked in an earlier try are not read and hashed again.
  const verified = new Set<string>();
  for (;;) {
    if (signal.aborted) throw new QortinoInstallError('cancelled');
    options.onRetry(null);
    // Also when Hub switched to the public node during the download.
    if (getDefaultStore().get(isRunningPublicNodeAtom)) {
      throw new QdnModelDownloadError({ code: 'public_node' });
    }
    const check = checkDeviceForModel(
      await readDeviceTier(),
      await savedModelBytes(model),
      model
    );
    if (!check.enoughStorage) {
      throw new QdnModelDownloadError({
        code: 'low_storage',
        neededBytes: check.neededBytes,
        freeBytes: check.tier.availStorageBytes,
      });
    }
    let reached = -1;
    try {
      return await downloadQdnModel(model, {
        signal,
        verified,
        onProgress: (progress) => {
          reached = Math.max(reached, progressScore(progress));
          options.onProgress(progress);
        },
      });
    } catch (e) {
      if (
        signal.aborted ||
        (e instanceof QortinoInstallError && e.code === 'cancelled')
      ) {
        throw new QortinoInstallError('cancelled');
      }
      const error = jobError(e);
      const damagedPart =
        error.code === 'checksum' ? (error.detail ?? '') : null;
      if (damagedPart !== null) {
        damaged.set(damagedPart, (damaged.get(damagedPart) ?? 0) + 1);
      }
      if (reached > best) {
        best = reached;
        triesWithoutProgress = 0;
      } else {
        triesWithoutProgress += 1;
      }
      if (
        !isRetryable(error) ||
        (damagedPart !== null &&
          (damaged.get(damagedPart) ?? 0) > MAX_CHECKSUM_RETRIES) ||
        triesWithoutProgress >= MAX_TRIES_WITHOUT_PROGRESS
      ) {
        throw new QdnModelDownloadError(error);
      }
      const delay =
        RETRY_DELAYS_MS[
          Math.min(triesWithoutProgress, RETRY_DELAYS_MS.length - 1)
        ];
      options.onRetry({ error, retryAt: Date.now() + delay });
      await wait(delay, signal, options.onWait);
    }
  }
}
