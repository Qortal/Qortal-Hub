/**
 * Keeps the Qortino model loaded across opens of its panel.
 *
 * Loading reads ~2.5 GB of weights, and the system prompt has to be read
 * once more before the first answer. Both are done once per load: closing the
 * panel only schedules an unload (see Qortino's "Keep ready" setting), so
 * opening it again soon after is instant, and the system prompt is read in
 * the background while the user is still typing.
 */
import QortinoLlm from './qortinoLlm';
import { getQortinoSettings } from './settings';

export type QortinoModelLoad = {
  path: string;
  nCtx: number;
  /** False: run on the processor only (settings → Use the graphics card). */
  gpu?: boolean;
};

/** After the panel closes. */
export const RELEASE_AFTER_CLOSE_MS = 90_000;
/** After the panel closes, set to free the memory right away: a stopped reply winds down first. */
export const RELEASE_RIGHT_AWAY_MS = 2_000;

let loadedKey: string | null = null;
let loading: { key: string; promise: Promise<void> } | null = null;
let warmedSystem: string | null = null;
let warming: { system: string; promise: Promise<void> } | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let busy = 0;
/** Bumped by every unload, so a load that finishes after one is not recorded as loaded. */
let generation = 0;
/** Completed loads; a new load starts with an empty KV cache. */
let loadCount = 0;

function keyOf(load: QortinoModelLoad): string {
  return `${load.path}|${load.nCtx}|${load.gpu === false ? 'cpu' : 'gpu'}`;
}

export function isQortinoModelLoaded(load: QortinoModelLoad): boolean {
  return loadedKey === keyOf(load);
}

/**
 * Which chat the KV cache holds the conversation of, and where that chat's
 * prompt history starts. Kept here rather than in the chat component, so
 * closing and reopening the sheet does not look like a fresh cache.
 */
type KvOwner = { sessionId: string; loads: number; historyStart: number };
let kvOwner: KvOwner | null = null;

/** History start for `sessionId` if the KV cache holds its conversation, else null. */
export function qortinoKvHistoryStart(sessionId: string): number | null {
  if (
    !kvOwner ||
    kvOwner.sessionId !== sessionId ||
    kvOwner.loads !== loadCount
  ) {
    return null;
  }
  return kvOwner.historyStart;
}

/** Record that the KV cache now holds `sessionId`'s conversation. */
export function setQortinoKvOwner(
  sessionId: string,
  historyStart: number
): void {
  kvOwner = { sessionId, loads: loadCount, historyStart };
}

