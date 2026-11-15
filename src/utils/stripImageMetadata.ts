/**
 * Lossless removal of photo metadata (EXIF, XMP, IPTC, comments, embedded
 * thumbnails and other trailers) from JPEG, PNG and WebP bytes.
 *
 * Phone photos carry GPS coordinates, the camera make/model/serial and the
 * capture time. Anything Hub publishes (Torq posts on QDN are public and
 * permanent) must not carry them, but re-encoding every photo costs quality
 * and time, so this walks the container and copies only what is needed to
 * draw the image:
 *
 * - JPEG: keeps SOI/EOI, the frame, tables and scans, JFIF (APP0, minus its
 *   optional thumbnail), the ICC colour profile (APP2 "ICC_PROFILE") and Adobe
 *   (APP14, needed for CMYK).
 *   Drops APP1 (EXIF with its thumbnail, XMP), APP13 (IPTC/Photoshop), MPF,
 *   every other APPn, comments, and anything after the first image's EOI
 *   (Motion Photo videos, HDR gain maps, MPF secondary images).
 * - PNG: keeps critical chunks plus the colour/transparency/animation chunks.
 *   Drops eXIf, tEXt, zTXt, iTXt, tIME and anything unknown.
 * - WebP: keeps the image, alpha, animation and ICC chunks. Drops EXIF, XMP
 *   and anything unknown, and fixes the VP8X flags and RIFF size.
 *
 * Orientation is the one EXIF field that changes how a photo looks. When the
 * source says it is rotated (orientation 2-8), a minimal EXIF block holding
 * only that tag is written back, so the photo displays exactly as before and
 * nothing else survives.
 */

type ImageContainer = 'jpeg' | 'png' | 'webp';

type StripImageMetadataResult =
  | {
      ok: true;
      format: ImageContainer;
      /** The cleaned file. Same array as the input when nothing changed. */
      bytes: Uint8Array;
      changed: boolean;
      /** What was dropped, for logs and tests (e.g. "APP1:Exif", "tEXt"). */
      removed: string[];
      /** EXIF orientation carried over (1 = upright / none). */
      orientation: number;
    }
  | {
      ok: false;
      format: ImageContainer | null;
      reason: 'unsupported' | 'malformed';
    };

export const IMAGE_CONTAINER_MIME: Record<ImageContainer, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

class MalformedImageError extends Error {}

const malformed = (message: string): never => {
  throw new MalformedImageError(message);
};

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = '';
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

const startsWithAscii = (
  bytes: Uint8Array,
  start: number,
  end: number,
  text: string
): boolean => {
  if (end - start < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Identify the container from its magic bytes (never trust the MIME). */
export function detectImageContainer(bytes: Uint8Array): ImageContainer | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    startsWithAscii(bytes, 0, 4, 'RIFF') &&
    startsWithAscii(bytes, 8, 12, 'WEBP')
  ) {
    return 'webp';
  }
  return null;
}

// ---------------------------------------------------------------------------
// EXIF orientation (TIFF structure)
// ---------------------------------------------------------------------------

/**
 * Orientation (tag 0x0112 in IFD0) from a TIFF/EXIF block; 1 when absent or
 * unreadable. Never throws: a broken EXIF block just means "upright".
 */
