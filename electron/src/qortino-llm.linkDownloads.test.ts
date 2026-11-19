import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

type Handler = (event: unknown, args?: unknown) => Promise<unknown>;

const fake = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, Handler>(),
  window: null as unknown,
  fetch: null as unknown as (
    url: string,
    init?: RequestInit
  ) => Promise<Response>,
}));

vi.mock('electron', async () => {
  const events = await import('node:events');
  class ModelProcess extends events.EventEmitter {
    postMessage(message: { id: string }) {
      setImmediate(() =>
        this.emit('message', {
          type: 'reply',
          id: message.id,
          ok: true,
          result: {},
        })
      );
    }
    kill() {
      return true;
    }
  }
  return {
    app: { getPath: () => fake.userData, on: () => undefined },
    dialog: {},
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        fake.handlers.set(channel, handler);
      },
    },
    net: {},
    utilityProcess: { fork: () => new ModelProcess() },
  };
});
vi.mock('./index', () => ({
  myCapacitorApp: {
    getMainWindow: () => fake.window,
    getCustomURLScheme: () => 'capacitor-electron',
  },
}));

import { registerQortinoLlmIpcHandlers } from './qortino-llm';

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await settle(5);
}

describe('Qortino link downloads in the main process', () => {
  let event: unknown;
  const call = (channel: string, args?: unknown) =>
    fake.handlers.get(channel)!(event, args);

  beforeAll(() => {
    registerQortinoLlmIpcHandlers();
  });

  beforeEach(async () => {
    fake.userData = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'qortino-links-')
    );
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      mainFrame: { url: 'capacitor-electron://-/' },
      send: vi.fn(),
      session: {
        fetch: (url: string, init?: RequestInit) => fake.fetch(url, init),
      },
    });
    fake.window = { isDestroyed: () => false, webContents: contents };
    event = { sender: contents, senderFrame: contents.mainFrame };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await call('qortino:cancelDownload', {}).catch(() => undefined);
    await settle();
    await fs.promises.rm(fake.userData, { recursive: true, force: true });
  });

  it('does not save a web page as the model when the link is not to the file itself', async () => {
    // The address of a model's page on Hugging Face ("blob"), not the file.
    fake.fetch = async () =>
      new Response(
        '<!doctype html><html><head><title>model.gguf</title></head><body>…</body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    const relativePath = 'other-models/abc123/model.gguf';

    const outcome = await call('qortino:downloadUrl', {
      url: 'https://huggingface.co/someone/model-GGUF/blob/main/model.gguf',
      relativePath,
    }).then(
      () => 'saved',
      (error: Error) => error.message
    );

    expect(outcome).not.toBe('saved');
    expect(
      fs.existsSync(path.join(fake.userData, 'Qortino AI', relativePath))
    ).toBe(false);
  });

  it('saves the file when the link brings a GGUF model', async () => {
    const model = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
    fake.fetch = async () =>
      new Response(model, {
        status: 200,
        headers: { 'content-length': String(model.length) },
      });
    const relativePath = 'other-models/abc124/model.gguf';

    const result = (await call('qortino:downloadUrl', {
      url: 'https://huggingface.co/someone/model-GGUF/resolve/main/model.gguf',
      relativePath,
    })) as { path: string; bytesWritten: number };

    expect(result.bytesWritten).toBe(model.length);
    expect(fs.readFileSync(result.path)).toEqual(Buffer.from(model));
  });

  it('keeps a finished download it could not read, and does not call it a web page', async () => {
    const model = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
    fake.fetch = async () =>
      new Response(model, {
        status: 200,
        headers: { 'content-length': String(model.length) },
      });
    const relativePath = 'other-models/abc125/model.gguf';
    const target = path.join(fake.userData, 'Qortino AI', relativePath);
    // Another program holds the file for a moment (a virus scanner, say).
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation((async (
      file: fs.PathLike,
      ...rest: unknown[]
    ) => {
      if (String(file) === target) {
        throw Object.assign(new Error('EBUSY: resource busy or locked'), {
          code: 'EBUSY',
        });
      }
      return (realOpen as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.promises.open);

    const outcome = await call('qortino:downloadUrl', {
      url: 'https://huggingface.co/someone/model-GGUF/resolve/main/model.gguf',
      relativePath,
    }).then(
      () => 'saved',
      (error: Error) => error.message
    );

    expect(outcome).not.toBe('saved');
    expect(outcome).not.toBe('not_gguf');
    expect(fs.readFileSync(target)).toEqual(Buffer.from(model));
  });

  it('trying again checks the file a last try saved, without downloading it again', async () => {
    const model = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0]);
    const relativePath = 'other-models/abc126/model.gguf';
    const target = path.join(fake.userData, 'Qortino AI', relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, model);
    let requests = 0;
    fake.fetch = async () => {
      requests += 1;
      return new Response(model, {
        status: 200,
        headers: { 'content-length': String(model.length) },
      });
    };

    const result = (await call('qortino:downloadUrl', {
      url: 'https://huggingface.co/someone/model-GGUF/resolve/main/model.gguf',
      relativePath,
    })) as { path: string; bytesWritten: number };

    expect(requests).toBe(0);
    expect(result).toEqual({ path: target, bytesWritten: model.length });
  });

  it('does not fill the disk with a link model bigger than the free space', async () => {
    // 2 MB free on the disk; the model is 18 GB.
    const realStatfs = fs.promises.statfs.bind(fs.promises);
    vi.spyOn(fs.promises, 'statfs').mockImplementation((async (
      dir: fs.PathLike
    ) => {
      const real = await realStatfs(dir);
      return { ...real, bsize: 4096, bavail: (2 * 1024 ** 2) / 4096 };
    }) as typeof fs.promises.statfs);
    let sent = 0;
    fake.fetch = async (_url, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            // Sends as long as it is read, until stopped.
            if (init?.signal?.aborted) return;
            sent += 256 * 1024;
            controller.enqueue(new Uint8Array(256 * 1024));
            return settle(1);
          },
          cancel() {
            /* stopped */
          },
        }),
        {
          status: 200,
          headers: { 'content-length': String(18_556_686_752) },
        }
      );
    const relativePath = 'other-models/def456/big.gguf';
    let outcome = 'pending';
    void call('qortino:downloadUrl', {
      url: 'https://huggingface.co/x/resolve/main/big.gguf',
      relativePath,
    }).then(
      () => {
        outcome = 'saved';
      },
      (error: Error) => {
        outcome = error.message;
      }
    );
    await until(() => outcome !== 'pending' || sent >= 4 * 1024 ** 2, 5_000);

    // Refused, rather than writing until the disk is full.
    expect(outcome).not.toBe('pending');
    expect(sent).toBeLessThan(2 * 1024 ** 2);
  });
});
