// Browser-only constants shared by the isolated worker and the trusted shell.
// Ports are capabilities: guest input and trusted operation ports are separate.
export const QAPP_FILE_SCHEME = 'qapp-file-worker';
export const QAPP_FILE_WORKER_URL = `${QAPP_FILE_SCHEME}://executor/`;
export const QAPP_FILE_CHUNK_BYTES = 5 * 1024 * 1024;
export const QAPP_FILE_REQUEST_BYTES = 8 * 1024 ** 3;
export const QAPP_FILE_GLOBAL_BYTES = 16 * 1024 ** 3;
export const QAPP_FILE_MAX_FILES = 4096;
export const QAPP_FILE_IDLE_MS = 30 * 60_000;
export const QAPP_FILE_OPERATION_MS = 120_000;

export type QAppFileMetadata = {
  reference: object;
  size: number;
  type: string;
  name?: string;
  lastModified?: number;
};

export type QAppFileOperation =
  | { kind: 'reference'; file: number }
  | { kind: 'save'; file: number; filename: string }
  | {
      kind: 'upload';
      file: number;
      start: number;
      end: number;
      index: number;
      endpoint: string;
      encryption?: { key: Uint8Array; iv: Uint8Array };
    };

export function requireFileRange(size: number, start: number, end: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > size ||
    end - start > QAPP_FILE_CHUNK_BYTES
  )
    throw new Error('QAPP_FILE_INVALID_RANGE');
}

export function fileCounter(iv: Uint8Array, byteOffset: number): Uint8Array {
  if (
    iv.byteLength !== 16 ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    byteOffset % 16 !== 0
  )
    throw new Error('QAPP_FILE_INVALID_COUNTER');
  const counter = new Uint8Array(iv);
  // Never use bitwise arithmetic on the byte offset: it truncates at 2 GiB.
  let carry = BigInt(byteOffset) / 16n;
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 255n);
    counter[i] = Number(sum & 255n);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}
