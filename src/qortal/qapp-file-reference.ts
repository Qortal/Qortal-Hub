import { mapQAppGraph } from '../../electron/src/qapp-request-transport';
import {
  QAPP_FILE_IDLE_MS,
  QAPP_FILE_OPERATION_MS,
  QAPP_FILE_MAX_FILES,
  QAPP_FILE_REQUEST_BYTES,
  type QAppFileMetadata,
  type QAppFileOperation,
} from '../../electron/src/qapp-file-protocol';
import i18n from '../i18n/i18n';

const references = new WeakSet<object>();
const failure = () =>
  new Error(i18n.t('question:message.error.perform_request'));

// Only objects constructed from the authenticated worker channel enter this
// WeakSet. Guest-supplied properties can never impersonate a file capability.
export function isQAppFileReference(
  value: unknown
): value is QAppFileReference {
  return !!value && typeof value === 'object' && references.has(value);
}
export function isQAppFile(value: unknown): value is Blob | QAppFileReference {
  return value instanceof Blob || isQAppFileReference(value);
}
export function hasQAppFileReferences(value: unknown) {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    if (isQAppFileReference(item)) return true;
    seen.add(item);
    if (item instanceof Map) {
      for (const [key, entry] of item) {
        pending.push(key);
        pending.push(entry);
      }
    } else if (item instanceof Set) {
      for (const entry of item) pending.push(entry);
    } else if (
      Array.isArray(item) ||
      Object.prototype.toString.call(item) === '[object Object]'
    ) {
      for (const key of Object.keys(item)) pending.push(item[key]);
    }
  }
  return false;
}

export class QAppFileReference {
  readonly size: number;
  readonly type: string;
  readonly name?: string;
  readonly lastModified?: number;
  constructor(
    metadata: QAppFileMetadata,
    private file: number,
    private call: (operation: QAppFileOperation) => Promise<any>,
    private signal?: AbortSignal
  ) {
    this.size = metadata.size;
    this.type = metadata.type;
    this.name = metadata.name;
    this.lastModified = metadata.lastModified;
    references.add(this);
    Object.freeze(this);
  }
  upload(
    options: Omit<
      Extract<QAppFileOperation, { kind: 'upload' }>,
      'file' | 'kind'
    >
  ) {
    return this.call({ ...options, kind: 'upload', file: this.file });
  }
  save(filename: string) {
    return this.call({ kind: 'save', file: this.file, filename });
  }
  async base64(): Promise<string> {
    const blob = await this.readableBlob();
    return new Promise((resolve, reject) => {
      if (this.signal?.aborted) return reject(failure());
      const reader = new FileReader();
      const abort = () => reader.abort();
      const cleanup = () => this.signal?.removeEventListener('abort', abort);
      reader.onload = () => {
        cleanup();
        if (typeof reader.result === 'string')
          resolve(reader.result.slice(reader.result.indexOf(',') + 1));
        else reject(failure());
      };
      reader.onerror = reader.onabort = () => {
        cleanup();
        reject(failure());
      };
      this.signal?.addEventListener('abort', abort, { once: true });
      try {
        reader.readAsDataURL(blob);
      } catch {
        cleanup();
        reject(failure());
      }
    });
  }
  readableBlob(): Promise<Blob> {
    // Chromium supports reading a foreign-session Blob and fetching its object
    // URL (PDF.js), but NOT constructing dependent Blobs there. Never slice this
    // value, wrap it in new Blob/File, or append it to multipart FormData.
    // Uploads and saving deliberately keep all native operations in the worker.
    return this.call({ kind: 'reference', file: this.file });
  }
}

export function attachQAppFileClient(
  port: MessagePort,
  receive: (data: any) => void,
  failed: () => void
) {
  let disposed = false;
  let received = false;
  let nextId = 0;
  let tail = Promise.resolve();
  let waiting:
    | { id: number; resolve: (value: any) => void; reject: () => void }
    | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  function dispose(completed = false) {
    if (disposed) return;
    disposed = true;
    abort.abort();
    clearTimeout(timeout);
    waiting?.reject();
    waiting = undefined;
    try {
      port.postMessage({ kind: 'release', completed });
    } catch {
      /* A terminated worker may already have closed the port. */
    } finally {
      port.close();
    }
  }
  function fail() {
    if (disposed) return;
    dispose();
    failed();
  }
  function call(operation: QAppFileOperation) {
    const result = tail.then(
      () =>
        new Promise<any>((resolve, reject) => {
          if (disposed) return reject(failure());
          const id = ++nextId;
          waiting = { id, resolve, reject: () => reject(failure()) };
          timeout = setTimeout(
            fail,
            operation.kind === 'save'
              ? QAPP_FILE_IDLE_MS + 5000
              : // A worker has at most eight live requests. Account for the
                // bounded upload queue as well as this operation's own deadline.
                QAPP_FILE_OPERATION_MS * (operation.kind === 'upload' ? 8 : 1) +
                  5000
          );
          try {
            port.postMessage({ id, operation });
          } catch {
            fail();
          }
        })
    );
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
  port.onmessage = (event) => {
    if (disposed) return;
    try {
      const message = event.data;
      if (!received && message?.kind === 'request') {
        received = true;
        clearTimeout(timeout);
        const files = new Map<object, QAppFileReference>();
        if (
          !Array.isArray(message.files) ||
          message.files.length < 1 ||
          message.files.length > QAPP_FILE_MAX_FILES
        )
          throw failure();
        let bytes = 0;
        for (const [index, metadata] of (
          message.files as QAppFileMetadata[]
        ).entries()) {
          if (
            !metadata ||
            !metadata.reference ||
            typeof metadata.reference !== 'object' ||
            files.has(metadata.reference) ||
            !Number.isSafeInteger(metadata.size) ||
            metadata.size < 0 ||
            typeof metadata.type !== 'string'
          )
            throw failure();
          bytes += metadata.size;
          if (bytes > QAPP_FILE_REQUEST_BYTES) throw failure();
          files.set(
            metadata.reference,
            new QAppFileReference(metadata, index, call, abort.signal)
          );
        }
        port.postMessage({ kind: 'accept' });
        receive(
          mapQAppGraph(message.data, (value) => files.get(value) || value)
        );
      } else if (waiting && message?.id === waiting.id) {
        clearTimeout(timeout);
        const pending = waiting;
        waiting = undefined;
        if (message.error) pending.reject();
        else pending.resolve(message.result);
      } else fail();
    } catch {
      fail();
    }
  };
  port.onmessageerror = fail;
  port.addEventListener('close', () => {
    if (!disposed) fail();
  });
  timeout = setTimeout(fail, 30_000);
  return dispose;
}
