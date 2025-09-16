# Development

Requirements for the development of Qortal-Hub from sources:

- installation of nodejs from the [official site](https://nodejs.org/en/download)
- an IDE like vscode or Intellij, or similar tools
- some knowledge of React and its ecosystem

## Running Qortal-Hub while developing

Follow these steps:

- install dependencies: `npm install`
- `npm run dev`
- open the browser at page `http://localhost:5173/`

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

## Contribution guide

See some useful instructions about [contribution](contribution.md).
