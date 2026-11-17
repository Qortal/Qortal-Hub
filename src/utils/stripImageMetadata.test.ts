import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildOrientationTiff,
  detectImageContainer,
  readTiffOrientation,
  stripImageMetadata,
} from './stripImageMetadata';

/*
 * Fixtures in __fixtures__/media-metadata were written by Pillow (plus a
 * hand-built EXIF block with GPS IFD and thumbnail, IPTC, a comment and a
 * Motion Photo style trailer) so the byte layouts are the real ones. Every
 * file carries the marker strings below; none may survive stripping. The
 * stripped files were also checked offline to decode to identical pixels
 * (Pillow, ImageMagick, ffmpeg).
 */
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(resolve(__dirname, '__fixtures__/media-metadata', name))
  );

const SECRETS = [
  'GPSSECRET',
  'PrivateModel',
  'SecretPhoneCo',
  '2026:09:30',
  'SecretCity',
  'Private Person',
  'xmpmeta',
  'ftypmp42',
];

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const expectNoSecrets = (bytes: Uint8Array) => {
  const body = text(bytes);
  for (const secret of SECRETS) expect(body).not.toContain(secret);
};

const strip = (bytes: Uint8Array) => {
  const result = stripImageMetadata(bytes);
  if (result.ok === false) throw new Error(`strip failed: ${result.reason}`);
  return result;
};

// --- independent little parsers for the assertions --------------------------

type JpegSegment = { marker: number; bytes: Uint8Array; payload: Uint8Array };

/** Header segments up to and including the first SOS. */
const jpegHeader = (bytes: Uint8Array): JpegSegment[] => {
  const out: JpegSegment[] = [];
  let p = 2;
  while (p < bytes.length) {
    const marker = bytes[p + 1];
    const length = (bytes[p + 2] << 8) | bytes[p + 3];
    out.push({
      marker,
      bytes: bytes.subarray(p, p + 2 + length),
      payload: bytes.subarray(p + 4, p + 2 + length),
    });
    if (marker === 0xda) break;
    p += 2 + length;
  }
  return out;
};

const countJpegMarkers = (bytes: Uint8Array, marker: number) => {
  let n = 0;
  for (let i = 0; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === marker) n += 1;
  }
  return n;
};

type PngChunk = {
  type: string;
  data: Uint8Array;
  crc: number;
  raw: Uint8Array;
};

const pngChunks = (bytes: Uint8Array): PngChunk[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: PngChunk[] = [];
  let p = 8;
  while (p < bytes.length) {
    const length = view.getUint32(p);
    const type = text(bytes.subarray(p + 4, p + 8));
    out.push({
      type,
      data: bytes.subarray(p + 8, p + 8 + length),
      crc: view.getUint32(p + 8 + length),
      raw: bytes.subarray(p, p + 12 + length),
    });
    p += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
};

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

type WebpChunk = { id: string; payload: Uint8Array; raw: Uint8Array };

const webpChunks = (bytes: Uint8Array): WebpChunk[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: WebpChunk[] = [];
  let p = 12;
  while (p < bytes.length) {
    const size = view.getUint32(p + 4, true);
    out.push({
      id: text(bytes.subarray(p, p + 4)),
      payload: bytes.subarray(p + 8, p + 8 + size),
      raw: bytes.subarray(p, p + 8 + size + (size & 1)),
    });
    p += 8 + size + (size & 1);
  }
  return out;
};

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

// -----------------------------------------------------------------------------

describe('detectImageContainer', () => {
  it('sniffs JPEG, PNG and WebP by magic bytes, not by name', () => {
    expect(detectImageContainer(fixture('phone-exif-gps.jpg'))).toBe('jpeg');
    expect(detectImageContainer(fixture('exif-text.png'))).toBe('png');
    expect(detectImageContainer(fixture('exif-xmp.webp'))).toBe('webp');
    expect(
      detectImageContainer(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))
    ).toBe(null);
  });
});

