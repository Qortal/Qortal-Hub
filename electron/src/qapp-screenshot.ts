/**
 * Screenshots of a Q-App for its page in the library. The renderer shows the
 * app in a guest webview Hub prepared; the publisher moves around in it
 * themselves, and main captures that guest each time they ask. Main never
 * runs anything inside the app.
 */

/** Longest side of a captured image, in pixels. */
export const SHOT_MAX_SIDE = 1600;

export type ShotRequest = { action: 'capture' };

/** The request if it's one main understands, else null. */
export const parseShotRequest = (value: unknown): ShotRequest | null => {
  if (!value || typeof value !== 'object') return null;
  return (value as Record<string, unknown>).action === 'capture'
    ? { action: 'capture' }
    : null;
};

/** The size that keeps the aspect and fits `maxSide`. */
export const fitShotSize = (
  width: number,
  height: number,
  maxSide = SHOT_MAX_SIDE
) => {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

interface CapturableImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: {
    width?: number;
    height?: number;
    quality?: string;
  }): CapturableImage;
  toPNG(): Uint8Array;
}

export interface CapturedShot {
  png: Uint8Array;
  width: number;
  height: number;
}

/** The capture, shrunk to SHOT_MAX_SIDE, as PNG. */
export const encodeCapturedShot = (image: CapturableImage): CapturedShot => {
  if (image.isEmpty()) throw new Error('SHOT_EMPTY');
  const size = image.getSize();
  const target = fitShotSize(size.width, size.height);
  const resized =
    target.width === size.width && target.height === size.height
      ? image
      : image.resize({ ...target, quality: 'best' });
  const final = resized.getSize();
  return { png: resized.toPNG(), width: final.width, height: final.height };
};
