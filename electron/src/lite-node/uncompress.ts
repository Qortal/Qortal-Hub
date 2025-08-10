// uncompress2.ts
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';

export enum Compression2 {
  ZIP = 'ZIP',
  NONE = 'NONE',
}

export interface UncompressOpts2 {
  /** Path to the file/dir we’re operating on (like this.filePath in Java) */
  filePath: string;
  /** Final uncompressed directory path (like this.uncompressedPath in Java) */
  uncompressedPath: string;
  /** Compression type; if unknown, use ZIP for previews (matches Java default) */
  compression?: Compression2;
  /** Called when filePath is already a directory (Java: moveFilePathToFinalDestination) */
  moveFilePathToFinalDestination: () => Promise<void> | void;
  /** Optional: directories we consider “inside data or temp” for safe deletion */
  safeDeleteRoots?: string[]; // e.g., [appDataDir, os.tmpdir()]
}

/** Basic containment check to mirror FilesystemUtils.pathInsideDataOrTempPath(...) */
function pathInsideAny2(p: string, roots: string[] = []): boolean {
  const ap = path.resolve(p);
  return roots.some((root) => {
    const ar = path.resolve(root);
    return ap === ar || ap.startsWith(ar + path.sep);
  });
}

/** unzip: similar behavior to Java’s ZipUtils.unzip(sourcePath, destPath) */
async function unzip2(sourcePath: string, destPath: string): Promise<void> {
  // ensure dest dir
  await fsp.mkdir(destPath, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(sourcePath)
      .pipe(unzipper.Extract({ path: destPath }))
      .on('close', () => resolve())
      .on('error', reject);
  });
}

/**
 * Port of the Java uncompress():
 * - Ensures filePath exists
 * - If filePath is a directory -> just call moveFilePathToFinalDestination()
 * - Else:
 *   - compression ZIP => unzip
 *   - compression NONE => move file to `${uncompressedPath}/data`
 * - Verifies uncompressedPath exists
 * - Deletes original compressed file if inside safeDeleteRoots
 * - Replaces "filePath" with "uncompressedPath" (returned)
 */
export async function uncompress2(opts: UncompressOpts2): Promise<string> {
  const {
    filePath,
    uncompressedPath,
    compression = Compression2.ZIP, // default to ZIP (like Java)
    moveFilePathToFinalDestination,
    safeDeleteRoots = [],
  } = opts;

  // Guard: must exist
  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    throw new Error(`Can't uncompress non-existent file path: ${filePath}`);
  }

  const stat = await fsp.stat(filePath);
  if (stat.isDirectory()) {
    // Already a directory - nothing to uncompress
    await Promise.resolve(moveFilePathToFinalDestination());
    return uncompressedPath; // acts like "this.filePath = this.uncompressedPath"
  }

  try {
    if (compression === Compression2.ZIP) {
      // Java unzips into parent of uncompressedPath, then expects uncompressedPath to exist after.
      // To keep it simple & predictable, we unzip directly into uncompressedPath’s parent,
      // assuming the ZIP entries create the final folder structure including uncompressedPath.
      const destParent = path.dirname(uncompressedPath);
      await unzip2(filePath, destParent);
    } else if (compression === Compression2.NONE) {
      // Ensure target dir exists, then move file to <uncompressedPath>/data
      await fsp.mkdir(uncompressedPath, { recursive: true });
      const finalPath = path.join(uncompressedPath, 'data');
      // Try rename (fast), fallback to copy
      try {
        await fsp.rename(filePath, finalPath);
      } catch {
        await fsp.copyFile(filePath, finalPath);
      }
    } else {
      throw new Error(`Unrecognized compression type: ${compression}`);
    }
  } catch (e: any) {
    throw new Error(`Unable to unzip file: ${e?.message ?? String(e)}`);
  }

  // Verify uncompressedPath exists
  try {
    const st = await fsp.stat(uncompressedPath);
    if (!st.isDirectory()) {
      throw new Error(
        `Uncompressed path is not a directory: ${uncompressedPath}`
      );
    }
  } catch {
    throw new Error(
      `Unable to unzip file: expected ${uncompressedPath} to exist`
    );
  }

  // Delete original compressed file if inside safe roots (like FilesystemUtils check)
  try {
    if (pathInsideAny2(filePath, safeDeleteRoots)) {
      await fsp.unlink(filePath).catch(() => {
        /* non-fatal */
      });
    }
  } catch {
    // ignore failures (non-essential step)
  }

  // Return the new "filePath" (Java sets this.filePath = this.uncompressedPath)
  return uncompressedPath;
}
