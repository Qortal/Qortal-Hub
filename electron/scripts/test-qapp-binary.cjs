// Real Chromium serialization is essential: structuredClone mocks preserve Blobs
// and would miss the original regression. No Core, wallet or external network is needed.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('../../node_modules/esbuild');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const profile = mkdtempSync(join(tmpdir(), 'qapp-binary-test-'));
app.setPath('userData', profile);
app.on('will-quit', () => rmSync(profile, { recursive: true, force: true }));
const preload = join(__dirname, '../build/src/qapp-guest-preload.js');
const timer = setTimeout(() => {
  console.error('Binary bridge test timed out');
  app.exit(1);
}, 45_000);

app
  .whenReady()
  .then(async () => {
    const hostBundle = await build({
      entryPoints: [
        join(__dirname, '../../src/qortal/qapp-guest-request-bridge.ts'),
      ],
      bundle: true,
      format: 'iife',
      globalName: 'QAppBridge',
      platform: 'browser',
      write: false,
    });
    // Exercise the second IPC hop and actual native RNS encoder with an echo
    // transport, without opening a network link or requesting account access.
    const managerPath = join(profile, 'rns-manager.cjs');
    await build({
      entryPoints: [join(__dirname, '../src/qapp-reticulum-manager.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: managerPath,
    });
    const { QAppReticulumManager } = require(managerPath);
    const rnsCalls = [];
    const manager = new QAppReticulumManager({
      onEvent: () => () => {},
      invoke: async (action, payload) => {
        rnsCalls.push({ action, ...payload });
        return { ok: true, payload: { ...payload, messageId: 'test-message' } };
      },
    });
    const owner = { tabId: 'test', name: 'test', service: 'APP' };
    const destination = '0123456789abcdef0123456789abcdef';
    const { connectionId } = await manager.connect(owner, destination);
    const hostPreload = join(profile, 'host-preload.cjs');
    writeFileSync(
      hostPreload,
      `
      const { contextBridge, ipcRenderer } = require('electron');
      contextBridge.exposeInMainWorld('testRns', data => ipcRenderer.invoke('test:rns', data));
    `
    );
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        webviewTag: true,
        contextIsolation: true,
        preload: hostPreload,
      },
    });
    ipcMain.handle('test:rns', (event, data) => {
      assert.equal(event.sender, win.webContents);
      return data.action === 'RNS_REQUEST'
        ? manager.request(owner, {
            destination,
            path: '/echo',
            payload: data.payload,
          })
        : manager.send(owner, connectionId, data.payload);
    });
    const guests = new Set();
    let guestContents;
    ipcMain.handle('qappGuest:hello', (event) => {
      assert.ok(guests.has(event.sender.id));
      return true;
    });
    win.webContents.on('will-attach-webview', (_event, prefs) => {
      prefs.preload = preload;
      prefs.sandbox = true;
      prefs.contextIsolation = true;
      prefs.nodeIntegration = false;
      prefs.additionalArguments = ['--qapp-guest-token=binary-test'];
    });
    win.webContents.on('did-attach-webview', (_event, guest) => {
      guests.add(guest.id);
      guestContents = guest;
      guest.on('preload-error', (_event, _path, error) => {
        throw error;
      });
    });
    await win.loadURL('data:text/html,<body></body>');
    await win.webContents.executeJavaScript(hostBundle.outputFiles[0].text);
    const guestScript = `
    window.ask = data => new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => {
        channel.port1.close();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      parent.postMessage({requestedHandler: 'UI', ...data}, '*', [channel.port2]);
    });
    window.early = ask({action: 'SAVE_FILE', blob: new Blob(['early'], {type:'text/plain'}), filename:'early.txt'});
  `;
    await win.webContents.executeJavaScript(`new Promise(resolve => {
    window.dispatched = [];
    window.chunkSizes = [];
    window.documents = [];
    const view = document.createElement('webview');
    window.view = view;
    view.setAttribute('preload', ${JSON.stringify(pathToFileURL(preload).href)});
    view.addEventListener('ipc-message', event => {
      if (event.channel === 'qapp:binary' && event.args[0].kind === 'chunk') window.chunkSizes.push(event.args[0].bytes.byteLength);
      if (event.channel !== 'qapp:hello') return;
      window.documents.push(event.args[0].documentId);
      if (window.disposeBridge) window.disposeBridge();
      window.disposeBridge = QAppBridge.attachQAppRequestBridge(view, event.args[0].documentId, async event => {
        const {data, ports} = event;
        window.dispatched.push(data.action);
        if (data.action === 'RNS_REQUEST' || data.action === 'RNS_SEND') {
          ports[0].postMessage({result: await window.testRns(data), error: null});
          return;
        }
        if (data.action === 'UNSERIALIZABLE_REPLY') {
          ports[0].postMessage({result: () => undefined, error: null});
          return;
        }
        if (data.action === 'SAVE_FILE') {
          const url = URL.createObjectURL(data.blob);
          URL.revokeObjectURL(url);
        }
        const summarize = async value => {
          if (value instanceof Blob) {
            const bytes = new Uint8Array(await value.arrayBuffer());
            let checksum = 0;
            for (const byte of bytes) checksum = (checksum + byte) >>> 0;
            const digest = bytes.byteLength >= 1024 * 1024
              ? {byteExact:bytes.every((byte,index)=>byte===index%251)}
              : {};
            return {kind:value instanceof File?'File':'Blob', size:value.size, type:value.type, name:value.name, lastModified:value.lastModified, checksum, ...digest};
          }
          if (ArrayBuffer.isView(value)) return Array.from(value);
          if (Array.isArray(value)) return Promise.all(value.map(summarize));
          if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k,v])=>[k,await summarize(v)])));
          return value;
        };
        ports[0].postMessage({ result: await summarize(data), error: null });
      });
      // Hold readiness briefly so the early page request exercises the queue.
      setTimeout(() => { view.send('qapp:ready', event.args[0].documentId); resolve(); }, 50);
    });
    view.src = ${JSON.stringify('data:text/html,<body><script>' + guestScript + '</script></body>')};
    document.body.append(view);
  })`);
    const results = await win.webContents.executeJavaScript(
      `view.executeJavaScript(${JSON.stringify(`(async () => {
    const size = 16 * 1024 * 1024 + 13;
    const bytes = new Uint8Array(size);
    let checksum = 0;
    for (let i=0;i<size;i++) {bytes[i]=i%251; checksum=(checksum+bytes[i])>>>0;}
    const file = new File([bytes], 'video.bin', {type:'application/octet-stream',lastModified:12345});
    const early = await window.early;
    const [save, single, multiple, encrypt, groupEncrypt, sharingEncrypt, pdf, ordinary] = await Promise.all([
      ask({action:'SAVE_FILE',blob:new Blob(['hello'],{type:'text/plain'}),filename:'hello.txt'}),
      ask({action:'PUBLISH_QDN_RESOURCE',file}),
      ask({action:'PUBLISH_MULTIPLE_QDN_RESOURCES',resources:[{file:new File(['nested'],'nested.txt',{type:'text/plain',lastModified:6789})},{file:new Blob([],{type:'image/png'})}]}),
      ask({action:'ENCRYPT_DATA',blob:new Blob(['secret'])}),
      ask({action:'ENCRYPT_QORTAL_GROUP_DATA',groupId:1,file:new File(['secret'],'secret.txt',{type:'text/plain'})}),
      ask({action:'ENCRYPT_DATA_WITH_SHARING_KEY',blob:new Blob(['secret'])}),
      ask({action:'SHOW_PDF_READER',blob:new Blob(['%PDF-1.7'],{type:'application/pdf'})}),
      ask({action:'FILE_SAVE_WRITE',data:new Uint8Array([1,2,3]),offset:0,saveId:'control'}),
    ]);
    return {early,save,single,multiple,encrypt,groupEncrypt,sharingEncrypt,pdf,ordinary,size,checksum};
  })()`)})`
    );
    assert.equal(results.early.blob.checksum, 541);
    assert.equal(results.save.blob.checksum, 532);
    assert.deepEqual(results.single.file, {
      kind: 'File',
      size: results.size,
      type: 'application/octet-stream',
      name: 'video.bin',
      lastModified: 12345,
      checksum: results.checksum,
      byteExact: true,
    });
    assert.equal(results.multiple.resources[0].file.name, 'nested.txt');
    assert.equal(results.multiple.resources[0].file.checksum, 643);
    assert.equal(results.multiple.resources[0].file.lastModified, 6789);
    assert.deepEqual(results.multiple.resources[1].file, {
      kind: 'Blob',
      size: 0,
      type: 'image/png',
      name: undefined,
      lastModified: undefined,
      checksum: 0,
    });
    assert.equal(results.encrypt.blob.checksum, 646);
    assert.equal(results.groupEncrypt.file.checksum, 646);
    assert.equal(results.groupEncrypt.file.kind, 'File');
    assert.equal(results.sharingEncrypt.blob.checksum, 646);
    assert.equal(results.pdf.blob.kind, 'Blob');
    assert.equal(results.pdf.blob.type, 'application/pdf');
    assert.equal(results.pdf.blob.checksum, 450);
    assert.deepEqual(results.ordinary.data, [1, 2, 3]);
    const state = await win.webContents.executeJavaScript(
      '({chunks:window.chunkSizes,dispatched:window.dispatched})'
    );
    assert.ok(state.chunks.length > 64);
    assert.ok(state.chunks.every((size) => size > 0 && size <= 256 * 1024));
    assert.equal(state.dispatched.length, 9);
    console.log('PASS: binary payload roundtrips');
    const rnsResults = await win.webContents.executeJavaScript(
      `view.executeJavaScript(${JSON.stringify(`(async () => {
        const replies = [];
        for (const action of ['RNS_REQUEST', 'RNS_SEND']) {
          for (const payload of [
            new Uint8Array([1,2,3]).buffer,
            new DataView(new Uint8Array([99,1,2,3,88]).buffer,1,3),
            new Uint16Array(new Uint8Array([99,99,1,2,3,4,88,88]).buffer,2,2),
            new ArrayBuffer(0),
          ]) {
            const result = await ask({action, payload});
            replies.push(action === 'RNS_REQUEST'
              ? {binary:result instanceof Uint8Array, bytes:Array.from(result)}
              : result);
          }
        }
        return replies;
      })()`)})`
    );
    const expectedRnsBytes = [[1, 2, 3], [1, 2, 3], [1, 2, 3, 4], []];
    assert.deepEqual(
      rnsResults.slice(0, 4),
      expectedRnsBytes.map((bytes) => ({ binary: true, bytes }))
    );
    assert.deepEqual(
      rnsResults.slice(4),
      expectedRnsBytes.map(() => ({ messageId: 'test-message' }))
    );
    const encodedRns = rnsCalls.filter(
      (call) => call.action !== 'qapp_rns_connect'
    );
    assert.equal(encodedRns.length, 8);
    encodedRns.forEach((call, index) => {
      assert.equal(call.encoding, 'base64');
      assert.deepEqual(
        Array.from(Buffer.from(call.payloadBase64, 'base64')),
        expectedRnsBytes[index % 4]
      );
    });
    console.log(
      'PASS: RNS binary request/send across both IPC hops and binary replies'
    );
    // A response serialization error must reject that request and leave the
    // guest connected for the next one.
    const replyFailure = await win.webContents.executeJavaScript(
      `view.executeJavaScript("ask({action:'UNSERIALIZABLE_REPLY'}).then(()=>'unexpected success',error=>error.message)")`
    );
    assert.equal(replyFailure, 'QAPP_BRIDGE_ERROR');
    const afterBadReply = await win.webContents.executeJavaScript(
      `view.executeJavaScript("ask({action:'AFTER_BAD_REPLY'})")`
    );
    assert.equal(afterBadReply.action, 'AFTER_BAD_REPLY');
    console.log('PASS: asynchronous response failure recovery');

    // A navigation to an attachment starts, but keeps the original document.
    // Cancelling the download must not leave that Q-App's bridge disconnected.
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="synthetic.txt"',
      });
      response.end('synthetic download');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const attempted = new Promise((resolve) =>
        guestContents.session.once('will-download', (event) => {
          event.preventDefault();
          resolve();
        })
      );
      await guestContents.executeJavaScript(
        `location.href = ${JSON.stringify(`http://127.0.0.1:${server.address().port}/attachment`)}; void 0;`
      );
      await attempted;
      const afterDownload = await win.webContents.executeJavaScript(
        `view.executeJavaScript("ask({action:'AFTER_CANCELLED_DOWNLOAD',blob:new Blob(['still connected'])})")`
      );
      assert.equal(afterDownload.action, 'AFTER_CANCELLED_DOWNLOAD');
      assert.equal(afterDownload.blob.size, 15);
      console.log('PASS: bridge survives cancelled download navigation');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    // Interrupt a real transfer before its first chunk is acknowledged, then
    // navigate. Its incomplete data must never reach a handler in either document.
    await win.webContents.executeJavaScript(`new Promise(resolve => {
    const interrupt = event => {
      if (event.channel !== 'qapp:binary' || event.args[0].kind !== 'chunk') return;
      event.stopImmediatePropagation();
      view.removeEventListener('ipc-message', interrupt, true);
      resolve();
    };
    view.addEventListener('ipc-message', interrupt, true);
    view.executeJavaScript("void ask({action:'INTERRUPTED',blob:new Blob([new Uint8Array(1024*1024)])})");
  })`);
    // Reload generates a fresh document binding and must still accept legacy calls.
    await win.webContents.executeJavaScript(
      `new Promise(resolve => {view.addEventListener('ipc-message',function onHello(e){if(e.channel==='qapp:hello'){view.removeEventListener('ipc-message',onHello);setTimeout(resolve,100);}});view.reload();})`
    );
    const reloaded = await win.webContents.executeJavaScript(
      "view.executeJavaScript('window.early')"
    );
    assert.equal(reloaded.blob.checksum, 541);
    const documents =
      await win.webContents.executeJavaScript('window.documents');
    assert.equal(new Set(documents).size, 2);
    assert.equal(
      await win.webContents.executeJavaScript(
        "window.dispatched.includes('INTERRUPTED')"
      ),
      false
    );
    console.log(
      `Q-App binary Electron test passed: SAVE_FILE, single/multiple publish, encryption, early/concurrent requests, failed replies, cancelled downloads, interrupted transfer/reload, and ${results.size} bytes in bounded chunks (Electron ${process.versions.electron}).`
    );
    clearTimeout(timer);
    manager.destroy();
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
