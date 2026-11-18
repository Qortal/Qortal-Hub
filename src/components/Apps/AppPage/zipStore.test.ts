import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zipStore';
import { blobBytes } from './blobBytes';

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * Reads a stored (uncompressed) zip the way unzip does: from the central
 * directory, checking each local header and CRC on the way.
 */
const readZip = async (blob: Blob) => {
  const data = await blobBytes(blob);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: { name: string; data: Uint8Array; flags: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const flags = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      data.subarray(offset + 46, offset + 46 + nameLength)
    );
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0); // stored
    const localNameLength = view.getUint16(local + 26, true);
    const start =
      local + 30 + localNameLength + view.getUint16(local + 28, true);
    const content = data.slice(start, start + size);
    expect(crc32(content)).toBe(crc);
    files.push({ name, data: content, flags });
    offset += 46 + nameLength;
  }
  return files;
};

describe('zipStore', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes a zip with every file whole', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 7]);
    const files = await readZip(
      createZip(
        [
          { path: 'shots.json', data: bytes('{"v":1}') },
          { path: 'assets/1.webp', data: png },
          { path: 'naïve 日本.txt', data: bytes('ünï') },
        ],
        new Date(2026, 10, 14, 21, 30, 10)
      )
    );
    expect(files.map((file) => file.name)).toEqual([
      'shots.json',
      'assets/1.webp',
      'naïve 日本.txt',
    ]);
    expect(new TextDecoder().decode(files[0].data)).toBe('{"v":1}');
    expect(Array.from(files[1].data)).toEqual(Array.from(png));
    expect(new TextDecoder().decode(files[2].data)).toBe('ünï');
    // Names are marked UTF-8, so unzip tools show them right.
    files.forEach((file) => expect(file.flags & 0x0800).toBe(0x0800));
  });

  it('keeps paths inside the zip and refuses duplicates', () => {
    expect(() =>
      createZip([
        { path: 'a.txt', data: bytes('1') },
        { path: './a.txt', data: bytes('2') },
      ])
    ).toThrow(/Duplicate/);
    expect(() => createZip([{ path: '../', data: bytes('1') }])).toThrow();
  });

  it('drops dot segments from paths', async () => {
    const files = await readZip(
      createZip([{ path: '../../outside/../a.txt', data: bytes('x') }])
    );
    expect(files.map((file) => file.name)).toEqual(['outside/a.txt']);
  });
});