describe('EXIF orientation helpers', () => {
  it('round-trips a minimal orientation-only TIFF block', () => {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const tiff = buildOrientationTiff(orientation);
      expect(tiff.length).toBe(26);
      expect(readTiffOrientation(tiff)).toBe(orientation);
    }
  });

  it('reads little-endian blocks and treats junk as upright', () => {
    const little = Uint8Array.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01,
      0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ]);
    expect(readTiffOrientation(little)).toBe(6);
    const bogus = little.slice();
    bogus[18] = 9;
    expect(readTiffOrientation(bogus)).toBe(1);
    expect(readTiffOrientation(Uint8Array.from([1, 2, 3]))).toBe(1);
    expect(readTiffOrientation(little.subarray(0, 12))).toBe(1);
  });
});

describe('stripImageMetadata — JPEG', () => {
  it('drops EXIF (GPS, camera, time, thumbnail), XMP, IPTC, comments and the trailer', () => {
    const source = fixture('phone-exif-gps.jpg');
    const result = strip(source);

    expect(result.format).toBe('jpeg');
    expect(result.changed).toBe(true);
    expect(result.removed).toEqual([
      'APP1:Exif',
      'APP1:XMP',
      'APP13:Photoshop 3.0',
      'COM',
      'trailer',
    ]);
    expectNoSecrets(result.bytes);
    // Only one SOI/EOI pair is left: the EXIF thumbnail and the appended
    // Motion Photo data are gone.
    expect(countJpegMarkers(result.bytes, 0xd8)).toBe(1);
    expect(result.bytes[result.bytes.length - 2]).toBe(0xff);
    expect(result.bytes[result.bytes.length - 1]).toBe(0xd9);
  });

  it('keeps JFIF, the ICC profile and every image segment byte for byte', () => {
    const source = fixture('phone-exif-gps.jpg');
    const result = strip(source);
    const before = jpegHeader(source).filter(
      (s) => ![0xe1, 0xed, 0xfe].includes(s.marker)
    );
    const after = jpegHeader(result.bytes).filter(
      (s) => !(s.marker === 0xe1 && s.bytes.length === 36)
    );
    expect(after.map((s) => s.marker)).toEqual(before.map((s) => s.marker));
    after.forEach((segment, i) => {
      expect(sameBytes(segment.bytes, before[i].bytes)).toBe(true);
    });
    expect(text(after[1].payload).startsWith('ICC_PROFILE\0')).toBe(true);
  });

  it('writes back only the orientation, right after JFIF', () => {
    const result = strip(fixture('phone-exif-gps.jpg'));
    expect(result.orientation).toBe(6);
    const [jfif, app1] = jpegHeader(result.bytes);
    expect(jfif.marker).toBe(0xe0);
    expect(app1.marker).toBe(0xe1);
    expect(text(app1.payload.subarray(0, 6))).toBe('Exif\0\0');
    const tiff = app1.payload.subarray(6);
    expect(sameBytes(tiff, buildOrientationTiff(6))).toBe(true);
    expect(readTiffOrientation(tiff)).toBe(6);
  });

  it('copies progressive scans with restart markers and stuffed bytes untouched', () => {
    const source = fixture('progressive-restart.jpg');
    const result = strip(source);
    expect(result.removed).toEqual(['APP1:Exif']);
    expect(result.orientation).toBe(1);
    // Exactly the original minus its EXIF segment: no orientation block is
    // added for an upright photo.
    const exif = jpegHeader(source).find((s) => s.marker === 0xe1);
    const start = source.indexOf(0xe1, 2) - 1;
    const expected = new Uint8Array(source.length - exif.bytes.length);
    expected.set(source.subarray(0, start));
    expected.set(source.subarray(start + exif.bytes.length), start);
    expect(sameBytes(result.bytes, expected)).toBe(true);
    expect(countJpegMarkers(result.bytes, 0xda)).toBe(
      countJpegMarkers(source, 0xda)
    );
    expectNoSecrets(result.bytes);
  });

  it('drops the MPF index and the secondary pictures after the first EOI', () => {
    const source = fixture('multi-picture.mpo.jpg');
    const result = strip(source);
    expect(result.removed).toEqual(['APP1:Exif', 'APP2:MPF', 'trailer']);
    expect(result.orientation).toBe(3);
    expect(countJpegMarkers(result.bytes, 0xd8)).toBe(1);
    expect(countJpegMarkers(result.bytes, 0xd9)).toBe(1);
    expectNoSecrets(result.bytes);
  });

  it('returns a clean JPEG as the very same array', () => {
    const source = fixture('clean.jpg');
    const result = strip(source);
    expect(result.changed).toBe(false);
    expect(result.removed).toEqual([]);
    expect(result.bytes).toBe(source);
  });

  it('skips fill bytes before markers like libjpeg does', () => {
    const source = fixture('clean.jpg');
    const padded = new Uint8Array(source.length + 3);
    padded.set(source.subarray(0, 2));
    padded.set([0xff, 0xff, 0xff], 2); // fill before the APP0 marker
    padded.set(source.subarray(2), 5);
    const result = strip(padded);
    expect(sameBytes(result.bytes, source)).toBe(true);
  });

  it('drops the uncompressed thumbnail a JFIF segment can carry', () => {
    const source = fixture('clean.jpg');
    const jfif = jpegHeader(source)[0];
    expect(jfif.bytes.length).toBe(18);
    // Same JFIF fields, but announcing a 2x2 RGB thumbnail (12 bytes).
    const thumbnail = Buffer.from('THUMBSECRET!', 'latin1');
    const segment = new Uint8Array(jfif.bytes.length + thumbnail.length);
    segment.set(jfif.bytes);
    segment[3] = 16 + thumbnail.length; // segment length
    segment[16] = 2; // Xthumbnail
    segment[17] = 2; // Ythumbnail
    segment.set(thumbnail, jfif.bytes.length);
    const withThumbnail = new Uint8Array(source.length + thumbnail.length);
    withThumbnail.set(source.subarray(0, 2));
    withThumbnail.set(segment, 2);
    withThumbnail.set(
      source.subarray(2 + jfif.bytes.length),
      2 + segment.length
    );

    const result = strip(withThumbnail);
    expect(result.removed).toEqual(['APP0:JFIF-thumbnail']);
    expect(text(result.bytes)).not.toContain('THUMBSECRET');
    // The JFIF fields (version, density) are kept exactly.
    expect(sameBytes(result.bytes, source)).toBe(true);
  });

  it('reports malformed input instead of guessing', () => {
    const source = fixture('phone-exif-gps.jpg');
    // Cut inside the EXIF segment.
    expect(stripImageMetadata(source.subarray(0, 100))).toEqual({
      ok: false,
      format: 'jpeg',
      reason: 'malformed',
    });
  });
});