export function readTiffOrientation(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  let little: boolean;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) little = true;
  else if (tiff[0] === 0x4d && tiff[1] === 0x4d) little = false;
  else return 1;
  const u16 = (at: number) =>
    little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1];
  const u32 = (at: number) =>
    little
      ? (tiff[at] |
          (tiff[at + 1] << 8) |
          (tiff[at + 2] << 16) |
          (tiff[at + 3] << 24)) >>>
        0
      : ((tiff[at] << 24) |
          (tiff[at + 1] << 16) |
          (tiff[at + 2] << 8) |
          tiff[at + 3]) >>>
        0;
  if (u16(2) !== 42) return 1;
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) !== 0x0112) continue;
    const type = u16(entry + 2);
    let value = 1;
    if (type === 3) value = u16(entry + 8);
    else if (type === 4) value = u32(entry + 8);
    else if (type === 1) value = tiff[entry + 8];
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** A 26-byte big-endian TIFF block holding only the Orientation tag. */
export function buildOrientationTiff(orientation: number): Uint8Array {
  const value = Math.max(1, Math.min(8, Math.round(orientation)));
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d], 0); // "MM": big-endian
  view.setUint16(2, 42); // TIFF magic
  view.setUint32(4, 8); // IFD0 offset
  view.setUint16(8, 1); // one entry
  view.setUint16(10, 0x0112); // Orientation
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1); // count
  view.setUint16(18, value);
  // Bytes 20-21 pad the value; 22-25 = 0: no next IFD, so no thumbnail.
  return tiff;
}

const EXIF_HEADER = 'Exif\0\0';

/** EXIF payloads sometimes keep the JPEG "Exif\0\0" prefix (WebP, PNG). */
const tiffFromExifPayload = (payload: Uint8Array): Uint8Array =>
  startsWithAscii(payload, 0, payload.length, EXIF_HEADER)
    ? payload.subarray(EXIF_HEADER.length)
    : payload;

// ---------------------------------------------------------------------------
// Output assembly
// ---------------------------------------------------------------------------

type Piece = Uint8Array;

const concat = (pieces: Piece[]): Uint8Array => {
  let total = 0;
  for (const piece of pieces) total += piece.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out;
};

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
const JPEG_APP0 = 0xe0;
const JPEG_APP1 = 0xe1;
const JPEG_APP2 = 0xe2;
const JPEG_APP14 = 0xee;
const JPEG_COM = 0xfe;

const isStandaloneJpegMarker = (marker: number) =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

const jpegSegmentLabel = (marker: number, payload: Uint8Array): string => {
  if (marker === JPEG_COM) return 'COM';
  const app = marker - JPEG_APP0;
  let id = '';
  for (let i = 0; i < Math.min(payload.length, 40); i += 1) {
    const ch = payload[i];
    if (ch === 0) break;
    if (ch < 0x20 || ch > 0x7e) {
      id = '';
      break;
    }
    id += String.fromCharCode(ch);
  }
  if (id.startsWith('http://ns.adobe.com/xap/')) id = 'XMP';
  else if (id.startsWith('http://ns.adobe.com/xmp/extension')) id = 'XMP-ext';
  return id ? `APP${app}:${id.slice(0, 16)}` : `APP${app}`;
};

/** Which header segments survive. Everything that is not APPn/COM is kept. */
const keepJpegSegment = (marker: number, payload: Uint8Array): boolean => {
  if (marker === JPEG_COM) return false;
  if (marker < JPEG_APP0 || marker > 0xef) return true;
  if (marker === JPEG_APP0) {
    return startsWithAscii(payload, 0, payload.length, 'JFIF\0');
  }
  if (marker === JPEG_APP2) {
    return startsWithAscii(payload, 0, payload.length, 'ICC_PROFILE\0');
  }
  if (marker === JPEG_APP14) {
    return startsWithAscii(payload, 0, payload.length, 'Adobe');
  }
  return false;
};

/** JFIF fields before the optional thumbnail: id, version, units, density. */
const JFIF_FIELDS_BYTES = 12;

/**
 * JFIF APP0 can carry an uncompressed RGB thumbnail (Xthumbnail x Ythumbnail
 * pixels after the density fields), which may show the uncropped original.
 * Returns the segment rebuilt without it, or null when it has none.
 */
const jfifWithoutThumbnail = (payload: Uint8Array): Uint8Array | null => {
  if (payload.length < JFIF_FIELDS_BYTES + 2) return null;
  const hasThumbnail =
    payload.length > JFIF_FIELDS_BYTES + 2 ||
    payload[JFIF_FIELDS_BYTES] !== 0 ||
    payload[JFIF_FIELDS_BYTES + 1] !== 0;
  if (!hasThumbnail) return null;
  const length = 2 + JFIF_FIELDS_BYTES + 2;
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, JPEG_APP0, (length >> 8) & 0xff, length & 0xff]);
  segment.set(payload.subarray(0, JFIF_FIELDS_BYTES), 4);
  // The last two bytes stay 0: no thumbnail.
  return segment;
};

