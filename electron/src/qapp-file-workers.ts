import {
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { QAppFileBudget } from './qapp-file-budget';
import { QAPP_FILE_SCHEME, QAPP_FILE_WORKER_URL } from './qapp-file-protocol';

export const QAPP_FILE_WORKER_CSP =
  "default-src 'none'; connect-src http: https:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'";
type Worker = {
  window: BrowserWindow;
  ready: Promise<void>;
  tasks: Set<string>;
  idle?: ReturnType<typeof setTimeout>;
};
type Task = {
  id: string;
  guest: WebContents;
  documentId: string;
  requestId: number;
  worker: Worker;
  host: WebContents;
  cancelSave?: () => void;
  cleanup: () => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Main brokers ports and lifetimes; file contents never enter Node IPC. */
export class QAppFileWorkers {
  private budget = new QAppFileBudget();
  private workers = new Map<Session, Worker>();
  private tasks = new Map<string, Task>();
  private configured = new WeakSet<Session>();

  constructor() {
    ipcMain.on('qappFiles:fault', (event) => {
      for (const worker of this.workers.values()) {
        if (
          !worker.window.isDestroyed() &&
          event.sender === worker.window.webContents &&
          event.senderFrame === event.sender.mainFrame &&
          event.sender.getURL() === QAPP_FILE_WORKER_URL
        ) {
          worker.window.destroy();
          return;
        }
      }
    });
    ipcMain.on('qappFiles:released', (event, id, completed) => {
      const task = this.authorizedWorker(event, id);
      if (task) this.release(task, completed === true);
    });
    ipcMain.on('qappFiles:cancelSave', (event, id) => {
      this.authorizedWorker(event, id)?.cancelSave?.();
    });
    ipcMain.handle('qappFiles:save', async (event, id, url, filename) => {
      const task = this.authorizedWorker(event, id);
      if (!task) throw new Error('QAPP_PERMISSION_DENIED');
      await this.save(task, url, filename);
    });
  }

  private authorizedWorker(
    event: IpcMainEvent | IpcMainInvokeEvent,
    id: unknown
  ) {
    if (typeof id !== 'string') return;
    const task = this.tasks.get(id);
    if (
      task &&
      event.sender === task.worker.window.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.sender.getURL() === QAPP_FILE_WORKER_URL
    )
      return task;
  }

  private createWorker(guestSession: Session) {
    const existing = this.workers.get(guestSession);
    if (existing) {
      clearTimeout(existing.idle);
      return existing;
    }
    // Idle renderers count too: opening different apps cannot accumulate them.
    for (const [session, worker] of this.workers) {
      if (!worker.tasks.size) {
        this.workers.delete(session);
        clearTimeout(worker.idle);
        worker.window.destroy();
      }
    }
    if (this.workers.size >= 4) throw new Error('QAPP_BRIDGE_BUSY');
    if (!this.configured.has(guestSession)) {
      guestSession.protocol.handle(QAPP_FILE_SCHEME, (request) => {
        if (request.url !== QAPP_FILE_WORKER_URL || request.method !== 'GET')
          return new Response(null, { status: 404 });
        return new Response('<!doctype html><meta charset="utf-8">', {
          headers: {
            'Content-Type': 'text/html',
            'Content-Security-Policy': QAPP_FILE_WORKER_CSP,
            'Cache-Control': 'no-store',
          },
        });
      });
      this.configured.add(guestSession);
    }
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        session: guestSession,
        preload: join(__dirname, 'qapp-file-worker-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        webSecurity: true,
        backgroundThrottling: false,
        devTools: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) =>
      event.preventDefault()
    );
    const worker: Worker = {
      window,
      tasks: new Set(),
      ready: window.loadURL(QAPP_FILE_WORKER_URL),
    };
    this.workers.set(guestSession, worker);
    const dead = () => {
      if (this.workers.get(guestSession) === worker)
        this.workers.delete(guestSession);
      clearTimeout(worker.idle);
      for (const id of [...worker.tasks]) {
        const task = this.tasks.get(id);
        if (task) this.release(task);
      }
      if (!window.isDestroyed()) window.destroy();
    };
    window.webContents.on('render-process-gone', dead);
    window.webContents.on('preload-error', dead);
    window.once('closed', dead);
    void worker.ready.catch(dead);
    return worker;
  }

  async open(
    guest: WebContents,
    host: WebContents,
    partition: string,
    documentId: string,
    requestId: number,
    bytes: number,
    files: number
  ) {
    if (
      !/^[a-f0-9]{32}$/.test(documentId) ||
      !Number.isSafeInteger(requestId) ||
      requestId < 1 ||
      [...this.tasks.values()].some(
        (task) =>
          task.guest === guest &&
          task.documentId === documentId &&
          task.requestId === requestId
      )
    )
      throw new Error('QAPP_FILE_INVALID_REQUEST');
    const id = randomUUID();
    this.budget.reserve(
      id,
      partition,
      `${guest.id}:${documentId}`,
      bytes,
      files
    );
    let task: Task | undefined;
    try {
      const worker = this.createWorker(guest.session);
      const cancel = () => {
        if (task) this.release(task);
      };
      const navigate = (
        _event,
        _url,
        _httpResponseCode,
        _httpStatusText,
        isMainFrame
      ) => {
        if (isMainFrame) cancel();
      };
      task = {
        id,
        guest,
        host,
        documentId,
        requestId,
        worker,
        timer: setTimeout(cancel, 2 * 60 * 60_000),
        cleanup: () => {
          guest.removeListener('did-frame-navigate', navigate);
          guest.removeListener('render-process-gone', cancel);
          guest.removeListener('destroyed', cancel);
          host.removeListener('did-navigate', cancel);
          host.removeListener('render-process-gone', cancel);
          host.removeListener('destroyed', cancel);
        },
      };
      this.tasks.set(id, task);
      worker.tasks.add(id);
      guest.on('did-frame-navigate', navigate);
      guest.on('render-process-gone', cancel);
      guest.on('destroyed', cancel);
      host.on('did-navigate', cancel);
      host.on('render-process-gone', cancel);
      host.on('destroyed', cancel);
      let startup: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          worker.ready,
          new Promise<never>((_, reject) => {
            startup = setTimeout(() => {
              reject(new Error('QAPP_FILE_WORKER_TIMEOUT'));
              // A worker whose load never settles must not be reused by the
              // next request, repeatedly resetting its idle shutdown timer.
              if (!worker.window.isDestroyed()) worker.window.destroy();
            }, 30_000);
          }),
        ]);
      } finally {
        clearTimeout(startup);
      }
      if (!this.tasks.has(id)) throw new Error('QAPP_FILE_CLOSED');
      const data = new MessageChannelMain();
      const control = new MessageChannelMain();
      const untransferred = new Set([
        data.port1,
        data.port2,
        control.port1,
        control.port2,
      ]);
      try {
        worker.window.webContents.mainFrame.postMessage(
          'qappFiles:attach',
          { id, bytes, files },
          [data.port1, control.port1]
        );
        untransferred.delete(data.port1);
        untransferred.delete(control.port1);
        host.mainFrame.postMessage(
          'qappFiles:control',
          { guestId: guest.id, documentId, requestId },
          [control.port2]
        );
        untransferred.delete(control.port2);
        guest.mainFrame.postMessage(
          'qappFiles:input',
          { documentId, requestId },
          [data.port2]
        );
        untransferred.delete(data.port2);
      } finally {
        // A frame may disappear halfway through setup. Release ports still
        // owned by main instead of relying on garbage collection to close them.
        for (const port of untransferred) port.close();
      }
    } catch (error) {
      if (task) this.release(task);
      else this.budget.release(id);
      throw error;
    }
  }

  releaseGuest(guest: WebContents) {
    for (const task of [...this.tasks.values()])
      if (task.guest === guest) this.release(task);
  }

  releaseAll() {
    for (const task of [...this.tasks.values()]) this.release(task);
    for (const worker of [...this.workers.values()])
      if (!worker.window.isDestroyed()) worker.window.destroy();
  }

  private release(task: Task, completed = false) {
    if (!this.tasks.delete(task.id)) return;
    this.budget.release(task.id);
    if (!completed && !task.guest.isDestroyed()) {
      try {
        task.guest.send('qappFiles:failed', {
          documentId: task.documentId,
          requestId: task.requestId,
        });
      } catch {
        /* The guest frame may already have exited. */
      }
    }
    task.cleanup();
    clearTimeout(task.timer);
    task.cancelSave?.();
    const worker = task.worker;
    worker.tasks.delete(task.id);
    if (!worker.window.isDestroyed()) {
      try {
        worker.window.webContents.send('qappFiles:cancel', task.id);
      } catch {
        /* Renderer termination also releases the native references. */
      }
      if (!worker.tasks.size) {
        clearTimeout(worker.idle);
        worker.idle = setTimeout(() => worker.window.destroy(), 30_000);
      }
    }
  }

  private async save(task: Task, url: unknown, filename: unknown) {
    if (
      typeof url !== 'string' ||
      !url.startsWith(`blob:${QAPP_FILE_WORKER_URL}`) ||
      typeof filename !== 'string' ||
      !filename ||
      filename.length > 200 ||
      /[\\/\u202a-\u202e\u2066-\u2069]/.test(filename) ||
      [...filename].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) ||
      filename === '.' ||
      filename === '..' ||
      task.cancelSave
    )
      throw new Error('QAPP_FILE_INVALID_SAVE');
    let cancelled = false;
    const cancellation = new Promise<Electron.SaveDialogReturnValue>(
      (resolve) => {
        task.cancelSave = () => {
          cancelled = true;
          resolve({ canceled: true, filePath: '' });
        };
      }
    );
    try {
      const parent = BrowserWindow.fromWebContents(task.host);
      if (!parent || parent.isDestroyed()) throw new Error('QAPP_FILE_CLOSED');
      // Electron's dialog may remain open after the originating request ends.
      // Stop awaiting it so the worker can revoke its Blob URL immediately;
      // any eventual dialog result is ignored and must never start a download.
      const choice = await Promise.race([
        dialog.showSaveDialog(parent, { defaultPath: filename }),
        cancellation,
      ]);
      if (
        cancelled ||
        choice.canceled ||
        !choice.filePath ||
        !this.tasks.has(task.id)
      )
        throw new Error('QAPP_FILE_SAVE_CANCELLED');
      const contents = task.worker.window.webContents;
      await new Promise<void>((resolve, reject) => {
        let item: Electron.DownloadItem | undefined;
        let settled = false;
        const finish = (error = false) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          contents.session.removeListener('will-download', download);
          if (error) {
            item?.cancel();
            reject(new Error('QAPP_FILE_SAVE_FAILED'));
          } else resolve();
        };
        const download = (
          _event,
          candidate: Electron.DownloadItem,
          source: WebContents
        ) => {
          if (source !== contents || candidate.getURL() !== url) return;
          item = candidate;
          clearTimeout(timer);
          contents.session.removeListener('will-download', download);
          item.setSavePath(choice.filePath);
          item.once('done', (_event, state) => finish(state !== 'completed'));
        };
        const timer = setTimeout(() => finish(true), 30_000);
        task.cancelSave = () => finish(true);
        contents.session.on('will-download', download);
        try {
          contents.downloadURL(url);
        } catch {
          finish(true);
        }
      });
    } finally {
      task.cancelSave = undefined;
    }
  }
}
