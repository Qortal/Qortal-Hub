import * as fs from 'fs';
import * as nodeCrypto from 'crypto';
import * as path from 'path';

const openSessionDirectory =
  `qortal-reticulum-opened-${process.pid}-` +
  nodeCrypto.randomBytes(6).toString('hex');

export function safeReticulumOpenFileName(
  fileHash: string,
  suggestedFileName?: string,
  fallbackFileName = 'attachment.bin'
): string {
  const source =
    String(suggestedFileName || fallbackFileName || 'attachment.bin')
      .replace(/\\/g, '/')
      .split('/')
      .pop() || 'attachment.bin';
  let cleaned = source
    .replace(/[<>:"/\\|?*]/g, '_')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!cleaned) cleaned = 'attachment.bin';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) {
    cleaned = `_${cleaned}`;
  }
  const extension = path.extname(cleaned).slice(0, 24);
  const stem = path.basename(cleaned, extension).slice(0, 120) || 'attachment';
  const hashSuffix =
    String(fileHash || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-f0-9]/g, '')
      .slice(0, 12) || nodeCrypto.randomBytes(6).toString('hex');
  return `${stem}-${hashSuffix}${extension}`;
}

export async function materializeReticulumResourceForOpen(options: {
  sourcePath: string;
  tempRoot: string;
  fileHash: string;
  suggestedFileName?: string;
  fallbackFileName?: string;
}): Promise<string> {
  const sourceStat = await fs.promises.stat(options.sourcePath);
  if (!sourceStat.isFile())
    throw new Error('Verified attachment is not a file');
  const destinationDirectory = path.join(
    options.tempRoot,
    openSessionDirectory
  );
  await fs.promises.mkdir(destinationDirectory, {
    mode: 0o700,
    recursive: true,
  });
  const destinationPath = path.join(
    destinationDirectory,
    safeReticulumOpenFileName(
      options.fileHash,
      options.suggestedFileName,
      options.fallbackFileName
    )
  );
  const existingStat = await fs.promises
    .stat(destinationPath)
    .catch(() => null);
  if (existingStat?.isFile() && existingStat.size === sourceStat.size) {
    return destinationPath;
  }
  const temporaryPath = `${destinationPath}.${nodeCrypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.copyFile(options.sourcePath, temporaryPath);
    await fs.promises.chmod(temporaryPath, 0o444).catch(() => undefined);
    try {
      await fs.promises.rename(temporaryPath, destinationPath);
      return destinationPath;
    } catch (error) {
      const racedDestination = await fs.promises
        .stat(destinationPath)
        .catch(() => null);
      if (
        racedDestination?.isFile() &&
        racedDestination.size === sourceStat.size
      ) {
        return destinationPath;
      }
      throw error;
    }
  } finally {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);
  }
}
