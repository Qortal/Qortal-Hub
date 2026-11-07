# Q-App native file handling

Q-Apps retain the existing `qortalRequest` API. `File`/`Blob` request arguments
must not be encoded as base64 or copied into a reconstructed Blob merely to
cross the webview boundary.

## Boundaries

Each Q-App remains sandboxed in its own Electron session. Ordinary requests use
the existing IPC bridge. For requests containing files, main authenticates the
attached guest, its prepared owner and document nonce, reserves a bounded task,
and creates a hidden sandboxed renderer in that guest's **same session**.

Main brokers two separate MessageChannels. The guest channel submits one native
request graph and is then closed. The Hub controller channel receives metadata
and supplies authorized operations. Guest input never authorizes an upload or
save. Main never receives file bytes or exposes a filesystem path to the guest.

The executor loads an empty `qapp-file-worker://executor/` document. Its bundled
isolated preload is the only executable code. Node integration, page scripts,
frames, popups, navigation, webviews and service workers are unavailable. The
scheme is a distinct secure origin; it is not a Q-App HTTP origin. The existing
session response hook must preserve its restrictive CSP.

## Consumers

| Consumer                                                  | Handling                                                                                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single and multi-resource publishing, including ZIP files | Hub retains validation, permission, fee decisions, retries, progress, finalization and signing. The executor slices and uploads each 5 MiB multipart chunk.                                                                      |
| `streamed-v1` publishing                                  | AES-CTR encryption takes place in the executor, one chunk at a time, with the original byte-offset counter and no signed 32-bit truncation. Only the symmetric upload key is sent to the executor.                               |
| `SAVE_FILE` with a Blob                                   | After Hub permission, the executor creates a native Blob URL. Main presents the save dialog and starts a Chromium download in the originating session. The selected path stays in main.                                          |
| Legacy encryption and legacy encrypted publishing         | `FileReader` in Hub reads the original native reference. Existing whole-payload encryption still requires a complete base64 string; the shared read semaphore serializes these conversions. No full Blob is reconstructed first. |
| `SHOW_PDF_READER`                                         | The PDF viewer receives the original readable Blob reference and uses an object URL, including HTTP-style range reads from that URL.                                                                                             |
| `FILE_SAVE_*`, location-based saves, RNS binary payloads  | Existing streaming/binary paths remain in use; these do not require a Blob reconstruction worker. Location-based AES-CTR decryption now accounts for arbitrary network chunk boundaries and uses full-width byte offsets.        |

Chromium can read a Blob reference received from another session, but constructing
dependent Blobs there (`slice`, `new Blob`, multipart construction) triggered
`Bad blob references` renderer termination in Electron 44.1.1. Therefore the
read-only reference accessor is restricted to FileReader and the PDF viewer.
Never pass its result into multipart construction or slice it in Hub.

Hub recognizes internal file capabilities by object identity in a private
WeakSet, never by Q-App-supplied marker properties. Internal background dispatch
preserves those capabilities within the trusted Hub document instead of
structured-cloning away their methods. Requests without capabilities retain the
existing `window.postMessage` path.

## Bounds and cleanup

- At most four worker sessions, created on demand and reclaimed after idle time.
- At most 16 retained requests globally, eight per session and four per document.
- Bursts wait in the originating guest (up to 256 queued file requests). Busy
  admission retries without copying file bytes or allocating more workers.
- At most 8 GiB of file references per request/session, 16 GiB globally, and 4096
  distinct retained files globally. These include requests awaiting permission.
- One upload/encryption operation at a time per worker; a multipart chunk is at
  most 5 MiB. Native saves and reference passing do not occupy that scheduler,
  so a save dialog cannot block another request's upload. Uploads omit cookies,
  reject redirects and accept only HTTP(S) QDN chunk endpoints supplied through
  the trusted controller channel, including configured Core proxy path prefixes.
- Worker startup and controller acknowledgment have a 30-second deadline. Each
  running upload has a 120-second deadline; waiting uploads have a bounded queue.
  Tasks expire after 30 minutes idle or two hours total. Idle workers are
  reclaimed after 30 seconds.
- Replies, permission denial, committed navigation, renderer death and bridge
  disposal release capabilities. Worker errors and timeouts must not leave
  permanent reservations or a hung worker reusable by later requests.
- Cancelling a save stops waiting for its native dialog and releases the worker's
  Blob URL. The OS dialog may remain visible, but a late confirmation cannot
  start a download. Failed port handoffs close endpoints still owned by main;
  a worker that exceeds the startup deadline is destroyed immediately.
- Native reference passing does not make legacy whole-message encryption use
  constant memory. Its complete-string/complete-message algorithm remains a
  distinct memory cost, as it was with iframes.
- Each active session's worker adds fixed renderer overhead. Chromium still
  manages the source Blob's own memory/disk backing; this design does not promise
  zero allocation or zero disk use for Blobs created in Q-App JavaScript.
- The PDF viewer keeps its native object URL until replacement, close or unmount,
  then revokes it. It does not keep the worker request alive while viewing.

## Verification

Compile Electron and then bundle both sandboxed preloads (the order matters):

```sh
npx tsc -p electron/tsconfig.json
node electron/scripts/build-qapp-preload.mjs
env -u ELECTRON_RUN_AS_NODE electron/node_modules/.bin/electron electron/scripts/test-qapp-file-worker.cjs
```

The real Electron fixture uses a separate guest session, production preload,
broker, executor and renderer bridge, plus a loopback multipart sink. It checks
file bytes, native saving, generated and empty Blobs, multiple resources,
multi-chunk encrypted upload, PDF object-URL fetch/range/XHR reads, legacy
FileReader conversion and internal dispatch. It also checks startup requests,
parallel request backpressure, cookie isolation, redirect rejection, forged
capabilities, worker-only IPC authorization, crash recovery, stalled-network
cancellation and navigation/reload. It also exercises cancellation while a save
dialog is unresolved, partial port-handoff failure, startup timeout eviction,
the real 30-second idle shutdown, and logout cleanup. The separate main-window security,
Q-App network policy and Reticulum attachment-open fixtures remain applicable.
`QAPP_FILE_TEST_MIB=512` selects a larger disk file. On Linux,
`QAPP_FILE_PROFILE=1` samples aggregate process PSS; profiling affects timings.
The fixture uses no wallet, Qortal Core or external service. Unit tests exercise
the actual single/multi publish and save handlers on permission denial and the
publish implementation through chunk upload and mocked finalization. AES-CTR
tests compare against independent Node crypto, including unaligned download
chunks, the fallback implementation and offsets above 2 GiB.

Measured locally on Linux with Electron 44.1.1 (one profiled run per file size):

| Disk file | Warm-worker handoff | Sampled peak PSS increase across test processes | Sampled profile storage growth during upload |
| --------- | ------------------- | ----------------------------------------------- | -------------------------------------------- |
| 512 MiB   | 62 ms               | 74.7 MiB                                        | 20 KiB                                       |
| 1536 MiB  | 53 ms               | 90.7 MiB                                        | 20 KiB                                       |

Both upload and native-save SHA-256 hashes matched the original source. The
baseline already includes the warm worker; these numbers exclude its startup
overhead. Sampling affects timings and can miss brief peaks. These results are
evidence against full-file reconstruction, not a throughput benchmark or a
guarantee about Chromium's internal storage behavior.

Windows/macOS runtime tests, platform packaging and an actual paid Qortal Core
publication were not exercised in this Linux verification.
