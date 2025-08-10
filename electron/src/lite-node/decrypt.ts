// decrypt2.ts
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline as pipelineCb } from 'stream';
import { promisify } from 'util';
import crypto from 'crypto';
import bs58 from 'bs58';

const pipeline = promisify(pipelineCb);

export const AES256_LENGTH = 32 as const;

type JavaAlgo = 'AES/CBC/PKCS5Padding' | 'AES';

function resolveNodeCipher2(
  javaAlgo: JavaAlgo
): crypto.CipherGCMTypes | crypto.CipherCCMTypes | string {
  switch (javaAlgo) {
    case 'AES/CBC/PKCS5Padding':
      return 'aes-256-cbc'; // PKCS5==PKCS7
    case 'AES':
      return 'aes-256-ecb'; // legacy fallback
    default:
      throw new Error(`Unsupported algorithm: ${javaAlgo}`);
  }
}

/**
 * Decrypt a file where the first 16 bytes are the IV.
 * For ECB (legacy), we still skip those 16 bytes for parity with Java.
 */
export async function decryptFile2(
  javaAlgorithm: JavaAlgo,
  keyBytes: Uint8Array | Buffer,
  encryptedFilePath: string,
  decryptedFilePath: string
): Promise<void> {
  const key = Buffer.isBuffer(keyBytes) ? keyBytes : Buffer.from(keyBytes);
  if (key.length !== AES256_LENGTH) {
    throw new Error(`AES key must be ${AES256_LENGTH} bytes`);
  }

  // Ensure output dir exists
  const parent = path.dirname(decryptedFilePath);
  await fsp.mkdir(parent, { recursive: true });

  const fd = await fsp.open(encryptedFilePath, 'r');
  try {
    // Read IV from first 16 bytes
    const iv = Buffer.alloc(16);
    const { bytesRead } = await fd.read(iv, 0, 16, 0);
    if (bytesRead !== 16)
      throw new Error('Encrypted file too short (missing IV)');

    const nodeCipher = resolveNodeCipher2(javaAlgorithm);
    const decipher =
      nodeCipher === 'aes-256-ecb'
        ? crypto.createDecipheriv(nodeCipher, key, null) // ECB ignores IV
        : crypto.createDecipheriv(nodeCipher, key, iv);

    const readStream = fs.createReadStream(encryptedFilePath, { start: 16 });
    const writeStream = fs.createWriteStream(decryptedFilePath);

    await pipeline(readStream, decipher, writeStream);
  } finally {
    await fd.close();
  }
}

export interface DecryptWithFallbackOptions {
  /** Base58-encoded 32-byte AES key (from tx.secret) */
  secretB58?: string | null;
  /** Path to the encrypted file (IV stored in first 16 bytes) */
  encryptedPath: string;
  /** Working directory where decrypted output should be written (to "zipped.zip") */
  workingDir: string;
}

/**
 * High-level helper matching the Java flow:
 * - If no/invalid secret → returns null (assume unencrypted)
 * - Try "AES/CBC/PKCS5Padding"
 * - On failure, try "AES" (ECB)
 * - On success, returns the decrypted path: `${workingDir}/zipped.zip`
 */
export async function decryptWithFallback2(
  opts: DecryptWithFallbackOptions
): Promise<string | null> {
  const { secretB58, encryptedPath, workingDir } = opts;

  const secret = secretB58 ? Buffer.from(bs58.decode(secretB58)) : null;
  if (!secret || secret.length !== AES256_LENGTH) {
    // No valid secret → assume unencrypted (same behavior as Java comment)
    return null;
  }

  const outPath = path.join(workingDir, 'zipped.zip');

  // 1) Try CBC
  try {
    await decryptFile2('AES/CBC/PKCS5Padding', secret, encryptedPath, outPath);
    return outPath;
  } catch (e1) {
    // 2) Fallback to legacy ECB
    try {
      await decryptFile2('AES', secret, encryptedPath, outPath);
      return outPath;
    } catch (e2) {
      const message = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(
        `Unable to decrypt "${encryptedPath}" using CBC or ECB: ${message}`
      );
    }
  }
}
