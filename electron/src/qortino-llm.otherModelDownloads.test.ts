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

describe('Downloads of other models in the main process', () => {
  let event: unknown;
  const call = (channel: string, args?: unknown) =>
    fake.handlers.get(channel)!(event, args);
  const NODE_PART =
    'http://127.0.0.1:12391/arbitrary/FILE/Qortino%20AI/qshare_file_part';

  beforeAll(() => {
    registerQortinoLlmIpcHandlers({
      isNodeUrl: (url) => url.startsWith('http://127.0.0.1:12391/'),
    });
  });

  beforeEach(async () => {
    fake.userData = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'qortino-other-models-')
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

  it('downloads nothing from a host that is not one of the nodes', async () => {
    let requests = 0;
    fake.fetch = async () => {
      requests += 1;
      return new Response(new Uint8Array(8), { status: 200 });
    };
    for (const url of [
      'https://huggingface.co/someone/model-GGUF/resolve/main/model.gguf',
      'http://127.0.0.1:12392/arbitrary/FILE/Qortino%20AI/qshare_file_part',
      'file:///etc/passwd',
    ]) {
      await expect(
        call('qortino:downloadUrl', {
          url,
          relativePath: 'other-models/big-model/big-00001-of-00002.gguf',
        })
      ).rejects.toThrow('only from your node');
    }
    expect(requests).toBe(0);
    expect(
      fs.existsSync(path.join(fake.userData, 'Qortino AI', 'other-models'))
    ).toBe(false);
  });

  it('downloads a part again when an earlier copy of it is there', async () => {
    // The renderer asks only for a part whose copy is missing or damaged.
    const relativePath = 'other-models/big-model/big-00001-of-00002.gguf';
    const target = path.join(fake.userData, 'Qortino AI', relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, Buffer.from('damaged copy'));
    const part = new Uint8Array([0x47, 0x47, 0x55, 0x46, 3, 0, 0, 0, 9, 9]);
    let requests = 0;
    fake.fetch = async () => {
      requests += 1;
      return new Response(part, {
        status: 200,
        headers: { 'content-length': String(part.length) },
      });
    };

    const result = (await call('qortino:downloadUrl', {
      url: NODE_PART,
      relativePath,
    })) as { path: string; bytesWritten: number };

    expect(requests).toBe(1);
    expect(result).toEqual({ path: target, bytesWritten: part.length });
    expect(fs.readFileSync(target)).toEqual(Buffer.from(part));
  });

  it('does not fill the disk with a part bigger than the free space', async () => {
    // 2 MB free on the disk; the part is 1.8 GB.
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
          headers: { 'content-length': String(1_789_492_512) },
        }
      );
    const relativePath = 'other-models/big-model/big-00002-of-00002.gguf';
    let outcome = 'pending';
    void call('qortino:downloadUrl', {
      url: NODE_PART,
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

  it("deletes a part and its .part, and the model's folder once it is empty", async () => {
    const folder = path.join(fake.userData, 'Qortino AI', 'other-models', 'm');
    await fs.promises.mkdir(folder, { recursive: true });
    for (const name of ['m-00001-of-00002.gguf', 'm-00002-of-00002.gguf']) {
      await fs.promises.writeFile(path.join(folder, name), 'x');
    }
    await fs.promises.writeFile(
      path.join(folder, 'm-00002-of-00002.gguf.part'),
      'x'
    );

    await call('qortino:removeOtherModel', {
      relativePath: 'other-models/m/m-00001-of-00002.gguf',
    });
    expect(fs.readdirSync(folder).sort()).toEqual([
      'm-00002-of-00002.gguf',
      'm-00002-of-00002.gguf.part',
    ]);

    await call('qortino:removeOtherModel', {
      relativePath: 'other-models/m/m-00002-of-00002.gguf',
    });
    expect(fs.existsSync(folder)).toBe(false);
    // Qortino's own folder is not for this.
    await expect(
      call('qortino:removeOtherModel', {
        relativePath: 'models/qortino-00001-of-00002.gguf',
      })
    ).rejects.toThrow();
  });
});
