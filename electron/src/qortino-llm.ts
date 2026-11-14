/**
 * Qortino AI in the desktop Hub: the main process side.
 *
 * - Files: the model parts from QDN and other models live in
 *   `<userData>/Qortino AI` (qortino-llm-files.ts).
 * - The model runs in a utility process of its own (qortino-llm-worker.ts),
 *   started on the first load, so a model that crashes llama.cpp does not
 *   take Hub down with it.
 * - Only the Hub window may call these (requireMainWindowSender); Q-Apps
 *   never see them.
 */
import { app, dialog, ipcMain, utilityProcess } from 'electron';
import type { IpcMainInvokeEvent, UtilityProcess } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { myCapacitorApp } from '.';
import { requireMainWindowSender } from './main-window-policy';
import { sessionHop } from './qortino-llm-net';
import {
  QORTINO_RENDERER_EVENT_CHANNEL,
  type QortinoRendererEventName,
  type QortinoWorkerOp,
  type QortinoWorkerReply,
} from './qortino-llm-protocol';
import {
  availableMemoryBytes,
  cleanupStorage,
  diskSpace,
  DownloadCancelledError,
  downloadToFile,
  fileSize,
  isDownloadTarget,
  isLoadableModelPath,
  OTHER_MODELS_DIR,
  otherModelRelativePath,
  QORTINO_ROOT_NAME,
  readPickedModels,
  rememberPickedModel,
  resolveInsideRoot,
  sha256File,
  toPosix,
} from './qortino-llm-files';

function qortinoRoot(): string {
  return path.join(app.getPath('userData'), QORTINO_ROOT_NAME);
}

let pickedModels: Set<string> | null = null;

/** The picked-files list lives next to Qortino's folder, in Hub's user data. */
function pickedListDir(): string {
  return app.getPath('userData');
}

function picked(): Set<string> {
  pickedModels ??= readPickedModels(pickedListDir());
  return pickedModels;
}

function mainContents() {
  return myCapacitorApp?.getMainWindow?.()?.webContents;
}

function requireHub(event: IpcMainInvokeEvent): void {
  requireMainWindowSender(
    event,
    mainContents(),
    `${myCapacitorApp?.getCustomURLScheme?.()}://-`
  );
}

function sendToHub(event: QortinoRendererEventName, payload: unknown): void {
  const contents = mainContents();
  if (!contents || contents.isDestroyed()) return;
  contents.send(QORTINO_RENDERER_EVENT_CHANNEL, { event, payload });
}

/* ---------------------------------------------------------------- worker */

type Pending = {
  op: QortinoWorkerOp;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  /** The model a load is for (to remember one that crashed on the graphics card). */
  modelPath?: string;
  gpu?: boolean;
};

let worker: UtilityProcess | null = null;
let nextId = 0;
/** Calls waiting for a reply, per model process. */
const pendingByWorker = new Map<UtilityProcess, Map<string, Pending>>();
/** Models that took the model process down while loading on the graphics card. */
const cpuOnlyModels = new Set<string>();
let lastGpu: string | false | null = null;

function pendingFor(child: UtilityProcess): Map<string, Pending> {
  let entries = pendingByWorker.get(child);
  if (!entries) {
    entries = new Map();
    pendingByWorker.set(child, entries);
  }
  return entries;
}

function startWorker(): UtilityProcess {
  if (worker) return worker;
  const child = utilityProcess.fork(
    path.join(__dirname, 'qortino-llm-worker.js'),
    [],
    { serviceName: 'Qortino AI', stdio: 'inherit' }
  );
  const entries = pendingFor(child);
  child.on('message', (message: QortinoWorkerReply) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'reply') {
      const entry = entries.get(message.id);
      if (!entry) return;
      entries.delete(message.id);
      if (message.ok) entry.resolve(message.result ?? {});
      else entry.reject(new Error(message.error || 'Qortino failed'));
      return;
    }
    if (worker === child) sendToHub(message.event, message.payload);
  });
  child.on('exit', (code) => {
    if (worker === child) worker = null;
    pendingByWorker.delete(child);
    const interrupted = entries.size > 0;
    // Calls run one after another: the first one still waiting (a cancel
    // answers at once) is the one the process died in.
    const running = [...entries.values()].find(
      (entry) => entry.op !== 'cancel'
    );
    if (
      running?.op === 'load' &&
      running.gpu !== false &&
      running.modelPath &&
      code !== 0
    ) {
      // Next time this model runs on the processor.
      cpuOnlyModels.add(running.modelPath);
    }
    for (const entry of entries.values()) {
      // The chat loads the model again when it hears this.
      entry.reject(new Error('Model is not loaded'));
    }
    entries.clear();
    if (interrupted) {
      sendToHub('token', {
        token: '',
        done: true,
        error: 'Model is not loaded',
      });
    }
  });
  worker = child;
  return child;
}