const orientationApp1 = (orientation: number): Uint8Array => {
  const tiff = buildOrientationTiff(orientation);
  const length = 2 + EXIF_HEADER.length + tiff.length;
  const header = Uint8Array.from([
    0xff,
    JPEG_APP1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...Array.from(EXIF_HEADER, (ch) => ch.charCodeAt(0)),
  ]);
  return concat([header, tiff]);
};

function stripJpeg(data: Uint8Array): StripImageMetadataResult {
  const pieces: Piece[] = [data.subarray(0, 2)];
  const removed: string[] = [];
  let orientation = 1;
  let sawExif = false;
  let jfifFirst = false;
  let pos = 2;
  let finished = false;

  while (pos < data.length && !finished) {
    // libjpeg skips stray bytes before a marker; so do we (they are dropped).
    if (data[pos] !== 0xff) {
      const next = data.indexOf(0xff, pos);
      if (next < 0) malformed('JPEG ends without EOI after stray bytes');
      removed.push('garbage');
      pos = next;
    }
    let m = pos + 1;
    while (m < data.length && data[m] === 0xff) m += 1; // fill bytes
    if (m >= data.length) malformed('JPEG truncated at a marker');
    const marker = data[m];
    const markerStart = m - 1;

    if (marker === JPEG_EOI) {
      pieces.push(data.subarray(markerStart, m + 1));
      if (m + 1 < data.length) removed.push('trailer');
      finished = true;
      break;
    }
    if (marker === JPEG_SOI || marker === 0x00) {
      malformed('Unexpected JPEG marker');
    }
    if (isStandaloneJpegMarker(marker)) {
      pieces.push(data.subarray(markerStart, m + 1));
      pos = m + 1;
      continue;
    }
    if (m + 2 >= data.length) malformed('JPEG segment length missing');
    const length = (data[m + 1] << 8) | data[m + 2];
    if (length < 2) malformed('JPEG segment length invalid');
    const segmentEnd = m + 1 + length;
    if (segmentEnd > data.length) malformed('JPEG segment overruns file');
    const payload = data.subarray(m + 3, segmentEnd);

    if (keepJpegSegment(marker, payload)) {
      const isJfif =
        marker === JPEG_APP0 &&
        startsWithAscii(payload, 0, payload.length, 'JFIF\0');
      if (isJfif && pieces.length === 1) jfifFirst = true;
      const jfif = isJfif ? jfifWithoutThumbnail(payload) : null;
      if (jfif) {
        removed.push('APP0:JFIF-thumbnail');
        pieces.push(jfif);
      } else {
        pieces.push(data.subarray(markerStart, segmentEnd));
      }
    } else {
      removed.push(jpegSegmentLabel(marker, payload));
      if (
        marker === JPEG_APP1 &&
        !sawExif &&
        startsWithAscii(payload, 0, payload.length, EXIF_HEADER)
      ) {
        sawExif = true;
        orientation = readTiffOrientation(payload.subarray(EXIF_HEADER.length));
      }
    }
    pos = segmentEnd;

    if (marker !== JPEG_SOS) continue;

    // Entropy-coded scan data: 0xFF is followed by 0x00 (stuffing) or RSTn;
    // anything else is the next marker (DHT/SOS between progressive scans,
    // or EOI).
    let scan = pos;
    for (;;) {
      const ff = data.indexOf(0xff, scan);
      if (ff < 0) {
        // No EOI: a truncated file. Keep the scan data as it is.
        pieces.push(data.subarray(pos));
        pos = data.length;
        finished = true;
        break;
      }
      let next = ff + 1;
      while (next < data.length && data[next] === 0xff) next += 1;
      if (next >= data.length) {
        pieces.push(data.subarray(pos));
        pos = data.length;
        finished = true;
        break;
      }
      const value = data[next];
      if (value === 0x00 || (value >= 0xd0 && value <= 0xd7)) {
        scan = next + 1;
        continue;
      }
      pieces.push(data.subarray(pos, ff));
      pos = ff;
      break;
    }
  }

  if (orientation > 1) {
    pieces.splice(jfifFirst ? 2 : 1, 0, orientationApp1(orientation));
  }
  const bytes = concat(pieces);
  const changed = removed.length > 0 || bytes.length !== data.length;
  return {
    ok: true,
    format: 'jpeg',
    bytes: changed ? bytes : data,
    changed,
    removed,
    orientation,
  };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** Ancillary chunks needed to draw the image the same way. */
const PNG_KEEP_ANCILLARY = new Set([
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
  'hIST',
  'sPLT',
  'cICP',
  'mDCV',
  'cLLI',
  // APNG animation
  'acTL',
  'fcTL',
  'fdAT',
]);

let crcTable: Uint32Array | null = null;

const crc32 = (bytes: Uint8Array): number => {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const u32be = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const pngChunk = (type: string, payload: Uint8Array): Uint8Array => {
  const typeAndData = concat([
    Uint8Array.from(Array.from(type, (ch) => ch.charCodeAt(0))),
    payload,
  ]);
  return concat([
    Uint8Array.from(u32be(payload.length)),
    typeAndData,
    Uint8Array.from(u32be(crc32(typeAndData))),
  ]);
};

function stripPng(data: Uint8Array): StripImageMetadataResult {
  const pieces: Piece[] = [data.subarray(0, 8)];
  const removed: string[] = [];
  let orientation = 1;
  let idatIndex = -1;
  let sawEnd = false;
  let pos = 8;

  while (pos < data.length) {
    if (pos + 12 > data.length) malformed('PNG chunk header truncated');
    const length =
      ((data[pos] << 24) |
        (data[pos + 1] << 16) |
        (data[pos + 2] << 8) |
        data[pos + 3]) >>>
      0;
    const type = ascii(data, pos + 4, 4);
    const chunkEnd = pos + 12 + length;
    if (chunkEnd > data.length) malformed('PNG chunk overruns file');
    const critical = (data[pos + 4] & 0x20) === 0;

    if (critical || PNG_KEEP_ANCILLARY.has(type)) {
      if (type === 'IDAT' && idatIndex < 0) idatIndex = pieces.length;
      pieces.push(data.subarray(pos, chunkEnd));
    } else {
      removed.push(type);
      if (type === 'eXIf' && orientation === 1) {
        orientation = readTiffOrientation(
          tiffFromExifPayload(data.subarray(pos + 8, pos + 8 + length))
        );
      }
    }
    pos = chunkEnd;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) malformed('PNG has no IEND');
  if (pos < data.length) removed.push('trailer');
  if (idatIndex < 0) malformed('PNG has no image data');

  if (orientation > 1) {
    pieces.splice(
      idatIndex,
      0,
      pngChunk('eXIf', buildOrientationTiff(orientation))
    );
  }
  const bytes = concat(pieces);
  const changed = removed.length > 0 || bytes.length !== data.length;
  return {
    ok: true,
    format: 'png',
    bytes: changed ? bytes : data,
    changed,
    removed,
    orientation,
  };
}

// ---------------------------------------------------------------------------
// WebP (RIFF)
// ---------------------------------------------------------------------------

const WEBP_KEEP = new Set([
  'VP8 ',
  'VP8L',
  'VP8X',
  'ALPH',
  'ANIM',
  'ANMF',
  'ICCP',
]);
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;

const u32le = (value: number) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

function stripWebp(data: Uint8Array): StripImageMetadataResult {
  const declared =
    (data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)) >>> 0;
  const riffEnd = 8 + declared;
  if (riffEnd > data.length) malformed('WebP RIFF size overruns file');
  const pieces: Piece[] = [];
  const removed: string[] = [];
  let orientation = 1;
  let vp8xIndex = -1;
  let pos = 12;

  while (pos < riffEnd) {
    if (pos + 8 > riffEnd) malformed('WebP chunk header truncated');
    const fourcc = ascii(data, pos, 4);
    const size =
      (data[pos + 4] |
        (data[pos + 5] << 8) |
        (data[pos + 6] << 16) |
        (data[pos + 7] << 24)) >>>
      0;
    const payloadEnd = pos + 8 + size;
    if (payloadEnd > riffEnd) malformed('WebP chunk overruns RIFF');
    // Chunks are padded to an even size; tolerate a missing final pad byte.
    const chunkEnd = Math.min(payloadEnd + (size & 1), riffEnd);

    if (WEBP_KEEP.has(fourcc)) {
      if (fourcc === 'VP8X') {
        if (size < 10) malformed('WebP VP8X chunk too small');
        vp8xIndex = pieces.length;
        // Copied, because its flags byte is rewritten below.
        pieces.push(data.slice(pos, chunkEnd));
      } else {
        pieces.push(data.subarray(pos, chunkEnd));
      }
    } else {
      removed.push(fourcc.trim() || 'chunk');
      if (fourcc === 'EXIF' && orientation === 1) {
        orientation = readTiffOrientation(
          tiffFromExifPayload(data.subarray(pos + 8, payloadEnd))
        );
      }
    }
    pos = chunkEnd;
  }
  if (riffEnd < data.length) removed.push('trailer');
  if (
    !pieces.some((piece) => {
      const id = ascii(piece, 0, 4);
      return id === 'VP8 ' || id === 'VP8L' || id === 'ANMF';
    })
  ) {
    malformed('WebP has no image data');
  }

  // An EXIF chunk is only valid in the extended (VP8X) format.
  const keepOrientation = orientation > 1 && vp8xIndex >= 0;
  if (vp8xIndex >= 0) {
    const vp8x = pieces[vp8xIndex];
    let flags = vp8x[8] & ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP);
    if (keepOrientation) flags |= VP8X_FLAG_EXIF;
    vp8x[8] = flags;
  }
  if (keepOrientation) {
    const tiff = buildOrientationTiff(orientation);
    pieces.push(
      concat([
        Uint8Array.from([0x45, 0x58, 0x49, 0x46, ...u32le(tiff.length)]),
        tiff,
      ])
    );
  }

  let body = 0;
  for (const piece of pieces) body += piece.length;
  const header = concat([
    data.subarray(0, 4),
    Uint8Array.from(u32le(body + 4)),
    data.subarray(8, 12),
  ]);
  const bytes = concat([header, ...pieces]);
  const changed =
    removed.length > 0 ||
    bytes.length !== data.length ||
    bytes.some((value, index) => value !== data[index]);
  return {
    ok: true,
    format: 'webp',
    bytes: changed ? bytes : data,
    changed,
    removed,
    orientation: keepOrientation ? orientation : 1,
  };
}

// ---------------------------------------------------------------------------

/**
 * Remove metadata from JPEG/PNG/WebP bytes without re-encoding the pixels.
 * Other formats come back as `{ ok: false, reason: 'unsupported' }`, files that
 * do not parse as `{ ok: false, reason: 'malformed' }`; callers then need a
 * re-encode (canvas) to be sure nothing leaks.
 */
export function stripImageMetadata(
  input: Uint8Array | ArrayBuffer
): StripImageMetadataResult {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = detectImageContainer(data);
  if (!format) return { ok: false, format: null, reason: 'unsupported' };
  try {
    if (format === 'jpeg') return stripJpeg(data);
    if (format === 'png') return stripPng(data);
    return stripWebp(data);
  } catch (err) {
    if (err instanceof MalformedImageError) {
      return { ok: false, format, reason: 'malformed' };
    }
    throw err;
  }
}
