import { createCipheriv, randomBytes, webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadFromLocation } from './downloadFromLocation';

vi.mock('../background/background.ts', () => ({
  createEndpoint: async (path) => path,
}));
vi.mock('../i18n/i18n', () => ({ default: { t: (key) => key } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.showSaveFilePicker;
});

it.each(['electron', 'browser'])(
  'decrypts irregular network chunks into the %s streaming writer',
  async (platform) => {
    const key = randomBytes(32),
      iv = randomBytes(16),
      plain = randomBytes(257);
    const cipher = createCipheriv('aes-256-ctr', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const writes: Uint8Array[] = [];
    const write = vi.fn(async (value: Uint8Array) => {
      writes.push(value);
    });
    const close = vi.fn();
    const cleanup = vi.fn();
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal(
      'electron',
      platform === 'electron'
        ? {
            startStreamSave: async () => ({
              canceled: false,
              filePath: 'selected.bin',
            }),
            writeChunk: async (_path, value) => write(value),
            deleteFile: cleanup,
          }
        : undefined
    );
    if (platform === 'browser')
      window.showSaveFilePicker = vi.fn(async () => ({
        createWritable: async () => ({ write, close, abort: cleanup }),
      })) as any;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (const [start, end] of [
                  [0, 1],
                  [1, 18],
                  [18, 65],
                  [65, 257],
                ])
                  controller.enqueue(
                    new Uint8Array(encrypted.subarray(start, end))
                  );
                controller.close();
              },
            }),
            { headers: { 'Content-Length': String(plain.length) } }
          )
      )
    );
    const result = await downloadFromLocation({
      filename: 'plain.bin',
      location: { service: 'FILE', name: 'test' },
      encryption: {
        encryptionType: 'streamed-v1',
        key: key.toString('base64'),
        iv: iv.toString('base64'),
      },
    });
    expect(result.success).toBe(true);
    expect(Buffer.concat(writes)).toEqual(plain);
    expect(write).toHaveBeenCalledTimes(4);
    expect(cleanup).not.toHaveBeenCalled();
    if (platform === 'browser') expect(close).toHaveBeenCalledOnce();
  }
);