function callWorker<T>(op: QortinoWorkerOp, args?: unknown): Promise<T> {
  if (!worker && (op === 'unload' || op === 'cancel' || op === 'info')) {
    return Promise.resolve({} as T);
  }
  const child = startWorker();
  const id = `q${(nextId += 1)}`;
  const load = args as { path?: string; gpu?: boolean } | undefined;
  return new Promise<T>((resolve, reject) => {
    pendingFor(child).set(id, {
      op,
      resolve: resolve as (value: unknown) => void,
      reject,
      modelPath: op === 'load' ? load?.path : undefined,
      gpu: load?.gpu,
    });
    child.postMessage({ id, op, args });
  });
}

/**
 * Unload the model, and end its process when nothing else is waiting on it:
 * a load sent while the unload ran (Qortino opened again) keeps it alive.
 */
async function unloadWorker(): Promise<void> {
  const child = worker;
  if (!child) return;
  await callWorker('unload');
  if (worker === child && (pendingByWorker.get(child)?.size ?? 0) === 0) {
    stopQortinoWorker();
  }
}

export function stopQortinoWorker(): void {
  const child = worker;
  worker = null;
  child?.kill();
}

/* ------------------------------------------------------------- downloads */

const downloads = new Map<string, AbortController>();

function cancelDownloads(relativePath?: string): void {
  for (const [key, controller] of downloads) {
    if (!relativePath || key === relativePath) controller.abort();
  }
}

/* -------------------------------------------------------------- handlers */

type Handler = (event: IpcMainInvokeEvent, args: any) => unknown;

function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event, args) => {
    requireHub(event);
    return handler(event, args ?? {});
  });
}

let registered = false;

