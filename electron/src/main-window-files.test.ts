import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMainWindowFileIpc } from './main-window-files';

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
