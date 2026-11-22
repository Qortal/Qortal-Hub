/**
 * Which model Qortino AI talks with.
 *
 * Qortino's own model (manifest.ts) comes from QDN, and so do the bigger
 * QDN_OTHER_MODELS Hub offers beside it. Hub downloads models from QDN only;
 * any other open model in GGUF format can be added as a file the user already
 * has on this computer. Qortino's persona and its curated Qortal answers stay
 * the same whichever model writes the rest.
 *
 * Kept in this computer's localStorage, read synchronously like settings.ts.
 */
import i18n from 'i18next';
import { useSyncExternalStore } from 'react';
import QortinoLlm from './qortinoLlm';
import type { DownloadProgress } from './download';
import {
  modelPartPath,
  modelTotalBytes,
  QDN_OTHER_MODELS,
  QORTINO_MODEL,
  type QortinoModelSpec,
} from './manifest';
import { isQortinoModelPathInUse, unloadQortinoModelNow } from './modelSession';
import type { QdnModelFailure, QdnModelRetry } from './qdnModelDownload';
import { executeEvent } from '../utils/events';

/** Id of Qortino's own model in the list. */
export const QORTINO_OWN_MODEL_ID = 'qortino';

/** Context window for models people add. */
export const OTHER_MODEL_CONTEXT_TOKENS = 4096;

export type OtherModelStatus = 'ready' | 'downloading' | 'failed';

export type OtherModel = {
  id: string;
  /** Shown in the list; the file name unless the user named it. */
  label: string;
  /**
   * `file`: picked on this computer and used where it is. `qdn`: one of the
   * QDN_OTHER_MODELS, downloaded by Hub. `link`: downloaded from a web link
   * by an earlier test build of Hub; kept so its file can still be used, or
   * deleted.
   */
  source: 'file' | 'qdn' | 'link';
  /** Absolute path of the GGUF (for a split model, its first part). */
  path: string;
  sizeBytes: number;
  addedAt: number;
  /** For `qdn`: which of the QDN_OTHER_MODELS it is. */
  qdnModelId?: string;
  /** For a model Hub downloaded: its (first) file, under Qortino's folder. */
  relativePath?: string;
  /** For `qdn`: every part, under Qortino's folder, first part first. */
  partPaths?: string[];
  status: OtherModelStatus;
  /** For `qdn`: why the last download gave up (none: it was stopped). */
  failure?: QdnModelFailure;
};

export type QortinoModelsState = {
  others: OtherModel[];
  activeId: string;
};

const STORAGE_KEY = 'qortino:models:v1';

const EMPTY: QortinoModelsState = {
  others: [],
  activeId: QORTINO_OWN_MODEL_ID,
};

function sanitize(raw: unknown): QortinoModelsState {
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const others = Array.isArray(value.others)
    ? (value.others as OtherModel[]).filter(
        (model) =>
          model &&
          typeof model.id === 'string' &&
          typeof model.path === 'string' &&
          typeof model.label === 'string' &&
          (model.source === 'file' ||
            model.source === 'link' ||
            (model.source === 'qdn' && typeof model.qdnModelId === 'string'))
      )
    : [];
  // A download Hub was closed in the middle of carries on from what it saved
  // only when asked: show it as stopped.
  const fixed = others.map((model) =>
    model.status === 'downloading'
      ? { ...model, status: 'failed' as const, failure: undefined }
      : model
  );
  const activeId =
    typeof value.activeId === 'string' &&
    (value.activeId === QORTINO_OWN_MODEL_ID ||
      fixed.some((model) => model.id === value.activeId))
      ? value.activeId
      : QORTINO_OWN_MODEL_ID;
  return { others: fixed, activeId };
}

let state: QortinoModelsState | null = null;
const listeners = new Set<() => void>();

function read(): QortinoModelsState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return sanitize(saved ? JSON.parse(saved) : null);
  } catch {
    return EMPTY;
  }
}

export function getQortinoModels(): QortinoModelsState {
  if (!state) state = read();
  return state;
}

function write(next: QortinoModelsState): void {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* kept until Hub closes */
  }
  for (const listener of listeners) listener();
}

export function subscribeQortinoModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useQortinoModels(): QortinoModelsState {
  return useSyncExternalStore(
    subscribeQortinoModels,
    getQortinoModels,
    getQortinoModels
  );
}

function patchModel(id: string, patch: Partial<OtherModel>): void {
  const current = getQortinoModels();
  write({
    ...current,
    others: current.others.map((model) =>
      model.id === id ? { ...model, ...patch } : model
    ),
  });
}

