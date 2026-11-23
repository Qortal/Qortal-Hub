/**
 * Covers, hover frames and thumbnails as WebP, from the JPEG frames the
 * engine cuts (or a picture the user picks), at each app's settings:
 *
 * - Q-Tube cover (`videoImage`): quality 0.6, at most 1200 px wide;
 * - hover frames (`extracts`): quality 0.8, at most 750 px wide;
 * - Q-Share thumbnail: at most 640 px wide and 200 KB;
 * - Subscreen poster: the cover cropped to 2:3 (Subscreen shows it upright).
 *
 * Drawn on a canvas directly rather than through compressImageFile, which
 * hands back the original (a JPEG, uncropped) whenever the WebP comes out
 * bigger: these must always be WebP, at a known size.
 */
import { VideoPublishError } from './errors';
import { dataUrlBase64, dataUrlMimeType, base64ToBytes } from './encoding';

export type CropRect = { sx: number; sy: number; sw: number; sh: number };
export type Size = { width: number; height: number };

export type WebpOptions = {
  maxWidth: number;
  maxHeight?: number;
  quality: number;
  /** Crop to this width/height ratio around the centre first (2/3). */
  cropAspect?: number;
};

/** A decoded picture that can be drawn into WebPs. */
export type DecodedImage = Size & {
  encode(crop: CropRect, size: Size, quality: number): Promise<Blob>;
  close(): void;
};

export type ImageBackend = { decode(source: Blob): Promise<DecodedImage> };

export const COVER_SETTINGS: WebpOptions = { maxWidth: 1200, quality: 0.6 };
export const EXTRACT_SETTINGS: WebpOptions = { maxWidth: 750, quality: 0.8 };
export const POSTER_ASPECT = 2 / 3;
export const QSHARE_THUMBNAIL_MAX_WIDTH = 640;
export const QSHARE_THUMBNAIL_MAX_BYTES = 200 * 1024;
const QSHARE_THUMBNAIL_STEPS: readonly WebpOptions[] = [
  { maxWidth: 640, quality: 0.8 },
  { maxWidth: 640, quality: 0.7 },
  { maxWidth: 640, quality: 0.6 },
  { maxWidth: 640, quality: 0.5 },
  { maxWidth: 480, quality: 0.5 },
  { maxWidth: 320, quality: 0.5 },
];

/** The size that fits the box, never enlarged, at least 1 px each way. */
export function fitWithin(
  size: Size,
  maxWidth: number,
  maxHeight = Infinity
): Size {
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** The largest centred rectangle of the given width/height ratio. */
export function centerCrop(size: Size, aspect: number): CropRect {
  if (size.width / size.height > aspect) {
    const sw = Math.max(1, Math.round(size.height * aspect));
    return {
      sx: Math.round((size.width - sw) / 2),
      sy: 0,
      sw,
      sh: size.height,
    };
  }
  const sh = Math.max(1, Math.round(size.width / aspect));
  return { sx: 0, sy: Math.round((size.height - sh) / 2), sw: size.width, sh };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = dataUrlBase64(dataUrl);
  if (!base64) throw new VideoPublishError('image-unreadable');
  try {
    return new Blob([base64ToBytes(base64)], {
      type: dataUrlMimeType(dataUrl) || 'application/octet-stream',
    });
  } catch (error) {
    throw new VideoPublishError('image-unreadable', undefined, {
      cause: error,
    });
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(
        new VideoPublishError('image-unreadable', undefined, {
          cause: reader.error,
        })
      );
    reader.readAsDataURL(blob);
  });
}

/** Chromium's canvas; Electron's renderer always encodes WebP. */
export const canvasImageBackend: ImageBackend = {
  async decode(source) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(source);
    } catch (error) {
      throw new VideoPublishError('image-unreadable', undefined, {
        cause: error,
      });
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      async encode(crop, size, quality) {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new VideoPublishError('image-encode-failed');
        context.imageSmoothingQuality = 'high';
        context.drawImage(
          bitmap,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          0,
          0,
          size.width,
          size.height
        );
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', quality)
        );
        // A browser without a WebP encoder silently answers with PNG.
        if (!blob || blob.type !== 'image/webp') {
          throw new VideoPublishError('image-encode-failed', blob?.type);
        }
        return blob;
      },
      close() {
        bitmap.close();
      },
    };
  },
};

const asBlob = (source: Blob | string): Blob =>
  typeof source === 'string' ? dataUrlToBlob(source) : source;

async function withDecoded<T>(
  source: Blob | string,
  backend: ImageBackend,
  use: (image: DecodedImage) => Promise<T>
): Promise<T> {
  const image = await backend.decode(asBlob(source));
  try {
    if (!(image.width > 0 && image.height > 0)) {
      throw new VideoPublishError('image-unreadable');
    }
    return await use(image);
  } finally {
    image.close();
  }
}

function encodeDecoded(image: DecodedImage, options: WebpOptions) {
  const crop = options.cropAspect
    ? centerCrop(image, options.cropAspect)
    : { sx: 0, sy: 0, sw: image.width, sh: image.height };
  const size = fitWithin(
    { width: crop.sw, height: crop.sh },
    options.maxWidth,
    options.maxHeight
  );
  return image.encode(crop, size, options.quality);
}

export function toWebp(
  source: Blob | string,
  options: WebpOptions,
  backend: ImageBackend = canvasImageBackend
): Promise<Blob> {
  return withDecoded(source, backend, (image) => encodeDecoded(image, options));
}

export async function toWebpDataUrl(
  source: Blob | string,
  options: WebpOptions,
  backend: ImageBackend = canvasImageBackend
): Promise<string> {
  return blobToDataUrl(await toWebp(source, options, backend));
}

/** The cover (`videoImage`); `poster` crops it to 2:3 for Subscreen. */
export function makeCover(
  source: Blob | string,
  { poster = false }: { poster?: boolean } = {},
  backend: ImageBackend = canvasImageBackend
): Promise<string> {
  return toWebpDataUrl(
    source,
    { ...COVER_SETTINGS, ...(poster ? { cropAspect: POSTER_ASPECT } : {}) },
    backend
  );
}

/** Hover frames (`extracts`): the first four. */
export async function makeExtracts(
  frames: readonly (Blob | string)[],
  backend: ImageBackend = canvasImageBackend
): Promise<string[]> {
  const out: string[] = [];
  for (const frame of frames.slice(0, 4)) {
    out.push(await toWebpDataUrl(frame, EXTRACT_SETTINGS, backend));
  }
  return out;
}

/** Q-Share's thumbnail: lower quality, then smaller, until within 200 KB. */
export async function makeQshareThumbnail(
  source: Blob | string,
  backend: ImageBackend = canvasImageBackend
): Promise<string> {
  const blob = await withDecoded(source, backend, async (image) => {
    for (const step of QSHARE_THUMBNAIL_STEPS) {
      const encoded = await encodeDecoded(image, step);
      if (encoded.size <= QSHARE_THUMBNAIL_MAX_BYTES) return encoded;
    }
    throw new VideoPublishError('image-too-large');
  });
  return blobToDataUrl(blob);
}

/** A base64 `data:image/…` URL, as the apps store covers and frames. */
export const isImageDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^data:image\/[\w.+-]+;base64,/.test(value);
