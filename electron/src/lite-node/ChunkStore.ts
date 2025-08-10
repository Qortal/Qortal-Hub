// ChunkStore.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import bs58 from 'bs58';

export type SaveResult = {
  filePath: string;
  hash58: string;
  existed: boolean; // true if we found it already saved
};

export class ChunkStore {
  constructor(private dataPath: string) {
    if (!dataPath) throw new Error('dataPath is required');
  }

  /** base58(SHA-256(data)) */
  computeHash58(data: Buffer): string {
    const hash = crypto.createHash('sha256').update(data).digest();
    return bs58.encode(hash);
  }

  /** Same directory scheme as core’s getOutputFilePath(...) */
  async buildOutputPath(
    hash58: string,
    signature?: Buffer | null,
    create = true
  ): Promise<string> {
    if (!hash58) throw new Error('hash58 is required');

    let dir: string;
    if (signature && signature.length === 64) {
      const sig58 = bs58.encode(signature);
      const p1 = sig58.slice(0, 2).toLowerCase();
      const p2 = sig58.slice(2, 4).toLowerCase();
      dir = path.join(this.dataPath, p1, p2, sig58);
    } else {
      const h1 = hash58.slice(0, 2).toLowerCase();
      const h2 = hash58.slice(2, 4).toLowerCase();
      dir = path.join(this.dataPath, '_misc', h1, h2);
    }

    if (create) await fs.mkdir(dir, { recursive: true });
    return path.join(dir, hash58);
  }

  /** Quick check without throwing */
  async hasChunk(hash58: string, signature?: Buffer | null): Promise<boolean> {
    const filePath = await this.buildOutputPath(hash58, signature, false).catch(
      () => null
    );
    if (!filePath) return false;
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /** Save to temp file (like Java’s createTempFile). Returns temp file path. */
  async writeTemp(hash58: string, data: Buffer): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qortalRawData-'));
    const filePath = path.join(tmpDir, hash58);
    await fs.writeFile(filePath, data);
    return filePath;
  }

  /**
   * Save chunk. If it already exists, we don’t rewrite it.
   * If useTemp=true, write to a temp file first (you can move later).
   */
  async saveChunk(
    data: Buffer,
    signature?: Buffer | null,
    opts?: { useTemp?: boolean; expectedHash58?: string }
  ): Promise<SaveResult> {
    const useTemp = opts?.useTemp ?? false;

    const hash58 = opts?.expectedHash58 ?? this.computeHash58(data);
    if (opts?.expectedHash58 && opts.expectedHash58 !== hash58) {
      throw new Error(
        `hash mismatch: expected ${opts.expectedHash58} got ${hash58}`
      );
    }

    // Where the final file would live
    const finalPath = await this.buildOutputPath(hash58, signature, !useTemp);

    // Dedupe: if exists, bail early
    const existed = await this.hasChunk(hash58, signature);
    if (existed) {
      return { filePath: finalPath, hash58, existed: true };
    }

    if (useTemp) {
      const tempPath = await this.writeTemp(hash58, data);
      return { filePath: tempPath, hash58, existed: false };
    }

    // Direct write
    try {
      await fs.writeFile(finalPath, data);
      return { filePath: finalPath, hash58, existed: false };
    } catch (e: any) {
      // Try to remove partial file
      try {
        await fs.unlink(finalPath);
      } catch {}
      throw new Error(`Unable to write data with hash ${hash58}: ${e.message}`);
    }
  }

  /** Move a temp-saved chunk into its final signature-based location */
  async finalizeTemp(
    tempPath: string,
    hash58: string,
    signature?: Buffer | null
  ): Promise<string> {
    const finalPath = await this.buildOutputPath(hash58, signature, true);

    // If another process already wrote the final file, drop temp to avoid dup
    const alreadyThere = await this.hasChunk(hash58, signature);
    if (alreadyThere) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      return finalPath;
    }

    await fs.rename(tempPath, finalPath);
    return finalPath;
  }
}
