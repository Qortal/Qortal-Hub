# Video publisher (Home window)

A built-in Home window that turns any video into an MP4 that plays well in
Q-Apps (H.264 + AAC, `+faststart`), keeps it under the node's publish limit,
and publishes it, in one go, to Q-Tube, Subscreen (films and TV series),
Torq or Q-Share — or saves it to this PC. Several files at a time, or a whole
folder (a series).

Desktop (Electron) only: ffmpeg ships inside Hub and runs in the main
process. Where `window.videoTool` is missing the window and its Home switch
don't show: the browser build, Android, and a desktop build made without
ffmpeg (main gives the Hub page the bridge only when both programs are
there: `VideoToolService.hasBinaries`, passed to the preload as
`--hub-video-tool`).

## Parts

| Part                                                                                      | Where                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| IPC contract (types, channel names)                                                       | `electron/src/video-tool-types.ts`                                                       |
| ffmpeg build (pinned sources)                                                             | `electron/scripts/build-ffmpeg.mjs` → `electron/resources/ffmpeg/<platform>-<arch>/`     |
| Engine: sources, ffprobe summary, ffmpeg plan, jobs, frames, chunk upload, preview scheme | `electron/src/video-tool*.ts`, wired in `electron/src/index.ts` and `preload.ts`         |
| Publishing: each app's resources, subtitles, removal, the step runner                     | `src/lib/videoPublisher/`                                                                |
| The window, its queue and forms                                                           | `src/components/VideoPublisher/`, Home grid files in `src/components/Group/HomeDesktop/` |

## Engine (Electron main)

### The bundled ffmpeg

`electron/scripts/build-ffmpeg.mjs` builds ffmpeg 8.0.1 from pinned,
checksummed sources: x264, SVT-AV1 2.3.0 (cmake from `uv`), dav1d 1.5.1
(meson/ninja from `uv`). ffmpeg (readers, the writers, filters) is 26.5 MB;
ffprobe is built apart, from its own copy of the source with readers only
(no writers, filters or swscale), 12.8 MB instead of 26.3 (from the same
build it would carry every encoder): 39.3 MB per platform in all (36.6
before AV1). No path of the build machine is written into them: configure
gets relative `-I`/`-L` paths and a placeholder prefix (ffmpeg keeps its
configure line, `-buildconf`), and SVT-AV1 is compiled with
`-ffile-prefix-map` (its messages quote their source files). The licences
(ffmpeg GPLv2+, x264, dav1d, SVT-AV1's BSD-3-Clause-Clear and AOM patent
licence), a NOTICE.txt (each part, its licence and its source archive) and
BUILD_INFO.json (sources, both configure lines, and the script's own hash,
`recipe`) go beside them. A part's licence that can't be copied stops the
build.

#### In release builds

`resources/ffmpeg/*/` is git-ignored: the packaging scripts make it.

- `electron:make-lin-docker` (and `-appimage`, `make-arm-docker`) builds it
  inside the Debian 11 image every time (its glibc, checked against the
  2.31 baseline like better-sqlite3), with `--release`: no AV1 parts, no
  package. The image has the tools (nasm, pkg-config, cmake, meson, ninja).
  Under QEMU (arm64 from an x64 host) the build takes much longer.
- `electron:make-*` (`run-electron-package.mjs`) builds each folder the
  package carries (`ffmpegTargetsFor`: the platform's, both processors' for
  a universal macOS app) when it's missing or was built by another version
  of the script, where this machine can (`canBuildHere`: Linux and macOS
  their own processor's, Linux also Windows'). Where it can't, packaging
  stops and says how to make it:
  - Windows: on Linux with the mingw-w64 cross compilers and their zlib
    (Debian/Ubuntu: `mingw-w64`, `libz-mingw-w64-dev`),
    `npm run build:ffmpeg -- --target win-x64 --release`, then copy
    `electron/resources/ffmpeg/win-x64` to the Windows machine;
  - macOS universal: build the other processor's on a Mac of that kind
    (`npm run build:ffmpeg -- --release`) and copy its folder.
- `QORTAL_SKIP_FFMPEG=1` packages without it: that Hub shows no Video
  publisher, nothing else changes. Packaging stops while a folder it would
  carry is still in `resources/ffmpeg` (electron-builder would copy it in
  unchecked).
- A folder is current only when this version of the script built it, with
  both programs and the AV1 parts (`isFolderCurrent`): one built without
  `--release`, missing cmake or meson, is built again.
- macOS builds target macOS 11 (`MACOSX_DEPLOYMENT_TARGET`), so a build
  made on a newer Mac still starts on older ones.
- Only linux-x64 has been built and run so far (here, against a new glibc,
  and in test builds); the Docker, arm64, Windows and macOS builds haven't
  been tried.
