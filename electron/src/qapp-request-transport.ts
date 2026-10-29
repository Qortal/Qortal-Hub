// Browser-only transport code, shared by the shell and the bundled sandboxed
// guest preload. Never import Node or Electron APIs here.
export const QAPP_BINARY_CHUNK_SIZE = 256 * 1024;
export const QAPP_BINARY_MAX_BYTES = 8 * 1024 ** 3;
const MAX_FILES = 4096;
const MAX_TRANSFERS = 2;
const IDLE_TIMEOUT_MS = 60_000;
const BRIDGE_ERROR = 'QAPP_BRIDGE_ERROR';

export type QAppRequest = {
  documentId: string;
  requestId: number;
  data: any;
};
type FileDescription = {
  reference: object;
  size: number;
  type: string;
  name?: string;
  lastModified?: number;
};
type BinaryMessage = {
  documentId: string;
  requestId: number;
  step: number;
  kind: 'start' | 'chunk' | 'finish' | 'abort';
  data?: any;
  files?: FileDescription[];
  fileIndex?: number;
  offset?: number;
  bytes?: ArrayBuffer;
};
type Ack = {
  documentId: string;
  requestId: number;
  step: number;
  error?: string;
};

// Preserve structured-clone containers, cycles and shared references. Binary
// references are identified by object identity in the same IPC message, never by
// magic properties that could collide with an application's own data.
function mapGraph(
  value: any,
  replace: (value: object) => any,
  seen = new Map()
) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const replacement = replace(value);
  if (replacement !== value) {
    seen.set(value, replacement);
    return replacement;
  }
  const tag = Object.prototype.toString.call(value);
  let output: any;
  if (Array.isArray(value)) output = new Array(value.length);
  else if (tag === '[object Map]') output = new Map();
  else if (tag === '[object Set]') output = new Set();
  else if (tag === '[object Object]') output = {};
  else return value; // ArrayBuffer, typed arrays, Date, RegExp, etc.
  seen.set(value, output);
  if (tag === '[object Map]') {
    for (const [key, item] of value)
      output.set(mapGraph(key, replace, seen), mapGraph(item, replace, seen));
  } else if (tag === '[object Set]') {
    for (const item of value) output.add(mapGraph(item, replace, seen));
  } else {
    for (const key of Object.keys(value)) {
      Object.defineProperty(output, key, {
        value: mapGraph(value[key], replace, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return output;
}

export function prepareQAppRequest(data: any) {
  const blobs: Blob[] = [];
  const files: FileDescription[] = [];
  let total = 0;
  const encoded = mapGraph(data, (value) => {
    if (!(value instanceof Blob)) return value;
    total += value.size;
    if (total > QAPP_BINARY_MAX_BYTES || files.length >= MAX_FILES)
      throw new Error(BRIDGE_ERROR);
    const reference = {};
    files.push({
      reference,
      size: value.size,
      type: value.type,
      ...(value instanceof File
        ? { name: value.name, lastModified: value.lastModified }
        : {}),
    });
    blobs.push(value);
    return reference;
  });
  return { data: files.length ? encoded : data, files, blobs };
}

// One acknowledged chunk in flight per guest, including across concurrent
// requests. Blob.slice() avoids materializing the whole file as an ArrayBuffer.
export class QAppBinarySender {
  private tail: Promise<void> = Promise.resolve();
  private waiting: {
    ack: Ack;
    resolve: () => void;
    reject: () => void;
  } | null = null;
  private disposed = false;
  private cancelStage: (() => void) | null = null;

  constructor(
    private send: (message: BinaryMessage) => void,
    private timeoutMs = IDLE_TIMEOUT_MS
  ) {}

  acknowledge(ack: Ack) {
    const waiting = this.waiting;
    if (
      !waiting ||
      ack?.documentId !== waiting.ack.documentId ||
      ack?.requestId !== waiting.ack.requestId ||
      ack?.step !== waiting.ack.step
    )
      return;
    if (ack.error) waiting.reject();
    else waiting.resolve();
  }

  dispose() {
    this.disposed = true;
    this.cancelStage?.();
  }

  // Both IPC acknowledgements and disk-backed Blob reads can stall. Bound each
  // stage and allow disposal to unblock the queue even while a read is pending.
  private stage<T>(
    start: (resolve: (value: T) => void, reject: () => void) => void
  ) {
    return new Promise<T>((resolve, reject) => {
      if (this.disposed) return reject(new Error(BRIDGE_ERROR));
      let settled = false;
      const finish = (error: boolean, value?: T) => {
        // A late read completion must not clear a subsequent stage's timeout or
        // acknowledgement handler after this stage has already been cancelled.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiting = null;
        this.cancelStage = null;
        if (error) reject(new Error(BRIDGE_ERROR));
        else resolve(value);
      };
      const timer = setTimeout(() => finish(true), this.timeoutMs);
      this.cancelStage = () => finish(true);
      try {
        start(
          (value) => finish(false, value),
          () => finish(true)
        );
      } catch {
        finish(true);
      }
    });
  }

  sendRequest(
    request: QAppRequest,
    prepared: ReturnType<typeof prepareQAppRequest>
  ) {
    const transfer = this.tail.then(async () => {
      let step = 0;
      const base = {
        documentId: request.documentId,
        requestId: request.requestId,
      };
      const exchange = (message: BinaryMessage) =>
        this.stage<void>((resolve, reject) => {
          this.waiting = { ack: message, resolve: () => resolve(), reject };
          this.send(message);
        });
      try {
        await exchange({
          ...base,
          step: step++,
          kind: 'start',
          data: prepared.data,
          files: prepared.files,
        });
        for (
          let fileIndex = 0;
          fileIndex < prepared.blobs.length;
          fileIndex++
        ) {
          const blob = prepared.blobs[fileIndex];
          for (
            let offset = 0;
            offset < blob.size;
            offset += QAPP_BINARY_CHUNK_SIZE
          ) {
            const bytes = await this.stage<ArrayBuffer>((resolve, reject) => {
              void blob
                .slice(offset, offset + QAPP_BINARY_CHUNK_SIZE)
                .arrayBuffer()
                .then(resolve, reject);
            });
            await exchange({
              ...base,
              step: step++,
              kind: 'chunk',
              fileIndex,
              offset,
              bytes,
            });
          }
        }
        await exchange({ ...base, step: step++, kind: 'finish' });
      } catch (error) {
        if (!this.disposed) {
          try {
            this.send({ ...base, step, kind: 'abort' });
          } catch {
            /* Guest has gone away. */
          }
        }
        throw error;
      }
    });
    // A failed transfer must not prevent subsequent requests from being sent.
    this.tail = transfer.catch(() => undefined);
    return transfer;
  }
}

type Transfer = {
  data: any;
  files: FileDescription[];
  parts: Blob[][];
  offsets: number[];
  nextStep: number;
  timer: ReturnType<typeof setTimeout>;
};

export class QAppBinaryReceiver {
  private transfers = new Map<number, Transfer>();

  constructor(
    private documentId: string,
    private acknowledge: (ack: Ack) => void,
    private dispatch: (request: QAppRequest) => void,
    private timeoutMs = IDLE_TIMEOUT_MS
  ) {}

  dispose() {
    for (const transfer of this.transfers.values())
      clearTimeout(transfer.timer);
    this.transfers.clear();
  }

  private drop(requestId: number) {
    const transfer = this.transfers.get(requestId);
    if (transfer) clearTimeout(transfer.timer);
    this.transfers.delete(requestId);
  }

  receive(message: BinaryMessage) {
    if (
      message?.documentId !== this.documentId ||
      !Number.isSafeInteger(message?.requestId) ||
      message.requestId < 1 ||
      !Number.isSafeInteger(message?.step) ||
      message.step < 0
    )
      return;
    const { requestId, step, documentId } = message;
    const ack = (error?: string) =>
      this.acknowledge({
        documentId,
        requestId,
        step,
        ...(error ? { error } : {}),
      });
    if (message.kind === 'abort') {
      this.drop(requestId);
      return;
    }
    let completed: QAppRequest | undefined;
    try {
      if (message.kind === 'start') {
        if (
          step !== 0 ||
          this.transfers.has(requestId) ||
          this.transfers.size >= MAX_TRANSFERS ||
          !message.data ||
          typeof message.data !== 'object' ||
          !Array.isArray(message.files) ||
          !message.files.length ||
          message.files.length > MAX_FILES
        )
          throw new Error(BRIDGE_ERROR);
        const references = new Set<object>();
        let total = 0;
        for (const file of message.files) {
          if (
            !file ||
            !file.reference ||
            typeof file.reference !== 'object' ||
            Object.prototype.toString.call(file.reference) !==
              '[object Object]' ||
            Object.keys(file.reference).length ||
            references.has(file.reference) ||
            !Number.isSafeInteger(file.size) ||
            file.size < 0 ||
            typeof file.type !== 'string' ||
            file.type.length > 65536 ||
            (file.name !== undefined &&
              (typeof file.name !== 'string' ||
                file.name.length > 65536 ||
                !Number.isFinite(file.lastModified)))
          )
            throw new Error(BRIDGE_ERROR);
          references.add(file.reference);
          total += file.size;
          if (total > QAPP_BINARY_MAX_BYTES) throw new Error(BRIDGE_ERROR);
        }
        this.transfers.set(requestId, {
          data: message.data,
          files: message.files,
          parts: message.files.map(() => []),
          offsets: message.files.map(() => 0),
          nextStep: 1,
          timer: undefined,
        });
      } else {
        const transfer = this.transfers.get(requestId);
        if (!transfer || step !== transfer.nextStep)
          throw new Error(BRIDGE_ERROR);
        transfer.nextStep++;
        if (message.kind === 'chunk') {
          const { fileIndex, offset, bytes } = message;
          const file = transfer.files[fileIndex];
          if (
            !Number.isSafeInteger(fileIndex) ||
            !file ||
            offset !== transfer.offsets[fileIndex] ||
            Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' ||
            bytes.byteLength === 0 ||
            bytes.byteLength > QAPP_BINARY_CHUNK_SIZE ||
            offset + bytes.byteLength > file.size
          )
            throw new Error(BRIDGE_ERROR);
          // Let Chromium own the bytes as Blob storage; do not retain a growing
          // array of JS ArrayBuffers or repeatedly concatenate the whole file.
          transfer.parts[fileIndex].push(new Blob([bytes]));
          transfer.offsets[fileIndex] += bytes.byteLength;
        } else if (message.kind === 'finish') {
          const replacements = new Map<object, Blob>();
          transfer.files.forEach((file, index) => {
            if (transfer.offsets[index] !== file.size)
              throw new Error(BRIDGE_ERROR);
            replacements.set(
              file.reference,
              file.name === undefined
                ? new Blob(transfer.parts[index], { type: file.type })
                : new File(transfer.parts[index], file.name, {
                    type: file.type,
                    lastModified: file.lastModified,
                  })
            );
          });
          const data = mapGraph(
            transfer.data,
            (value) => replacements.get(value) ?? value
          );
          completed = { documentId, requestId, data };
          this.drop(requestId);
        } else throw new Error(BRIDGE_ERROR);
      }
      const transfer = this.transfers.get(requestId);
      if (transfer) {
        clearTimeout(transfer.timer);
        transfer.timer = setTimeout(() => {
          this.drop(requestId);
          this.acknowledge({
            documentId,
            requestId,
            step: transfer.nextStep,
            error: BRIDGE_ERROR,
          });
        }, this.timeoutMs);
      }
    } catch {
      this.drop(requestId);
      ack(BRIDGE_ERROR);
      return;
    }
    ack();
    if (completed) this.dispatch(completed);
  }
}
