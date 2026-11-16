import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPublishProfileStore,
  publishProfileKey,
  registerPublishProfileIpc,
} from './publish-profiles';

const ADDRESS = `Q${'a'.repeat(33)}`;
const OTHER_ADDRESS = `Q${'b'.repeat(33)}`;
const LOGO_HASH = 'a'.repeat(64);
const SIGNATURE = '3'.repeat(88);

const appKey = (overrides = {}) => ({
  address: ADDRESS,
  service: 'APP',
  name: 'Q-Notes',
  identifier: '',
  ...overrides,
});

describe('publish profile store', () => {
  let root: string;
  let file: string;
  let store: ReturnType<typeof createPublishProfileStore>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hub-publish-profiles-'));
    file = join(root, 'publish-profiles.json');
    onError = vi.fn();
    store = createPublishProfileStore(() => file, onError);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const onDisk = async () => JSON.parse(await readFile(file, 'utf8'));

  it('has no profile before the first publish', async () => {
    expect(await store.get(appKey())).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('merges new fields into the saved profile and keeps the others', async () => {
    await store.merge(appKey(), {
      source: { path: join(root, 'dist'), kind: 'folder', takenAt: 1000 },
      publishedAt: 2000,
      metadata: {
        title: 'Q-Notes',
        description: 'Notes',
        category: 'tools',
        tags: ['notes'],
      },
    });
    const merged = await store.merge(appKey(), {
      publishedAt: 3000,
      signature: SIGNATURE,
    });

    expect(merged).toEqual({
      source: { path: join(root, 'dist'), kind: 'folder', takenAt: 1000 },
      publishedAt: 3000,
      metadata: {
        title: 'Q-Notes',
        description: 'Notes',
        category: 'tools',
        tags: ['notes'],
      },
      signature: SIGNATURE,
    });
    expect(await createPublishProfileStore(() => file).get(appKey())).toEqual(
      merged
    );
  });

  it('replaces the whole profile on set', async () => {
    await store.merge(appKey(), { publishedAt: 2000, signature: SIGNATURE });
    await store.set(appKey(), { publishedAt: 5000 });
    expect(await store.get(appKey())).toEqual({ publishedAt: 5000 });
  });

  it('keeps one profile per account and resource', async () => {
    await store.merge(appKey(), { publishedAt: 1 });
    await store.merge(appKey({ service: 'WEBSITE' }), { publishedAt: 2 });
    await store.merge(appKey({ address: OTHER_ADDRESS }), { publishedAt: 3 });
    await store.merge(appKey({ service: 'DOCUMENT', identifier: 'q-notes' }), {
      publishedAt: 4,
    });

    expect(await store.get(appKey())).toEqual({ publishedAt: 1 });
    expect(await store.get(appKey({ service: 'WEBSITE' }))).toEqual({
      publishedAt: 2,
    });
    expect(await store.get(appKey({ address: OTHER_ADDRESS }))).toEqual({
      publishedAt: 3,
    });
    expect(
      await store.get(appKey({ service: 'DOCUMENT', identifier: 'q-notes' }))
    ).toEqual({ publishedAt: 4 });
    expect(
      await store.get(appKey({ service: 'DOCUMENT', identifier: 'q-notes2' }))
    ).toBeNull();
  });

  it('treats names regardless of case and a missing identifier as default', () => {
    expect(publishProfileKey(appKey({ name: 'q-NOTES' }))).toBe(
      publishProfileKey(appKey({ identifier: 'default' }))
    );
    expect(publishProfileKey(appKey({ identifier: undefined }))).toBe(
      publishProfileKey(appKey())
    );
  });

  it('refuses keys that do not name one resource of one account', async () => {
    for (const key of [
      null,
      appKey({ address: 'not-an-address' }),
      appKey({ service: 'app/../x' }),
      appKey({ name: '' }),
      appKey({ name: 'line\nbreak' }),
      appKey({ identifier: 'x'.repeat(65) }),
    ]) {
      await expect(store.get(key)).rejects.toThrow(
        'Invalid publish profile key'
      );
      await expect(store.merge(key, { publishedAt: 1 })).rejects.toThrow(
        'Invalid publish profile key'
      );
    }
  });

  it('never stores keys, secrets, the app, its logo or encrypted bytes', async () => {
    const saved = await store.merge(appKey({ service: 'DOCUMENT' }), {
      publishedAt: 2000,
      privateApp: {
        groupId: 42,
        appName: 'Q-Notes',
        logoHash: LOGO_HASH,
        logo: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        secretKey: 'group-secret',
      },
      apiKey: 'node-api-key',
      privateKey: 'private-key',
      groupSecret: 'secret',
      app: 'UEsDBBQAAAAIAA',
      data: 'encrypted-bytes',
      encryptedData: 'encrypted-bytes',
      source: { path: join(root, 'dist'), kind: 'folder', buffer: [1, 2, 3] },
    });

    expect(saved).toEqual({
      publishedAt: 2000,
      privateApp: { groupId: 42, appName: 'Q-Notes', logoHash: LOGO_HASH },
      source: { path: join(root, 'dist'), kind: 'folder' },
    });
    const raw = await readFile(file, 'utf8');
    for (const secret of [
      'iVBORw0KGgo',
      'group-secret',
      'node-api-key',
      'private-key',
      'UEsDBBQ',
      'encrypted-bytes',
      'apiKey',
      'buffer',
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('drops values of the wrong shape', async () => {
    const saved = await store.merge(appKey(), {
      source: { path: 'relative/dist', kind: 'folder' },
      publishedAt: -5,
      metadata: { title: 42, tags: ['ok', 7, null] },
      privateApp: { groupId: 'abc', appName: 'X' },
      signature: 'not base58!',
    });
    expect(saved).toEqual({
      metadata: { title: '', description: '', category: '', tags: ['ok'] },
    });
    expect(
      (
        await store.merge(appKey(), {
          privateApp: { groupId: 7, appName: 'X', logoHash: 'nothex' },
        })
      ).privateApp
    ).toEqual({ groupId: 7, appName: 'X' });
  });

  it('reads a corrupt store as empty and writes a valid one again', async () => {
    await writeFile(file, '{"version":1,"profiles":{');
    expect(await store.get(appKey())).toBeNull();
    expect(onError).toHaveBeenCalled();

    await store.merge(appKey(), { publishedAt: 7 });
    expect(await onDisk()).toEqual({
      version: 1,
      profiles: {
        [publishProfileKey(appKey())]: {
          publishedAt: 7,
          updatedAt: expect.any(Number),
        },
      },
    });
  });

  it('ignores a store of another version and entries it cannot use', async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 99, profiles: { x: { publishedAt: 1 } } })
    );
    expect(await store.get(appKey())).toBeNull();

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        profiles: {
          [publishProfileKey(appKey())]: { apiKey: 'leaked', publishedAt: 9 },
          [publishProfileKey(appKey({ service: 'WEBSITE' }))]: 'garbage',
        },
      })
    );
    expect(await store.get(appKey())).toEqual({ publishedAt: 9 });
    expect(await store.get(appKey({ service: 'WEBSITE' }))).toBeNull();
  });

  it('applies concurrent saves one after another, losing none', async () => {
    await Promise.all([
      store.merge(appKey(), { publishedAt: 1 }),
      store.merge(appKey({ service: 'WEBSITE' }), { publishedAt: 2 }),
      store.merge(appKey(), { signature: SIGNATURE }),
    ]);
    expect(await store.get(appKey())).toEqual({
      publishedAt: 1,
      signature: SIGNATURE,
    });
    expect(await store.get(appKey({ service: 'WEBSITE' }))).toEqual({
      publishedAt: 2,
    });
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.tmp'))
    ).toEqual([]);
  });
});

describe('publish profile IPC', () => {
  let root: string;
  let handlers: Map<string, (...args: any[]) => Promise<any>>;
  let event: any;
  const call = (channel: string, ...args: any[]) =>
    handlers.get(channel)!(event, ...args);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hub-publish-profiles-ipc-'));
    handlers = new Map();
    event = { sender: { id: 1 }, trusted: true };
    registerPublishProfileIpc({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler as any),
      },
      checkSender: (e: any) => {
        if (!e.trusted) throw new Error('Untrusted sender');
      },
      getFilePath: () => join(root, 'publish-profiles.json'),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves and reads profiles for the main window', async () => {
    await call('publishProfiles:merge', appKey(), { publishedAt: 5 });
    expect(await call('publishProfiles:get', appKey())).toEqual({
      publishedAt: 5,
    });
  });

  it('rejects other senders before touching the store', async () => {
    event.trusted = false;
    await expect(
      call('publishProfiles:merge', appKey(), { publishedAt: 5 })
    ).rejects.toThrow('Untrusted sender');
    await expect(call('publishProfiles:get', appKey())).rejects.toThrow(
      'Untrusted sender'
    );
    expect(await readdir(root)).toEqual([]);
  });
});
