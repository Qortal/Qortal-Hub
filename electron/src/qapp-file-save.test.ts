import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { QAppFileSaves, SAVE_CHUNK_LIMIT } from './qapp-file-save';

describe('permission-scoped streaming saves', () => {
  let dir: string, destination: string, manager: QAppFileSaves, now: number;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'qapp-save-test-'));
    destination = join(dir, 'chosen.txt');
    now = 0;
    manager = new QAppFileSaves(join(dir, 'journal'), () => now);
  });
  afterEach(async () => {
    await manager.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const open = () =>
    manager.open('tab-a', 'suggested.txt', 3, async () => destination);

  it('does not replace the approved destination until exact-length finish', async () => {
    await fs.writeFile(destination, 'original');
    const { saveId } = await open();
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
    await expect(manager.finish('tab-a', saveId)).rejects.toThrow(
      'SAVE_INCOMPLETE'
    );
    await manager.write('tab-a', saveId, 0, bytes);
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
    expect(await manager.finish('tab-a', saveId)).toEqual({ saved: true });
    expect(new Uint8Array(await fs.readFile(destination))).toEqual(bytes);
    expect(await fs.readdir(join(dir, 'journal'))).toEqual([]);
  });
  it('rejects cross-tab writes/finish and ignores cross-tab abort', async () => {
    const { saveId } = await open();
    await expect(manager.write('tab-b', saveId, 0, bytes)).rejects.toThrow(
      'SAVE_NOT_FOUND'
    );
    await expect(manager.finish('tab-b', saveId)).rejects.toThrow(
      'SAVE_NOT_FOUND'
    );
    await manager.abort('tab-b', saveId);
    await manager.write('tab-a', saveId, 0, bytes);
    await manager.finish('tab-a', saveId);
  });
  it('bounds chunks and enforces size, offset and one in-flight write', async () => {
    const { saveId } = await open();
    await expect(manager.write('tab-a', saveId, 1, bytes)).rejects.toThrow(
      'SAVE_INVALID_CHUNK'
    );
    await expect(
      manager.write('tab-a', saveId, 0, new Uint8Array(SAVE_CHUNK_LIMIT + 1))
    ).rejects.toThrow('SAVE_INVALID_CHUNK');
    await expect(
      manager.write('tab-a', saveId, 0, new Uint8Array(4))
    ).rejects.toThrow('SAVE_INVALID_CHUNK');
    const write = manager.write('tab-a', saveId, 0, bytes);
    await expect(manager.write('tab-a', saveId, 0, bytes)).rejects.toThrow(
      'SAVE_BUSY'
    );
    await write;
  });
  it('cancels an active save without touching an existing destination', async () => {
    await fs.writeFile(destination, 'original');
    const { saveId } = await open();
    await manager.write('tab-a', saveId, 0, bytes);
    await manager.cleanup('tab-a');
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.part'))).toEqual(
      []
    );
    await expect(manager.finish('tab-a', saveId)).rejects.toThrow(
      'SAVE_NOT_FOUND'
    );
  });
  it('invalidates pending approval on logout and creates no file', async () => {
    let choose!: (path: string) => void;
    const opening = manager.open(
      'tab-a',
      'name.txt',
      3,
      () =>
        new Promise((resolve) => {
          choose = resolve;
        })
    );
    while (!choose) await new Promise((resolve) => setTimeout(resolve, 1));
    await manager.cleanup();
    choose(destination);
    await expect(opening).rejects.toThrow('SAVE_CANCELLED');
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.part'))).toEqual(
      []
    );
  });

  it('cancels during an in-flight write and cleans up after that write settles', async () => {
    await fs.writeFile(destination, 'original');
    const { saveId } = await open();
    const writing = manager.write('tab-a', saveId, 0, bytes);
    await manager.abort('tab-a', saveId);
    await expect(writing).rejects.toThrow('SAVE_CANCELLED');
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.part'))).toEqual(
      []
    );
  });
  it('expires idle saves and limits unapproved concurrent prompts', async () => {
    const { saveId } = await open();
    await expect(open()).rejects.toThrow('SAVE_BUSY');
    now = 5 * 60_000 + 1;
    await manager.expire();
    await expect(manager.write('tab-a', saveId, 0, bytes)).rejects.toThrow(
      'SAVE_NOT_FOUND'
    );
  });
  it('rejects paths, bidi filenames and unreasonable sizes before prompting', async () => {
    for (const filename of ['../secret', 'a\\b', 'a\u202etxt'])
      await expect(
        manager.open('tab-a', filename, 3, async () => destination)
      ).rejects.toThrow('SAVE_INVALID_REQUEST');
    await expect(
      manager.open('tab-a', 'ok', 9 * 1024 ** 3, async () => destination)
    ).rejects.toThrow('SAVE_INVALID_REQUEST');
  });
  it('cleans journalled crash remnants without deleting the completed file', async () => {
    await fs.mkdir(join(dir, 'journal'));
    const id = '12345678-1234-1234-1234-123456789abc';
    const part = join(dir, `.qortal-save-${id}.part`);
    await fs.writeFile(part, 'incomplete');
    await fs.writeFile(destination, 'complete');
    await fs.writeFile(
      join(dir, 'journal', `${id}.json`),
      JSON.stringify({ part })
    );
    await manager.initialize();
    await expect(fs.stat(part)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(destination, 'utf8')).toBe('complete');
  });
  it('handles empty files and user cancellation', async () => {
    await expect(
      manager.open('tab-a', 'empty', 0, async () => undefined)
    ).rejects.toThrow('SAVE_CANCELLED');
    const { saveId } = await manager.open(
      'tab-a',
      'empty',
      0,
      async () => destination
    );
    await manager.finish('tab-a', saveId);
    expect((await fs.stat(destination)).size).toBe(0);
  });
});
