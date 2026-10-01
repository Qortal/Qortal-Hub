import { parentPort } from 'worker_threads';

// This worker is unpacked from app.asar so Node can execute it directly.
// Use direct CommonJS imports to keep TypeScript from emitting tslib helpers,
// which cannot be resolved across the app.asar/app.asar.unpacked boundary.
const fs = require('fs') as typeof import('fs');
const nodeCrypto = require('crypto') as typeof import('crypto');
const path = require('path') as typeof import('path');

export type ReticulumResourceWorkerTask =
  | {
      id: number;
      kind: 'finalize_resource';
      sourcePath: string;
      destinationPath: string;
      expectedHash: string;
      expectedSize: number;
      moveSource?: boolean;
    }
  | {
      id: number;
      kind: 'delete_paths';
      paths: string[];
    }
  | {
      id: number;
      kind: 'hash_file';
      path: string;
    }
  | {
      id: number;
      kind: 'read_and_hash_file';
      path: string;
    }
  | {
      id: number;
      kind: 'write_range_file';
      sourcePath: string;
      destinationPath: string;
      startByte: number;
      endByteExclusive: number;
    }
  | {
      id: number;
      kind: 'inspect_paths';
      entries: Array<{
        fileHash: string;
        assembledPath: string;
        partialPath: string;
        expectedSize: number;
        expectedHash: string;
        expectComplete: boolean;
      }>;
    };

export type ReticulumResourceWorkerTaskInput =
  | Omit<
      Extract<ReticulumResourceWorkerTask, { kind: 'finalize_resource' }>,
      'id'
    >
  | Omit<Extract<ReticulumResourceWorkerTask, { kind: 'delete_paths' }>, 'id'>
  | Omit<Extract<ReticulumResourceWorkerTask, { kind: 'hash_file' }>, 'id'>
  | Omit<
      Extract<ReticulumResourceWorkerTask, { kind: 'read_and_hash_file' }>,
      'id'
    >
  | Omit<
      Extract<ReticulumResourceWorkerTask, { kind: 'write_range_file' }>,
      'id'
    >
  | Omit<Extract<ReticulumResourceWorkerTask, { kind: 'inspect_paths' }>, 'id'>;

export type ReticulumResourceWorkerResult =
  | {
      id: number;
      kind: ReticulumResourceWorkerTask['kind'];
      ok: true;
      durationMs: number;
      hash?: string;
      deleted?: number;
      bytes?: Uint8Array;
      sizeBytes?: number;
      inspections?: Array<{
        fileHash: string;
        assembledValid: boolean;
        partialExists: boolean;
      }>;
    }
  | {
      id: number;
      kind: ReticulumResourceWorkerTask['kind'];
      ok: false;
      durationMs: number;
      error: string;
    };

