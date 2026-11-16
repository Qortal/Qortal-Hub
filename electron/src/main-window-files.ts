import type {
  Dialog,
  IpcMain,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, basename, resolve } from 'path';
import { isUint8Array } from 'util/types';
import AdmZip from 'adm-zip';

type Grants = {
  reads: Map<string, string>;
  directories: Map<string, string>;
  writes: Map<string, string>;
};

type PickerOptions = {
  /** Where the picker opens, e.g. the folder used last time. */
  defaultPath?: unknown;
  /** Count the zipped files modified after this time (ms). */
  changedSince?: unknown;
};

const pickerOptions = (value: unknown): PickerOptions =>
  value && typeof value === 'object' ? (value as PickerOptions) : {};

/**
 * Where to open the picker. Only a hint for the dialog: it grants nothing,
 * and a path that no longer exists opens the usual picker instead.
 */
async function pickerDefaultPath(options: unknown): Promise<string | null> {
  const { defaultPath } = pickerOptions(options);
  if (
    typeof defaultPath !== 'string' ||
    !isAbsolute(defaultPath) ||
    defaultPath.includes('\0')
  ) {
    return null;
  }
  try {
    await fs.stat(defaultPath);
    return resolve(defaultPath);
  } catch {
    return null;
  }
}

function changedSince(options: unknown): number | null {
  const { changedSince: since } = pickerOptions(options);
  return typeof since === 'number' && Number.isFinite(since) && since > 0
    ? since
    : null;
}

/**
 * How many of the zip's files were modified after `since`. It counts the
 * zip's own entries, so it skips exactly what the zip skips.
 */
async function countFilesChangedSince(
  root: string,
  zip: Pick<AdmZip, 'getEntries'>,
  since: number
): Promise<number> {
  let changed = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    try {
      const stats = await fs.stat(join(root, ...entry.entryName.split('/')));
      if (stats.isFile() && stats.mtimeMs > since) changed += 1;
    } catch {
      // Gone since it was zipped.
    }
  }
  return changed;
}

export function installMainWindowFileCleanup(
  contents: Pick<WebContents, 'id' | 'on'>,
  cleanup: (contentsId: number) => void
): void {
  // Capture identity while alive: shutdown callbacks must not look up the
  // BrowserWindow's webContents or read properties from destroyed objects.
  const contentsId = contents.id;
  const reset = () => cleanup(contentsId);
  contents.on('did-navigate', reset);
  contents.on('render-process-gone', reset);
  contents.on('destroyed', reset);
}

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

  ipcMain.handle('dialog:openFile', async (event, options) => {
    const { grants, checkLive } = capture(event);
    const defaultPath = await pickerDefaultPath(options);
    checkLive();
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
      ...(defaultPath ? { defaultPath } : {}),
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
  ipcMain.handle('fs:selectAndZip', async (event, existingPath, options) => {
    const { grants, checkLive } = capture(event);
    let directoryPath = existingPath;
    if (!directoryPath) {
      const defaultPath = await pickerDefaultPath(options);
      checkLive();
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        ...(defaultPath ? { defaultPath } : {}),
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
    const buffer = zip.toBuffer();
    const since = changedSince(options);
    if (since === null) return { buffer, directoryPath };
    const changedFiles = await countFilesChangedSince(target, zip, since);
    checkLive();
    return { buffer, directoryPath, changedFiles };
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
