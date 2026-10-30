import { describe, expect, it, vi } from 'vitest';
import { mapQAppGraph, prepareQAppRequest } from './qapp-request-transport';

describe('native Q-App file graph', () => {
  it('describes files without reading bytes and restores identity across containers', () => {
    const file = new File(['hello'], 'photo.txt', {
      type: 'text/plain',
      lastModified: 123,
    });
    const empty = new Blob([]);
    const read = vi.fn(() => {
      throw new Error('must not read');
    });
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const data: any = {
      file,
      alias: file,
      empty,
      map: new Map([[file, new Set([empty])]]),
      view: new Uint8Array([1, 2]),
      date: new Date(42),
      ordinary: { reference: {}, size: 5 },
    };
    data.self = data;
    Object.defineProperty(data, '__proto__', {
      enumerable: true,
      value: { safe: true },
    });
    const prepared = prepareQAppRequest(data);
    expect(read).not.toHaveBeenCalled();
    expect(prepared.blobs).toEqual([file, empty]);
    expect(prepared.files[0]).toMatchObject({
      size: 5,
      type: 'text/plain',
      name: 'photo.txt',
      lastModified: 123,
    });
    const replacements = new Map(
      prepared.files.map((metadata, index) => [
        metadata.reference,
        prepared.blobs[index],
      ])
    );
    const restored = mapQAppGraph(
      prepared.data,
      (value) => replacements.get(value) || value
    );
    expect(restored.file).toBe(file);
    expect(restored.alias).toBe(file);
    expect(restored.map.get(file).has(empty)).toBe(true);
    expect(restored.self).toBe(restored);
    expect(restored.view).toBe(data.view);
    expect(restored.date).toBe(data.date);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.hasOwn(restored, '__proto__')).toBe(true);
    expect(restored.ordinary).toEqual(data.ordinary);
  });
  it('does not rewrite ordinary requests or treat forged descriptors as files', () => {
    const data = {
      action: 'RNS_SEND',
      payload: new Uint8Array([1, 2]),
      file: { size: 4, type: 'text/plain' },
    };
    expect(prepareQAppRequest(data)).toEqual({ data, files: [], blobs: [] });
    expect(prepareQAppRequest(data).data).toBe(data);
  });
  it('bounds the number of retained references including zero-byte Blobs', () => {
    expect(() =>
      prepareQAppRequest(Array.from({ length: 4097 }, () => new Blob([])))
    ).toThrow();
  });
});
