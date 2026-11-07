# Development

Requirements for the development of Qortal-Hub from sources:

- installation of Node.js 22.12 or newer from the [official site](https://nodejs.org/en/download)
- Python 3.9+ and Git on PATH for Reticulum networking during Electron development
- an IDE like vscode or Intellij, or similar tools
- some knowledge of React and its ecosystem

## Running Qortal-Hub while developing

Browser-only development:

Follow these steps:

- install dependencies: `npm install`
- `npm run dev`
- open the browser at page `http://localhost:5173/`

Electron development with Reticulum networking:

- install root dependencies: `npm install`
- sync Electron after web/native changes: `npx cap sync @capacitor-community/electron`
- move into Electron folder: `cd electron`
- install Electron dependencies: `npm install`
- start the desktop app: `npm run electron:start`

On first run, Electron installs the Qortal Reticulum runtime from `https://github.com/Philreact/Reticulum.git@master` plus LXMF into `electron/resources/reticulum-runtime/venv`. If that runtime gets stale or broken, rebuild it with:

```bash
cd electron
rm -rf resources/reticulum-runtime/venv
npm run bundle:reticulum-venv
```

## Opt-in renderer CPU profiling (Linux development)

From the repository root, with dependencies installed in both projects:

```bash
nvm use 24
npm run profile:renderer
```

This builds the renderer with source maps, syncs Electron, and launches a
profiling instance. Each main window and Q-App webview gets one capture:
by default it waits 60 seconds after that renderer's first `dom-ready`, then
records for 900 seconds. Reproduce the slowdown during the recording.
The app stays open after recording finishes.

For a shorter capture:

```bash
QORTAL_RENDERER_PROFILE_SECONDS=60 QORTAL_RENDERER_PROFILE_DELAY_SECONDS=10 npm run profile:renderer
```

The terminal prints `[RendererProfile]` messages with the start and saved file
path, even when ordinary development logs are disabled. Profiles are saved under
Electron's `userData/renderer-profiles/` directory as `.cpuprofile` files, with
`main-shell` or `qapp-guest` labels. Load a saved file in Chrome DevTools'
Performance panel. Keep the matching build and its source maps when inspecting it.
These are JavaScript CPU samples, not a React render-count or GPU profiler.

Keep DevTools closed on the target renderer during capture: Electron's debugger
can disconnect when DevTools opens. Closing or crashing a renderer also cancels
its unfinished capture. Other renderers continue independently.

After building and syncing, `cd electron && npm run electron:profile-renderer`
starts another profiling session without rebuilding the web assets. The normal
`npm run electron:start` command does not enable recording. Profiling is disabled
in packaged apps. The underlying explicit flag is `--profile-renderer=SECONDS`
(with `--profile-renderer-delay=SECONDS`); the bare activation flag defaults to
60 seconds with no delay. Durations are capped at one hour.

Source maps are enabled only for the profiling build. Run a normal `npm run build`
and sync again when returning to a normal build or before packaging.
The profiling build targets Electron with native top-level await, bypassing the
compatibility transform that would invalidate source maps. Normal builds retain
their existing browser targets. Profiles from older builds must be inspected with
their matching assets; rebuilding does not repair an existing recording's maps.

## Build Qortal-Hub from Source

Follow these steps:

- install dependencies: `npm install`
- `npm run build`
- `npx cap sync @capacitor-community/electron`

- move into electron folder: `cd electron`
- `npm install`
- `npm run build`

Alternatively you can start the app:

- `npm run electron:start`

Or create an Executable Package for linux:

- `npm run electron:make-local`

Reticulum is bundled as a native binary for packaged Electron builds. For Linux release artifacts, prefer the Docker commands so the bundled native binaries are built on Debian 11 with an older glibc compatibility baseline:

- Linux x64: `npm run electron:make-lin-docker` or `npm run electron:make-lin-docker-appimage`
- Linux arm64: `npm run electron:make-arm-docker` or `npm run electron:make-arm-docker-appimage`
- macOS: `npm run electron:make-mac`
- Windows: `npm run electron:make-win`

Linux arm64 Docker builds from a non-arm64 host require QEMU/binfmt arm64 emulation on the host.

## Contribution guide

See some useful instructions about [contribution](contribution.md).
