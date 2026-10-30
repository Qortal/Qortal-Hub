import {
  QAPP_FILE_GLOBAL_BYTES,
  QAPP_FILE_MAX_FILES,
  QAPP_FILE_REQUEST_BYTES,
} from './qapp-file-protocol';

// Includes requests waiting for permission, not just running byte operations.
export class QAppFileBudget {
  private entries = new Map<
    string,
    {
      session: string;
      document: string;
      bytes: number;
      files: number;
    }
  >();

  reserve(
    id: string,
    session: string,
    document: string,
    bytes: number,
    files: number
  ) {
    if (
      this.entries.has(id) ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > QAPP_FILE_REQUEST_BYTES ||
      !Number.isSafeInteger(files) ||
      files < 1 ||
      files > QAPP_FILE_MAX_FILES
    )
      throw new Error('QAPP_FILE_INVALID_REQUEST');
    let totalBytes = bytes,
      sessionBytes = bytes,
      totalFiles = files;
    let sessionRequests = 0,
      documentRequests = 0;
    const sessions = new Set([session]);
    for (const entry of this.entries.values()) {
      sessions.add(entry.session);
      totalBytes += entry.bytes;
      totalFiles += entry.files;
      if (entry.session === session) {
        sessionBytes += entry.bytes;
        sessionRequests++;
      }
      if (entry.document === document) documentRequests++;
    }
    if (
      totalBytes > QAPP_FILE_GLOBAL_BYTES ||
      sessionBytes > QAPP_FILE_REQUEST_BYTES ||
      totalFiles > QAPP_FILE_MAX_FILES ||
      this.entries.size >= 16 ||
      sessionRequests >= 8 ||
      documentRequests >= 4 ||
      sessions.size > 4
    )
      throw new Error('QAPP_BRIDGE_BUSY');
    this.entries.set(id, { session, document, bytes, files });
  }

  release(id: string) {
    this.entries.delete(id);
  }
  get size() {
    return this.entries.size;
  }
}
