import { prepareQAppRequest } from './qapp-request-transport';
import {
  fileCounter,
  QAPP_FILE_IDLE_MS,
  QAPP_FILE_OPERATION_MS,
  requireFileRange,
  type QAppFileOperation,
} from './qapp-file-protocol';

type Ports = Pick<
  MessagePort,
  'postMessage' | 'close' | 'start' | 'addEventListener' | 'removeEventListener'
>;
type Environment = {
  // A single scheduler per worker bounds simultaneous reads/encryption/fetches.
  schedule: <T>(run: () => Promise<T>) => Promise<T>;
  save: (blob: Blob, filename: string, signal: AbortSignal) => Promise<void>;
  released: (completed: boolean) => void;
  fault: () => void;
};

/** Guest data can provide files, but only the separate trusted port can use them. */
export function attachQAppFileExecutor(
  input: Ports,
  control: Ports,
  expected: { bytes: number; files: number },
  environment: Environment
) {
  let files: Blob[] | undefined;
  let disposed = false;
  let busy = false;
  let accepted = false;
  let nextOperation = 1;
  let idle: ReturnType<typeof setTimeout>;
  let operation: AbortController | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(dispose, accepted ? QAPP_FILE_IDLE_MS : 30_000);
  };
  function dispose(completed = false) {
    if (disposed) return;
    disposed = true;
    clearTimeout(idle);
    operation?.abort();
    files = undefined;
    input.close();
    control.close();
    environment.released(completed === true);
  }
  input.addEventListener('message', (event: MessageEvent) => {
    if (disposed || files) return;
    try {
      const prepared = prepareQAppRequest(event.data);
      if (
        prepared.files.length !== expected.files ||
        prepared.files.reduce((sum, file) => sum + file.size, 0) !==
          expected.bytes
      )
        throw new Error('QAPP_FILE_INVALID_REQUEST');
      files = prepared.blobs;
      input.close(); // No guest channel remains after the one immutable request.
      control.postMessage({
        kind: 'request',
        data: prepared.data,
        files: prepared.files,
      });
      touch();
    } catch {
      control.postMessage({ kind: 'error', error: 'QAPP_BRIDGE_ERROR' });
      dispose();
    }
  });
  control.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;
    if (disposed) return;
    if (message?.kind === 'release') return dispose(message.completed === true);
    if (files && !accepted && message?.kind === 'accept') {
      accepted = true;
      touch();
      return;
    }
    if (!files || !accepted || busy || message?.id !== nextOperation) {
      dispose();
      return;
    }
    nextOperation++;
    busy = true;
    touch();
    const abort = new AbortController();
    operation = abort;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (disposed || abort.signal.aborted) throw new Error('QAPP_FILE_CLOSED');
      timer = setTimeout(
        () => {
          // Blob reads cannot be aborted. A hung operation must not permanently
          // occupy this worker's scheduler or retain its source files.
          environment.fault();
          dispose();
        },
        message.operation?.kind === 'save'
          ? QAPP_FILE_IDLE_MS
          : QAPP_FILE_OPERATION_MS
      );
      const op: QAppFileOperation = message.operation;
      if (
        !op ||
        !Number.isSafeInteger(op.file) ||
        op.file < 0 ||
        !files[op.file]
      )
        throw new Error('QAPP_FILE_INVALID_REQUEST');
      const file = files[op.file];
      if (op.kind === 'reference') return file;
      if (op.kind === 'save') {
        await environment.save(file, op.filename, abort.signal);
        return null;
      }
      if (op.kind !== 'upload') throw new Error('QAPP_FILE_INVALID_REQUEST');
      requireFileRange(file.size, op.start, op.end);
      const slice = file.slice(op.start, op.end);
      const endpoint = new URL(op.endpoint);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash ||
        // A configured Core URL can include a reverse-proxy path prefix.
        !/\/arbitrary\/[^/]+\/[^/]+(?:\/[^/]+)?\/chunk$/.test(
          endpoint.pathname
        ) ||
        !Number.isSafeInteger(op.index) ||
        op.index < 0
      )
        throw new Error('QAPP_FILE_INVALID_UPLOAD');
      let chunk = slice;
      if (op.encryption) {
        const { key, iv } = op.encryption;
        if (
          !ArrayBuffer.isView(key) ||
          !ArrayBuffer.isView(iv) ||
          Object.prototype.toString.call(key) !== '[object Uint8Array]' ||
          Object.prototype.toString.call(iv) !== '[object Uint8Array]' ||
          ![16, 24, 32].includes(key.byteLength)
        )
          throw new Error('QAPP_FILE_INVALID_ENCRYPTION');
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          key as Uint8Array<ArrayBuffer>,
          'AES-CTR',
          false,
          ['encrypt']
        );
        const counter = fileCounter(iv, op.start);
        const encrypted = await crypto.subtle.encrypt(
          {
            name: 'AES-CTR',
            counter: counter as Uint8Array<ArrayBuffer>,
            length: 128,
          },
          cryptoKey,
          await slice.arrayBuffer()
        );
        chunk = new Blob([encrypted]);
      }
      if (disposed || abort.signal.aborted) throw new Error('QAPP_FILE_CLOSED');
      const body = new FormData();
      body.append(
        'chunk',
        chunk,
        file instanceof File ? file.name : 'undefined'
      );
      body.append('index', String(op.index));
      const response = await fetch(endpoint.href, {
        method: 'POST',
        body,
        signal: abort.signal,
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      // The chunk endpoint's response body is unused. Do not buffer an arbitrary
      // server response (or leave its stream running between chunks).
      await response.body?.cancel();
      if (!response.ok) throw new Error('QAPP_FILE_UPLOAD_FAILED');
      return null;
    };
    // Reference passing reads no bytes. Native saves stream in Chromium and may
    // wait on a user dialog; neither should occupy the JS upload/encryption lane.
    const work =
      message.operation?.kind === 'upload' ? environment.schedule(run) : run();
    void work
      .then(
        (result) => {
          if (!disposed && !abort.signal.aborted)
            control.postMessage(
              { id: message.id, result },
              result instanceof ArrayBuffer ? [result] : []
            );
          else if (!disposed) dispose();
        },
        () => {
          if (!disposed)
            control.postMessage({
              id: message.id,
              error: 'QAPP_FILE_OPERATION_FAILED',
            });
        }
      )
      .finally(() => {
        clearTimeout(timer);
        busy = false;
        operation = undefined;
        if (!disposed) touch();
      });
  });
  control.addEventListener('close', () => dispose());
  input.start();
  control.start();
  touch();
  return dispose;
}
