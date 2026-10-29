# Streaming file saves (desktop)

This generic QApp API saves bytes progressively without a whole-file Blob.
It does not download URLs, decrypt data, inspect file formats, or verify an app's
claims. The app remains responsible for its protocol and integrity checks.
Legacy `SAVE_FILE` remains unchanged. An updated desktop Hub is required.

## Compatibility with legacy Q-Apps

`SAVE_FILE` with `blob`, `PUBLISH_QDN_RESOURCE` with `file`, and
`PUBLISH_MULTIPLE_QDN_RESOURCES` with nested resource files remain supported.
Q-Apps do not need to convert files to `data64` or migrate to `FILE_SAVE_*` to
work in isolated desktop webviews. Blob/File inputs to `ENCRYPT_DATA`,
`ENCRYPT_QORTAL_GROUP_DATA`, `ENCRYPT_DATA_WITH_SHARING_KEY`, and
`SHOW_PDF_READER` use the same compatibility transport. Existing `data64`
inputs are also supported.

Hub transports Blob/File bytes internally in acknowledged 256 KiB binary chunks
and rebuilds the objects before invoking the existing handlers. File names, MIME
types and last-modified timestamps are preserved, including empty files. This
avoids base64 expansion and whole-file ArrayBuffers at the IPC boundary. The
bridge allows up to 8 GiB of unique Blob/File data and 4096 binary objects per
request. File reads and chunk acknowledgements time out after 60 seconds, so a
stalled read cannot block later requests. Committed navigation or guest closure
discards incomplete transfers; cancelled navigation and download links keep the
current document connected. These are transport limits, not changes to QDN's
service limits or permission requirements.

Legacy requests still reconstruct complete Blobs in Chromium storage and retain
the existing handler's memory requirements. They are not a guarantee of constant
memory for multi-gigabyte files, particularly when encryption requires base64.
Use the streaming-save API below when producing a download incrementally; it is
an additional desktop API, not a replacement for legacy `SAVE_FILE`. Keep a
legacy fallback when supporting older Hubs or other clients. Successful legacy
`SAVE_FILE` means the download was initiated, not that disk writing has finished.

For the isolated-webview regression test, run `cd electron && npm run test:qapp-binary`
(with `ELECTRON_RUN_AS_NODE` unset). It tests actual Electron serialization,
metadata and bytes, nested/empty files, concurrent and early requests, interrupted
transfers, cancelled download navigation, response serialization failures, and reload.

## Permission and API

Call `FILE_SAVE_OPEN` from a deliberate Download/Save action. Hub presents a
native permission prompt showing the trusted app identity, **suggested filename**
and **declared size**. It explicitly says these details come from the app and
are not a guarantee of content or safety. Approval opens the native save dialog.
Approval is per save, never a session-wide permission. Hub never auto-opens files.

```js
const { saveId } = await qortalRequestWithTimeout(
  {
    action: 'FILE_SAVE_OPEN',
    filename: 'example.zip',
    size: expectedBytes,
  },
  330000
);
try {
  let offset = 0;
  for await (const data of verifiedChunks) {
    // Uint8Array, max 256 KiB
    await qortalRequestWithTimeout(
      {
        action: 'FILE_SAVE_WRITE',
        saveId,
        offset,
        data,
      },
      60000
    );
    offset += data.byteLength;
  }
  await verifyCompleteFile();
  await qortalRequestWithTimeout({ action: 'FILE_SAVE_FINISH', saveId }, 60000);
} catch (error) {
  await qortalRequest({ action: 'FILE_SAVE_ABORT', saveId });
  throw error;
}
```

WRITE returns cumulative `bytesWritten`; FINISH returns `{ saved: true }`.
Do not pipeline writes: await each acknowledgment. FINISH requires the exact
declared length. Hub cannot know whether a malicious app actually verified it.
The native path is never returned to the QApp. The iframe cannot supply its owner,
permission wording, or an output path. Main-process IPC is restricted to Hub's
main frame; saves are additionally bound to the QApp identity and tab.

## Limits and cleanup

- One pending/active save per tab/app, eight across Hub; maximum 8 GiB per save.
  Applications can impose a smaller limit (the file-sharing app uses 3 GiB).
- One in-flight write per save; chunks up to 256 KiB; strictly increasing offsets.
- Five-minute idle expiry and 24-hour absolute lifetime. Pending dialogs are
  invalidated too. A stale approval cannot create an output after logout/cleanup.
- Tab reload/closure, logout, shell navigation/crash, cancellation and expiry
  abort unfinished saves. On ordinary shutdown cleanup is best effort.
- A randomly named `.qortal-save-<uuid>.part` beside the chosen destination holds
  plaintext with owner-only POSIX permissions. It is not the final filename.
  FINISH fsyncs and atomically renames it, replacing a file only at the destination
  selected through the native overwrite-confirming dialog. There is no automatic
  launch or antivirus/content-safety guarantee. Windows relies on folder ACLs.
- Private local journals record partial paths for cleanup on the next Hub launch
  following a crash. Failed deletions retain the journal for a later attempt.
  Journals contain local paths, not file contents, and never reach a backend.
  Cleanup is deletion, not guaranteed secure erasure of disk sectors.

Keep the original destination unchanged on abort or integrity failure. If an
application loses the final acknowledgment at the commit boundary, the file
may already have been saved; cancellation cannot roll back a completed save.

Error codes include `SAVE_CANCELLED`, `SAVE_BUSY`, `SAVE_NOT_FOUND`,
`SAVE_INVALID_REQUEST`, `SAVE_INVALID_CHUNK`, `SAVE_INCOMPLETE`, `SAVE_IO_ERROR`,
`SAVE_PERMISSION_DENIED`, and `SAVE_UNAVAILABLE`. OS errors are redacted.

## Manual smoke test

After building/syncing and restarting desktop Hub, open a file-sharing link.
Approve the prompt and choose a path. Check a small file's contents, then a large
file; memory must not grow with the entire file size. Cancel midway, close the
tab, and log out during separate downloads: no final file should be created.
Repeat with an existing output file and cancel: its contents must stay unchanged.
Test native save/overwrite dialogs separately on Linux, macOS and Windows.