function clearReleaseTimer(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

/** Load the model unless it is already loaded (or loading) with these settings. */
export async function ensureQortinoModel(
  load: QortinoModelLoad
): Promise<void> {
  clearReleaseTimer();
  const key = keyOf(load);
  if (loadedKey === key) return;
  if (loading?.key === key) return loading.promise;

  // Another model is still loading: this one replaces it, so that load must
  // not be recorded when it finishes.
  if (loading && loading.key !== key) generation += 1;
  const startedAt = generation;
  // The model process lets go of the current model before it loads another,
  // so until this load succeeds no model is loaded (a failed switch must not
  // leave the old one looking ready).
  const hadModel = loadedKey !== null || loading !== null;
  if (loadedKey !== null) {
    loadedKey = null;
    kvOwner = null;
  }
  const promise = (async () => {
    // The model process swaps models (or context sizes) in one load.
    warmedSystem = null;
    warming = null;
    try {
      await QortinoLlm.loadModel({
        path: load.path,
        nCtx: load.nCtx,
        ...(load.gpu === false ? { gpu: false } : {}),
      });
    } catch (error) {
      // Refused before the model process saw it (a missing file, say), the
      // old model may still be in memory with nothing here holding it.
      if (hadModel && generation === startedAt) {
        void QortinoLlm.unload().catch(() => undefined);
      }
      throw error;
    }
    if (generation === startedAt) {
      loadedKey = key;
      loadCount += 1;
    }
  })();
  loading = { key, promise };
  try {
    await promise;
  } finally {
    if (loading?.promise === promise) loading = null;
  }
}

/**
 * Read the system prompt into the KV cache now. Fire and forget: a question
 * sent meanwhile simply waits for it natively and reuses the result.
 */
export function warmQortinoSystemPrompt(system: string): Promise<void> {
  if (!loadedKey || !system) return Promise.resolve();
  if (warmedSystem === system) return Promise.resolve();
  if (warming?.system === system) return warming.promise;
  // Another system prompt (the answer length changed): the KV cache keeps
  // only the new prompt, so no chat's conversation is in it any more. Also
  // once read, for a reply that was still running when it was asked for.
  const replacing = warmedSystem !== null || warming !== null;
  if (replacing) kvOwner = null;
  const promise = QortinoLlm.warmup({ system })
    .then(() => {
      if (warming?.promise === promise) warmedSystem = system;
    })
    .catch(() => undefined)
    .finally(() => {
      if (replacing) kvOwner = null;
      if (warming?.promise === promise) warming = null;
    });
  warming = { system, promise };
  return promise;
}

/** Mark a reply in progress, so a scheduled release waits for it to finish. */
export function markQortinoBusy(isBusy: boolean): void {
  busy = Math.max(0, busy + (isBusy ? 1 : -1));
}

export async function unloadQortinoModelNow(): Promise<void> {
  clearReleaseTimer();
  generation += 1;
  // A load still running is undone by this unload: a later ensure starts a
  // new one rather than joining it.
  loading = null;
  loadedKey = null;
  warmedSystem = null;
  warming = null;
  await QortinoLlm.unload().catch(() => undefined);
}

/**
 * The native side says no model is loaded although this session thought one
 * was: forget it, so the next ensureQortinoModel loads again.
 */
export function forgetQortinoModel(): void {
  clearReleaseTimer();
  generation += 1;
  loading = null;
  loadedKey = null;
  warmedSystem = null;
  warming = null;
  kvOwner = null;
}

/** Unload after `delayMs` unless the model is used again first. */
export function releaseQortinoModelSoon(
  delayMs = RELEASE_AFTER_CLOSE_MS
): void {
  if (!loadedKey && !loading) return;
  clearReleaseTimer();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (busy > 0) {
      // Still writing an answer: look again once it had time to finish.
      releaseQortinoModelSoon(delayMs);
      return;
    }
    void unloadQortinoModelNow();
  }, delayMs);
}

/**
 * The Qortino panel closed: keep the model as long as Qortino's settings
 * say.
 */
export function releaseQortinoModelAfterClose(): void {
  const { keepReady } = getQortinoSettings();
  if (keepReady === 'open') return;
  releaseQortinoModelSoon(
    keepReady === 'off' ? RELEASE_RIGHT_AWAY_MS : RELEASE_AFTER_CLOSE_MS
  );
}

/** The model path in a session key ("path|nCtx|gpu"). */
function pathOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf('|', key.lastIndexOf('|') - 1));
}

/** The model being loaded, or loaded: its file is in use. */
export function isQortinoModelPathInUse(modelPath: string): boolean {
  return (
    (loadedKey !== null && pathOfKey(loadedKey) === modelPath) ||
    (loading !== null && pathOfKey(loading.key) === modelPath)
  );
}

/** Path of the model loaded now, if any. */
export function loadedQortinoModelPath(): string | null {
  return loadedKey
    ? loadedKey.slice(
        0,
        loadedKey.lastIndexOf('|', loadedKey.lastIndexOf('|') - 1)
      )
    : null;
}

/** Test hook. */
export function resetQortinoModelSessionForTests(): void {
  clearReleaseTimer();
  loadedKey = null;
  loading = null;
  warmedSystem = null;
  warming = null;
  busy = 0;
  generation = 0;
  loadCount = 0;
  kvOwner = null;
}
