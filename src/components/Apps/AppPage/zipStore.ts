/**
 * A minimal ZIP writer: files are stored, not compressed. Enough for QDN's
 * `isZip` uploads (Core unzips them into the resource's folder), and the
 * screenshots inside are WebP, which wouldn't compress anyway.
 */

export interface ZipEntry {
  /** Path inside the zip, `/`-separated, without a leading slash. */
  path: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;

const getCrcTable = (): Uint32Array => {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
};

export const crc32 = (data: Uint8Array): number => {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

const UTF8_FLAG = 0x0800;
const VERSION = 20;

const cleanPath = (path: string): string => {
  const parts = String(path)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');
  if (parts.length === 0) throw new Error('Empty zip entry path');
  return parts.join('/');
};

/** The entries as one zip file. */
export const createZip = (
  entries: ZipEntry[],
  modified: Date = new Date()
): Blob => {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();

  entries.forEach((entry) => {
    const path = cleanPath(entry.path);
    if (seen.has(path)) throw new Error(`Duplicate zip entry: ${path}`);
    seen.add(path);
    const name = encoder.encode(path);
    const data = entry.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    header.set(name, 46);

    parts.push(local as BlobPart, data as BlobPart);
    central.push(header);
    offset += local.length + data.length;
  });

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...parts, ...central, end] as BlobPart[], {
    type: 'application/zip',
  });
};
