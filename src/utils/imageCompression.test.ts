import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CompressorOptions = {
  mimeType: string;
  success: (result: Blob) => void;
  error: (err: Error) => void;
};

// Compressor.js needs a real canvas; tests decide what it "produces".
const compressor = vi.hoisted(() => ({
  run: null as null | ((file: Blob, opts: CompressorOptions) => void),
  calls: 0,
}));

vi.mock('compressorjs', () => ({
  default: class {
    constructor(file: Blob, opts: CompressorOptions) {
      compressor.calls += 1;
      compressor.run?.(file, opts);
    }
  },
}));

import { compressImageFile, ensureImageMetadataFree } from './imageCompression';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(resolve(__dirname, '__fixtures__/media-metadata', name))
  );

const readBytes = async (blob: Blob) =>
  new Uint8Array(
    await new Promise<ArrayBuffer>((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result as ArrayBuffer);
      reader.onerror = () => fail(reader.error);
      reader.readAsArrayBuffer(blob);
    })
  );

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const expectClean = async (file: Blob) => {
  const body = latin1(await readBytes(file));
  for (const secret of [
    'GPSSECRET',
    'PrivateModel',
    'SecretPhoneCo',
    'xmpmeta',
  ]) {
    expect(body).not.toContain(secret);
  }
};

const photo = () =>
  new File([fixture('phone-exif-gps.jpg')], 'IMG_0001.jpg', {
    type: 'image/jpeg',
  });

const quitterOptions = {
  thresholdBytes: 5 * 1024 * 1024,
  first: { quality: 0.72, maxWidth: 1920, mimeType: 'image/webp' },
  fallback: { quality: 0.65, maxWidth: 1600, mimeType: 'image/jpeg' },
};

beforeEach(() => {
  compressor.run = null;
  compressor.calls = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('compressImageFile and photo metadata', () => {
  it('publishes a photo under the threshold without its EXIF/GPS (no re-encode)', async () => {
    const source = photo();
    const out = await compressImageFile(source, quitterOptions);
    expect(compressor.calls).toBe(0);
    expect(out.name).toBe('IMG_0001.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBeLessThan(source.size);
    await expectClean(out);
  });

  it('keeps the stripped original when the re-encode is not smaller', async () => {
    compressor.run = (_file, opts) =>
      opts.success(new Blob([new Uint8Array(50_000)], { type: opts.mimeType }));
    const source = photo();
    const out = await compressImageFile(source, {
      first: quitterOptions.first,
    });
    expect(compressor.calls).toBe(1);
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBeLessThan(source.size);
    await expectClean(out);
  });

  it('does not mistake Compressor.js handing back its input for a re-encode', async () => {
    // Strict mode returns the original when re-encoding would be bigger.
    compressor.run = (file, opts) => opts.success(file);
    const out = await compressImageFile(photo(), {
      first: quitterOptions.first,
    });
    await expectClean(out);
  });

  it('strips the original when compression fails outright', async () => {
    compressor.run = (_file, opts) => opts.error(new Error('no webp'));
    const out = await compressImageFile(photo(), {
      first: quitterOptions.first,
      fallback: quitterOptions.fallback,
    });
    expect(compressor.calls).toBe(2);
    expect(out.name).toBe('IMG_0001.jpg');
    await expectClean(out);
  });

  it('still returns a smaller re-encode unchanged', async () => {
    const encoded = new Blob([new Uint8Array(400)], { type: 'image/webp' });
    compressor.run = (_file, opts) => opts.success(encoded);
    const out = await compressImageFile(photo(), {
      first: quitterOptions.first,
    });
    expect(out.size).toBe(400);
    expect(out.type).toBe('image/webp');
    expect(out.name).toBe('IMG_0001.webp');
  });

  it('re-encodes formats it cannot strip losslessly, even when not smaller', async () => {
    const avif = new File(
      [
        Uint8Array.from([
          0x00,
          0x00,
          0x00,
          0x1c,
          0x66,
          0x74,
          0x79,
          0x70,
          0x61,
          0x76,
          0x69,
          0x66,
          ...new Array(100).fill(7),
        ]),
      ],
      'shot.avif',
      { type: 'image/avif' }
    );
    const encoded = new Blob([new Uint8Array(900)], { type: 'image/webp' });
    compressor.run = (_file, opts) => opts.success(encoded);
    const out = await compressImageFile(avif, quitterOptions);
    expect(compressor.calls).toBe(1);
    expect(out.type).toBe('image/webp');
    expect(out.size).toBe(900);
  });

  it('leaves GIFs and non-images alone', async () => {
    const gif = new File([Uint8Array.from([0x47, 0x49, 0x46, 0x38])], 'a.gif', {
      type: 'image/gif',
    });
    expect(await compressImageFile(gif, quitterOptions)).toBe(gif);
    const pdf = new File([new Uint8Array(10)], 'a.pdf', {
      type: 'application/pdf',
    });
    expect(await compressImageFile(pdf, quitterOptions)).toBe(pdf);
  });
});

describe('ensureImageMetadataFree', () => {
  it('hands back a stripped copy, or the same Blob when already clean', async () => {
    const cleaned = await ensureImageMetadataFree(photo());
    if (cleaned.ok === false) throw new Error(cleaned.reason);
    expect(cleaned.file.type).toBe('image/jpeg');
    await expectClean(cleaned.file);

    const clean = new Blob([fixture('clean.webp')], { type: 'image/webp' });
    expect(await ensureImageMetadataFree(clean)).toEqual({
      ok: true,
      file: clean,
    });
    const gif = new Blob([Buffer.from('GIF87a\0\0\0\0', 'latin1')]);
    expect(await ensureImageMetadataFree(gif)).toEqual({ ok: true, file: gif });
  });

  it('reports formats and files it cannot vouch for', async () => {
    const heif = Buffer.alloc(32);
    heif.writeUInt32BE(24, 0);
    heif.write('ftypheic', 4, 'latin1');
    expect(await ensureImageMetadataFree(new Blob([heif]))).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    const cut = fixture('phone-exif-gps.jpg').subarray(0, 100);
    expect(await ensureImageMetadataFree(new Blob([cut]))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
