import { MessageChannel } from 'node:worker_threads';
import { createCipheriv, randomBytes, webcrypto } from 'node:crypto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachQAppFileExecutor } from './qapp-file-executor';
import { fileCounter } from './qapp-file-protocol';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  // Node MessageChannel clones Node Blobs, not jsdom's emulation. Multipart wire
  // serialization is covered by the real Electron integration fixture.
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'FormData',
    class extends Map {
      append(key: string, value: any) {
        this.set(key, value);
      }
    }
  );
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});
function fixture(
  bytes: number,
  files: number,
  schedule: <T>(run: () => Promise<T>) => Promise<T> = (run) => run()
) {
  const input = new MessageChannel();
  const control = new MessageChannel();
  const save = vi.fn(async () => undefined);
  const released = vi.fn();
  const cleanup = attachQAppFileExecutor(
    input.port1 as any,
    control.port1 as any,
    { bytes, files },
    { schedule, save, released, fault: vi.fn() }
  );
  cleanups.push(
    cleanup,
    () => input.port2.close(),
    () => control.port2.close()
  );
  let nextId = 0;
  const receive = () =>
    new Promise<any>((resolve) =>
      control.port2.once('message', (message) => {
        if (message.kind === 'request')
          control.port2.postMessage({ kind: 'accept' });
        resolve(message);
      })
    );
  return {
    input: input.port2,
    control: control.port2,
    receive,
    save,
    released,
    call: async (operation: any) => {
      const reply = receive();
      control.port2.postMessage({ id: ++nextId, operation });
      return await reply;
    },
  };
}

describe('native file executor', () => {
  it('sends metadata without reading any file, and preserves aliases/cycles', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const f = fixture(5, 1);
    const metadata = f.receive();
    const data: any = {
      file,
      alias: file,
      nested: new Map([[file, new Set([file])]]),
    };
    data.self = data;
    f.input.postMessage(data);
    const message = await metadata;
    expect(message.kind).toBe('request');
    expect(message.data.file).toBe(message.files[0].reference);
    expect(message.data.alias).toBe(message.data.file);
    expect(message.data.self).toBe(message.data);
    const read = await f.call({ kind: 'reference', file: 0 });
    expect(await read.result.text()).toBe('hello');
  });
  it('does not execute operations sent through the guest input port', async () => {
    const f = fixture(1, 1);
    const reply = f.receive();
    f.input.postMessage({
      kind: 'save',
      file: new Blob(['x']),
      filename: 'bad.txt',
    });
    expect((await reply).kind).toBe('request');
    expect(f.save).not.toHaveBeenCalled();
  });
  it('rejects a file count/size mismatch before dispatch', async () => {
    const f = fixture(100, 1);
    const reply = f.receive();
    f.input.postMessage({ file: new Blob(['x']) });
    expect((await reply).kind).toBe('error');
    expect(f.released).toHaveBeenCalledOnce();
  });
  it('bounds chunk ranges and rejects unknown file IDs', async () => {
    const f = fixture(5, 1);
    const reply = f.receive();
    f.input.postMessage({ file: new Blob(['hello']) });
    await reply;
    for (const operation of [
      { kind: 'upload', file: 0, start: -1, end: 1 },
      { kind: 'upload', file: 0, start: 0, end: 6 },
      { kind: 'reference', file: 1 },
    ])
      expect((await f.call(operation)).error).toBeTruthy();
  });
  it('uploads native multipart chunks with no credentials or redirects', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const f = fixture(5, 1);
    const reply = f.receive();
    f.input.postMessage({ file: new Blob(['hello']) });
    await reply;
    expect(
      (
        await f.call({
          kind: 'upload',
          file: 0,
          start: 0,
          end: 5,
          index: 0,
          endpoint:
            'https://node.invalid/core-proxy/arbitrary/FILE/name/id/chunk?apiKey=test',
        })
      ).error
    ).toBeUndefined();
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(await ((options.body as FormData).get('chunk') as Blob).text()).toBe(
      'hello'
    );
    expect((options.body as FormData).get('index')).toBe('0');
    expect(
      (
        await f.call({
          kind: 'upload',
          file: 0,
          start: 0,
          end: 5,
          index: 0,
          endpoint: 'https://node.invalid/admin/stop',
        })
      ).error
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not let a pending save dialog block another request upload', async () => {
    let tail = Promise.resolve();
    const schedule = (run) => {
      const result = tail.then(run);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null))
    );
    const saving = fixture(1, 1, schedule);
    const uploading = fixture(1, 1, schedule);
    for (const f of [saving, uploading]) {
      const ready = f.receive();
      f.input.postMessage({ file: new Blob(['x']) });
      await ready;
    }
    let openDialog: () => void;
    const opened = new Promise<void>((resolve) => {
      openDialog = resolve;
    });
    let closeDialog: () => void;
    saving.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          closeDialog = resolve;
          openDialog();
        })
    );
    const save = saving.call({ kind: 'save', file: 0, filename: 'test.txt' });
    await opened;
    try {
      const upload = await uploading.call({
        kind: 'upload',
        file: 0,
        start: 0,
        end: 1,
        index: 0,
        endpoint: 'https://node.invalid/arbitrary/FILE/name/chunk',
      });
      expect(upload.error).toBeUndefined();
    } finally {
      closeDialog();
    }
    expect((await save).error).toBeUndefined();
  });
  it('matches independent AES-CTR encryption, including offsets beyond 2 GiB', async () => {
    const key = randomBytes(32),
      iv = randomBytes(16),
      plaintext = randomBytes(8192);
    let uploaded: Blob;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        uploaded = options.body.get('chunk');
        return new Response(null, { status: 200 });
      })
    );
    const f = fixture(plaintext.length, 1);
    const reply = f.receive();
    f.input.postMessage({ file: new Blob([plaintext]) });
    await reply;
    await f.call({
      kind: 'upload',
      file: 0,
      start: 16,
      end: plaintext.length,
      index: 1,
      endpoint: 'https://node.invalid/arbitrary/FILE/name/chunk',
      encryption: { key, iv },
    });
    const cipher = createCipheriv('aes-256-ctr', key, iv);
    const expected = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]).subarray(16);
    expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(expected);
    const zero = new Uint8Array(16);
    expect(Buffer.from(fileCounter(zero, 2 ** 31)).toString('hex')).toBe(
      '00000000000000000000000008000000'
    );
    expect(Buffer.from(fileCounter(zero, 2 ** 32)).toString('hex')).toBe(
      '00000000000000000000000010000000'
    );
  });
});
