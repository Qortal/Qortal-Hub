import { parentPort } from 'worker_threads';

// This worker is unpacked from app.asar so Node can execute it directly.
// Avoid emitted tslib helpers, which are not resolvable from that location.
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

function loadSharp(): typeof import('sharp') {
  if (__dirname.includes('app.asar.unpacked')) {
    const packedBuildDir = __dirname.replace('app.asar.unpacked', 'app.asar');
    return require(
      path.join(packedBuildDir, '..', '..', 'node_modules', 'sharp')
    ) as typeof import('sharp');
  }
  return require('sharp') as typeof import('sharp');
}

const sharp = loadSharp();

export type ReticulumMediaWorkerTask = {
  id: number;
  kind: 'gif_to_webp';
  inputPath: string;
  outputPath: string;
  targetBytes: number;
};

export type ReticulumMediaWorkerTaskInput = Omit<
  ReticulumMediaWorkerTask,
  'id'
>;

export type ReticulumMediaWorkerResult =
  | {
      id: number;
      kind: ReticulumMediaWorkerTask['kind'];
      ok: true;
      durationMs: number;
      outputPath: string;
      sizeBytes: number;
      width: number;
      height: number;
      pages: number;
      targetAchieved: boolean;
    }
  | {
      id: number;
      kind: ReticulumMediaWorkerTask['kind'];
      ok: false;
      durationMs: number;
      error: string;
    };

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MIN_TARGET_BYTES = 128 * 1024;
const MAX_TARGET_BYTES = 4 * 1024 * 1024;

const WEBP_PROFILES = [
  { maxDimension: 960, quality: 76, alphaQuality: 82 },
  { maxDimension: 800, quality: 68, alphaQuality: 74 },
  { maxDimension: 720, quality: 60, alphaQuality: 68 },
  { maxDimension: 640, quality: 52, alphaQuality: 60 },
  { maxDimension: 540, quality: 46, alphaQuality: 54 },
  { maxDimension: 480, quality: 40, alphaQuality: 48 },
  { maxDimension: 400, quality: 34, alphaQuality: 42 },
  { maxDimension: 320, quality: 28, alphaQuality: 36 },
] as const;

sharp.concurrency(1);
sharp.cache({ files: 0, items: 8, memory: 32 });

const removeIfPresent = async (filePath: string) => {
  await fs.promises.unlink(filePath).catch(() => undefined);
};

export async function convertAnimatedGifToWebp(
  task: ReticulumMediaWorkerTask
): Promise<
  Omit<
    Extract<ReticulumMediaWorkerResult, { ok: true }>,
    'id' | 'kind' | 'ok' | 'durationMs'
  >
> {
  const inputPath = path.resolve(task.inputPath);
  const outputPath = path.resolve(task.outputPath);
  if (inputPath === outputPath)
    throw new Error('Input and output paths must differ');

  const inputStat = await fs.promises.stat(inputPath);
  if (!inputStat.isFile()) throw new Error('GIF input is not a file');
  if (inputStat.size <= 0 || inputStat.size > MAX_INPUT_BYTES) {
    throw new Error('GIF input size is unsupported');
  }

  const metadata = await sharp(inputPath, {
    animated: true,
    failOn: 'error',
    limitInputPixels: 300_000_000,
  }).metadata();
  if (metadata.format !== 'gif') throw new Error('Selected file is not a GIF');

  const targetBytes = Math.min(
    MAX_TARGET_BYTES,
    Math.max(MIN_TARGET_BYTES, Math.floor(task.targetBytes))
  );
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  let best:
    | {
        attemptPath: string;
        sizeBytes: number;
        width: number;
        height: number;
        pages: number;
      }
    | undefined;
  const attemptPaths: string[] = [];

  try {
    for (const [index, profile] of WEBP_PROFILES.entries()) {
      const attemptPath = `${outputPath}.${index}.webp`;
      attemptPaths.push(attemptPath);
      const result = await sharp(inputPath, {
        animated: true,
        failOn: 'error',
        limitInputPixels: 300_000_000,
      })
        .resize({
          width: profile.maxDimension,
          height: profile.maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          alphaQuality: profile.alphaQuality,
          effort: 3,
          loop: metadata.loop ?? 0,
          ...(metadata.delay?.length ? { delay: metadata.delay } : {}),
          quality: profile.quality,
          smartSubsample: true,
        })
        .toFile(attemptPath);

      const candidate = {
        attemptPath,
        sizeBytes: result.size,
        width: result.width,
        height: result.pageHeight || result.height,
        pages: result.pages || metadata.pages || 1,
      };
      if (!best || candidate.sizeBytes < best.sizeBytes) best = candidate;
      if (candidate.sizeBytes <= targetBytes) {
        best = candidate;
        break;
      }
    }

    if (!best) throw new Error('Animated WebP conversion produced no output');
    await removeIfPresent(outputPath);
    await fs.promises.rename(best.attemptPath, outputPath);
    return {
      outputPath,
      sizeBytes: best.sizeBytes,
      width: best.width,
      height: best.height,
      pages: best.pages,
      targetAchieved: best.sizeBytes <= targetBytes,
    };
  } finally {
    await Promise.all(attemptPaths.map(removeIfPresent));
  }
}

parentPort?.on('message', async (task: ReticulumMediaWorkerTask) => {
  const startedAt = Date.now();
  try {
    const result = await convertAnimatedGifToWebp(task);
    parentPort?.postMessage({
      id: task.id,
      kind: task.kind,
      ok: true,
      durationMs: Date.now() - startedAt,
      ...result,
    } satisfies ReticulumMediaWorkerResult);
  } catch (error) {
    parentPort?.postMessage({
      id: task.id,
      kind: task.kind,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ReticulumMediaWorkerResult);
  }
});
