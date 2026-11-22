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

type Posted = { id: string; op: string };
type FakeModelProcess = EventEmitter & { posted: Posted[]; killed: boolean };
type Handler = (event: unknown, args?: unknown) => Promise<unknown>;

const fake = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, Handler>(),
  processes: [] as FakeModelProcess[],
  window: null as unknown,
}));

vi.mock('electron', async () => {
  const events = await import('node:events');
  /** A model process that answers every call, each in a turn of its own. */
  class ModelProcess extends events.EventEmitter {
    posted: Posted[] = [];
    killed = false;
    postMessage(message: Posted) {
      this.posted.push(message);
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
      this.killed = true;
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
    utilityProcess: {
      fork: () => {
        const child = new ModelProcess();
        fake.processes.push(child as unknown as FakeModelProcess);
        return child;
      },
    },
  };
});
vi.mock('./index', () => ({
  myCapacitorApp: {
    getMainWindow: () => fake.window,
    getCustomURLScheme: () => 'capacitor-electron',
  },
}));

import { registerQortinoLlmIpcHandlers } from './qortino-llm';

/** A transfer that sends a few bytes, then waits until it is stopped. */
const stalledFetch = async (_url: string, init?: RequestInit) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('saved so far'));
        init?.signal?.addEventListener('abort', () =>
          controller.error(new Error('aborted'))
        );
      },
    }),
    { status: 200 }
  );

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await settle(5);
}

describe('Qortino in the main process when the Hub page goes away', () => {
  let page: EventEmitter;
  let event: unknown;
  const call = (channel: string, args?: unknown) =>
    fake.handlers.get(channel)!(event, args);

  beforeAll(() => {
    registerQortinoLlmIpcHandlers({
      isNodeUrl: (url) => url.startsWith('http://127.0.0.1:12391/'),
    });
  });

  beforeEach(async () => {
    fake.userData = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'qortino-main-')
    );
    fake.processes.length = 0;
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      mainFrame: { url: 'capacitor-electron://-/' },
      send: vi.fn(),
      session: { fetch: stalledFetch },
    });
    page = contents;
    fake.window = { isDestroyed: () => false, webContents: contents };
    event = { sender: contents, senderFrame: contents.mainFrame };
  });

  afterEach(async () => {
    // Refused once the window is gone; nothing is downloading then anyway.
    await call('qortino:cancelDownload', {}).catch(() => undefined);
    await settle();
    await fs.promises.rm(fake.userData, { recursive: true, force: true });
  });

  it('unloads the model when the page is reloaded', async () => {
    const modelPath = path.join(
      fake.userData,
      'Qortino AI',
      'models',
      'm.gguf'
    );
    await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.promises.writeFile(modelPath, 'gguf');
    await call('qortino:loadModel', { path: modelPath });
    const [modelProcess] = fake.processes;
    expect(modelProcess.posted.map((message) => message.op)).toEqual(['load']);

    // The page's own release timer is gone with it.
    page.emit('did-navigate');
    await settle();

    expect(modelProcess.posted.map((message) => message.op)).toContain(
      'unload'
    );
    expect(modelProcess.killed).toBe(true);
  });

  it('takes what the model process says after the window is gone', async () => {
    const modelPath = path.join(
      fake.userData,
      'Qortino AI',
      'models',
      'm.gguf'
    );
    await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.promises.writeFile(modelPath, 'gguf');
    await call('qortino:loadModel', { path: modelPath });
    const [modelProcess] = fake.processes;

    // Electron throws when a destroyed window is asked for its page.
    fake.window = {
      isDestroyed: () => true,
      get webContents(): never {
        throw new TypeError('Object has been destroyed');
      },
    };
    page.emit('destroyed');

    expect(() =>
      modelProcess.emit('message', {
        type: 'event',
        event: 'progress',
        payload: { stage: 'load', detail: '', percent: 50 },
      })
    ).not.toThrow();
    await settle();
    expect(modelProcess.killed).toBe(true);
  });

  it('stops a download when the page is reloaded, and keeps what it saved', async () => {
    const relativePath = 'other-models/abc/m.gguf';
    const part = `${path.join(fake.userData, 'Qortino AI', relativePath)}.part`;
    let outcome = 'pending';
    void call('qortino:downloadUrl', {
      url: 'http://127.0.0.1:12391/arbitrary/FILE/Qortino%20AI/qshare_file_m',
      relativePath,
    }).then(
      () => {
        outcome = 'saved';
      },
      (error: Error) => {
        outcome = error.message;
      }
    );
    await until(() => fs.existsSync(part) && fs.statSync(part).size > 0);
    expect(outcome).toBe('pending');

    page.emit('did-navigate');
    await until(() => outcome !== 'pending');

    expect(outcome).toBe('cancelled');
    expect(fs.readFileSync(part, 'utf8')).toBe('saved so far');
    // The next page can ask for it again.
    const again = call('qortino:downloadUrl', {
      url: 'http://127.0.0.1:12391/arbitrary/FILE/Qortino%20AI/qshare_file_m',
      relativePath,
    });
    again.catch(() => undefined);
    await expect(
      Promise.race([again, settle(50).then(() => 'downloading')])
    ).resolves.toBe('downloading');
  });
});
