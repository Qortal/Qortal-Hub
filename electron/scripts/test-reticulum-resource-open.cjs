// Linux regression test: use a synthetic xdg-open so no real application or
// attachment is opened. Exercise actual IPC, shell dispatch and forced GC.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { build } = require('../../node_modules/esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const v8 = require('node:v8');
const vm = require('node:vm');

if (process.platform !== 'linux') {
  console.log('SKIP: Linux desktop opener regression');
  app.quit();
} else {
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-resource-open-'));
  app.setPath('userData', path.join(root, 'profile'));
  const log = path.join(root, 'opened');
  process.env.QORTAL_TEST_OPEN_LOG = log;
  fs.writeFileSync(
    path.join(root, 'xdg-open'),
    '#!/bin/sh\nprintf "%s\\n" "$1" >> "$QORTAL_TEST_OPEN_LOG"\n',
    { mode: 0o700 }
  );
  process.env.PATH = root + path.delimiter + process.env.PATH;
  const preload = path.join(root, 'preload.cjs');
  fs.writeFileSync(
    preload,
    `
    require('electron').contextBridge.exposeInMainWorld('openAttachment', () =>
      require('electron').ipcRenderer.invoke('reticulumResource:open'));
    require('electron').contextBridge.exposeInMainWorld('openConfigFolder', () =>
      require('electron').ipcRenderer.invoke('reticulum:revealConfigInFileExplorer'));
  `
  );
  const timeout = setTimeout(() => {
    console.error('Desktop open IPC did not settle');
    app.exit(1);
  }, 15_000);
  let gcTimer;
  app.on('will-quit', () => {
    clearTimeout(timeout);
    clearInterval(gcTimer);
    fs.rmSync(root, { recursive: true, force: true });
  });
  app
    .whenReady()
    .then(async () => {
      const modulePath = path.join(root, 'resource-open.cjs');
      await build({
        stdin: {
          contents: `export { materializeReticulumResourceForOpen } from './reticulum-resource-open';
            export { openLocalPath } from './desktop-shell';`,
          resolveDir: path.join(__dirname, '../src'),
          loader: 'ts',
        },
        outfile: modulePath,
        bundle: true,
        platform: 'node',
        format: 'cjs',
      });
      const { materializeReticulumResourceForOpen, openLocalPath } = require(
        modulePath
      );
      const sourcePath = path.join(root, 'verified-resource');
      fs.writeFileSync(sourcePath, 'synthetic attachment');
      let openedPath;
      ipcMain.handle('reticulumResource:open', async () => {
        openedPath = await materializeReticulumResourceForOpen({
          sourcePath,
          tempRoot: root,
          fileHash: 'a'.repeat(64),
          suggestedFileName: 'résumé #1%.txt',
        });
        const error = await openLocalPath(openedPath, shell);
        return { success: !error, error };
      });
      const configDir = path.join(root, 'config folder #1%');
      ipcMain.handle('reticulum:revealConfigInFileExplorer', async () => {
        fs.mkdirSync(configDir, { recursive: true });
        const error = await openLocalPath(configDir, shell);
        return { ok: !error, error: error || undefined, configDir };
      });
      const win = new BrowserWindow({
        show: false,
        webPreferences: { preload },
      });
      await win.loadURL('data:text/html,<body></body>');
      gcTimer = setInterval(gc, 50);
      const result =
        await win.webContents.executeJavaScript('openAttachment()');
      assert.deepEqual(result, { success: true, error: '' });
      // Dispatch completion need not wait for xdg-open to exit/write its log.
      for (let i = 0; i < 100 && !fs.existsSync(log); i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        fs.readFileSync(log, 'utf8').trim(),
        pathToFileURL(openedPath).href
      );
      assert.equal(fs.readFileSync(openedPath, 'utf8'), 'synthetic attachment');
      const folderResult =
        await win.webContents.executeJavaScript('openConfigFolder()');
      assert.deepEqual(folderResult, { ok: true, error: undefined, configDir });
      for (let i = 0; i < 100; i++) {
        if (fs.readFileSync(log, 'utf8').trim().split('\n').length === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
        pathToFileURL(openedPath).href,
        pathToFileURL(configDir).href,
      ]);
      console.log(
        `PASS: attachment materialization and Linux file/folder open IPC settle correctly on Electron ${process.versions.electron}`
      );
      win.destroy();
      app.quit();
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
