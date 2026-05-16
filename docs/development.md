# Development

Requirements for the development of Qortal-Hub from sources:

- installation of nodejs from the [official site](https://nodejs.org/en/download)
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

Reticulum is bundled as a native binary for packaged Electron builds. Build packages on the target OS so the bundled `rnsd` matches that platform:

- Linux: `npm run electron:make-lin` or `npm run electron:make-lin-docker-appimage`
- macOS: `npm run electron:make-mac`
- Windows: `npm run electron:make-win`

## Contribution guide

See some useful instructions about [contribution](contribution.md).
