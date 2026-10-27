// Real Electron regression. Uses production policies, preload and file/storage
// handlers, loopback HTTP, synthetic files, and isolated userData. No real wallet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const {
  installMainWindowNavigationPolicy,
  requireMainWindowSender,
} = require('../build/src/main-window-policy');
const { registerMainWindowFileIpc } = require('../build/src/main-window-files');
const {
  registerMainWindowWalletStorage,
} = require('../build/src/main-window-storage');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-window-security-'));
app.setPath('userData', path.join(scratch, 'userData'));
app.commandLine.appendSwitch('disable-gpu');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'capacitor-electron',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const shellUrl = 'capacitor-electron://-';
const selected = path.join(scratch, 'selected.zip');
const output = path.join(scratch, 'backup.json');
const secret = path.join(scratch, 'not-selected');
fs.writeFileSync(selected, 'synthetic preview');
fs.writeFileSync(secret, 'synthetic secret');
let main;
let childCount = 0;
let requests = 0;
const externalLinks = [];
const web = http.createServer((_request, response) => {
  requests++;
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Untrusted page</title>');
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error('Main window security test timed out');
  app.exit(1);
}, 30_000);

app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
    const remote = `http://127.0.0.1:${web.address().port}/?capacitor-electron`;
    protocol.handle('capacitor-electron', (request) => {
      if (new URL(request.url).pathname === '/redirect') {
        return new Response(null, {
          status: 302,
          headers: { Location: remote },
        });
      }
      return new Response(
        '<!doctype html><title>Hub shell fixture</title><body></body>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    });
    main = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        sandbox: false,
        contextIsolation: true,
        webviewTag: true,
        preload: path.resolve(__dirname, '../build/src/preload.js'),
        additionalArguments: [
          '--window-role=main-shell',
          `--hub-shell-url=${shellUrl}`,
        ],
      },
    });
    const checkSender = (event) =>
      requireMainWindowSender(event, main.webContents, shellUrl);
    const files = registerMainWindowFileIpc({
      ipcMain,
      checkSender,
      dialog: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [selected],
        }),
        showSaveDialog: async () => ({ canceled: false, filePath: output }),
      },
    });
    registerMainWindowWalletStorage({
      ipcMain,
      checkSender,
      getFilePath: async () => path.join(scratch, 'wallet-storage.json'),
      onError: (error) => {
        throw error;
      },
    });
    installMainWindowNavigationPolicy(
      main.webContents,
      shellUrl,
      async (url) => {
        externalLinks.push(url);
      },
      (error) => {
        throw error;
      }
    );
    main.webContents.on('did-create-window', () => {
      childCount++;
    });
    main.webContents.on('did-navigate', () =>
      files.revoke(main.webContents.id)
    );
    await main.loadURL(shellUrl);
    const run = (source) => main.webContents.executeJavaScript(source);
    assert.equal(await run('typeof window.electron.readFile'), 'function');
    assert.equal(await run('typeof require'), 'undefined');
    assert.equal(await run('typeof window.groupCall.join'), 'function');
    assert.equal(await run('typeof window.call'), 'object');

    // Wallet backups/custom-node storage and normal ZIP/download APIs still work.
    await run(`window.walletStorage.set('wallets', ['synthetic-backup'])`);
    assert.deepEqual(await run(`window.walletStorage.get('wallets')`), [
      'synthetic-backup',
    ]);
    assert.equal(await run('window.electron.selectFile()'), selected);
    assert.deepEqual(
      Array.from(
        await run(`window.electron.readFile(${JSON.stringify(selected)})`)
      ),
      Array.from(Buffer.from('synthetic preview'))
    );
    assert.equal(
      await run(
        `window.electron.readFile(${JSON.stringify(secret)}).then(() => false, () => true)`
      ),
      true
    );
    await run(`window.electron.startStreamSave({filename:'backup.json'})`);
    await run(
      `window.electron.writeChunk(${JSON.stringify(output)}, new TextEncoder().encode('first'), false)`
    );
    await run(
      `window.electron.writeChunk(${JSON.stringify(output)}, new TextEncoder().encode('second'), true)`
    );
    assert.equal(fs.readFileSync(output, 'utf8'), 'firstsecond');
    assert.equal(
      await run(
        `window.electron.writeChunk(${JSON.stringify(secret)}, new Uint8Array([1]), false).then(() => false, () => true)`
      ),
      true
    );
    await run(`window.electron.deleteFile(${JSON.stringify(output)})`);
    assert.equal(fs.existsSync(output), false);

    const click = async (url, target = '') => {
      await run(
        `(() => { const a=document.createElement('a'); a.href=${JSON.stringify(url)}; a.target=${JSON.stringify(target)}; document.body.append(a); a.click(); })()`
      );
      await delay(150);
    };
    await click(remote);
    assert.ok(main.webContents.getURL().startsWith(shellUrl));
    assert.equal(requests, 0);
    assert.equal(externalLinks.at(-1), remote);
    // A blocked navigation must preserve selections and active shell state.
    assert.equal(
      await run(
        `window.electron.readFile(${JSON.stringify(selected)}).then(() => true)`
      ),
      true
    );
    await click(remote, '_blank');
    assert.equal(childCount, 0);
    assert.equal(requests, 0);
    await click('file:///tmp/untrusted.html');
    assert.ok(main.webContents.getURL().startsWith(shellUrl));

    // QApps still run in their isolated webview and exchange request/reply
    // messages through the real guest preload with Node disabled in the shell.
    main.webContents.on('will-attach-webview', (_event, preferences) => {
      preferences.preload = path.resolve(
        __dirname,
        '../build/src/qapp-guest-preload.js'
      );
      preferences.nodeIntegration = false;
      preferences.contextIsolation = true;
      preferences.sandbox = true;
      preferences.additionalArguments = ['--qapp-guest-token=synthetic-token'];
    });
    ipcMain.handle('qappGuest:hello', (_event, token) => {
      assert.equal(token, 'synthetic-token');
    });
    let guest;
    const guestLoaded = new Promise((resolve) => {
      main.webContents.once('did-attach-webview', (_event, contents) => {
        guest = contents;
        guest.once('did-finish-load', resolve);
      });
    });
    await run(`(() => {
      const view = document.createElement('webview');
      view.src = ${JSON.stringify(remote)};
      view.addEventListener('ipc-message', event => {
        const request = event.args[0];
        if (event.channel === 'qapp:hello') view.send('qapp:ready', request.documentId);
        if (event.channel === 'qapp:request') view.send('qapp:response', {
          documentId: request.documentId, requestId: request.requestId,
          result: {syntheticReply: true}
        });
      });
      document.body.append(view);
    })()`);
    await guestLoaded;
    assert.equal(
      await guest.executeJavaScript('typeof window.electron'),
      'undefined'
    );
    const qappRequest = () =>
      guest.executeJavaScript(`new Promise(resolve => {
      const channel = new MessageChannel(); channel.port1.onmessage = e => resolve(e.data);
      window.postMessage({requestedHandler:'UI',action:'GET_USER_ACCOUNT'}, '*', [channel.port2]);
    })`);
    assert.deepEqual(await qappRequest(), { syntheticReply: true });
    await click(remote);
    assert.equal(guest.isDestroyed(), false);
    assert.deepEqual(await qappRequest(), { syntheticReply: true });
    const beforeRedirect = requests;

    // Internal navigation/reload remains functional; a redirect cannot escape.
    await main.loadURL(shellUrl + '/apps#test');
    assert.equal(await run('typeof window.electron.readFile'), 'function');
    assert.equal(
      await run(
        `window.electron.readFile(${JSON.stringify(selected)}).then(() => false, () => true)`
      ),
      true
    );
    await main.loadURL(shellUrl + '/redirect').catch(() => {});
    assert.equal(requests, beforeRedirect);
    await main.loadURL(shellUrl);
    const loaded = new Promise((resolve) =>
      main.webContents.once('did-finish-load', resolve)
    );
    main.reload();
    await loaded;
    assert.deepEqual(await run(`window.walletStorage.get('wallets')`), [
      'synthetic-backup',
    ]);

    // Even a forced main-process load (bypassing navigation events) cannot give
    // remote content the preload. Identity-only IPC guards would fail this test.
    await main.loadURL(remote);
    assert.deepEqual(
      await run(
        `['electron','electronAPI','walletStorage','appStorage','foreignWalletSigner','qortalLandRealtime'].map(k=>typeof window[k])`
      ),
      Array(6).fill('undefined')
    );
    assert.throws(
      () =>
        checkSender({
          sender: main.webContents,
          senderFrame: main.webContents.mainFrame,
        }),
      /restricted/
    );
    assert.equal(fs.readFileSync(secret, 'utf8'), 'synthetic secret');
    console.log(
      'PASS: navigation, popup/redirect blocking, preload isolation, IPC origin checks, wallet storage, ZIP reads, backup/chunk writes, cleanup, QApp request/reply, and reload'
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (main && !main.isDestroyed()) main.destroy();
    web.closeAllConnections();
    web.close();
    app.exit(process.exitCode || 0);
  }
});
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