export function hashReticulumResourceFile(filePath: string): string {
  const hash = nodeCrypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function readAndHashReticulumResourceFile(filePath: string): {
  bytes: Uint8Array;
  hash: string;
} {
  const fileBytes = fs.readFileSync(filePath);
  // Node 24 marks buffers returned by fs.readFileSync() as non-transferable.
  // Copy into a plain ArrayBuffer-backed view before using a worker transfer
  // list so Electron 44 can hand the bytes back to the main process.
  const bytes = new Uint8Array(fileBytes.length);
  bytes.set(fileBytes);
  return {
    bytes,
    hash: nodeCrypto.createHash('sha256').update(fileBytes).digest('hex'),
  };
}

export function finalizeReticulumResource(
  task: Extract<ReticulumResourceWorkerTask, { kind: 'finalize_resource' }>
): string {
  const stat = fs.statSync(task.sourcePath);
  if (!stat.isFile() || stat.size !== task.expectedSize) {
    throw new Error('Resource source size mismatch');
  }
  const hash = hashReticulumResourceFile(task.sourcePath);
  if (hash !== task.expectedHash.toLowerCase()) {
    throw new Error('Assembled file hash mismatch');
  }
  fs.mkdirSync(path.dirname(task.destinationPath), { recursive: true });
  if (path.resolve(task.sourcePath) !== path.resolve(task.destinationPath)) {
    if (task.moveSource) {
      try {
        fs.renameSync(task.sourcePath, task.destinationPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'EPERM') throw error;
        fs.rmSync(task.destinationPath, { force: true });
        fs.renameSync(task.sourcePath, task.destinationPath);
      }
      return hash;
    }
    const temporaryPath = `${task.destinationPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.copyFileSync(task.sourcePath, temporaryPath);
      fs.renameSync(temporaryPath, task.destinationPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  return hash;
}

export function deleteReticulumResourcePaths(paths: string[]): number {
  let deleted = 0;
  for (const candidate of new Set(paths.filter(Boolean))) {
    if (!fs.existsSync(candidate)) continue;
    fs.rmSync(candidate, { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}

export function writeReticulumResourceRange(
  task: Extract<ReticulumResourceWorkerTask, { kind: 'write_range_file' }>
): { hash: string; sizeBytes: number } {
  const startByte = Math.floor(task.startByte);
  const endByteExclusive = Math.floor(task.endByteExclusive);
  if (startByte < 0 || endByteExclusive <= startByte) {
    throw new Error('Invalid resource byte range');
  }
  const sourceStat = fs.statSync(task.sourcePath);
  if (!sourceStat.isFile() || endByteExclusive > sourceStat.size) {
    throw new Error('Resource byte range exceeds source');
  }
  fs.mkdirSync(path.dirname(task.destinationPath), { recursive: true });
  const source = fs.openSync(task.sourcePath, 'r');
  const output = fs.openSync(task.destinationPath, 'w');
  const sizeBytes = endByteExclusive - startByte;
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, sizeBytes));
  const hash = nodeCrypto.createHash('sha256');
  let remaining = sizeBytes;
  let offset = startByte;
  try {
    while (remaining > 0) {
      const readSize = Math.min(buffer.length, remaining);
      const bytesRead = fs.readSync(source, buffer, 0, readSize, offset);
      if (bytesRead <= 0)
        throw new Error('Unexpected EOF while reading resource range');
      const slice = buffer.subarray(0, bytesRead);
      fs.writeSync(output, slice);
      hash.update(slice);
      remaining -= bytesRead;
      offset += bytesRead;
    }
  } catch (error) {
    fs.rmSync(task.destinationPath, { force: true });
    throw error;
  } finally {
    fs.closeSync(source);
    fs.closeSync(output);
  }
  return { hash: hash.digest('hex'), sizeBytes };
}

parentPort?.on('message', (task: ReticulumResourceWorkerTask) => {
  const startedAt = Date.now();
  try {
    if (task.kind === 'hash_file') {
      parentPort?.postMessage({
        id: task.id,
        kind: task.kind,
        ok: true,
        hash: hashReticulumResourceFile(task.path),
        durationMs: Date.now() - startedAt,
      } satisfies ReticulumResourceWorkerResult);
      return;
    }
    if (task.kind === 'read_and_hash_file') {
      const { bytes, hash } = readAndHashReticulumResourceFile(task.path);
      // Own the exact ArrayBuffer sent to the parent. Node Buffers may expose
      // ArrayBufferLike (including pooled/shared backing), which is not a safe
      // transferable and also fails Electron's Transferable contract.
      const transferableBytes = new Uint8Array(bytes.byteLength);
      transferableBytes.set(bytes);
      const result = {
        id: task.id,
        kind: task.kind,
        ok: true,
        bytes: transferableBytes,
        hash,
        durationMs: Date.now() - startedAt,
      } satisfies ReticulumResourceWorkerResult;
      parentPort?.postMessage(result, [transferableBytes.buffer]);
      return;
    }
    if (task.kind === 'write_range_file') {
      const result = writeReticulumResourceRange(task);
      parentPort?.postMessage({
        id: task.id,
        kind: task.kind,
        ok: true,
        hash: result.hash,
        sizeBytes: result.sizeBytes,
        durationMs: Date.now() - startedAt,
      } satisfies ReticulumResourceWorkerResult);
      return;
    }
    if (task.kind === 'delete_paths') {
      parentPort?.postMessage({
        id: task.id,
        kind: task.kind,
        ok: true,
        deleted: deleteReticulumResourcePaths(task.paths),
        durationMs: Date.now() - startedAt,
      } satisfies ReticulumResourceWorkerResult);
      return;
    }
    if (task.kind === 'inspect_paths') {
      const inspections = task.entries.map((entry) => {
        let assembledValid = false;
        let partialExists = false;
        try {
          const stat = fs.statSync(entry.assembledPath);
          assembledValid =
            stat.isFile() &&
            stat.size === entry.expectedSize &&
            (entry.expectComplete ||
              hashReticulumResourceFile(entry.assembledPath) ===
                entry.expectedHash);
        } catch {
          assembledValid = false;
        }
        try {
          partialExists = fs.statSync(entry.partialPath).isFile();
        } catch {
          partialExists = false;
        }
        return { fileHash: entry.fileHash, assembledValid, partialExists };
      });
      parentPort?.postMessage({
        id: task.id,
        kind: task.kind,
        ok: true,
        inspections,
        durationMs: Date.now() - startedAt,
      } satisfies ReticulumResourceWorkerResult);
      return;
    }
    parentPort?.postMessage({
      id: task.id,
      kind: task.kind,
      ok: true,
      hash: finalizeReticulumResource(task),
      durationMs: Date.now() - startedAt,
    } satisfies ReticulumResourceWorkerResult);
  } catch (error) {
    parentPort?.postMessage({
      id: task.id,
      kind: task.kind,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    } satisfies ReticulumResourceWorkerResult);
  }
});
