import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CompressorOptions = { success: (result: Blob) => void };

// Compressor.js keeps its input when re-encoding would make it bigger (and a
// browser that cannot decode the format never gets as far as re-encoding).
vi.mock('compressorjs', () => ({
  default: class {
    constructor(file: Blob, opts: CompressorOptions) {
      opts.success(file);
    }
  },
}));

import { compressImageFile } from '../../../utils/imageCompression';
import { encodeImageForPost } from './quitterPublish';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      resolve(__dirname, '../../../utils/__fixtures__/media-metadata', name)
    )
  );

const decoded = (base64: string) =>
  Buffer.from(base64, 'base64').toString('latin1');

/** A HEIC-shaped file: ftyp heic, then a meta box holding "GPS". */
const heic = () => {
  const bytes = Buffer.alloc(96);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftypheic\0\0\0\0mif1heic', 4, 'latin1');
  bytes.writeUInt32BE(72, 24);
  bytes.write('meta', 28, 'latin1');
  bytes.write('GPSSECRET', 40, 'latin1');
  return new File([bytes], 'IMG_0001.HEIC', { type: 'image/heic' });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('encodeImageForPost (Torq photos)', () => {
  it('strips anything a photo still carries before it is published', async () => {
    const photo = new File([fixture('phone-exif-gps.jpg')], 'IMG_1.jpg', {
      type: 'image/jpeg',
    });
    const body = decoded(await encodeImageForPost(photo, 0));
    expect(body.startsWith('\xff\xd8')).toBe(true);
    expect(body).not.toContain('GPSSECRET');
    expect(body).not.toContain('PrivateModel');
  });

  it('publishes a clean photo and a GIF exactly as they are', async () => {
    const clean = fixture('clean.jpg');
    expect(await encodeImageForPost(new File([clean], 'a.jpg'), 0)).toBe(
      Buffer.from(clean).toString('base64')
    );
    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'latin1'),
      Buffer.alloc(40),
    ]);
    expect(await encodeImageForPost(new Blob([gif]), 1)).toBe(
      gif.toString('base64')
    );
  });

  it('refuses a photo whose metadata could not be removed (HEIC)', async () => {
    // What compressImageFile hands back when the format cannot be decoded:
    // the untouched original.
    const prepared = await compressImageFile(heic(), {
      first: { quality: 0.75, maxWidth: 1920, mimeType: 'image/webp' },
      fallback: { quality: 0.72, maxWidth: 1920, mimeType: 'image/jpeg' },
    });
    await expect(encodeImageForPost(prepared, 0)).rejects.toThrow(
      /location and camera details/
    );
  });

  it('refuses an empty image', async () => {
    await expect(encodeImageForPost(new Blob([]), 2)).rejects.toThrow(
      'Image 3 is invalid for publish (0 bytes)'
    );
  });
});
