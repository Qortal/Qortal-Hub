/**
 * Qortino AI's model on this computer, run by the desktop app's main process
 * (electron/src/qortino-llm.ts) through `window.qortinoLlm`. The browser
 * build has no such bridge: there Qortino AI is simply not offered.
 *
 * Same shape as GO's QortinoLlm Capacitor plugin, so the chat, download and
 * model-session code is shared with GO almost unchanged.
 */

export type QortinoDeviceTier = {
  totalRamBytes: number;
  availRamBytes: number;
  /** Free space on the disk the model is saved to. */
  availStorageBytes: number;
  totalStorageBytes: number;
  lowMemory: boolean;
  cpuThreads?: number;
  /** What the last model ran on: 'vulkan', 'metal', 'cuda', or false (processor). */
  gpu?: string | false | null;
};

export type QortinoStoragePaths = {
  rootDir: string;
  modelsDir: string;
  knowledgeDir: string;
  /** Models added by a download link. */
  otherModelsDir?: string;
};

export type QortinoChatMessage = {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
};

/** Sampler settings; the model process defaults to Qwen3 Instruct's own. */
export type QortinoSamplingOptions = {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
};

export type QortinoCompleteOptions = QortinoSamplingOptions & {
  system?: string;
  messages: QortinoChatMessage[];
  contextChunks?: Array<string | { text: string }>;
  maxTokens?: number;
};

export type QortinoTokenEvent = {
  token: string;
  done: boolean;
  error?: string;
};

export type QortinoProgressEvent = {
  /** load | warmup | prefill | thinking | generate */
  stage: string;
  detail: string;
  percent: number;
};

export type QortinoDownloadProgressEvent = {
  relativePath?: string;
  bytesReceived: number;
  bytesTotal: number;
  done: boolean;
  error?: string;
};

export type QortinoVerifyProgressEvent = {
  relativePath?: string;
  bytesRead: number;
  bytesTotal: number;
};

export type QortinoListenerHandle = { remove: () => Promise<void> };

type QortinoEvents = {
  token: QortinoTokenEvent;
  progress: QortinoProgressEvent;
  downloadProgress: QortinoDownloadProgressEvent;
  verifyProgress: QortinoVerifyProgressEvent;
};

export type QortinoLoadResult = {
  loaded: boolean;
  path: string;
  loadMs?: number;
  gpu?: string | false;
  gpuLayers?: number;
};

/** What the preload exposes (electron/src/preload.ts, `qortinoLlm`). */
export type QortinoLlmBridge = {
  getDeviceTier(): Promise<QortinoDeviceTier>;
  getStoragePaths(): Promise<QortinoStoragePaths>;
  /** A file under Qortino's folder (main refuses anything else). */
  fileExists(options: {
    relativePath: string;
  }): Promise<{ exists: boolean; path: string; size: number }>;
  sha256File(options: {
    relativePath: string;
  }): Promise<{ sha256: string; size: number }>;
  cleanupStorage(options: {
    keep: string[];
  }): Promise<{ deletedFiles: number; freedBytes: number }>;
  downloadUrl(options: {
    apiKey?: string;
    url: string;
    relativePath: string;
  }): Promise<{ path: string; bytesWritten: number }>;
  cancelDownload(options?: { relativePath?: string }): Promise<void>;
  otherModelPath(options: {
    url: string;
  }): Promise<{ relativePath: string; filename: string }>;
  removeOtherModel(options: {
    relativePath: string;
  }): Promise<{ freedBytes: number }>;
  pickModelFile(options: {
    title?: string;
    filterName?: string;
  }): Promise<{ path: string; size: number; name: string } | null>;
  loadModel(options: {
    path: string;
    nCtx?: number;
    gpu?: boolean;
  }): Promise<QortinoLoadResult>;
  warmup(options: {
    system: string;
  }): Promise<{ ok?: boolean; warmMs?: number }>;
  unload(): Promise<void>;
  cancel(): Promise<void>;
  complete(
    options: QortinoCompleteOptions
  ): Promise<{ ok: boolean; text?: string }>;
  info(): Promise<{
    loadedPath?: string | null;
    gpu?: string | false | null;
    gpuLayers?: number;
  }>;
  on(eventName: string, listener: (payload: unknown) => void): () => void;
};

declare global {
  interface Window {
    qortinoLlm?: QortinoLlmBridge;
  }
}

/**
 * Electron rewrites an error thrown by an IPC handler as "Error invoking
 * remote method 'qortino:complete': Error: cancelled". The chat and the
 * downloads compare the message itself ('cancelled', 'Model is not loaded'),
 * as GO's plugin gave it.
 */