function newModelId(): string {
  return `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** A readable name from a GGUF file name. */
export function modelLabelFromFileName(name: string): string {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.gguf$/i, '')
    // Split models: name-00001-of-00003
    .replace(/-0*1-of-0*\d+$/i, '');
  const label = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return label || 'Model';
}

/** A split GGUF is loaded through its first part only. */
export function isLaterSplitPart(name: string): boolean {
  const match = /-(\d+)-of-(\d+)\.gguf$/i.exec(name);
  return Boolean(match && Number(match[1]) > 1);
}

/** Counts choices of the model in use, so a download ends without undoing one. */
let choices = 0;

export function setActiveQortinoModel(id: string): void {
  const current = getQortinoModels();
  if (
    id !== QORTINO_OWN_MODEL_ID &&
    !current.others.some((model) => model.id === id && model.status === 'ready')
  ) {
    return;
  }
  if (current.activeId === id) return;
  choices += 1;
  write({ ...current, activeId: id });
}

/** Add a GGUF that is already on this computer; it is used where it is. */
export function addFileModel(file: {
  path: string;
  name: string;
  size: number;
}): OtherModel {
  const current = getQortinoModels();
  const existing = current.others.find((model) => model.path === file.path);
  choices += 1;
  if (existing) {
    write({ ...current, activeId: existing.id });
    return existing;
  }
  const model: OtherModel = {
    id: newModelId(),
    label: modelLabelFromFileName(file.name),
    source: 'file',
    path: file.path,
    sizeBytes: file.size,
    addedAt: Date.now(),
    status: 'ready',
  };
  write({ others: [...current.others, model], activeId: model.id });
  return model;
}

export function renameOtherModel(id: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  patchModel(id, { label: trimmed.slice(0, 80) });
}

/* ------------------------------------------------- downloads from QDN */

/** Where a download of one of the QDN_OTHER_MODELS stands. */
export type OtherModelDownload = {
  progress: DownloadProgress | null;
  /** Waiting before the next try. */
  retry: QdnModelRetry | null;
};

type Job = {
  controller: AbortController;
  /** Settles once the download has stopped touching its files. */
  done: Promise<void>;
  /** Ends a wait before the next try at once. */
  wake?: () => void;
};

const jobs = new Map<string, Job>();
const downloads = new Map<string, OtherModelDownload>();
const downloadListeners = new Set<() => void>();
let downloadsSnapshot: Record<string, OtherModelDownload> = {};

function emitDownloads(): void {
  downloadsSnapshot = Object.fromEntries(downloads);
  for (const listener of downloadListeners) listener();
}

function setDownload(id: string, patch: Partial<OtherModelDownload>): void {
  downloads.set(id, {
    progress: null,
    retry: null,
    ...downloads.get(id),
    ...patch,
  });
  emitDownloads();
}

function subscribeDownloads(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => {
    downloadListeners.delete(listener);
  };
}

function getDownloads(): Record<string, OtherModelDownload> {
  return downloadsSnapshot;
}

export function useOtherModelDownloads(): Record<string, OtherModelDownload> {
  return useSyncExternalStore(subscribeDownloads, getDownloads, getDownloads);
}

/** The list entry of one of the QDN_OTHER_MODELS; there is at most one. */
export function qdnModelEntryId(model: QortinoModelSpec): string {
  return `qdn:${model.id}`;
}

function qdnModelSpec(id?: string): QortinoModelSpec | undefined {
  return QDN_OTHER_MODELS.find((model) => model.id === id);
}

/**
 * A model from QDN that this build offers, which the list shows in its own
 * row. One an earlier build offered is listed with the other models: it can
 * still be used when downloaded, and removed.
 */
export function isOfferedQdnModel(model: OtherModel): boolean {
  return model.source === 'qdn' && Boolean(qdnModelSpec(model.qdnModelId));
}

async function runQdnDownload(
  id: string,
  model: QortinoModelSpec,
  job: Job
): Promise<void> {
  const { signal } = job.controller;
  const choicesAtStart = choices;
  setDownload(id, { progress: null, retry: null });
  try {
    const { downloadQdnModelWithRetries } = await import('./qdnModelDownload');
    const { path } = await downloadQdnModelWithRetries(model, {
      signal,
      onProgress: (progress) => setDownload(id, { progress, retry: null }),
      onRetry: (retry) => setDownload(id, { retry }),
      onWait: (wake) => {
        job.wake = wake;
      },
    });
    patchModel(id, { path, status: 'ready', failure: undefined });
    // Nothing else chosen in the meantime: use the new model.
    if (
      getQortinoModels().activeId === QORTINO_OWN_MODEL_ID &&
      choices === choicesAtStart
    ) {
      setActiveQortinoModel(id);
    }
    executeEvent('openGlobalSnackBar', {
      type: 'success',
      message: String(
        i18n.t('core:qortino_agent.models.ready_notice', {
          name: model.label,
        })
      ),
      dismissible: true,
      duration: 9_000,
    });
  } catch (error) {
    if (signal.aborted) {
      // Stopped: the parts it saved stay, to carry on from.
      patchModel(id, { status: 'failed', failure: undefined });
      return;
    }
    const failure: QdnModelFailure =
      error && typeof error === 'object' && 'failure' in error
        ? (error as { failure: QdnModelFailure }).failure
        : {
            code: 'generic',
            detail: error instanceof Error ? error.message : String(error),
          };
    patchModel(id, { status: 'failed', failure });
  } finally {
    if (jobs.get(id) === job) jobs.delete(id);
    downloads.delete(id);
    emitDownloads();
  }
}

/**
 * Download one of the QDN_OTHER_MODELS into Qortino's folder, or carry on
 * with a download that stopped. Nothing happens if it is already going.
 * Resolves when the download ends, however it ends; it never rejects.
 */
export async function downloadQdnOtherModel(
  model: QortinoModelSpec
): Promise<void> {
  const id = qdnModelEntryId(model);
  if (jobs.has(id)) return;
  let settle!: () => void;
  const job: Job = {
    controller: new AbortController(),
    done: new Promise<void>((resolve) => {
      settle = resolve;
    }),
  };
  jobs.set(id, job);
  const current = getQortinoModels();
  const existing = current.others.find((item) => item.id === id);
  const partPaths = model.parts.map((part) => modelPartPath(model, part));
  const entry: OtherModel = {
    id,
    label: model.label,
    source: 'qdn',
    qdnModelId: model.id,
    // Known for sure once the download is done.
    path: existing?.path ?? '',
    relativePath: partPaths[0],
    // Parts an earlier build named otherwise are still deleted on Remove.
    partPaths: [...new Set([...partPaths, ...(existing?.partPaths ?? [])])],
    sizeBytes: modelTotalBytes(model),
    addedAt: existing?.addedAt ?? Date.now(),
    status: 'downloading',
  };
  write({
    ...current,
    others: existing
      ? current.others.map((item) => (item.id === id ? entry : item))
      : [...current.others, entry],
  });
  try {
    await runQdnDownload(id, model, job);
  } finally {
    settle();
  }
}

/** Carry on with a download that stopped, or end the wait before the next try. */
export async function retryOtherModelDownload(id: string): Promise<void> {
  const job = jobs.get(id);
  if (job) {
    job.wake?.();
    return;
  }
  const entry = getQortinoModels().others.find((item) => item.id === id);
  const model = entry?.source === 'qdn' ? qdnModelSpec(entry.qdnModelId) : null;
  if (model) await downloadQdnOtherModel(model);
}

/** Stop a download; the parts it saved stay, to carry on from or to remove. */
export function stopOtherModelDownload(id: string): void {
  jobs.get(id)?.controller.abort();
}

function forgetOtherModel(id: string): void {
  const current = getQortinoModels();
  write({
    others: current.others.filter((model) => model.id !== id),
    activeId: current.activeId === id ? QORTINO_OWN_MODEL_ID : current.activeId,
  });
}

/**
 * Take a model off the list. One Hub downloaded is deleted from disk (a
 * download still going is stopped first); a file the user picked stays where
 * it is. A model in use is unloaded first: the model process reads its
 * weights straight from the file (and Windows will not delete a file that is
 * open). If a file cannot be deleted, the model stays on the list and the
 * error is thrown.
 */
export async function removeOtherModel(id: string): Promise<void> {
  const model = getQortinoModels().others.find((item) => item.id === id);
  if (!model) return;
  const job = jobs.get(id);
  if (job) {
    job.controller.abort();
    await job.done;
  }
  // Loaded, still loading, or about to be loaded by the chat as the model
  // in use: let go of it before its file goes.
  if (
    isQortinoModelPathInUse(model.path) ||
    getQortinoModels().activeId === id
  ) {
    // An answer being written would keep the unload waiting until it ends.
    await QortinoLlm.cancel().catch(() => undefined);
    await unloadQortinoModelNow();
  }
  if (model.source !== 'file') {
    const files =
      model.partPaths ?? (model.relativePath ? [model.relativePath] : []);
    for (const relativePath of files) {
      await QortinoLlm.removeOtherModel({ relativePath });
    }
  }
  forgetOtherModel(id);
}

/* ------------------------------------------------- the model in use */

export type ActiveQortinoModel = {
  id: string;
  label: string;
  /** Null for Qortino's own model until it is downloaded. */
  path: string | null;
  contextTokens: number;
  isQortino: boolean;
};

/** The model the chat loads, given Qortino's own install path. */
export function resolveActiveQortinoModel(
  qortinoPath: string | null | undefined,
  models: QortinoModelsState = getQortinoModels()
): ActiveQortinoModel {
  const other = models.others.find(
    (model) => model.id === models.activeId && model.status === 'ready'
  );
  if (other) {
    return {
      id: other.id,
      label: other.label,
      path: other.path,
      contextTokens: OTHER_MODEL_CONTEXT_TOKENS,
      isQortino: false,
    };
  }
  return {
    id: QORTINO_OWN_MODEL_ID,
    label: QORTINO_MODEL.label,
    path: qortinoPath || null,
    contextTokens: QORTINO_MODEL.contextTokens,
    isQortino: true,
  };
}

/** Sampling for models other than Qortino's own (llama.cpp's usual defaults). */
export const OTHER_MODEL_SAMPLING = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.05,
  presencePenalty: 0,
};

export function resetQortinoModelsForTests(): void {
  state = null;
  choices = 0;
  listeners.clear();
  for (const job of jobs.values()) job.controller.abort();
  jobs.clear();
  downloads.clear();
  downloadListeners.clear();
  downloadsSnapshot = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing saved */
  }
}
