/**
 * Publishes PublishSteps in order through Hub's own publishOnQDN, one
 * transaction each, with no Q-App approval dialog (the window confirms the
 * whole batch and its fee first).
 *
 * - A step whose dependency failed or was skipped is skipped too, so no
 *   listing ever points at something that didn't go through.
 * - A network failure (or a node answer worth retrying) is tried twice more;
 *   if it still fails, that step fails and the independent steps go on.
 * - Anything else (the node refusing, a missing API key, an unknown error)
 *   stops the run: the next publish would most likely fail the same way, and
 *   every attempt can cost a fee.
 * - Before each step, `waitForSlot` may hold the run while the account has
 *   too many unconfirmed transactions (waitForPublishSlot).
 */
import { getBaseApi } from '../../background/background';
import { publishOnQDN } from '../../encryption/encryption';
import { videoToolErrorCode } from '../../../electron/src/video-tool-types';
import { needsApiKey, NodeAnswerError } from '../../qdn/publish/nodeAnswer';
import { isVideoPublishError, VideoPublishError } from './errors';
import type { PublishStep } from './types';

export type PublishStepStatus =
  | 'published'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type PublishStepOutcome = {
  key: string;
  status: PublishStepStatus;
  /** Set for failed, skipped and cancelled steps. */
  error?: VideoPublishError;
  /** What the node returned for the transaction (published steps). */
  result?: unknown;
};

export type PublishRequest = {
  data: unknown;
  service: string;
  identifier: string;
  name: string;
  title?: string;
  description?: string;
  tag1?: string;
  filename?: string;
  uploadType: 'base64' | 'file';
  onProgress: (done: number, total: number) => void;
  /** A cancel stops the upload between chunks, before anything is signed. */
  signal?: AbortSignal;
};

export type RunPublishOptions = {
  /** The registered name everything is published under. */
  name: string;
  signal?: AbortSignal;
  /** Keys already published in an earlier run (a retry): not sent again. */
  completed?: ReadonlySet<string>;
  onStepStart?: (step: PublishStep, index: number) => void;
  onProgress?: (stepKey: string, done: number, total: number) => void;
  onStepDone?: (outcome: PublishStepOutcome) => void;
  /** Resolves when the next publish may go; rejects (or false) to stop. */
  waitForSlot?: (step: PublishStep) => Promise<boolean | void>;
  /** Retries after a network failure (default 2). */
  retries?: number;
  /** Wait before a retry (default 10 s). */
  retryDelayMs?: number;
  /** Tests inject this; otherwise Hub's publishOnQDN. */
  publish?: (request: PublishRequest) => Promise<unknown>;
};

export type RunPublishResult = {
  /** Every step, in order. */
  outcomes: PublishStepOutcome[];
  /** Every step published (now or earlier). */
  ok: boolean;
  /** Why the run stopped early, when it did. */
  stoppedBy?: VideoPublishError;
};

const defaultPublish = (request: PublishRequest) =>
  publishOnQDN({
    data: request.data,
    service: request.service,
    identifier: request.identifier,
    name: request.name,
    title: request.title,
    description: request.description,
    tag1: request.tag1,
    filename: request.filename,
    uploadType: request.uploadType,
    onProgress: request.onProgress,
    signal: request.signal,
  });

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted ||
  (error instanceof DOMException && error.name === 'AbortError');

/**
 * Sorts a publish error: worth retrying (network), or one that stops the
 * run (refusal, missing API key, anything unknown).
 */