export function unwrapIpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const inner = message.replace(
    /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/,
    ''
  );
  return new Error(inner || message);
}

function unwrapped<T extends (...args: never[]) => Promise<unknown>>(
  call: T
): T {
  return ((...args: Parameters<T>) =>
    call(...args).catch((error: unknown) => {
      throw unwrapIpcError(error);
    })) as T;
}

/** The preload's bridge, with IPC errors carrying their own message. */
function wrapBridge(raw: QortinoLlmBridge): QortinoLlmBridge {
  const wrapped = { ...raw } as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'on' && typeof value === 'function') {
      wrapped[key] = unwrapped(
        (value as (...args: never[]) => Promise<unknown>).bind(raw)
      );
    }
  }
  return wrapped as QortinoLlmBridge;
}

let wrappedFor: QortinoLlmBridge | null = null;
let wrappedBridge: QortinoLlmBridge | null = null;

function bridge(): QortinoLlmBridge | null {
  if (typeof window === 'undefined') return null;
  const raw = window.qortinoLlm ?? null;
  if (!raw) return null;
  if (wrappedFor !== raw) {
    wrappedFor = raw;
    wrappedBridge = wrapBridge(raw);
  }
  return wrappedBridge;
}

function requireBridge(): QortinoLlmBridge {
  const found = bridge();
  if (!found) throw new Error('Qortino AI needs the Qortal Hub desktop app');
  return found;
}

/** The desktop app, with a model process Qortino AI can use. */
export function isQortinoLlmNativeAvailable(): boolean {
  return bridge() !== null;
}

/** Same as isQortinoLlmNativeAvailable; GO's name for it. */
export function isQortinoLlmInferenceAvailable(): boolean {
  return isQortinoLlmNativeAvailable();
}

const FALLBACK_TIER: QortinoDeviceTier = {
  totalRamBytes: 8 * 1024 ** 3,
  availRamBytes: 4 * 1024 ** 3,
  availStorageBytes: 20 * 1024 ** 3,
  totalStorageBytes: 64 * 1024 ** 3,
  lowMemory: false,
};

const QortinoLlm = {
  async getDeviceTier(): Promise<QortinoDeviceTier> {
    const found = bridge();
    return found ? found.getDeviceTier() : FALLBACK_TIER;
  },
  async getStoragePaths() {
    return requireBridge().getStoragePaths();
  },
  async fileExists(options: { relativePath: string }) {
    const found = bridge();
    if (!found) return { exists: false, path: '', size: 0 };
    return found.fileExists(options);
  },
  async sha256File(options: { relativePath: string }) {
    return requireBridge().sha256File(options);
  },
  async cleanupStorage(options: { keep: string[] }) {
    const found = bridge();
    if (!found) return { deletedFiles: 0, freedBytes: 0 };
    return found.cleanupStorage(options);
  },
  async downloadUrl(options: {
    apiKey?: string;
    url: string;
    relativePath: string;
  }) {
    return requireBridge().downloadUrl(options);
  },
  async cancelDownload(options?: { relativePath?: string }) {
    await bridge()?.cancelDownload(options ?? {});
  },
  async otherModelPath(options: { url: string }) {
    return requireBridge().otherModelPath(options);
  },
  async removeOtherModel(options: { relativePath: string }) {
    return requireBridge().removeOtherModel(options);
  },
  async pickModelFile(options: { title?: string; filterName?: string }) {
    return requireBridge().pickModelFile(options);
  },
  async loadModel(options: { path: string; nCtx?: number; gpu?: boolean }) {
    return requireBridge().loadModel(options);
  },
  async warmup(options: { system: string }) {
    const found = bridge();
    return found ? found.warmup(options) : {};
  },
  async unload() {
    await bridge()?.unload();
  },
  async cancel() {
    await bridge()?.cancel();
  },
  async complete(options: QortinoCompleteOptions) {
    return requireBridge().complete(options);
  },
  async info() {
    const found = bridge();
    return found ? found.info() : {};
  },
  async addListener<E extends keyof QortinoEvents>(
    eventName: E,
    listener: (event: QortinoEvents[E]) => void
  ): Promise<QortinoListenerHandle> {
    const found = bridge();
    if (!found) return { remove: async () => undefined };
    const off = found.on(eventName, (payload) =>
      listener(payload as QortinoEvents[E])
    );
    return {
      remove: async () => {
        off();
      },
    };
  },
};

export default QortinoLlm;
