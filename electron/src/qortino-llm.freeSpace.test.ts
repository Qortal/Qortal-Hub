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
}));

vi.mock('electron', () => ({
  app: { getPath: () => fake.userData, on: () => undefined },
  dialog: {},
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      fake.handlers.set(channel, handler);
    },
  },
  net: {},
  utilityProcess: { fork: () => undefined },
}));
vi.mock('./index', () => ({
  myCapacitorApp: {
    getMainWindow: () => fake.window,
    getCustomURLScheme: () => 'capacitor-electron',
  },
}));

import { registerQortinoLlmIpcHandlers } from './qortino-llm';

/** The model a link points at: 4 MiB, sent with its length. */
const MODEL_BYTES = 4 * 1024 * 1024;
/** What is free on the disk Qortino's folder is on. */
const FREE_BYTES = 1024 * 1024;

const servingFetch = async () =>
  new Response(new Uint8Array(MODEL_BYTES), {
    status: 200,
    headers: { 'content-length': String(MODEL_BYTES) },
  });

describe('a model downloaded by link, on a disk with too little room', () => {
  let event: unknown;
  const call = (channel: string, args?: unknown) =>
    fake.handlers.get(channel)!(event, args);

  beforeAll(() => {
    registerQortinoLlmIpcHandlers();
  });

  beforeEach(async () => {
    fake.userData = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'qortino-space-')
    );
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      mainFrame: { url: 'capacitor-electron://-/' },
      send: vi.fn(),
      session: { fetch: servingFetch },
    });
    fake.window = { isDestroyed: () => false, webContents: contents };
    event = { sender: contents, senderFrame: contents.mainFrame };
    // The disk has 1 MiB free (the same figure Qortino's own download checks).
    const realStatfs = fs.promises.statfs.bind(fs.promises);
    vi.spyOn(fs.promises, 'statfs').mockImplementation((async (
      target: fs.PathLike
    ) => {
      const stat = await realStatfs(target);
      return { ...stat, bsize: 4096, bavail: FREE_BYTES / 4096 };
    }) as typeof fs.promises.statfs);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(fake.userData, { recursive: true, force: true });
  });

  it('does not write a model bigger than the free space', async () => {
    const tier = (await call('qortino:getDeviceTier')) as {
      availStorageBytes: number;
    };
    expect(tier.availStorageBytes).toBe(FREE_BYTES);

    const relativePath = 'other-models/abc123/big-model.gguf';
    const target = path.join(fake.userData, 'Qortino AI', relativePath);
    const outcome = await call('qortino:downloadUrl', {
      url: 'https://example.com/big-model.gguf',
      relativePath,
    }).then(
      () => 'saved',
      (error: Error) => error.message
    );

    // On a real disk the write runs until the disk is full and the .part
    // stays; nothing may be written past what is free.
    expect(outcome).not.toBe('saved');
    const written = Math.max(
      fs.existsSync(target) ? fs.statSync(target).size : 0,
      fs.existsSync(`${target}.part`) ? fs.statSync(`${target}.part`).size : 0
    );
    expect(written).toBeLessThanOrEqual(FREE_BYTES);
  });
});
