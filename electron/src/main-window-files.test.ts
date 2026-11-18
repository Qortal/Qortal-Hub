import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  unlink,
  utimes,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installMainWindowFileCleanup,
  registerMainWindowFileIpc,
} from './main-window-files';

describe('main window file cleanup lifecycle', () => {
  it('cleans up after destruction without reading destroyed native objects', () => {
    const contents = new EventEmitter();
    let destroyed = false;
    Object.defineProperty(contents, 'id', {
      get: () => {
        if (destroyed) throw new TypeError('Object has been destroyed');
        return 42;
      },
    });
    const cleanup = vi.fn();
    installMainWindowFileCleanup(contents as any, cleanup);
    contents.emit('did-navigate');
    contents.emit('render-process-gone');
    destroyed = true;
    expect(() => contents.emit('destroyed')).not.toThrow();
    expect(cleanup.mock.calls).toEqual([[42], [42], [42]]);
  });

  it('ignores blocked navigations and unrelated guest lifecycles', () => {
    const contents = Object.assign(new EventEmitter(), { id: 42 });
    const guest = Object.assign(new EventEmitter(), { id: 43 });
    const cleanup = vi.fn();
    installMainWindowFileCleanup(contents as any, cleanup);
    contents.emit('will-navigate');
    guest.emit('did-navigate');
    guest.emit('destroyed');
    expect(cleanup).not.toHaveBeenCalled();
    contents.emit('destroyed');
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(42);
  });
});