export function registerQortinoLlmIpcHandlers(): void {
  if (registered) return;
  registered = true;

  handle('qortino:getDeviceTier', async () => {
    const { availBytes, totalBytes } = await diskSpace(qortinoRoot());
    const totalRam = os.totalmem();
    const availRam = availableMemoryBytes();
    return {
      totalRamBytes: totalRam,
      availRamBytes: availRam,
      availStorageBytes: availBytes,
      totalStorageBytes: totalBytes,
      lowMemory: availRam < 1024 ** 3,
      cpuThreads: os.cpus().length,
      gpu: lastGpu,
    };
  });

  handle('qortino:getStoragePaths', async () => {
    const rootDir = qortinoRoot();
    return {
      rootDir,
      modelsDir: path.join(rootDir, 'models'),
      knowledgeDir: path.join(rootDir, 'knowledge'),
      otherModelsDir: path.join(rootDir, OTHER_MODELS_DIR),
    };
  });

  handle('qortino:fileExists', async (_event, args) => {
    const target = resolveInsideRoot(qortinoRoot(), args.relativePath);
    const size = await fileSize(target);
    return { exists: size !== null, path: target, size: size ?? 0 };
  });

  handle('qortino:sha256File', async (_event, args) => {
    const relativePath = String(args.relativePath);
    const target = resolveInsideRoot(qortinoRoot(), relativePath);
    return sha256File(target, (bytesRead, bytesTotal) =>
      sendToHub('verifyProgress', { relativePath, bytesRead, bytesTotal })
    );
  });

  handle('qortino:cleanupStorage', async (_event, args) => {
    const keep = Array.isArray(args.keep)
      ? args.keep.filter((item: unknown) => typeof item === 'string')
      : [];
    return cleanupStorage(qortinoRoot(), keep);
  });

  handle('qortino:downloadUrl', async (_event, args) => {
    const relativePath = toPosix(String(args.relativePath || ''));
    if (!isDownloadTarget(relativePath)) {
      throw new Error('Only model files can be downloaded here');
    }
    const target = resolveInsideRoot(qortinoRoot(), relativePath);
    if (downloads.has(relativePath)) {
      throw new Error('This file is already downloading');
    }
    const controller = new AbortController();
    downloads.set(relativePath, controller);
    // Through the Hub window's own network session: it trusts the local
    // node's HTTPS certificate (local-https-cert.ts) and uses the system's
    // proxy settings, which Node's fetch does not.
    const hubSession = mainContents()?.session;
    try {
      const result = await downloadToFile({
        url: String(args.url || ''),
        apiKey: typeof args.apiKey === 'string' ? args.apiKey : undefined,
        target,
        signal: controller.signal,
        fetchImpl: hubSession
          ? (((input, init) =>
              hubSession.fetch(input as string, {
                ...init,
                credentials: 'omit',
                cache: 'no-store',
              })) as typeof fetch)
          : undefined,
        // With the node's API key: redirects one by one, the key only on
        // the node's own origin.
        hop: hubSession ? sessionHop(hubSession) : undefined,
        events: {
          onProgress: (bytesReceived, bytesTotal) =>
            sendToHub('downloadProgress', {
              relativePath,
              bytesReceived,
              bytesTotal,
              done: false,
            }),
        },
      });
      sendToHub('downloadProgress', {
        relativePath,
        bytesReceived: result.bytesWritten,
        bytesTotal: result.bytesWritten,
        done: true,
      });
      return result;
    } catch (error) {
      const message =
        error instanceof DownloadCancelledError
          ? 'cancelled'
          : error instanceof Error
            ? error.message
            : String(error);
      sendToHub('downloadProgress', {
        relativePath,
        bytesReceived: 0,
        bytesTotal: 0,
        done: true,
        error: message,
      });
      // A link's folder left empty by a cancel goes too.
      if (
        message === 'cancelled' &&
        relativePath.startsWith(`${OTHER_MODELS_DIR}/`)
      ) {
        await fs.promises.rmdir(path.dirname(target)).catch(() => undefined);
      }
      throw new Error(message);
    } finally {
      if (downloads.get(relativePath) === controller) {
        downloads.delete(relativePath);
      }
    }
  });

  handle('qortino:cancelDownload', async (_event, args) => {
    cancelDownloads(
      typeof args.relativePath === 'string' ? args.relativePath : undefined
    );
  });

  handle('qortino:otherModelPath', async (_event, args) =>
    otherModelRelativePath(String(args.url || ''))
  );

  handle('qortino:removeOtherModel', async (_event, args) => {
    const relativePath = toPosix(String(args.relativePath || ''));
    if (!relativePath.startsWith(`${OTHER_MODELS_DIR}/`)) {
      throw new Error('Only models added by link can be deleted here');
    }
    const target = resolveInsideRoot(qortinoRoot(), relativePath);
    const size = (await fileSize(target)) ?? 0;
    await fs.promises.rm(target, { force: true });
    await fs.promises.rm(`${target}.part`, { force: true });
    // The link's own folder, once empty.
    const folder = path.dirname(target);
    if (path.basename(path.dirname(folder)) === OTHER_MODELS_DIR) {
      await fs.promises.rmdir(folder).catch(() => undefined);
    }
    return { freedBytes: size };
  });

  handle('qortino:pickModelFile', async (_event, args) => {
    const owner = myCapacitorApp?.getMainWindow?.();
    const options = {
      title: typeof args.title === 'string' ? args.title : undefined,
      properties: ['openFile' as const],
      filters: [
        {
          name: typeof args.filterName === 'string' ? args.filterName : 'GGUF',
          extensions: ['gguf'],
        },
      ],
    };
    const { canceled, filePaths } = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (canceled || !filePaths[0]) return null;
    const size = (await fileSize(filePaths[0])) ?? 0;
    // Only files picked here (or Qortino's own) may be loaded later.
    await rememberPickedModel(pickedListDir(), picked(), filePaths[0]);
    return { path: filePaths[0], size, name: path.basename(filePaths[0]) };
  });

  handle('qortino:loadModel', async (_event, args) => {
    const modelPath = String(args.path || '');
    if (!isLoadableModelPath(qortinoRoot(), picked(), modelPath)) {
      throw new Error('Not a model file Qortino can load');
    }
    // Checked without waiting, so an unload sent after this load can never
    // reach the model process before it.
    if (!fs.existsSync(modelPath)) {
      throw new Error('The model file is missing');
    }
    const gpu =
      cpuOnlyModels.has(modelPath) || args.gpu === false ? false : undefined;
    const result = await callWorker<{ gpu?: string | false }>('load', {
      path: modelPath,
      nCtx: Number(args.nCtx) || 4096,
      gpu,
    });
    lastGpu = result?.gpu ?? null;
    return result;
  });

  handle('qortino:warmup', async (_event, args) =>
    callWorker('warmup', { system: String(args.system || '') })
  );

  handle('qortino:complete', async (_event, args) =>
    callWorker('complete', args)
  );

  handle('qortino:cancel', async () => callWorker('cancel'));

  // The memory goes back to the system with the process.
  handle('qortino:unload', async () => unloadWorker());

  handle('qortino:info', async () => callWorker('info'));

  app.on('will-quit', () => {
    cancelDownloads();
    stopQortinoWorker();
  });
}
