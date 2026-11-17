import { SHOT_LIMITS } from './appPageData';

/**
 * Pictures for an app's page are re-encoded in the renderer: WebP, at most
 * SHOT_LIMITS.maxSide on the longest side. Drawing them on a canvas also drops
 * everything but the pixels (camera data, location, names).
 */

export interface EncodedImage {
  blob: Blob;
  width: number;
  height: number;
}

export const fitInside = (width: number, height: number, maxSide: number) => {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('IMAGE_ENCODE'))),
      type,
      quality
    );
  });

const loadBitmap = async (source: Blob): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(source);
  } catch {
    throw new Error('IMAGE_UNREADABLE');
  }
};

/** A screenshot as WebP that fits SHOT_LIMITS.maxSide. */
export const encodeScreenshot = async (
  source: Blob,
  maxSide = SHOT_LIMITS.maxSide,
  quality = 0.86
): Promise<EncodedImage> => {
  const bitmap = await loadBitmap(source);
  const { width, height } = fitInside(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('IMAGE_ENCODE');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await canvasToBlob(canvas, 'image/webp', quality);
  return { blob, width, height };
};

/** An app icon: the middle square of the picture, `size` pixels, WebP. */
export const encodeSquareIcon = async (
  source: Blob,
  size = 256
): Promise<Blob> => {
  const bitmap = await loadBitmap(source);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  const target = Math.min(size, side);
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('IMAGE_ENCODE');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    target,
    target
  );
  bitmap.close?.();
  return canvasToBlob(canvas, 'image/webp', 0.9);
};

/** Accepted picture files for screenshots and icons. */
export const IMAGE_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