- The licences: ffmpeg is built with `--enable-gpl` (x264), so the two
  programs are GPL-2.0-or-later; SVT-AV1 is BSD-3-Clause-Clear with the
  AOMedia patent licence, dav1d BSD-2-Clause. Hub runs them as separate
  programs. Their source is the pinned archives (URLs and SHA-256 in
  BUILD_INFO.json and NOTICE.txt) plus this script; a release can attach
  those archives (kept in the build folder's `src/`) to be sure they stay
  available.

### Sources

`videoTool.addFiles(files, relativePaths?)`: preload maps each `File` to its path with
`webUtils.getPathForFile` (files without a path are skipped) and main keeps
`{ id → path, name, size, relativePath }` per webContents (cleared when that
page navigates or dies, like `main-window-files.ts`). The renderer never sees
or sends a path. `kind` comes from the extension: video
(`mp4 m4v mov qt 3gp 3g2 mkv webm avi wmv asf flv f4v ts m2ts mts mpg mpeg vob
ogv mxf dv divx xvid`), subtitle (`srt vtt ass ssa sub sup`), else other.
Folder picks (`<input webkitdirectory>`) pass `webkitRelativePath` as
`relativePath`. A file from a dropped folder has none, so the window passes
where it sat (its drop entry's `fullPath`, `Show/Season 1/E01.mkv`) in
`relativePaths`, which wins.

### Probe

`ffprobe -v error -print_format json -show_format -show_streams` →
`VideoProbe` (pure `summarizeProbe(json, source)`):

- video: the first stream that isn't `attached_pic` (cover art); `bitDepth`
  from `bits_per_raw_sample` or the pixel format; `hdr` when
  `color_transfer` is `smpte2084` or `arib-std-b67`; `interlaced` when
  `field_order` is not `progressive`/unknown; `rotation` from the display
  matrix side data; display size applies the sample aspect ratio and rotation.
- `fps` from `avg_frame_rate` (else `r_frame_rate`).
- subtitles: `kind: 'picture'` for `hdmv_pgs_subtitle`, `dvd_subtitle`,
  `dvb_subtitle`, `xsub`; everything else text.
- languages: ISO 639-2 tags as given (the renderer maps them).
- `playableAsIs`: video `h264` with `yuv420p`/`yuvj420p` 8-bit, and every kept
  audio stream `aac` (or no audio).
- `no-video` error when there is no video stream; `probe-failed` when ffprobe
  fails.

### Qualities and the plan

Pure `planVideoJob(probe, spec)` → ffmpeg argument lists (never a shell
line). Each quality is a box the picture must fit in, **in the video's own
orientation** (a portrait video's 720p box is 720×1280), never enlarged:

| Quality | Box       | x264   | Cap (maxrate) | Floor | Audio    |
| ------- | --------- | ------ | ------------- | ----- | -------- |
| 1080    | 1920×1080 | CRF 22 | 5000 kb/s     | 2000  | AAC 160k |
| 720     | 1280×720  | CRF 23 | 2800          | 1100  | AAC 128k |
| 540     | 960×540   | CRF 23 | 1800          | 700   | AAC 128k |
| 480     | 854×480   | CRF 24 | 1400          | 550   | AAC 128k |
| 360     | 640×360   | CRF 26 | 800           | 300   | AAC 96k  |

- `original` (**Original quality**): the source's own size (never above
  1080p), its picture copied whenever it can be (H.264 that fits the box,
  whatever its bitrate, when the copy fits the limit), else encoded at the
  step's CRF − 4 (1080p: 18) without the step's maxrate: only the source's
  own bitrate and the original's size cap it. Other settings are those of
  the smallest step at or above its size.
- Common output settings: `-c:v libx264 -preset medium -profile:v high`
  (level 4.1 at most), `-pix_fmt yuv420p`, keyframe at least every 2 s
  (`-g round(fps*2)`), frame rate kept up to 60 (30 for 540/480/360; a
  rate up to 5 % over counts as at the cap, as a phone's 30.2 does) with
  `-fps_mode` passthrough when below the cap, on a fine clock
  (`-enc_time_base:v 1:90000`: on the frame rate's own clock, a film's
  millisecond timestamps landed two frames on one tick and played back
  jerkily: one film had 419 of its first 1,439 frames so; 0 with it),
  `bufsize = 2 × maxrate`;
  `-c:a aac -ac 2 -ar 48000`; `-map_metadata -1 -map_chapters -1`;
  `-movflags +faststart`; scale with
  `scale=w:h:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`
  (non-square pixels made square first).
- Interlaced: `bwdif` first. HDR: no tone-mapping in this build (zimg not
  included yet); the probe flags it so the window can say colours may look
  flat.
- Burn-in (`burnSubtitleIndex`): `overlay` for picture subtitles; text burn-in
  is not supported (no libass): picture only.
- **The source's own bitrate** (`sourceVideoKbps`): its stream's figure, but
  never more than the file holds (`size × 8 / duration` less the sound's
  known bitrates). A Matroska `BPS` tag can be left over from before a
  re-encode: a 1.5 GB film of 1 h 43 min said 5.98 Mb/s, where the
  file holds 1.62. Without a figure, the file's share is used. The copy path,
  `keep`'s estimate and the cap below all use it.
- **Never more bits than the source had**: a re-encode's cap is the quality's
  maxrate, but at most the source's bitrate in H.264's worth (× 1.5 for HEVC,
  × 1.4 for VP9, × 1.8 for AV1, × 1 for H.264 and older codecs), and never
  under 200 kb/s. A smaller picture gains no detail from more bits, only
  size: the film above came out of 720p at 2.06 GB (2.5 Mb/s of video),
  from a 1.5 GB file; capped, it plans at most 1.4 GB in one pass. A long
  video that fits at its own bitrate is no longer refused as too long.
- **Never bigger than the original**: the cap is also at most what keeps the
  file within the original's size, the MP4's own bytes counted
  (`(size − 256 KiB) / 1.015 × 8 / duration − audio`). An HEVC film of
  1.6 GB was offered 2 GB at 1080p and 720p (H.264's 1.5× of HEVC's
  bitrate); now every estimate is at most 1.6 GB. Copies (`keep`, a copied
  picture) keep the original's own picture bits. The cap binds only on a
  hard picture (grain, noise), and the encoder can overshoot it: a 2-minute
  noisy HEVC clip of 50.2 MB came out 56.5 MB in AV1. An encode that comes
  out bigger than its original runs its last pass again once, its cap (or
  two-pass target) scaled to land under 96 % of the original
  (`retryUnderOriginalKbps`; the plan keeps its cap as `maxrateKbps`).
- **Budget**: `budget = floor(sizeLimitBytes × 0.98)`. `cap_total = (maxrate +
audio) × duration / 8`. If `cap_total ≤ budget`: one pass, CRF with the cap.
  Else video bitrate `= budget × 8 / duration − audio`; if that is below the
  floor → `too-long-for-limit` (before encoding), else two-pass ABR
  (`-b:v`, `-maxrate 1.5×`, `-bufsize 3×`, `-pass 1 -an -f null`, then
  `-pass 2`), passlog in the job folder.
- **Estimate** (`estimateBytes`, the window's "at most"): the streams' bytes
  plus the MP4's own (`withMuxOverhead`: + 1.5 % + 256 KiB), so it is an
  upper bound (a 2-minute 1080p encode estimated at 73.8 MB without it came
  out 74.1 MB). The budget checks above still compare the streams alone with
  98 % of the limit; the window caps what it shows at the limit.
- `keep`: `-c copy` of the video and the chosen audio, same metadata/
  faststart flags; refused unless `playableAsIs` and it fits.
  `playableAsIs` is H.264 8-bit 4:2:0, or AV1 4:2:0 at 8 or 10 bits (it
  plays wherever AV1 plays: Chromium, Hub and GO's WebView included,
  Firefox, Safari on Apple devices that decode AV1), with AAC (or no)
  sound. The plan names the kept picture's own codec (`codec: 'av1'` for an
  AV1 file).
- H.264 video that fits the chosen box (no scaling needed, 8-bit 4:2:0) with
  non-AAC sound: video `-c:v copy`, only the audio encoded.
- One audio stream: `audioIndex` or the default-flagged or the first.
- Subtitles: after the video, never in its passes, so a track ffmpeg can't
  convert leaves the video fine. The chosen text streams go in one run of
  their own (`-map 0:<index> -c:s webvtt subtitles/<n>.vtt` each, the file
  read once); if it fails, each runs alone and only the ones that fail are
  left out (`failedSubtitles`, reason `failed`). If it ran out of time (a
  file too slow to read), all of them are left out without running each
  alone. Text streams are the codecs
  this build decodes (`TEXT_SUBTITLE_CODECS` in `video-tool-probe.ts`);
  others (teletext, Blu-ray text, broadcast captions) are `unsupported` and
  can't be ticked. An external file goes through its own small ffmpeg run
  (decoded to UTF-8 first: a file that isn't UTF-8 is read in its track
  language's usual older encoding, e.g. Windows-1251 for Russian, else
  Windows-1252) to `.vtt`; a MicroDVD `.sub` without its own
  `{1}{1}<fps>` line is timed at the video's frame rate (`-subfps`), and a
  binary VobSub `.sub` is reported as pictures. Cap 2 MiB each
  (Q-Tube's/Subscreen's limit); bigger ones fail that track only.
- After encoding, `output-too-big` if the result exceeds `sizeLimitBytes`.

### AV1 (`codec: 'av1'`)

The window converts to AV1 by default: `-c:v libsvtav1 -preset 8 -pix_fmt
yuv420p`, CRF = x264's + 9 (1080p 31, 720p and 540p 32, 480p 33, 360p 35;
Original quality 27 at 1080p), and every cap and floor 0.6× x264's (a
source's own bitrate counts at 0.6× its H.264 worth). Measured on a
2-minute scene of a 1620×1080 HEVC film with Ubuntu's ffmpeg 8.0.1 and
SVT-AV1 2.3.0 (16 threads, 2026-11-16):

| Encoder                  | Time | Bitrate   | XPSNR (Y) | SSIM   |
| ------------------------ | ---- | --------- | --------- | ------ |
| x264 medium CRF 22       | 24 s | 1546 kb/s | 40.29     | 0.9923 |
| x264 medium CRF 18       | 30 s | 3009 kb/s | 42.09     | 0.9946 |
| SVT-AV1 preset 10 CRF 30 | 13 s | 930 kb/s  | 39.15     | 0.9918 |
| SVT-AV1 preset 8 CRF 30  | 24 s | 960 kb/s  | 39.99     | 0.9935 |
| SVT-AV1 preset 8 CRF 36  | 24 s | 581 kb/s  | 39.20     | 0.9924 |
| SVT-AV1 preset 6 CRF 36  | 45 s | 568 kb/s  | 39.43     | 0.9929 |
| SVT-AV1 p8 CRF 36 10-bit | 31 s | 572 kb/s  | 39.75     | 0.9914 |

Preset 8 takes x264 medium's time and lands 35–60 % smaller at the same
look (XPSNR and SSIM disagree on how much); preset 10 is twice as fast but
visibly worse, preset 6 twice as slow for little; 10-bit costs 29 % more
time for a mixed result, so 8-bit.

- ffmpeg's SVT-AV1 wrapper has no two-pass. A video that doesn't fit the
  limit at the cap gets one capped-CRF pass at the bitrate that fits
  (`capFit`, `videoKbps`): SVT-AV1's average stays well under the cap (a
  400k cap averaged 272k, 800k 414k). Over the limit anyway: the pass again
  with a lower cap (`retryTwoPassKbps`, `withVideoCap`).
- Copies: an AV1 picture (8- or 10-bit 4:2:0) is copied with AV1 chosen;
  H.264 is re-encoded to AV1 at a step (smaller), copied only for Original
  quality (or kept by Keep as is). With H.264 chosen, AV1 sources are
  written as H.264.
- Which: `VideoPublisherController.codec()`: the user's choice
  (`settings.codec`), else AV1 when the converter writes it
  (`status().av1`, from `ffmpeg -encoders`) and the PC has 8 or more
  logical processors (`status().cpuThreads`), else H.264. The Format
  buttons mark AV1 as the recommended format, say why when H.264 is picked
  for a slow PC, and grey AV1 when the converter can't write it. AV1 plays in Hub, Chrome, Firefox, Edge and
  Android; not in Safari on Apple devices without AV1 hardware (before the
  iPhone 15 Pro and M3 Macs).
- The card's Converted line names the format (`output.codec`).

### Jobs

- One encode at a time; others `queued`. Job folder:
  `<userData>/video-publisher-jobs/<jobId>/` (not the OS temp dir, which can
  be a small tmpfs). Stale folders are removed at startup and on
  `releaseJob`. Free space is checked before starting (estimate × 1.1 +
  x264's two-pass stats, about a byte per macroblock per frame, + 64 MiB)
  → `disk-full`; a disk that fills up during the encode (ENOSPC) is
  `disk-full` too.
- On quit, `shutdown()` cancels the queued jobs, kills the running ones and
  starts nothing more. A job its page releases before it ends (stopped and
  removed at once) says `cancelled` first, so the window's run goes on.
- Pause (`pauseJob` / `resumeJob`): the job's ffmpeg gets SIGSTOP and
  SIGCONT, so the PC's power comes back at once and the encode goes on
  from where it stood. A short step with a timeout (subtitles, frames)
  isn't stopped: it finishes, and a paused job starts no new process until
  it's resumed (`run` waits). The state says `paused` (no ETA meanwhile).
  ffmpeg's own `speed` counts the paused minutes, so after a pause the ETA
  comes from the media written over the time it really ran (`pausedMs`).
  Cancel kills a paused job too (SIGKILL ends a stopped process). Windows
  has no such signals: `status().canPause` is false there and `pauseJob`
  says `not-supported`.
- `remakeSubtitles(jobId, subtitles)`: a finished job's subtitles written
  again as the list now says (added during the conversion, taken out,
  another language or label), the picture untouched. New names each time
  (`g<n>s<index>`: a preview may be reading the old files, which go once
  the new ones are listed); a source already written (same stream, or same
  file and encoding) is copied, not converted again, so a language change
  doesn't read a big video through again. One list at a time per job.
- `-progress pipe:1 -nostats` parsed into percent (`out_time_us / duration`,
  pass 1 counts as 40 % of two-pass jobs: on a real 1 h 43 min 1080p film
  pass 2 ran about 1.45× slower), `speed`, ETA (pass 2 priced at 1.5×
  pass 1's time while pass 1 runs). Events go to the
  renderer that started the job (`videoTool:jobEvent`).
- ffmpeg runs at low priority (`os.setPriority(pid, 10)`, below-normal on
  Windows), `windowsHide`. Cancel kills it and deletes partial files.
- Binary: `process.resourcesPath/ffmpeg/<platform>-<arch>/` when packaged,
  `electron/resources/ffmpeg/<platform>-<arch>/` in development
  (`QORTAL_HUB_FFMPEG_DIR` overrides). Missing → `status()` says
  `missing-binary` (and the page never gets the bridge). `status().av1`
  comes from `ffmpeg -encoders`; a look-up that failed is asked again next
  time, not kept.

### Frames

`frames(target, { count | times, width })`: `-ss <t> -i <file> -frames:v 1
-vf scale=<width>:-2 -c:v mjpeg -q:v 3 -f image2pipe pipe:1` per frame, as
`data:image/jpeg;base64,…`. Default times: evenly inside the video avoiding
the first/last 3 %. The renderer turns them into WebP.

### Chunk upload

`uploadChunk({ jobId, file, start, end, index, endpoint })`: main checks the
job and file exist, `0 ≤ start < end ≤ size`, `end − start ≤ 5 MiB`, and that
`endpoint` is `http(s)://…/arbitrary/<SERVICE>/<name>[/<identifier>]/chunk`
(query allowed; a node reached under a path of its own, such as
`https://host/qortal`, keeps that path before `/arbitrary`) on an origin the main window's CSP connects to (localhost
and the node addresses Hub knows, `isAllowedNodeEndpoint`), reads that range and POSTs `multipart/form-data` with fields
`chunk` (the bytes, filename = the output's name) and `index`, through
`net.fetch` (Chromium's network stack, so Hub's certificate rules apply).
The node's answer is read to the end, never cancelled: a cancelled
`net.fetch` answer keeps its `ClientRequest` alive in main, and with it both
copies of the chunk (measured in a bare Electron: 1 GB of 5 MiB chunks left
3 GB that garbage collection couldn't free; read instead, 36 MB). A 2 GB
video once took the main process to 6 GB that way.
Returns `{ ok: false, status }` on an HTTP error; status 0 for a network
failure. The renderer wraps the output in a `QAppFileReference`
(`src/qortal/qapp-file-reference.ts`) whose `upload()` calls this and throws
`QAppFileUploadError(status)` on failure, so `publishData` uploads it with its
existing chunk loop and retry rules, without the bytes entering the renderer.
When main turns the request down itself (`[video-tool:<code>]`, such as
`job-missing`), it throws an answer that isn't retried, and the runner reports
`publish-failed` rather than a network failure.

### A node on this PC reads the file itself

`buildOnNode({ jobId, file, endpoint, filename })`: when the node runs on
this PC (`localhost`, `127.x.x.x` or `[::1]`), it builds the transaction
from the converted file itself, through Core's publish-from-path route:
`POST /arbitrary/<SERVICE>/<name>[/<identifier>]` with the file's path as
the body (`text/plain`), which answers the unsigned transaction (Base58).
Nothing is uploaded, and Core makes none of an upload's copies. An upload
saves its chunks in Core's `uploads-temp` folder, then `finalize` joins
them into one file in the system's temporary folder (Java's
`java.io.tmpdir`, `/tmp`). Some Linux systems keep `/tmp` in memory with a
per-user quota, so a big video could fail there ("Disk quota exceeded"), or
fill memory. Core's own space check (`/arbitrary/check/tmp`) measures
`uploads-temp`'s disk, not `/tmp`, so it doesn't catch it. From the path,
Core works only in its data folder (`<data>/_temp/writer/…`, on disk) and
never moves or changes the file (Core 6.1.9's `ArbitraryResource.upload`
and `ArbitraryDataWriter`).

Core names the published file after the file it reads (as it names a
joined upload after `filename`), so main gives the node a hard link in a
`node-*` folder inside the job's folder, named after the last part of
`filename` (else the output's own name; on Windows `<>:"|?*` become `_`).
The link goes once the node has answered. Main checks the job, the file
and the endpoint as for a chunk (the route itself, not `…/chunk`,
`/base64`, `/string`, `/zip` or `/finalize`, which would take the body as
the data), and reads the node's answer to the end. It returns
`{ ok: false, status, reason }` for a node elsewhere (`not-local`, nothing
asked), no link (`link`), a refusal (`refused`), an answer that isn't a
transaction (`answer`) or no answer (`network`).

`publishData` asks first for a file that offers `buildOnNode`
(`src/qdn/publish/nodeBuildable.ts`) and isn't encrypted, after the space
check, then signs what the node built. Null, or anything but a missing API
key (401/403 stops as an upload would), and it uploads the file in chunks
as before: a node in Docker, or one running as another user, can't read
Hub's files. Everything before the signature, so a fallback costs nothing.
The card says "Your node is preparing the video" with a moving bar while
it waits (`PublishProgress.onNode`, from `createJobFileReference`'s
`onNodeBuild`).

### Preview scheme

`hub-video://job/<jobId>/video.mp4` (and `subtitles/<id>.vtt`), registered as
privileged (`standard`, `secure`, `stream`, `supportFetchAPI`) in the same
`protocol.registerSchemesAsPrivileged` call as Hub's other schemes; served
from the job folder with Range support; only for existing jobs; added to the
main window's CSP `media-src` if the CSP restricts it.

## Publishing (`src/lib/videoPublisher/`)

Everything here is pure apart from the step runner. All publishes go through
Hub's own `publishOnQDN` (`src/encryption/encryption.ts`), extended with
`filename` and an optional `onProgress(done, total)` (chunk progress from
`publishData`). Publish starts converting at once, without asking. Right
before each video goes up, Hub's own approval (the one Q-Apps get, through
`getUserPermission`: "Do you give this application permission to publish to
QDN?", the resources with service, name, identifier and file name, and the
fee) asks for what's left of it (`publishApproval.ts`,
`VideoPublisherController.askApproval`). The request is marked as Hub's own
Q-App requests are (`isFromExtension: true`): App's message handler opens its
window only for those, and an unmarked one times out unanswered
(`publishApproval.window.test.tsx` goes through the real route). It goes
with `HUB_REQUEST` as its app, so the window names no app (as for Minting or
the Torq composer), never "Unknown Q-App". With "Preview each converted video
first" it comes after Publish it; without, as soon as the video is
converted. A series' playlist asks the same way. Declined, or not answered
within the minute Hub waits (as for a Q-App): "Not published"
(`approval-declined`), the converted file kept, and Retry asks again. A fee
the node doesn't give: `fee-unknown`, nothing asked or sent. Before asking,
the balance must cover the whole fee, less what the account's transactions
not confirmed yet take: their fees and the QORT they pay (payments, QORT
transfers, name purchases, AT deployments; `checkPublishBalance` with its
public key). The node checks each new transaction against the confirmed
balance alone, so it would take them all and never confirm the last ones
(the listing). Short: `balance`, nothing asked or sent, and the run stops.
A node that can't list them: `fee-unknown`, never "nothing pending".

### Order and safety

Per video: the VIDEO (or FILE) first, then its subtitles, then the listing
(metadata DOCUMENT, playlist, Torq post) last, and only if everything it
points at went through (`dependsOn`; a Q-Tube-format listing depends on its
VIDEO and its subtitles, which it lists; a Q-Share share names every file,
so it depends on all of them, and its thumbnail waits for the shared
file). A failed upload never leaves a
listing that can't play. Before each publish the runner can wait while the
account has many unconfirmed transactions (`waitForPublishSlot`, Subscreen's
rule: at most `25 − batch`, counted by the account's public key, which is
what Core's `creator` parameter takes; all of them are read, since Core
lists them oldest first and a day of chat messages would fill a page). It
retries a step twice on network errors and busy answers (5xx, 408, 429,
also to the balance, fee and name look-ups before anything goes up; then
it skips what depends on it and goes on), and stops the whole run
on a refusal or an unknown error, since the next publish would most likely
fail the same way and each try can cost a fee. A retry passes the keys that
went through as `completed`. A cancel stops an upload between chunks and
always before the transaction is signed (`publishData`'s `signal`), so
nothing is paid for after it. When the node's answer to a publish is lost,
`publishData` asks the node for the transaction by its signature before
calling it failed, so a retry doesn't pay twice. Core's answer for a
transaction it couldn't take its blockchain lock for within its minute
(400, `NO_BLOCKCHAIN_LOCK`) is busy, not a refusal: the same signed
transaction is sent again (`nodeAnswer.ts`, for every publish in Hub).

#### The library (`src/lib/videoPublisher/`)

Each builder returns ordered `PublishStep`s (one resource, one fee each) and
a `PublishedRecord` (link, the Hub tab to open, every resource) to keep with
the results; `buildRemovalSteps(record)` turns that into the removal.
Errors are `VideoPublishError` with a `code`, never English text. Real
records the formats are checked against are in
`src/lib/videoPublisher/__fixtures__/real-records.json`.

`publishData` (`src/qdn/publish/publish.ts`) takes an optional
`onProgress(chunksDone, totalChunks)`, and now rethrows an `Error` as it is
(a `NodeAnswerError` keeps its status, so a refusal can be told from a
network failure; the message is unchanged). `publishOnQDN` passes
`filename` and `onProgress` through.

The converted file goes to `publishData` as a `QAppFileReference`
(`createJobFileReference`): `upload()` calls `videoTool.uploadChunk` and
throws `QAppFileUploadError(status)` on the node's answer; status 0 (a
network failure) is thrown as a plain `Error` instead, which publishData's
chunk loop retries (`QAppFileUploadError(0)` would count as a refusal there).
With a bridge that has `buildOnNode`, it's a `JobFileReference`, whose
`buildOnNode` has a node on this PC read the file itself first (see "A node
on this PC reads the file itself").

Images are drawn on a canvas (`createImageBitmap` + `toBlob('image/webp')`)
rather than through `compressImageFile`, which hands back the original
(a JPEG, uncropped) whenever its WebP comes out bigger.

### Q-Tube (deployed Q-Tube, 2026-08-01)

- VIDEO `qtube_vid_<slug>_<id6>` (file), DOCUMENT
  `qtube_vid_<slug>_<id6>_metadata` (`data64`, filename
  `video_metadata.json`). Both: `title` (≤ 50, no `\r\n`), `description`
  `**category:<c>;subcategory:<s>;code:<code5>**` + 150 chars of plain text,
  `tag1: "qtube_vid_"`.
- slug: title without `[^a-zA-Z0-9\s-]`, spaces → `-`, repeats collapsed,
  lowercase, ≤ 30. ids: random alphanumeric (6), code (5). ≤ 64 chars total.
- Metadata JSON (key order):
  `{ title, version: 1, fullDescription, htmlDescription, videoImage,
videoReference: { name, identifier, service: "VIDEO" }, extracts,
commentsId: "qtube_vid__cm_<id>", category, subcategory, code, videoType:
"video/mp4", filename, fileSize, duration }`.
  - `htmlDescription`: paragraphs on blank lines as escaped `<p>…</p>`,
    single newlines `<br />`; `fullDescription`: its plain text,
    whitespace-collapsed, ≤ 150 (Subscreen keeps it whole).
  - `category`/`subcategory` numeric (`""` when no subcategory).
  - `videoImage`: cover, WebP q0.6, ≤ 1200 px wide, data URL (required).
  - `extracts`: 4 WebP (q0.8, ≤ 750 px) data URLs, one from each quarter.
  - `filename`: Subscreen's rule, the title with only `[A-Za-z0-9_]` (accents
    folded first; `-` goes too, as Subscreen's own file names show), ≤ 40,
    `video` when nothing is left, + `.mp4`; the VIDEO resource uses the same
    filename. (Q-Tube itself stores the picked file's own name there; the
    converted file has none worth keeping.)
  - The metadata DOCUMENT must stay under 5 MiB.
- Categories (`Qortal/q-tube` `src/constants/Categories.ts`): 1 Movies,
  2 Series, 3 Music … 29 Privacy, 99 Other; subcategories under 1, 2, 4, 24.
- Link: `qortal://APP/Q-Tube/video/<name>/<metadata identifier>`.
- Removal: publish `RA==` (base64) to the DOCUMENT and the VIDEO, without a
  title or file name (qapp-core's `deleteResource`), the DOCUMENT first.

### Subtitles (Q-Tube, Subscreen and Torq players: qapp-core's records)

- One FILE per track: identifier
  `GYDXhZ-<h14("VIDEO-<name>-<VIDEO identifier>")>-<15 random alnum>-v1`,
  where `hN(s)` = SHA-256 of `s`, base64, `+`→`.`, `/`→`~`, `=` removed, first N
  chars (`GYDXhZ` = h6 of `ENTITY_SUBTITLE`).
- `title`: the ISO 639-1 code (required). `filename`: `<base>.<lang>.vtt`.
- Data (base64 of JSON): `{ subtitleData: <base64 of the .vtt text>, language,
filename, type: "text/vtt" }`. ≤ 2 MiB per file. Published under the same
  name as the video, after the VIDEO, before the metadata.
- Removal: `RA==` to the same identifier.

### Subscreen (1.1.3) — films and series, in Q-Tube's format

- Film: Q-Tube's two resources with `category: 1`, a genre subcategory
  (101–115, and Other as **199**: Subscreen lists Other as 116 but reads 199
  the same way, and Q-Tube only knows 199, so 199 shows in both), plus `year` (optional) and `quality` in the metadata, keys as Subscreen orders
  them. `quality` follows Subscreen's rule (since 2026-11-16): the largest
  16:9 frame (7680×4320 … 640×360) the video fills on either side, 97 %
  allowed, so 1280×536 is 720 and 1920×804 is 1080; 960×540 and 720×576
  are 480 (no 540 or 576 step); under 240 lines, none. Subscreen shows it
  unless its own bitrate guess is 2+ steps away. It used the shorter side
  before, which put widescreen films a step low. The card names the
  original's and the converted file's size by the same rule ("1080p"). Subscreen hides films shorter than 600 s (they still show in Q-Tube):
  the window warns.
- Series: every episode is a Q-Tube video with `category: 2`, the series
  genre (201–215, Other as 299 for the same reason), the series description,
  and `quality`, no `year` (Subscreen gives only films and the playlist one);
  an episode's title is the one given, else `<series> S01E02` (`<series> —
Episode N` without a number, N its place among the run's episodes when the
  run started (`episodePlace`, kept when another is taken off the list, so
  no two get one number), as its card shows it), its cover the series
  poster;
  then one PLAYLIST `qtube_playlist_<slug>_<id6>`, filename
  `playlist.json`, `tag1: "qtube_vid_"`, description
  `**category:2;subcategory:<g>;c:<code1>;c:<code2>;…**` (≤ 10 codes) + 120
  chars, JSON `{ title, version: 1, description, htmlDescription, image,
videos: [{ name, identifier: "<id>_metadata", service: "DOCUMENT", code,
season, episode, episodeKind, episodeTitle, label, order, duration,
quality }], commentsId: "qtube_playlist__cm_<id>", category: 2,
subcategory, year }`. Episodes come from the file names (`S01E02`, `1x02`,
  `Season 1/Episode 2`, `E02`, a leading number), editable.
- Exact shapes: Subscreen's bundle (pretty copies) in the research folder,
  `PublishPage-*.js` around lines 1834–1974 and `UserAvatar-*.js`.

### Subscreen's cast & crew

A Subscreen film's fields and a series' form have "Cast & crew"
(`CreditsEditor.tsx`): one field per role in Subscreen's order (Directors,
Cast with an optional character, Writers, Producers, Music, Cinematography,
Editing). Enter or + adds a chip and × removes it; a person once per role,
200 names, 80 characters each. It is kept as `credits` in the film's
`fields` and in `settings.series` (fixed at Publish).

People aren't keys in the metadata or playlist, because Subscreen's readers
drop unknown keys (`subscreenCredits.ts`, checked against Subscreen 1.1.3
and real records):

- **Credits:** `subscreen_credits_<pn>`, where `pn` is Subscreen's two
  FNV-1a-style 32-bit hashes over the UTF-16 units of
  `<service>:<name>:<identifier>`. The title is a film's metadata DOCUMENT
  or a series' PLAYLIST, never an episode. JSON `{ titleRef, people:
[{ personRef, role, displayName, character? (actors), at }], version: 2 }`,
  every entry with one `at`. Title `Credits <identifier>` (50), no tag,
  `credits.json`. The description is the names in lower case, newest first,
  as many as fit in 240 bytes; Subscreen's person pages search it.
- **A person:** `subscreen_person_<slug ≤ 20>_<5 random>` (a slug reading
  "profile…" gets `p-`; none gives `person`), `{ displayName }`, title and
  description the name, `person.json`. It is shared by every title that
  names them. Before publishing a new one, Hub looks the name up as
  Subscreen's form does (`subscreenPeople.ts`) and points at the newest
  match from any publisher. A person published this session is reused too.
  A failed lookup makes a new person, as in Subscreen.

The title's resources go first, then each new person, then the credits;
people and credits wait for the title's listing. A film's go in its own plan
and approval, with the lookups before the approval. A series' go with its
playlist, planned once, so a retry sends the same people. No names, no
credits DOCUMENT. The credits are in the record (`kind: 'credits'`) and
removed first; a person never is. A series whose playlist went up without its
credits is failed with its record (partly on the list), and Retry sends the
rest. Once a Remove has started, Retry doesn't. A Cancel while the people are
looked up, or while the approval is open, leaves it cancelled (nothing went
up), with its file kept for Retry.

### Torq (2026-11-14)

- A post with a video: VIDEO + metadata in Q-Tube's format (Torq: id of 8,
  title ≤ 100 in its dialog, category required, no description: one typed
  for another app isn't sent), then the post DOCUMENT with
  the identifier Hub's composer builds (`buildQuitterPostIdentifier`), JSON
  `{ text, timestamp, name, videos: [{ identifier: "<id>_metadata", service:
"DOCUMENT", name, mimeType: "video/mp4", source: "upload", display: "card"
}] }`, with the mention/hashtag description from `torqPublish.ts` /
  `quitterPublish.ts`. The post stays under 5 MiB.
- A video already on Q-Tube: post only, `videos: [{ name, identifier:
"<id>_metadata", service: "DOCUMENT", display: "card" }]`, and its Q-Tube
  link appended to the text for Quitter readers (Torq adds an attached
  link's source URL the same way).
- Removal: the post first, then (for an uploaded video) its metadata and
  VIDEO, all `RA==`, as Torq's delete does; a linked video is left alone.

### Q-Share (2.1.0)

- FILE `qshare_file_<slug>_<id6>` (title ≤ 50, description
  `**cat:4;sub:<4xx>**` + 150, `tag1: "qshare_file_"`, the file name),
  optional THUMBNAIL `qshare_thumb_<slug>_<id6>` (`thumbnail.webp`, ≤ 640 px,
  ≤ 200 KB), DOCUMENT `qshare_file_<slug>_<other id6>_metadata` (`data64`,
  filename `video_metadata.json`): `{ title, version: 1, fullDescription,
htmlDescription, commentsId: "qshare_file__cm_<id>", category: "4",
subcategory: "<4xx>", subcategory2: "", files: [{ filename, identifier,
name, service: "FILE", mimetype, size }], thumbnail: { service:
"THUMBNAIL", name, identifier } }`. Subtitles can go in as extra FILEs in
  `files`.
- Titles: Q-Share's form keeps only `[a-zA-Z0-9\s-_!?()&'",.;:|—~@#$%^*+=<>]`
  (accents are folded first, so "café" stays "cafe").
- Removal: as Q-Share's `buildShareRemoval` (title, description and `tag1`
  `deleted`, files keeping their names, data `RA==`), but the DOCUMENT goes
  first, like every other listing here, so a stopped removal never leaves a
  share whose file is gone.
- Link: `qortal://APP/Q-Share/share/<name>/<metadata identifier>`.

## The window

- Drop files or a folder, or Choose videos / Choose a folder. The buttons
  open the system's dialog through main (`pickFiles`), worded by the window
  ("Add for publishing" / "Add for converting": Chromium's own picker says
  "Upload"); main reads a folder like Chromium's folder picker (relativePath
  "<folder>/<sub>/<file>", sorted by name, no hidden files or links, 6
  levels, 2000 files). The hidden `<input type=file>` / `webkitdirectory`
  stay for an older main. Each file becomes a
  queue item with a 16:9 thumbnail (112×63, 144×81 in a window wider than
  760 px) and the original's line: its file type (from ffprobe's
  `format_name`, the file name telling apart one family: MP4/MOV, MKV/WebM,
  VOB), size, resolution, length and probe summary (sound as "AAC stereo",
  "AC-3 mono", "E-AC-3 5.1"). Once converted, a second line says what it
  became: MP4, its size and resolution, and how much smaller. What was left out shows under the list, named (three at
  most, then "and N more") with why: audio only (a sound file's extension),
  no video named like it (a subtitle file), or not a video. A subtitle file
  goes with the video it's named after, added with it or already queued
  (one in a run was planned without it: left out); named after none, with
  the one video added with it. A suggested series sorts the queue, but an
  order set by hand stays when more files come (the series form's Sort
  sorts again).
- Destination: Q-Tube · Subscreen (Film / TV series) · Torq · Q-Share · Save
  to this PC. It's where the next Publish goes, and stays open during a
  run: published then, videos join it with their own app (a series can't
  join or be joined: its playlist is planned at the start). Each card in a
  run shows its app (`DestinationTag`).
- With two or more ready videos each has a tick; the main button takes the
  ticked ones, the others stay for a later one ("Ticked: N of M"). It says
  what happens now: with "Preview each converted video first", "Convert for
  <app> (N)", "Convert the series (N)" or "Convert (N)" (each video is then
  published or saved from its card); without, "Convert and publish to <app>
  (N)", "Convert and publish the series (N)" or "Convert and save (N)".
  When every one keeps its file (Keep as is), nothing is converted, so it
  says "Prepare for <app> (N)" / "Prepare the series (N)" / "Prepare (N)",
  or "Publish to <app> (N)" / "Publish the series (N)" / "Save (N)".
- A ready video whose file already plays in the apps and fits the limit
  (Keep as is is open for it: `readyAsIs`) says so in green on its card:
  "Ready to publish as it is: AV1 and AAC, under the 2 GB limit. Choose
  “Keep as is” under Quality to skip converting.", or, kept, "It goes up
  without converting." Not for Save to this PC.
- Quality: chosen once, in the settings column (`QualitySteps`): the five
  steps, greyed above every ticked video's own size
  (`windowQualityChoices`; "Your videos go up to 720p…"), and Keep as is
  when a video can keep its file (others then get the best step). The card
  shows only what its video converts at.
- "Preview each converted video first" (on by default): a converted video
  waits with its preview, then Publish it / Save it or Discard.
- Each item has the chosen app's fields, prefilled (title from the file name
  without dots/underscores/release tags, cover from the video's frames), and
  a "same for all" row for the shared ones (category, genre, description,
  post text).
- Posters: a Subscreen film, and a Q-Tube or Torq video in Movies or Series
  (Subscreen lists those too), asks for its real poster (`posterWanted`):
  until an image is chosen, the cover section says why (Subscreen shows it
  upright, 2:3; a frame gets cut to fit) and offers "Choose a poster", and
  the card notes that a frame of the video goes in its place. The series
  form asks for the series' poster the same way. A Q-Tube or Torq cover
  isn't cut (a chosen poster stays upright); a Subscreen one is cut to 2:3.
  A chosen image shows whole in its tile.
- Look: the window wraps itself in `publisherTheme` (Hub's blue pill surface
  for a picked choice, segmented groups for Format and Quality, rounded
  fields, blue progress bars), its two columns are soft panes (`paneSx`),
  and a card's notes are tinted callouts with their tone's icon; a card that
  still needs something has a warning stripe down its edge. Where to: five
  equal tiles in one row (`destinationTileSx`), each app's picture on a
  round backdrop of its own (`avatarSocketSx`), so a light picture (Q-Share's)
  shows on the blue picked tile too.
- Sizes (Home lets the window go down to a third of Home's width, and as
  tall as wanted): wide (from 860 px), the videos on the left and the
  settings with their bar on the right, each column scrolling on its own;
  wide but under 560 px tall, the whole window scrolls instead (rows at
  their content's height: `max-content max-content 1fr`), so neither column
  is squeezed under the bar. Narrow, a tall slim window too: one column,
  the videos, the settings, then the bar, scrolling together; from 640 px
  tall the bar stays in view at the bottom (sticky). The videos pane is a
  container (`vp-queue`): in a slim pane a card's picture shrinks to 84×47
  and subtitle rows give the file's name more room; the "Where to" tiles
  shrink their names under 440 px, so all five stay in one row.
- The main button starts converting at once (the approval comes right
  before each upload) → conversion and publishing run as a pipeline (item 2 converts while item 1
  is published), cancel, retry. Progress shows in one place, each card's
  bar: converting, its % and time left ("42 % · 3 min left", seconds under
  a minute); publishing, the share of its bytes up (the video is nearly all
  of it, its thumbnail and listing a sliver), with "Publishing the video"
  beside it. A converting card has Pause beside Cancel (where main can
  pause): the bar stands dimmed, the status says Paused, and Resume goes on
  from there. Nothing else converts meanwhile; uploads of videos already
  converted go on. The run pane only counts ("Converted: 1 of 2", "Published:
  0 of 2", "Saved", each for its own videos) and says how many wait to be
  checked. Pressed during a run, the main button puts those videos after
  the ones in it (`start` → `joinRun`), with the app, quality and
  shared fields chosen then. A converted video waiting to be checked can be
  minimized (its preview hidden, Save it / Publish it kept). Results with Open in the app
  and "Remove from <app>" (replaces what was published there, after a
  confirmation with the fee). The queue survives leaving Home.
- Published (collapsed, with a count): every video this account published
  from here, newest first, with Open, Copy link and "Remove from <app>" (the
  same confirmation with the fee), after Clear finished and a restart too.
  Clear finished takes off the queue what's over (published, discarded,
  not a video, cancelled before converting); a cancelled video that kept
  its converted file stays, since Retry would still publish it
  (`isClearable`), and so does an episode its series still holds; the
  button counts only what it takes.
  × takes an entry off the list ("Take off this list. It stays on <app>.")
  when it went up whole or was removed; not one only partly up, or with a
  removal running or failed, which Remove cleans up (`canDismissPublished`).
- Subtitles and fields after the start: the title, description and the
  other fields can change until the video goes up. So can its text
  subtitles (add a file, tick, language, label): one still waiting takes
  them into its job, one converting gets them written when it's done
  (`syncSubtitles` compares the list with `madeSubtitles`), a converted
  one gets them written again once the edits stop (400 ms), and publishing
  waits for that. The sound and a burned-in track are part of the picture,
  fixed once it starts converting. Cancelled (or failed) before it was
  converted, everything can change again, and Retry builds its job anew
  with the choices as they are then.
- Subtitle files: the language comes from the tags at the end of the name
  (`languageFromFileName`): `movie.en.srt`, `movie.pt-BR.forced.srt`, and
  names of tags only, as subtitle folders have them (`English.srt`,
  `Forced.eng.srt`, `SDH.eng.HI.srt`). "hi" alone is Hindi; beside another
  language it means hearing impaired (`movie.en.hi.srt`). The players list a
  track per language, so one per language goes (`chosenSubtitles`): of the
  ticked ones, a full track before one for the hearing impaired, and that
  before a forced one (the first of equals). The others say another track
  of their language goes instead.
- Subtitles: Q-Share has no subtitle player, so the card says ticked tracks
  go into the share as .vtt files to download (the library publishes them
  as FILEs the share names). Save to this PC writes the MP4 alone
  (`saveOutput`): the card says so and offers only picture tracks to burn
  in; text tracks aren't extracted for it. The save dialog asks before
  overwriting. Once saved, the card shows the path, Play (the system's
  player) and Show in folder (`openSaved`): main keeps the paths it saved
  per page and opens only those, by an id it gave out, never a path from the
  page; a file moved or deleted since gives `saved-missing`.
- Limits from `MAX_SIZE_PUBLISH` / `MAX_SIZE_PUBLIC_NODE` and
  `isRunningGateway()`. Needs a registered name for publishing (Save works
  without).
- All text through i18next (`core:video_publisher.*`), both themes via
  `theme.palette`.

### How the window is built (`src/components/VideoPublisher/`)

- State lives in Jotai's default store (`videoPublisherAtoms.ts`), driven by
  one controller (`videoPublisherController.ts`) outside React, so a run goes
  on while Home is hidden. It listens to `videoTool.onJobEvent` only while a
  run is going.
- The pipeline: the engine converts one video at a time; the next conversion
  starts once the converted video before it has begun uploading. Uploads go
  in queue order, the first converted video first: one further up that
  isn't converted yet (a retry) doesn't hold the converted ones after it.
  With "Let me check each video first", videos waiting for the check don't
  hold the next conversions, up to `MAX_CONVERTED_HELD` (3) converted files
  waiting at once, to be checked or uploaded (then, while one waits for its
  check, the window says the next converts once one goes up or is
  discarded), and an approved video uploads even while one before it still
  waits for its check: they can be checked in any order. A series' playlist
  still goes last, its episodes in the queue's order. A refusal, a balance
  too short for a video's fees, a missing API key or an unknown error stops the
  run; converted videos keep their files for Retry, which skips what went
  up, and videos being saved to this PC go on. Cancel all stops a series'
  playlist too, unless its upload started (it ends failed, with Retry). A series' playlist goes once every episode is up (or on "Publish the
  series without them"). While it still owes its playlist to an episode
  that went up, no other run starts (`seriesOwesPlaylist`; the main button
  says to finish the series first): a new run would drop it.
- A video keeps the run it went into (`QueueItem.context`: destination,
  name, account, and the shared and series fields as they were at
  Publish): a later run doesn't change its card, its Retry (which publishes
  where its plan was made for) or its Remove. A run's progress counts only
  its own videos (`run.itemIds`); a video of an earlier run that's retried
  counts in the run it goes on in (not in a series' run, whose videos are
  its episodes). A series that's done doesn't hold the window's settings
  while such a video goes (`seriesBusy`), though nothing joins its run. Retry isn't offered once a Remove started.
- Retry never publishes unasked: it converts again (or goes back to be
  checked, when its run wanted that and it wasn't), and the upload asks for
  approval again, with what's left of it and its fee. The same holds for a
  series' playlist (its Retry and "Publish the series without them").
- What went up of a video that failed or was cancelled keeps a record, so
  Remove can replace it; an episode keeps its own until the series'
  playlist takes it in (and stays on the list until then), and an episode
  that finishes after the playlist went up publishes the playlist again (so
  the series' card can't be closed while an episode can be retried, or is
  on its way after a Retry). The
  series' poster is picked from the episodes of the series it goes with;
  one picked from another video stays shown, as picked.
  While the playlist goes up, neither the series nor an episode it lists
  can be removed (`removalBlocked`), and a series whose Remove started isn't
  published again (no Retry). Remove's confirmation counts, and its fee
  covers, only what is left of a Remove that stopped half way. Its balance
  check (`quote`) takes off what the account's unconfirmed transactions
  take too, and a balance the node can't check keeps Remove off, as for a
  publish.
- Another account signing in (or signing out) stops the run and clears the
  queue: nothing is published as an account other than the run's own.
- The published list (`publishedHistory.ts`, `videoPublishedAtom`) is per
  account in `localStorage['video-publisher-published-v1:<address>']`, the
  200 newest (an entry lists up to 10,000 resources: a long series with
  many subtitle languages lists hundreds), read and written in try/catch (blocked storage: it lasts until
  Hub closes). An entry is the library's `PublishedRecord` with its kind
  (`qtube`, `film`, `series`, `episode`, `torq`, `qshare`), `publishedAt`,
  `partial` (what a failed, cancelled or still running upload put on QDN,
  written as each part goes up, so closing Hub mid-upload keeps it) and its
  removal
  state, plus the removal steps that went through (`removedKeys`), so a
  Remove stopped by a restart (`removal-interrupted`) skips them. A video is
  `item:<id>`, rewritten when a retry finishes it. It goes on the list of
  the account that ran it, even when another signed in meanwhile (an upload
  that started can't be stopped), as is what a removal replaced after a
  switch; a series'
  `series:<playlist identifier>` takes its episodes' place once the
  playlist is up. Stored entries are checked field by field on reading.
  Remove from the list of a video still on the queue goes through its
  card's removal, so both show the same; a removed entry can be taken off
  the list. Its card's details (which are open) live in the store too
  (`videoExpandedAtom`), and the Details button is there while the file is
  read, so a click then isn't lost; the adding bar and the left-out note
  don't move the cards (the note, under them, is scrolled into view). On
  the empty screen the published list scrolls on its own, within 45% of
  the window, so the drop zone and its buttons stay in view.
- Qualities use the engine's own `planVideoJob` (`qualityOptions.ts`):
  Original quality always (beside Keep as is, which shows only when
  `playableAsIs`). The window's quality steps down per video when it
  doesn't fit (Original quality too long at its own size: the largest step
  that fits); a video smaller than the chosen step and between two steps
  keeps its own size at Original quality. Under the steps: "No video comes
  out bigger than its original".
- Save to this PC isn't held to the node's limit (64 GiB, only the disk).
- Error codes from the engine, the library and the window share one set of
  sentences, `core:video_publisher.error.<code with "_">`.