describe('main window file selections', () => {
  let root: string;
  let handlers: Map<string, (...args: any[]) => Promise<any>>;
  let dialogs: any;
  let files: ReturnType<typeof registerMainWindowFileIpc>;
  let event: any;
  const call = (channel: string, ...args: any[]) =>
    handlers.get(channel)!(event, ...args);
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hub-selected-files-'));
    handlers = new Map();
    dialogs = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() };
    event = { sender: { id: 1 }, trusted: true };
    files = registerMainWindowFileIpc({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler as any),
      },
      dialog: dialogs,
      checkSender: (e: any) => {
        if (!e.trusted) throw new Error('Untrusted sender');
      },
    });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it('supports ZIP selection and repeated preview refresh, but not arbitrary reads or writes', async () => {
    const selected = join(root, 'preview.zip');
    const secret = join(root, 'secret');
    await writeFile(selected, 'preview');
    await writeFile(secret, 'secret');
    dialogs.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [selected],
    });
    expect(await call('dialog:openFile')).toBe(selected);
    expect((await call('fs:readFile', selected)).toString()).toBe('preview');
    await writeFile(selected, 'updated');
    expect((await call('fs:readFile', selected)).toString()).toBe('updated');
    await expect(call('fs:readFile', secret)).rejects.toThrow('not selected');
    await expect(
      call('file:writeChunk', selected, new Uint8Array([1]), false)
    ).rejects.toThrow('not selected');
    await expect(call('file:deleteFile', selected)).rejects.toThrow(
      'not selected'
    );
    event.sender.id = 2;
    await expect(call('fs:readFile', selected)).rejects.toThrow('not selected');
  });
  it('preserves folder preview refresh without allowing arbitrary directories', async () => {
    const dir = join(root, 'preview');
    await mkdir(dir);
    await writeFile(join(dir, 'index.html'), 'hello');
    dialogs.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [dir],
    });
    const first = await call('fs:selectAndZip');
    expect(first.directoryPath).toBe(dir);
    expect(first.buffer.length).toBeGreaterThan(0);
    expect((await call('fs:selectAndZip', dir)).buffer).toEqual(first.buffer);
    expect(dialogs.showOpenDialog).toHaveBeenCalledTimes(1);
    await expect(call('fs:selectAndZip', root)).rejects.toThrow('not selected');
  });
  it('opens the folder picker at a saved path and counts files changed since the last publish', async () => {
    const dir = join(root, 'dist');
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), 'old');
    await writeFile(join(dir, 'assets', 'app.js'), 'new');
    await writeFile(join(dir, 'assets', 'style.css'), 'new');
    const lastPublish = Date.now() - 60_000;
    const before = new Date(lastPublish - 60_000);
    const after = new Date(lastPublish + 30_000);
    await utimes(join(dir, 'index.html'), before, before);
    await utimes(join(dir, 'assets', 'app.js'), after, after);
    await utimes(join(dir, 'assets', 'style.css'), after, after);
    // A folder's own time doesn't count: only the files the zip holds.
    await utimes(join(dir, 'assets'), after, after);
    dialogs.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [dir],
    });

    const result = await call('fs:selectAndZip', undefined, {
      defaultPath: dir,
      changedSince: lastPublish,
    });

    expect(dialogs.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      defaultPath: dir,
    });
    expect(result.directoryPath).toBe(dir);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.changedFiles).toBe(2);
    // The same folder again, already granted: the count follows the files.
    await utimes(join(dir, 'index.html'), after, after);
    expect(
      (await call('fs:selectAndZip', dir, { changedSince: lastPublish }))
        .changedFiles
    ).toBe(3);
  });
  it('falls back to the usual pickers when the saved path is gone or invalid', async () => {
    dialogs.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await call('fs:selectAndZip', undefined, {
      defaultPath: join(root, 'moved-away'),
      changedSince: 1,
    });
    await call('dialog:openFile', { defaultPath: 'relative/app.zip' });
    await call('dialog:openFile', { defaultPath: join(root, 'gone.zip') });
    await call('fs:selectAndZip', undefined, { defaultPath: 42 });
    expect(dialogs.showOpenDialog.mock.calls).toEqual([
      [{ properties: ['openDirectory'] }],
      [
        {
          properties: ['openFile'],
          filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
        },
      ],
      [
        {
          properties: ['openFile'],
          filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
        },
      ],
      [{ properties: ['openDirectory'] }],
    ]);
  });
  it('treats a saved path as a place to open the picker, never as a grant', async () => {
    const saved = join(root, 'last.zip');
    const picked = join(root, 'picked.zip');
    await writeFile(saved, 'last');
    await writeFile(picked, 'picked');
    dialogs.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [picked],
    });

    expect(await call('dialog:openFile', { defaultPath: saved })).toBe(picked);
    expect(dialogs.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
      defaultPath: saved,
    });
    expect((await call('fs:readFile', picked)).toString()).toBe('picked');
    await expect(call('fs:readFile', saved)).rejects.toThrow('not selected');
    await expect(
      call('fs:selectAndZip', root, { defaultPath: root })
    ).rejects.toThrow('not selected');
  });
  it('preserves backup writes, chunked downloads, and failed-download cleanup', async () => {
    const output = join(root, 'backup.json');
    dialogs.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: output,
    });
    expect(
      await call('file:startStreamSave', {
        filename: 'backup.json',
        mimeType: 'application/json',
      })
    ).toEqual({ canceled: false, filePath: output });
    await call('file:writeChunk', output, Buffer.from('first'), false);
    await call('file:writeChunk', output, Buffer.from('second'), true);
    expect(await readFile(output, 'utf8')).toBe('firstsecond');
    await expect(
      call('file:writeChunk', join(root, 'other'), Buffer.from('bad'), false)
    ).rejects.toThrow('not selected');
    expect(await call('file:deleteFile', output)).toBe(true);
    await expect(readFile(output)).rejects.toThrow();
    await expect(
      call('file:writeChunk', output, Buffer.from('bad'), false)
    ).rejects.toThrow('not selected');
  });
  it('revokes selections on navigation and rejects dialogs completing for an old document', async () => {
    const selected = join(root, 'preview.zip');
    await writeFile(selected, 'preview');
    dialogs.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [selected],
    });
    await call('dialog:openFile');
    files.revoke(1);
    await expect(call('fs:readFile', selected)).rejects.toThrow('not selected');
    let finish: (v: any) => void;
    dialogs.showSaveDialog.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        })
    );
    const pending = call('file:startStreamSave', { filename: 'test' });
    files.revoke(1);
    finish!({ canceled: false, filePath: join(root, 'test') });
    await expect(pending).rejects.toThrow('previous document');
  });
  it('rejects untrusted IPC senders before dialogs or filesystem access', async () => {
    event.trusted = false;
    for (const channel of handlers.keys()) {
      await expect(call(channel, join(root, 'secret'))).rejects.toThrow(
        'Untrusted sender'
      );
    }
    expect(dialogs.showOpenDialog).not.toHaveBeenCalled();
    expect(dialogs.showSaveDialog).not.toHaveBeenCalled();
  });
  it('handles cancelled dialogs without granting access', async () => {
    dialogs.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    dialogs.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await call('dialog:openFile')).toBeUndefined();
    expect(await call('fs:selectAndZip')).toBeNull();
    expect(await call('file:startStreamSave', { filename: 'test' })).toEqual({
      canceled: true,
    });
  });
  it('rejects a selected path redirected to another file by a symlink', async () => {
    const selected = join(root, 'selected');
    const secret = join(root, 'secret');
    await writeFile(selected, 'selected');
    await writeFile(secret, 'secret');
    dialogs.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: selected,
    });
    await call('file:startStreamSave', { filename: 'selected' });
    await unlink(selected);
    await symlink(secret, selected);
    await expect(
      call('file:writeChunk', selected, Buffer.from('bad'), false)
    ).rejects.toThrow('changed');
    expect(await readFile(secret, 'utf8')).toBe('secret');
  });
});
