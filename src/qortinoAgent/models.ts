/**
 * Which model Qortino AI talks with.
 *
 * Qortino's own model (manifest.ts) comes from QDN. Besides it, people can
 * add any open model in GGUF format: a file already on this computer, or one
 * downloaded from a link (Hugging Face and the like). Qortino's persona and
 * its curated Qortal answers stay the same whichever model writes the rest.
 *
 * Kept in this computer's localStorage, read synchronously like settings.ts.
 */
import { useSyncExternalStore } from 'react';
import QortinoLlm from './qortinoLlm';
import { QORTINO_MODEL } from './manifest';
import { isQortinoModelPathInUse, unloadQortinoModelNow } from './modelSession';

/** Id of Qortino's own model in the list. */
export const QORTINO_OWN_MODEL_ID = 'qortino';

/** Context window for models people add. */
export const OTHER_MODEL_CONTEXT_TOKENS = 4096;

export type OtherModelStatus = 'ready' | 'downloading' | 'failed';

export type OtherModel = {
  id: string;
  /** Shown in the list; the file name unless the user named it. */
  label: string;
  /** `file`: picked on this computer; `link`: downloaded by Hub. */
  source: 'file' | 'link';
  /** Absolute path of the GGUF (for a split model, its first part). */
  path: string;
  sizeBytes: number;
  addedAt: number;
  /** For `link`: where it came from and where it is saved under Qortino's folder. */
  url?: string;
  relativePath?: string;
  status: OtherModelStatus;
  error?: string;
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
          (model.source === 'file' || model.source === 'link')
      )
    : [];
  // A download Hub was closed in the middle of carries on from its `.part`
  // only when asked: show it as stopped.
  const fixed = others.map((model) =>
    model.status === 'downloading'
      ? { ...model, status: 'failed' as const, error: undefined }
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

export function setActiveQortinoModel(id: string): void {
  const current = getQortinoModels();
  if (
    id !== QORTINO_OWN_MODEL_ID &&
    !current.others.some((model) => model.id === id && model.status === 'ready')
  ) {
    return;
  }
  if (current.activeId === id) return;
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

/* ------------------------------------------------- downloads by link */

export type OtherModelDownload = {
  bytesReceived: number;
  bytesTotal: number;
};

const downloads = new Map<string, OtherModelDownload>();
const downloadListeners = new Set<() => void>();
let downloadsSnapshot: Record<string, OtherModelDownload> = {};

function emitDownloads(): void {
  downloadsSnapshot = Object.fromEntries(downloads);
  for (const listener of downloadListeners) listener();
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

export function isOtherModelLink(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function runDownload(model: OtherModel): Promise<void> {
  if (!model.url || !model.relativePath) return;
  const relativePath = model.relativePath;
  downloads.set(model.id, { bytesReceived: 0, bytesTotal: model.sizeBytes });
  emitDownloads();
  const handle = await QortinoLlm.addListener('downloadProgress', (event) => {
    if (event.relativePath !== relativePath || event.done) return;
    downloads.set(model.id, {
      bytesReceived: event.bytesReceived,
      bytesTotal: event.bytesTotal,
    });
    emitDownloads();
  });
  try {
    const result = await QortinoLlm.downloadUrl({
      url: model.url,
      relativePath,
    });
    patchModel(model.id, {
      path: result.path,
      sizeBytes: result.bytesWritten,
      status: 'ready',
      error: undefined,
    });
    // Nothing else chosen in the meantime: use the new model.
    const current = getQortinoModels();
    if (current.activeId === QORTINO_OWN_MODEL_ID) {
      setActiveQortinoModel(model.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'cancelled') {
      forgetOtherModel(model.id);
    } else {
      patchModel(model.id, { status: 'failed', error: message });
    }
  } finally {
    await handle.remove();
    downloads.delete(model.id);
    emitDownloads();
  }
}

/** Download a GGUF from `url` into Qortino's folder and add it to the list. */
export async function addLinkModel(input: {
  url: string;
  label?: string;
}): Promise<OtherModel> {
  const url = input.url.trim();
  if (!isOtherModelLink(url)) throw new Error('invalid_link');
  const { relativePath, filename } = await QortinoLlm.otherModelPath({ url });
  // The same file again (the same link, or with ?download=true): no second
  // copy, and no second download over the first.
  const current = getQortinoModels();
  const existing = current.others.find(
    (model) => model.url === url || model.relativePath === relativePath
  );
  if (existing) {
    if (existing.status === 'failed') void retryOtherModelDownload(existing.id);
    return existing;
  }
  const { rootDir } = await QortinoLlm.getStoragePaths();
  const latest = getQortinoModels();
  const raced = latest.others.find(
    (item) => item.url === url || item.relativePath === relativePath
  );
  if (raced) return raced;
  const model: OtherModel = {
    id: newModelId(),
    label: input.label?.trim() || modelLabelFromFileName(filename),
    source: 'link',
    path: `${rootDir.replace(/[\\/]$/, '')}/${relativePath}`,
    sizeBytes: 0,
    addedAt: Date.now(),
    url,
    relativePath,
    status: 'downloading',
  };
  // Written from the list as it is now: it may have changed while waiting.
  write({ ...latest, others: [...latest.others, model] });
  void runDownload(model);
  return model;
}

/** Carry on with a download that failed or that Hub was closed during. */
export async function retryOtherModelDownload(id: string): Promise<void> {
  const model = getQortinoModels().others.find((item) => item.id === id);
  if (!model || model.source !== 'link' || downloads.has(id)) return;
  patchModel(id, { status: 'downloading', error: undefined });
  await runDownload({ ...model, status: 'downloading' });
}

export async function cancelOtherModelDownload(id: string): Promise<void> {
  const model = getQortinoModels().others.find((item) => item.id === id);
  if (!model?.relativePath) return;
  if (downloads.has(id)) {
    await QortinoLlm.cancelDownload({ relativePath: model.relativePath });
    return;
  }
  await removeOtherModel(id);
}

function forgetOtherModel(id: string): void {
  const current = getQortinoModels();
  write({
    others: current.others.filter((model) => model.id !== id),
    activeId: current.activeId === id ? QORTINO_OWN_MODEL_ID : current.activeId,
  });
}

/**
 * Take a model off the list. One Hub downloaded is deleted from disk; a file
 * the user picked stays where it is. A model in use is unloaded first: the
 * model process reads its weights straight from the file (and Windows will
 * not delete a file that is open). If the file cannot be deleted, the model
 * stays on the list and the error is thrown.
 */
export async function removeOtherModel(id: string): Promise<void> {
  const model = getQortinoModels().others.find((item) => item.id === id);
  if (!model) return;
  if (downloads.has(id) && model.relativePath) {
    await QortinoLlm.cancelDownload({ relativePath: model.relativePath });
  }
  // Loaded, still loading, or about to be loaded by the chat as the model
  // in use: let go of it before its file goes.
  if (
    isQortinoModelPathInUse(model.path) ||
    getQortinoModels().activeId === id
  ) {
    await unloadQortinoModelNow();
  }
  if (model.source === 'link' && model.relativePath) {
    await QortinoLlm.removeOtherModel({ relativePath: model.relativePath });
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

/**
 * Open models people often run on a PC, with a direct GGUF link. Offered in
 * the add dialog to fill the link in; nothing is downloaded unless asked.
 */
export type SuggestedModel = {
  id: string;
  label: string;
  url: string;
  sizeBytes: number;
  license: string;
};

export const SUGGESTED_OTHER_MODELS: SuggestedModel[] = [
  {
    id: 'phi-4-mini',
    label: 'Phi-4 mini Instruct',
    url: 'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    sizeBytes: 2_491_874_688,
    license: 'MIT',
  },
  {
    id: 'llama-3.2-3b',
    label: 'Llama 3.2 3B Instruct',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 2_019_377_696,
    license: 'Llama 3.2 Community',
  },
  {
    id: 'mistral-7b',
    label: 'Mistral 7B Instruct v0.3',
    url: 'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    sizeBytes: 4_372_812_000,
    license: 'Apache-2.0',
  },
  {
    id: 'qwen2.5-7b',
    label: 'Qwen2.5 7B Instruct',
    url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4_683_074_240,
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3-30b-a3b',
    label: 'Qwen3 30B A3B Instruct 2507',
    url: 'https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/resolve/main/Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf',
    sizeBytes: 18_556_686_752,
    license: 'Apache-2.0',
  },
];

export function resetQortinoModelsForTests(): void {
  state = null;
  listeners.clear();
  downloads.clear();
  downloadListeners.clear();
  downloadsSnapshot = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing saved */
  }
}
