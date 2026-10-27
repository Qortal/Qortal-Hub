import type { Dialog, IpcMain, IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, basename, resolve } from 'path';
import { isUint8Array } from 'util/types';
import AdmZip from 'adm-zip';

type Grants = {
  reads: Map<string, string>;
  directories: Map<string, string>;
  writes: Map<string, string>;
};

// Keep the renderer API compatible, but only accept paths selected by a native
// dialog in this document's lifetime. A read grant never grants write access.
export function registerMainWindowFileIpc({
  ipcMain,
  dialog,
  checkSender,
}: {
  ipcMain: Pick<IpcMain, 'handle'>;
  dialog: Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>;
  checkSender: (event: IpcMainInvokeEvent) => void;
}) {
  const owners = new Map<number, Grants>();
  const capture = (event: IpcMainInvokeEvent) => {
    checkSender(event);
    let grants = owners.get(event.sender.id);
    if (!grants) {
      grants = { reads: new Map(), directories: new Map(), writes: new Map() };
      owners.set(event.sender.id, grants);
    }
    const checkLive = () => {
      checkSender(event);
      if (owners.get(event.sender.id) !== grants) {
        throw new Error('File selection belongs to a previous document');
      }
    };
    return { grants, checkLive };
  };
  const absolute = (value: unknown): string => {
    if (
      typeof value !== 'string' ||
      !isAbsolute(value) ||
      value.includes('\0')
    ) {
      throw new Error('Invalid file path');
    }
    return resolve(value);
  };
  const destination = async (filePath: string): Promise<string> => {
    try {
      return await fs.realpath(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return join(await fs.realpath(dirname(filePath)), basename(filePath));
    }
  };
  const selected = async (
    paths: Map<string, string>,
    value: unknown,
    forWrite = false
  ): Promise<string> => {
    const filePath = absolute(value);
    const granted = paths.get(filePath);
    if (!granted) throw new Error('Path was not selected by the user');
    const current = await (forWrite
      ? destination(filePath)
      : fs.realpath(filePath));
    if (current !== granted) throw new Error('Selected path has changed');
    return current;
  };

  ipcMain.handle('dialog:openFile', async (event) => {
    const { grants, checkLive } = capture(event);
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
    });
    checkLive();
    if (result.canceled || !result.filePaths[0]) return undefined;
    const filePath = absolute(result.filePaths[0]);
    const realPath = await fs.realpath(filePath);
    checkLive();
    grants.reads.set(filePath, realPath);
    return filePath;
  });
  ipcMain.handle('fs:readFile', async (event, filePath) => {
    const { grants, checkLive } = capture(event);
    const target = await selected(grants.reads, filePath);
    checkLive();
    return fs.readFile(target);
  });
  ipcMain.handle('fs:selectAndZip', async (event, existingPath) => {
    const { grants, checkLive } = capture(event);
    let directoryPath = existingPath;
    if (!directoryPath) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });
      checkLive();
      if (result.canceled || !result.filePaths[0]) return null;
      directoryPath = absolute(result.filePaths[0]);
      const realPath = await fs.realpath(directoryPath);
      checkLive();
      grants.directories.set(directoryPath, realPath);
    }
    const target = await selected(grants.directories, directoryPath);
    checkLive();
    const zip = new AdmZip();
    zip.addLocalFolder(target);
    return { buffer: zip.toBuffer(), directoryPath };
  });
  ipcMain.handle('file:startStreamSave', async (event, options) => {
    const { grants, checkLive } = capture(event);
    if (typeof options?.filename !== 'string')
      throw new Error('Invalid filename');
    const result = await dialog.showSaveDialog({
      defaultPath: options.filename,
      filters: options.mimeType
        ? [
            {
              name: 'File',
              extensions: [options.filename.split('.').pop() || '*'],
            },
          ]
        : undefined,
    });
    checkLive();
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = absolute(result.filePath);
    const realPath = await destination(filePath);
    checkLive();
    grants.writes.set(filePath, realPath);
    return { canceled: false, filePath };
  });
  ipcMain.handle('file:writeChunk', async (event, filePath, chunk, append) => {
    const { grants, checkLive } = capture(event);
    const target = await selected(grants.writes, filePath, true);
    if (!isUint8Array(chunk) || typeof append !== 'boolean') {
      throw new Error('Invalid file chunk');
    }
    checkLive();
    if (append) await fs.appendFile(target, chunk);
    else await fs.writeFile(target, chunk);
    return true;
  });
  ipcMain.handle('file:deleteFile', async (event, filePath) => {
    const { grants, checkLive } = capture(event);
    const target = await selected(grants.writes, filePath, true);
    checkLive();
    grants.writes.delete(absolute(filePath));
    try {
      await fs.unlink(target);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  });
  return { revoke: (contentsId: number) => owners.delete(contentsId) };
}