describe('stripImageMetadata — PNG', () => {
  it('drops eXIf, text chunks, tIME and trailing bytes; keeps colour chunks', () => {
    const source = fixture('exif-text.png');
    const result = strip(source);
    expect(result.format).toBe('png');
    expect(result.removed).toEqual([
      'tIME',
      'tEXt',
      'zTXt',
      'iTXt',
      'eXIf',
      'trailer',
    ]);
    expectNoSecrets(result.bytes);
    expect(pngChunks(result.bytes).map((c) => c.type)).toEqual([
      'IHDR',
      'gAMA',
      'iCCP',
      'pHYs',
      'eXIf',
      'IDAT',
      'IEND',
    ]);
    // Kept chunks are byte-identical to the source.
    const original = new Map(pngChunks(source).map((c) => [c.type, c.raw]));
    for (const chunk of pngChunks(result.bytes)) {
      if (chunk.type === 'eXIf') continue;
      expect(sameBytes(chunk.raw, original.get(chunk.type))).toBe(true);
    }
  });

  it('writes an orientation-only eXIf with a valid CRC before the image data', () => {
    const result = strip(fixture('exif-text.png'));
    expect(result.orientation).toBe(6);
    const exif = pngChunks(result.bytes).find((c) => c.type === 'eXIf');
    expect(sameBytes(exif.data, buildOrientationTiff(6))).toBe(true);
    const typeAndData = exif.raw.subarray(4, exif.raw.length - 4);
    expect(exif.crc).toBe(crc32(typeAndData));
  });

  it('keeps APNG animation chunks', () => {
    const result = strip(fixture('animated.png'));
    expect(result.removed).toEqual(['tEXt']);
    expect(pngChunks(result.bytes).map((c) => c.type)).toEqual([
      'IHDR',
      'acTL',
      'fcTL',
      'IDAT',
      'fcTL',
      'fdAT',
      'IEND',
    ]);
    expectNoSecrets(result.bytes);
  });

  it('refuses a PNG without IEND', () => {
    const source = fixture('animated.png');
    expect(stripImageMetadata(source.subarray(0, source.length - 12))).toEqual({
      ok: false,
      format: 'png',
      reason: 'malformed',
    });
  });
});

