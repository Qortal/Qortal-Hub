/**
 * Where the files of a publish come from: a zip, or (in the desktop app) a
 * folder that the main process zips. Electron's main process only reads paths
 * picked in its own dialog during this session, so "same folder as last time"
 * opens that dialog at the saved path instead of reading it directly.
 */

export type PublishSource = {
  /** The zip to publish. */
  file: File;
  kind: 'folder' | 'zip';
  /** The folder's or the zip's name, for display. */
  name: string;
  /** Where it is on this PC, when known. */
  path: string | null;
  /** When the files were read. */
  takenAt: number;
  /** Files modified since the last publish (folders only), when counted. */
  changedFiles: number | null;
};

type PickerOptions = { defaultPath?: string };

type FileBridge = {
  selectFile?: (options?: PickerOptions) => Promise<string | undefined>;
  readFile?: (filePath: string) => Promise<Uint8Array>;
  selectAndZipDirectory?: (
    existingPath?: string,
    options?: PickerOptions & { changedSince?: number }
  ) => Promise<{
    buffer: Uint8Array;
    directoryPath: string;
    changedFiles?: number;
  } | null>;
  getPathForFile?: (file: File) => string;
};

const fileBridge = (): FileBridge | undefined =>
  (window as unknown as { electron?: FileBridge }).electron;

/** The desktop app can zip a folder. */
export const canPickFolder = () =>
  typeof fileBridge()?.selectAndZipDirectory === 'function';

/** The desktop app can reopen a zip through its own dialog. */
export const canPickZip = () =>
  typeof fileBridge()?.selectFile === 'function' &&
  typeof fileBridge()?.readFile === 'function';

const lastSegment = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path;

const zipFile = (bytes: Uint8Array, name: string) =>
  new File([bytes as BlobPart], name, { type: 'application/zip' });

/** Opens the folder picker (at `defaultPath` if given); null if cancelled. */
export const pickFolderSource = async ({
  defaultPath,
  changedSince,
}: {
  defaultPath?: string;
  changedSince?: number | null;
} = {}): Promise<PublishSource | null> => {
  const options: PickerOptions & { changedSince?: number } = {};
  if (defaultPath) options.defaultPath = defaultPath;
  if (changedSince) options.changedSince = changedSince;
  const result = await fileBridge()?.selectAndZipDirectory?.(
    undefined,
    options
  );
  if (!result?.buffer || !result.directoryPath) return null;
  const name = lastSegment(result.directoryPath);
  return {
    file: zipFile(result.buffer, `${name}.zip`),
    kind: 'folder',
    name,
    path: result.directoryPath,
    takenAt: Date.now(),
    changedFiles:
      typeof result.changedFiles === 'number' ? result.changedFiles : null,
  };
};

/** Opens the zip picker (at `defaultPath` if given); null if cancelled. */
export const pickZipSource = async ({
  defaultPath,
}: { defaultPath?: string } = {}): Promise<PublishSource | null> => {
  const bridge = fileBridge();
  const filePath = await bridge?.selectFile?.(
    defaultPath ? { defaultPath } : {}
  );
  if (!filePath) return null;
  const bytes = await bridge.readFile(filePath);
  const name = lastSegment(filePath);
  return {
    file: zipFile(bytes, name),
    kind: 'zip',
    name,
    path: filePath,
    takenAt: Date.now(),
    changedFiles: null,
  };
};

/** A zip picked or dropped in the page; its path is known in the desktop app. */
export const sourceFromFile = (file: File): PublishSource => {
  let path: string | null = null;
  try {
    path = fileBridge()?.getPathForFile?.(file) || null;
  } catch {
    path = null;
  }
  return {
    file,
    kind: 'zip',
    name: file.name,
    path,
    takenAt: Date.now(),
    changedFiles: null,
  };
};