export function classifyPublishError(error: unknown): {
  retry: boolean;
  error: VideoPublishError;
} {
  if (isVideoPublishError(error)) {
    return { retry: error.code === 'network', error };
  }
  const detail = error instanceof Error ? error.message : String(error);
  // Electron main turned the request down: the node was never asked.
  if (videoToolErrorCode(detail)) {
    return {
      retry: false,
      error: new VideoPublishError('publish-failed', detail, { cause: error }),
    };
  }
  if (error instanceof NodeAnswerError) {
    if (error.retryable) {
      return {
        retry: true,
        error: new VideoPublishError('network', detail, { cause: error }),
      };
    }
    return {
      retry: false,
      error: new VideoPublishError(
        needsApiKey(error.status) ? 'needs-api-key' : 'refused',
        detail,
        { cause: error }
      ),
    };
  }
  // fetch() rejects with a TypeError when the node can't be reached;
  // publishData's chunk loop gives up with "Chunk N failed after …".
  if (error instanceof TypeError || /^Chunk \d+ failed after/.test(detail)) {
    return {
      retry: true,
      error: new VideoPublishError('network', detail, { cause: error }),
    };
  }
  return {
    retry: false,
    error: new VideoPublishError('publish-failed', detail, { cause: error }),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

const requestData = (step: PublishStep) =>
  'base64' in step.data
    ? { data: step.data.base64, uploadType: 'base64' as const }
    : { data: step.data.file, uploadType: 'file' as const };

export async function runPublishSteps(
  steps: readonly PublishStep[],
  options: RunPublishOptions
): Promise<RunPublishResult> {
  const {
    name,
    signal,
    completed,
    retries = 2,
    retryDelayMs = 10_000,
    publish = defaultPublish,
  } = options;
  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) throw new Error(`Duplicate step key ${step.key}`);
    keys.add(step.key);
  }

  const outcomes = new Map<string, PublishStepOutcome>();
  const settle = (outcome: PublishStepOutcome) => {
    outcomes.set(outcome.key, outcome);
    options.onStepDone?.(outcome);
  };
  let stoppedBy: VideoPublishError | undefined;

  for (const [index, step] of steps.entries()) {
    if (completed?.has(step.key)) {
      settle({ key: step.key, status: 'published' });
      continue;
    }
    if (stoppedBy) {
      settle({
        key: step.key,
        status: stoppedBy.code === 'cancelled' ? 'cancelled' : 'skipped',
        error:
          stoppedBy.code === 'cancelled'
            ? stoppedBy
            : new VideoPublishError('stopped'),
      });
      continue;
    }
    const blocked = (step.dependsOn || []).find(
      (key) => outcomes.get(key)?.status !== 'published' && !completed?.has(key)
    );
    if (blocked) {
      settle({
        key: step.key,
        status: 'skipped',
        error: new VideoPublishError('dependency-failed', blocked),
      });
      continue;
    }

    try {
      if (signal?.aborted) throw new VideoPublishError('cancelled');
      if (options.waitForSlot) {
        const go = await options.waitForSlot(step);
        if (signal?.aborted) throw new VideoPublishError('cancelled');
        if (go === false) throw new VideoPublishError('slot-timeout');
      }
    } catch (error) {
      stoppedBy = isVideoPublishError(error)
        ? error
        : new VideoPublishError('slot-timeout', String(error));
      settle({
        key: step.key,
        status: stoppedBy.code === 'cancelled' ? 'cancelled' : 'skipped',
        error: stoppedBy,
      });
      continue;
    }

    options.onStepStart?.(step, index);
    const { data, uploadType } = requestData(step);
    for (let attempt = 0; ; attempt += 1) {
      try {
        if (signal?.aborted) throw new VideoPublishError('cancelled');
        options.onProgress?.(step.key, 0, 1);
        const result = await publish({
          data,
          uploadType,
          service: step.service,
          identifier: step.identifier,
          name,
          title: step.title,
          description: step.description,
          tag1: step.tag1,
          filename: step.filename,
          onProgress: (done, total) =>
            options.onProgress?.(step.key, done, total),
          signal,
        });
        settle({ key: step.key, status: 'published', result });
        break;
      } catch (raw) {
        if (isAbort(raw, signal)) {
          stoppedBy = new VideoPublishError('cancelled');
          settle({ key: step.key, status: 'cancelled', error: stoppedBy });
          break;
        }
        const { retry, error } = classifyPublishError(raw);
        if (retry && attempt < retries) {
          await sleep(retryDelayMs, signal);
          continue;
        }
        settle({ key: step.key, status: 'failed', error });
        if (!retry) stoppedBy = error;
        break;
      }
    }
  }

  const ordered = steps.map((step) => outcomes.get(step.key));
  return {
    outcomes: ordered,
    ok: ordered.every((outcome) => outcome.status === 'published'),
    stoppedBy,
  };
}

// --- Fees, balance and the account's unconfirmed transactions --------------

async function nodeJson(path: string): Promise<unknown> {
  const base = await getBaseApi();
  const response = await fetch(`${base}${path}`);
  if (!response.ok)
    throw new NodeAnswerError(`HTTP ${response.status}`, response.status);
  return response.json();
}

/** The node's fee for one QDN publish, in QORT. */
export async function getPublishUnitFee(): Promise<number> {
  const fee = Number(
    await nodeJson(
      `/transactions/unitfee?txType=ARBITRARY&timestamp=${Date.now()}`
    )
  );
  if (!Number.isFinite(fee)) throw new VideoPublishError('network', 'unitfee');
  return fee / 1e8;
}

/** What `steps` cost together: one fee per resource. */
export async function estimatePublishFee(
  steps: number | readonly PublishStep[]
): Promise<{ unitFee: number; count: number; total: number }> {
  const count = typeof steps === 'number' ? steps : steps.length;
  const unitFee = await getPublishUnitFee();
  // Fees are whole 1e-8 units: add them up as integers.
  const total = Math.round(unitFee * 1e8) * count;
  return { unitFee, count, total: total / 1e8 };
}