describe('stripImageMetadata — WebP', () => {
  it('drops EXIF and XMP, keeps ICC, and fixes the VP8X flags and RIFF size', () => {
    const source = fixture('exif-xmp.webp');
    const result = strip(source);
    expect(result.format).toBe('webp');
    expect(result.removed).toEqual(['EXIF', 'XMP']);
    expect(result.orientation).toBe(8);
    expectNoSecrets(result.bytes);

    const chunks = webpChunks(result.bytes);
    expect(chunks.map((c) => c.id)).toEqual(['VP8X', 'ICCP', 'VP8 ', 'EXIF']);
    // ICC (0x20) + EXIF (0x08, the orientation-only block); XMP flag cleared.
    expect(chunks[0].payload[0]).toBe(0x28);
    expect(sameBytes(chunks[3].payload, buildOrientationTiff(8))).toBe(true);
    const view = new DataView(result.bytes.buffer);
    expect(view.getUint32(4, true)).toBe(result.bytes.length - 8);

    const original = webpChunks(source);
    expect(sameBytes(chunks[1].raw, original[1].raw)).toBe(true);
    expect(sameBytes(chunks[2].raw, original[2].raw)).toBe(true);
  });

  it('adds no EXIF chunk for an upright lossless image', () => {
    const result = strip(fixture('lossless-exif.webp'));
    const chunks = webpChunks(result.bytes);
    expect(chunks.map((c) => c.id)).toEqual(['VP8X', 'VP8L']);
    expect(chunks[0].payload[0]).toBe(0x00);
    expectNoSecrets(result.bytes);
  });

  it('keeps animation frames', () => {
    const result = strip(fixture('animated-exif.webp'));
    const chunks = webpChunks(result.bytes);
    expect(chunks.map((c) => c.id)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF']);
    expect(chunks[0].payload[0]).toBe(0x02);
    expectNoSecrets(result.bytes);
  });

  it('returns a simple WebP without metadata unchanged', () => {
    const source = fixture('clean.webp');
    const result = strip(source);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(source);
  });

  it('refuses a chunk that runs past the RIFF end', () => {
    const broken = fixture('clean.webp').slice();
    broken[16] = 0xff; // VP8 chunk size low byte
    broken[17] = 0xff;
    expect(stripImageMetadata(broken)).toEqual({
      ok: false,
      format: 'webp',
      reason: 'malformed',
    });
  });
});

describe('stripImageMetadata — other formats', () => {
  it('leaves GIF, HEIC and unknown bytes to the caller', () => {
    expect(
      stripImageMetadata(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
    ).toEqual({ ok: false, format: null, reason: 'unsupported' });
    const heic = Uint8Array.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    expect(stripImageMetadata(heic)).toEqual({
      ok: false,
      format: null,
      reason: 'unsupported',
    });
  });
});
