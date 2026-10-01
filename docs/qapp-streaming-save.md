# Streaming file saves (desktop)

This generic QApp API saves bytes progressively without a whole-file Blob.
It does not download URLs, decrypt data, inspect file formats, or verify an app's
claims. The app remains responsible for its protocol and integrity checks.
Legacy `SAVE_FILE` remains unchanged. An updated desktop Hub is required.

## Permission and API

Call `FILE_SAVE_OPEN` from a deliberate Download/Save action. Hub presents a
native permission prompt showing the trusted app identity, **suggested filename**
and **declared size**. It explicitly says these details come from the app and
are not a guarantee of content or safety. Approval opens the native save dialog.
Approval is per save, never a session-wide permission. Hub never auto-opens files.

```js
const { saveId } = await qortalRequestWithTimeout({
  action: 'FILE_SAVE_OPEN', filename: 'example.zip', size: expectedBytes
}, 330000);
try {
  let offset = 0;
  for await (const data of verifiedChunks) { // Uint8Array, max 256 KiB
    await qortalRequestWithTimeout({
      action: 'FILE_SAVE_WRITE', saveId, offset, data
    }, 60000);
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