/** Fees are whole 1e-8 units: added up and compared as integers. */
const feeUnits = (qort: unknown) => Math.round((Number(qort) || 0) * 1e8);

/** An unconfirmed transaction as the node lists it: the parts read here. */
type PendingTransaction = {
  type?: string;
  fee?: unknown;
  amount?: unknown;
  assetId?: unknown;
  payments?: { assetId?: unknown; amount?: unknown }[];
};

/** QORT's asset id. */
const QORT_ASSET_ID = 0;

/** The QORT a pending transaction takes from the account: its fee and what it pays. */
function pendingUnits(tx: PendingTransaction): number {
  const isQort = (assetId: unknown) => Number(assetId) === QORT_ASSET_ID;
  let units = feeUnits(tx?.fee);
  switch (tx?.type) {
    case 'PAYMENT':
    case 'BUY_NAME':
    case 'DEPLOY_AT':
      units += feeUnits(tx.amount);
      break;
    case 'TRANSFER_ASSET':
      if (isQort(tx.assetId)) units += feeUnits(tx.amount);
      break;
    case 'MULTI_PAYMENT':
      for (const payment of Array.isArray(tx.payments) ? tx.payments : []) {
        if (isQort(payment?.assetId)) units += feeUnits(payment?.amount);
      }
      break;
  }
  return units;
}

/**
 * The account's QORT balance and whether it covers `needed`. With the
 * account's public key, what its transactions not confirmed yet take (their
 * fees and the QORT they pay) comes off first: the node checks each new
 * transaction against the confirmed balance alone, so it takes them all,
 * and those the balance can't pay for never confirm. A node that can't list
 * them gives no answer (it throws), never "nothing pending".
 */
export async function checkPublishBalance(
  address: string,
  needed: number,
  publicKey?: string | null
): Promise<{ balance: number; enough: boolean }> {
  const balance = Number(
    await nodeJson(`/addresses/balance/${encodeURIComponent(address)}`)
  );
  if (!Number.isFinite(balance)) {
    throw new VideoPublishError('network', 'balance');
  }
  if (!publicKey) return { balance, enough: balance >= needed };
  const pending = await unconfirmedOf(publicKey);
  if (!pending) throw new VideoPublishError('network', 'unconfirmed');
  const pendingTotal = pending.reduce((sum, tx) => sum + pendingUnits(tx), 0);
  return {
    balance,
    enough: feeUnits(balance) - pendingTotal >= feeUnits(needed),
  };
}

/**
 * Transactions of this account the network hasn't confirmed yet (no chat),
 * or null when the node can't say. All of them: Core lists them oldest
 * first, and chat messages, unconfirmed for a day, would fill a page.
 */
async function unconfirmedOf(
  publicKey: string
): Promise<PendingTransaction[] | null> {
  try {
    const list = await nodeJson(
      `/transactions/unconfirmed?creator=${encodeURIComponent(publicKey)}`
    );
    return Array.isArray(list)
      ? list.filter((tx) => tx?.type !== 'CHAT')
      : null;
  } catch {
    return null;
  }
}

/** Transactions of this account the network hasn't confirmed yet (no chat). */
export async function countUnconfirmed(
  publicKey: string
): Promise<number | null> {
  return (await unconfirmedOf(publicKey))?.length ?? null;
}

/** Core's limit on one account's unconfirmed transactions, as Subscreen keeps it. */
export const MAX_UNCONFIRMED = 25;

/**
 * Subscreen's wait before a batch: while more than `25 − batch` of the
 * account's transactions are unconfirmed, check again every 10 s (30 s when
 * the page is hidden). True when it may go; false after `timeoutMs` or a
 * cancel. A node that can't answer doesn't hold the publish up.
 */
export async function waitForPublishSlot(
  publicKey: string,
  {
    batch = 1,
    signal,
    timeoutMs = 600_000,
    pollMs,
    onWait,
  }: {
    batch?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    pollMs?: number;
    onWait?: (unconfirmed: number) => void;
  } = {}
): Promise<boolean> {
  const allowed = MAX_UNCONFIRMED - Math.min(batch, MAX_UNCONFIRMED);
  const deadline = Date.now() + timeoutMs;
  while (!signal?.aborted && Date.now() < deadline) {
    const count = await countUnconfirmed(publicKey);
    if (signal?.aborted) return false;
    if (count === null || count <= allowed) return true;
    onWait?.(count);
    const wait =
      pollMs ??
      (typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 30_000
        : 10_000);
    await sleep(Math.min(wait, Math.max(0, deadline - Date.now())), signal);
  }
  return false;
}
