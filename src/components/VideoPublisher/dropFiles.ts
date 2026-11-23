/**
 * The files of a drop, folders opened (a dropped season folder gives its
 * episodes). Chromium hands folders over as FileSystemDirectoryEntry.
 */

/** Folders this deep are opened at most, and this many files read. */
const MAX_DEPTH = 4;
const MAX_FILES = 2000;

const readEntries = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) =>
    reader.readEntries(resolve, reject)
  );

const fileOf = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

export type DroppedFiles = {
  files: File[];
  /**
   * Where each file sat in a dropped folder ("Show/Season 1/E01.mkv"), as a
   * folder picker's webkitRelativePath, which a dropped file doesn't have;
   * undefined for a file dropped by itself.
   */
  relativePaths: (string | undefined)[];
};

async function collect(
  entry: FileSystemEntry,
  depth: number,
  out: DroppedFiles
): Promise<void> {
  if (out.files.length >= MAX_FILES) return;
  if (entry.isFile) {
    out.files.push(await fileOf(entry as FileSystemFileEntry));
    out.relativePaths.push(
      depth > 0 ? entry.fullPath.replace(/^\//, '') : undefined
    );
    return;
  }
  if (!entry.isDirectory || depth >= MAX_DEPTH) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns a batch at a time, until an empty one.
  for (;;) {
    const batch = await readEntries(reader);
    if (!batch.length) break;
    for (const child of batch) await collect(child, depth + 1, out);
  }
}

export async function filesFromDrop(
  transfer: DataTransfer
): Promise<DroppedFiles> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) {
    const files = Array.from(transfer.files ?? []);
    return { files, relativePaths: files.map(() => undefined) };
  }
  const out: DroppedFiles = { files: [], relativePaths: [] };
  for (const entry of entries) {
    try {
      await collect(entry, 0, out);
    } catch {
      // An unreadable entry is left out; the rest still come.
    }
  }
  return out;
}

/** A drag that carries files (not text or a link). */
export const isFileDrag = (transfer: DataTransfer | null) =>
  Boolean(transfer && Array.from(transfer.types ?? []).includes('Files'));
