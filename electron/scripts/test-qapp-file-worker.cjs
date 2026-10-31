// Real Chromium, production guest preload, broker, worker and renderer client.
// Uses an isolated profile and loopback HTTP sink; never accesses a wallet/Core.
const { app, BrowserWindow, ipcMain, protocol, dialog } = require('electron');
const { build } = require('../../node_modules/esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qapp-file-worker-test-'));
app.setPath('userData', path.join(root, 'profile'));
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP core.qapp.test 127.0.0.1'
);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'qapp-file-worker',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const deadline = setTimeout(() => {
  console.error('File worker test timed out');
  app.exit(1);
}, 180_000);
const mib = Number(process.env.QAPP_FILE_TEST_MIB || 16);
const source = path.join(root, 'source.bin');
const block = crypto.randomBytes(1024 * 1024);
const expected = crypto.createHash('sha256');
const fd = fs.openSync(source, 'w');
for (let n = 0; n < mib; n++) {
  fs.writeSync(fd, block);
  expected.update(block);
}
fs.closeSync(fd);
const expectedHash = expected.digest('hex');
let server, shell;
app.on('will-quit', () => {
  clearTimeout(deadline);
  server?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

app
  .whenReady()
  .then(async () => {
    const { QAppFileWorkers } = require('../build/src/qapp-file-workers');
    const broker = new QAppFileWorkers();
    const {
      QAppReticulumManager,
    } = require('../build/src/qapp-reticulum-manager');
    const rns = new QAppReticulumManager({
      onEvent: () => () => {},
      invoke: async (_action, payload) => ({
        ok: true,
        payload: { ...payload, messageId: 'test-message' },
      }),
    });
    const owner = { tabId: 'test', name: 'test', service: 'APP' };
    const destination = '0123456789abcdef0123456789abcdef';
    const { connectionId } = await rns.connect(owner, destination);
    const hostPreload = path.join(root, 'host.cjs');
    fs.writeFileSync(
      hostPreload,
      `const {ipcRenderer,contextBridge}=require('electron');
    ipcRenderer.on('qappFiles:control',(e,m)=>window.postMessage({type:'qappFiles:control',...m},window.location.origin,e.ports));
    contextBridge.exposeInMainWorld('testRns', d=>ipcRenderer.invoke('test:rns',d));
    contextBridge.exposeInMainWorld('testDeniedSave', id=>ipcRenderer.invoke('qappFiles:save',id,'blob:qapp-file-worker://executor/forged','forged.bin').then(()=>false,()=>true));`
    );
    const received = [];
    let capture = false;
    let uploadHash = crypto.createHash('sha256');
    let slowStarted, slowAborted, slowRequest;
    let redirectedRequests = 0;
    server = http.createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/leaked') {
        redirectedRequests++;
        response.end('unexpected redirect');
        return;
      }
      if (request.url.endsWith('/redirect/chunk')) {
        response.writeHead(307, { Location: '/leaked' });
        response.end();
        return;
      }
      if (request.url === '/attachment') {
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="fixture.txt"',
        });
        response.end('fixture');
        return;
      }
      if (request.url.startsWith('/arbitrary/')) {
        assert.equal(
          request.headers.cookie,
          undefined,
          'Q-App cookies must not accompany uploads'
        );
        if (request.url.endsWith('/slow/chunk')) {
          request.once('aborted', () => slowAborted?.());
          response.once('close', () => slowAborted?.());
          slowRequest = request;
          request.pause();
          slowStarted?.();
          return;
        }
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          const body = Buffer.concat(chunks);
          const boundary =
            request.headers['content-type'].split('boundary=')[1];
          const start = body.indexOf('\r\n\r\n') + 4;
          const end = body.indexOf('\r\n--' + boundary, start);
          assert.ok(end >= start);
          const part = body.subarray(start, end);
          uploadHash.update(part);
          if (capture) received.push(Buffer.from(part));
          response.end('ok');
        });
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><input type="file" id="file"><body></body>' +
          (request.url === '/guest'
            ? `<script>
          window.earlyFileResult = new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = event => {
              channel.port1.close();
              if (event.data.error) reject(Error(event.data.error));
              else resolve(event.data.result);
            };
            window.postMessage({requestedHandler:'UI',action:'TEST_INTERNAL',
              file:new Blob(['early file'])}, '*', [channel.port2]);
          });
        </script>`
            : '')
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const coreOrigin = origin.replace('127.0.0.1', 'core.qapp.test');
    shell = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: hostPreload,
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await shell.loadURL(origin + '/host');
    ipcMain.handle('test:rns', (event, data) => {
      assert.equal(event.sender, shell.webContents);
      return data.action === 'RNS_REQUEST'
        ? rns.request(owner, {
            destination,
            path: '/echo',
            payload: data.payload,
          })
        : rns.send(owner, connectionId, data.payload);
    });
    let guest;
    let currentDocument;
    shell.webContents.on('will-attach-webview', (_event, preferences) => {
      preferences.preload = path.join(
        __dirname,
        '../build/src/qapp-guest-preload.bundle.js'
      );
      preferences.additionalArguments = ['--qapp-guest-token=test'];
      preferences.contextIsolation = true;
      preferences.sandbox = true;
      preferences.nodeIntegration = false;
    });
    shell.webContents.on('did-attach-webview', (_event, contents) => {
      guest = contents;
      contents.on('preload-error', (_event, file, error) => {
        console.error(file, error);
        app.exit(1);
      });
    });
    ipcMain.handle('qappGuest:hello', (event, token, documentId) => {
      assert.equal(event.sender, guest);
      assert.equal(token, 'test');
      currentDocument = documentId;
      return true;
    });
    ipcMain.handle(
      'qappFiles:open',
      async (event, documentId, requestId, bytes, files) => {
        assert.equal(event.sender, guest);
        assert.equal(event.senderFrame, guest.mainFrame);
        assert.equal(documentId, currentDocument);
        try {
          await broker.open(
            guest,
            shell.webContents,
            'persist:test-qapp',
            documentId,
            requestId,
            bytes,
            files
          );
        } catch (error) {
          if (error.message === 'QAPP_BRIDGE_BUSY') return { busy: true };
          throw error;
        }
      }
    );
    const bundled = await build({
      stdin: {
        contents: `export {attachQAppRequestBridge} from './src/qortal/qapp-guest-request-bridge';
      export {isQAppFileReference,isQAppFile} from './src/qortal/qapp-file-reference';
      export {sendMessageBackground} from './src/messaging/MessagesToBackground';`,
        resolveDir: path.join(__dirname, '../..'),
      },
      bundle: true,
      format: 'iife',
      globalName: 'TestBridge',
      platform: 'browser',
      write: false,
      plugins: [
        {
          name: 'fixture-i18n',
          setup(plugin) {
            plugin.onResolve({ filter: /i18n\/i18n$/ }, () => ({
              path: 'i18n',
              namespace: 'fixture',
            }));
            plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export default {t:key=>key}',
            }));
          },
        },
      ],
    });
    await shell.webContents.executeJavaScript(bundled.outputFiles[0].text);
    await shell.webContents.executeJavaScript(`
    window.ready = new Promise(resolve => window.readyResolve = resolve);
    window.addEventListener('message', async e => {
      if(e.source!==window || e.data?.type!=='backgroundMessage')return;
      const m=e.data;
      if(m.action!=='TEST_INTERNAL')return;
      const payload=await m.payload.file.base64();
      window.postMessage({type:'backgroundMessageResponse',requestId:m.requestId,payload},window.location.origin);
    });
    const v=document.createElement('webview');
    window.view=v;
    v.partition='persist:test-qapp';
    v.addEventListener('ipc-message', e=>{
      if(e.channel!=='qapp:hello')return;
      window.cleanup?.();
      window.cleanup=TestBridge.attachQAppRequestBridge(v,e.args[0].documentId,async e=>{
        const d=e.data; let result;
        if(d.action==='HOLD') {window.heldFile=d.file;window.heldReady?.();return;}
        if(d.action==='SLOW') {
          await d.file.upload({start:0,end:d.file.size,index:0,
            endpoint:${JSON.stringify(coreOrigin + '/arbitrary/FILE/name/slow/chunk')}});
          e.ports[0].postMessage({result:true,error:null});return;
        }
        if(d.action==='REDIRECT') {
          await d.file.upload({start:0,end:d.file.size,index:0,
            endpoint:${JSON.stringify(coreOrigin + '/arbitrary/FILE/name/redirect/chunk')}});
          e.ports[0].postMessage({result:true,error:null});return;
        }
        if(d.action==='UNSERIALIZABLE_REPLY'){e.ports[0].postMessage({result:()=>{}});return;}
        if(d.action==='RNS_REQUEST'||d.action==='RNS_SEND'){
          e.ports[0].postMessage({result:await window.testRns(d),error:null});return;
        }
        if(d.action==='PUBLISH_QDN_RESOURCE'||d.action==='PUBLISH_MULTIPLE_QDN_RESOURCES'){
          window.handoffAt=Date.now();
          const files=d.resources?d.resources.map(r=>r.file):[d.file];
          for(const file of files){
            if(!TestBridge.isQAppFileReference(file))throw Error('Not a native reference');
            for(let start=0,index=0;start<file.size;start+=5*1024*1024,index++)
              await file.upload({start,end:Math.min(file.size,start+5*1024*1024),index,
                endpoint:${JSON.stringify(coreOrigin + '/arbitrary/FILE/name/id/chunk')},encryption:d.encryption});
          }
          result={size:files.reduce((s,f)=>s+f.size,0),name:files[0].name,type:files[0].type,
            alias:d.file===d.alias};
        }else if(d.action==='SAVE_FILE'){await d.blob.save(d.filename);result=true;}
        else if(d.action==='TEST_INTERNAL')result=await TestBridge.sendMessageBackground('TEST_INTERNAL',d,5000);
        else if(d.action==='SHOW_PDF_READER'){
          const blob=await d.blob.readableBlob();
          const url=URL.createObjectURL(blob);
          window.pdfUrl=url;
          {
            result=await (await fetch(url)).text();
            const range=await (await fetch(url,{headers:{Range:'bytes=1-3'}})).text();
            if(range!=='df ')throw Error('PDF range fetch failed');
            const xhrText=await new Promise((resolve,reject)=>{
              const xhr=new XMLHttpRequest();xhr.open('GET',url);xhr.responseType='arraybuffer';
              xhr.onload=()=>resolve(new TextDecoder().decode(xhr.response));xhr.onerror=reject;xhr.send();
            });
            if(xhrText!==result)throw Error('PDF XHR read failed');
          }
        }
        else if(d.action==='TEST_FAKE')result=TestBridge.isQAppFile(d.file);
        else throw Error('Unknown test action');
        e.ports[0].postMessage({result,error:null});
      });
      setTimeout(()=>{v.send('qapp:ready',e.args[0].documentId);window.readyResolve();},25);
    });
    v.src=${JSON.stringify(origin + '/guest')};document.body.append(v);void 0;
  `);
    await shell.webContents.executeJavaScript('window.ready');
    assert.deepEqual(
      await guest.executeJavaScript(`({
        electronAPI: typeof window.electronAPI,
        require: typeof window.require,
        process: typeof window.process,
        parentIsSelf: window.parent === window,
        openerIsNull: window.opener === null
      })`),
      {
        electronAPI: 'undefined',
        require: 'undefined',
        process: 'undefined',
        parentIsSelf: true,
        openerIsNull: true,
      },
      'Q-App page must not see Hub APIs, Node or its parent window'
    );
    assert.equal(
      await guest.executeJavaScript('window.earlyFileResult'),
      Buffer.from('early file').toString('base64')
    );
    await guest.session.setProxy({ mode: 'direct' });
    await guest.session.cookies.set({
      url: coreOrigin,
      name: 'qapp_secret',
      value: 'must-not-leak',
    });
    await guest.session.cookies.set({
      url: origin,
      name: 'qapp_secret',
      value: 'must-not-leak',
    });
    guest.debugger.attach('1.3');
    const { root: doc } = await guest.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await guest.debugger.sendCommand('DOM.querySelector', {
      nodeId: doc.nodeId,
      selector: '#file',
    });
    await guest.debugger.sendCommand('DOM.setFileInputFiles', {
      nodeId,
      files: [source],
    });
    guest.debugger.detach();
    const installAsk = `window.ask = (data) => new Promise((resolve,reject)=>{
    const c=new MessageChannel();c.port1.onmessage=e=>{c.port1.close();
      e.data.error?reject(Error(JSON.stringify(e.data.error))):resolve(e.data.result);};
    window.postMessage({requestedHandler:'UI',...data},'*',[c.port2]);
  });window.sourceFile=document.querySelector('#file').files[0];void 0;`;
    await guest.executeJavaScript(installAsk);
    const started = Date.now();
    const pss = () => {
      if (process.platform !== 'linux') return null;
      let total = 0;
      for (const metric of app.getAppMetrics()) {
        try {
          total += Number(
            fs
              .readFileSync(`/proc/${metric.pid}/smaps_rollup`, 'utf8')
              .match(/^Pss:\s+(\d+)/m)?.[1] || 0
          );
        } catch {
          /* a process may have exited */
        }
      }
      return total / 1024;
    };
    const baseline = pss();
    const allocated = (directory) => {
      let total = 0;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        try {
          if (entry.isDirectory()) total += allocated(filename);
          else if (entry.isFile()) total += fs.statSync(filename).blocks * 512;
        } catch {
          /* Chromium may replace a cache file during sampling. */
        }
      }
      return total;
    };
    const profileBytes = allocated(app.getPath('userData'));
    let peakProfileBytes = profileBytes;
    let peak = baseline;
    const monitor =
      process.env.QAPP_FILE_PROFILE === '1'
        ? setInterval(() => {
            peak = Math.max(peak, pss());
            peakProfileBytes = Math.max(
              peakProfileBytes,
              allocated(app.getPath('userData'))
            );
          }, 100)
        : null;
    const result = await guest.executeJavaScript(
      `window.ask({action:'PUBLISH_QDN_RESOURCE',file:sourceFile,alias:sourceFile})`
    );
    clearInterval(monitor);
    assert.equal(result.size, mib * 1024 ** 2);
    assert.equal(result.name, 'source.bin');
    assert.equal(result.alias, true);
    assert.equal(uploadHash.digest('hex'), expectedHash);
    console.log(
      JSON.stringify({
        test: 'native-file-multipart',
        mib,
        ms: Date.now() - started,
        handoffMs:
          (await shell.webContents.executeJavaScript('window.handoffAt')) -
          started,
        baselinePssMiB: baseline,
        peakDeltaMiB: monitor ? peak - baseline : null,
        peakProfileGrowthMiB: monitor
          ? (peakProfileBytes - profileBytes) / 1024 ** 2
          : null,
        hashVerified: true,
      })
    );
    uploadHash = crypto.createHash('sha256');
    capture = true;
    await assert.rejects(
      guest.executeJavaScript(
        `window.ask({action:'REDIRECT',file:new Blob(['must not redirect'])})`
      )
    );
    assert.equal(redirectedRequests, 0);
    assert.equal(
      await guest.executeJavaScript(
        `window.ask({action:'TEST_INTERNAL',file:new Blob([])})`
      ),
      ''
    );
    const multi =
      await guest.executeJavaScript(`window.ask({action:'PUBLISH_MULTIPLE_QDN_RESOURCES',resources:[
    {file:new Blob(['first'])},{file:new File(['second'],'second.txt',{type:'text/plain'})}]})`);
    assert.equal(multi.size, 11);
    assert.equal(Buffer.concat(received.splice(0)).toString(), 'firstsecond');
    assert.equal(
      await guest.executeJavaScript(
        `window.ask({action:'TEST_INTERNAL',file:new Blob(['legacy base64'])})`
      ),
      Buffer.from('legacy base64').toString('base64')
    );
    assert.equal(
      await guest.executeJavaScript(
        `window.ask({action:'SHOW_PDF_READER',blob:new Blob(['pdf input'],{type:'application/pdf'})})`
      ),
      'pdf input'
    );
    assert.equal(
      await guest.executeJavaScript(
        `window.ask({action:'TEST_FAKE',file:{size:5,type:'text/plain',file:0}})`
      ),
      false
    );
    const key = crypto.randomBytes(32),
      iv = crypto.randomBytes(16);
    const encryptedSize = 5 * 1024 * 1024 + 31;
    await guest.executeJavaScript(`window.ask({action:'PUBLISH_QDN_RESOURCE',file:new Blob([new Uint8Array(${encryptedSize}).fill(7)]),
    encryption:{key:new Uint8Array(${JSON.stringify([...key])}),iv:new Uint8Array(${JSON.stringify([...iv])})}})`);
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
    assert.deepEqual(
      Buffer.concat(received.splice(0)),
      Buffer.concat([
        cipher.update(Buffer.alloc(encryptedSize, 7)),
        cipher.final(),
      ])
    );
    const saved = path.join(root, 'saved.bin');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
    assert.equal(
      await guest.executeJavaScript(
        `window.ask({action:'SAVE_FILE',filename:'saved.bin',blob:sourceFile})`
      ),
      true
    );
    const savedHash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(saved))
      savedHash.update(chunk);
    assert.equal(savedHash.digest('hex'), expectedHash);
    assert.notEqual(guest.session, shell.webContents.session);
    const ordinary = await guest.executeJavaScript(`(async()=>{
      const result=[];
      for(const action of ['RNS_REQUEST','RNS_SEND'])for(const payload of [
        new Uint8Array([1,2,3]).buffer,new DataView(new Uint8Array([9,1,2,3,9]).buffer,1,3),
        new Uint16Array(new Uint8Array([9,9,1,2,3,4,9,9]).buffer,2,2),new ArrayBuffer(0)]){
        const reply=await ask({action,payload});
        result.push(action==='RNS_REQUEST'?Array.from(reply):reply);
      }
      return result;
    })()`);
    assert.deepEqual(ordinary.slice(0, 4), [
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3, 4],
      [],
    ]);
    assert.deepEqual(
      ordinary.slice(4),
      Array.from({ length: 4 }, () => ({ messageId: 'test-message' }))
    );
    assert.equal(
      await guest.executeJavaScript(
        `ask({action:'UNSERIALIZABLE_REPLY'}).then(()=>false,()=>true)`
      ),
      true
    );
    const concurrent = await guest.executeJavaScript(
      `Promise.all(Array.from({length:12},(_,i)=>ask({action:'TEST_INTERNAL',file:new Blob([String(i)])})))`
    );
    assert.deepEqual(
      concurrent,
      Array.from({ length: 12 }, (_, i) =>
        Buffer.from(String(i)).toString('base64')
      )
    );

    const cancelledDownload = new Promise((resolve) =>
      guest.session.once('will-download', (event, _item, source) => {
        assert.equal(source, guest);
        event.preventDefault();
        resolve();
      })
    );
    await guest.executeJavaScript(
      `location.href=${JSON.stringify(origin + '/attachment')};void 0;`
    );
    await cancelledDownload;
    assert.equal(
      await guest.executeJavaScript(
        `ask({action:'TEST_INTERNAL',file:new Blob(['after download'])})`
      ),
      Buffer.from('after download').toString('base64')
    );

    // Hold a real request before authorizing any file operation.
    await shell.webContents.executeJavaScript(
      'window.holdReady=new Promise(r=>window.heldReady=r);void 0;'
    );
    await guest.executeJavaScript(
      `window.holdResult=ask({action:'HOLD',file:new Blob(['held'])}).then(()=>false,()=>true);void 0;`
    );
    await shell.webContents.executeJavaScript('window.holdReady');
    const held = [...broker.tasks.values()].find(
      (task) => task.guest === guest
    );
    assert.ok(held);
    assert.equal(
      await shell.webContents.executeJavaScript(
        `window.testDeniedSave(${JSON.stringify(held.id)})`
      ),
      true
    );
    const preferences = held.worker.window.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.webviewTag, false);
    assert.equal(held.worker.window.webContents.session, guest.session);
    assert.equal(
      await held.worker.window.webContents.executeJavaScript(
        'typeof window.require'
      ),
      'undefined'
    );
    // A dead executor must reject the outstanding request and be replaceable.
    held.worker.window.destroy();
    assert.equal(await guest.executeJavaScript('window.holdResult'), true);
    assert.equal(
      await shell.webContents.executeJavaScript(
        'heldFile.readableBlob().then(()=>false,()=>true)'
      ),
      true
    );
    assert.equal(broker.budget.size, 0);
    assert.equal(
      await shell.webContents.executeJavaScript(
        `fetch(pdfUrl).then(r=>r.text())`
      ),
      'pdf input'
    );
    await shell.webContents.executeJavaScript(
      'URL.revokeObjectURL(pdfUrl);void 0;'
    );
    assert.equal(
      await guest.executeJavaScript(
        `ask({action:'TEST_INTERNAL',file:new Blob(['after crash'])})`
      ),
      Buffer.from('after crash').toString('base64')
    );

    const stalled = new Promise((resolve) => (slowStarted = resolve));
    const aborted = new Promise((resolve) => (slowAborted = resolve));
    await guest.executeJavaScript(
      `window.slowResult=ask({action:'SLOW',file:new Blob([new Uint8Array(5*1024*1024)])}).then(()=>false,()=>true);void 0;`
    );
    await stalled;
    broker.releaseGuest(guest);
    assert.equal(await guest.executeJavaScript('window.slowResult'), true);
    // Let Node drain its paused parser so it can observe the peer disconnect.
    slowRequest.resume();
    assert.equal(
      await guest.executeJavaScript(
        `ask({action:'TEST_INTERNAL',file:new Blob(['after cancellation'])})`
      ),
      Buffer.from('after cancellation').toString('base64')
    );
    let abortDeadline;
    await Promise.race([
      aborted,
      new Promise(
        (_, reject) =>
          (abortDeadline = setTimeout(
            () => reject(Error('Upload was not aborted')),
            5000
          ))
      ),
    ]);
    clearTimeout(abortDeadline);

    // Cancelling a request must settle main's save handler even while the OS
    // dialog is unresolved, allowing the worker's finally to revoke its URL.
    const originalSave = broker.save;
    const originalDialog = dialog.showSaveDialog;
    let dialogOpened, resolveDialog, saveSettled;
    const opened = new Promise((resolve) => {
      dialogOpened = resolve;
    });
    const settled = new Promise((resolve) => {
      saveSettled = resolve;
    });
    dialog.showSaveDialog = () =>
      new Promise((resolve) => {
        resolveDialog = resolve;
        dialogOpened();
      });
    broker.save = async function (...args) {
      try {
        return await originalSave.apply(this, args);
      } finally {
        saveSettled();
      }
    };
    const cancelledSavePath = path.join(root, 'cancelled-save.bin');
    try {
      await guest.executeJavaScript(
        `window.cancelSaveResult=ask({action:'SAVE_FILE',filename:'cancelled-save.bin',blob:new Blob(['cancelled'])}).then(()=>false,()=>true);void 0;`
      );
      await opened;
      broker.releaseGuest(guest);
      let cancelDeadline;
      try {
        await Promise.race([
          settled,
          new Promise((_, reject) => {
            cancelDeadline = setTimeout(
              () => reject(Error('Cancelled save still awaits its dialog')),
              3000
            );
          }),
        ]);
      } finally {
        clearTimeout(cancelDeadline);
      }
      assert.equal(
        await guest.executeJavaScript('window.cancelSaveResult'),
        true
      );
      assert.equal(broker.budget.size, 0);
      // A late confirmation cannot revive the cancelled request or write a file.
      resolveDialog({ canceled: false, filePath: cancelledSavePath });
      assert.equal(
        await guest.executeJavaScript(
          `ask({action:'TEST_INTERNAL',file:new Blob(['after cancelled dialog'])})`
        ),
        Buffer.from('after cancelled dialog').toString('base64')
      );
      assert.equal(fs.existsSync(cancelledSavePath), false);
    } finally {
      resolveDialog?.({ canceled: true, filePath: '' });
      broker.save = originalSave;
      dialog.showSaveDialog = originalDialog;
    }

    // Simulate losing the host frame halfway through the port handoff.
    const hostFrame = shell.webContents.mainFrame;
    const originalPost = hostFrame.postMessage;
    try {
      hostFrame.postMessage = () => {
        throw Error('Simulated frame teardown');
      };
      await assert.rejects(
        broker.open(
          guest,
          shell.webContents,
          'persist:test-qapp',
          currentDocument,
          999999,
          1,
          1
        ),
        /Simulated frame teardown/
      );
      assert.equal(broker.budget.size, 0);
    } finally {
      hostFrame.postMessage = originalPost;
    }

    // A hung startup must evict its worker, not return it to the idle cache.
    // Accelerate only this synthetic main-process timeout; idle retirement
    // below still exercises the real production 30-second delay.
    const stalledWorker = broker.workers.get(guest.session);
    assert.ok(stalledWorker);
    stalledWorker.ready = new Promise(() => {});
    const originalSetTimeout = global.setTimeout;
    try {
      global.setTimeout = (callback, delay, ...args) =>
        originalSetTimeout(callback, delay === 30_000 ? 10 : delay, ...args);
      await assert.rejects(
        broker.open(
          guest,
          shell.webContents,
          'persist:test-qapp',
          currentDocument,
          999998,
          1,
          1
        ),
        /QAPP_FILE_WORKER_TIMEOUT/
      );
      assert.equal(stalledWorker.window.isDestroyed(), true);
      assert.equal(broker.budget.size, 0);
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    // Committed navigation releases a held reference, unlike a download attempt.
    await shell.webContents.executeJavaScript(
      'window.holdReady=new Promise(r=>window.heldReady=r);void 0;'
    );
    await guest.executeJavaScript(
      `void ask({action:'HOLD',file:new Blob(['old document'])}).catch(()=>{});`
    );
    await shell.webContents.executeJavaScript('window.holdReady');
    const previousDocument = currentDocument;
    const loaded = new Promise((resolve) =>
      guest.once('did-finish-load', resolve)
    );
    guest.reload();
    await loaded;
    await guest.executeJavaScript(installAsk);
    assert.equal(
      await guest.executeJavaScript(
        `ask({action:'TEST_INTERNAL',file:new Blob(['after reload'])})`
      ),
      Buffer.from('after reload').toString('base64')
    );
    assert.notEqual(currentDocument, previousDocument);
    assert.equal(
      await shell.webContents.executeJavaScript(
        'heldFile.readableBlob().then(()=>false,()=>true)'
      ),
      true
    );
    broker.releaseGuest(guest);
    // Exercise the real 30-second idle retirement, not a mocked clock.
    const idleWindows = [...broker.workers.values()].map(
      (worker) => worker.window
    );
    const retired = Promise.all(
      idleWindows.map(
        (window) =>
          new Promise((resolve) => {
            if (window.isDestroyed()) resolve();
            else window.once('closed', resolve);
          })
      )
    );
    let retireDeadline;
    try {
      await Promise.race([
        retired,
        new Promise((_, reject) => {
          retireDeadline = setTimeout(
            () => reject(Error('Idle workers were not retired')),
            35_000
          );
        }),
      ]);
    } finally {
      clearTimeout(retireDeadline);
    }
    assert.equal(broker.workers.size, 0);
    assert.equal(broker.budget.size, 0);
    assert.equal(
      await guest.executeJavaScript(
        `ask({action:'TEST_INTERNAL',file:new Blob(['after idle retirement'])})`
      ),
      Buffer.from('after idle retirement').toString('base64')
    );
    broker.releaseAll();
    assert.equal(broker.workers.size, 0);
    assert.equal(broker.tasks.size, 0);
    assert.equal(broker.budget.size, 0);
    console.log(
      'PASS: native references, multi-publish, encrypted multipart, internal dispatch, PDF, native save, forged references, RNS binary IPC, cookie isolation, sender authorization, dead-worker cleanup/recovery, cancelled download/dialog, failed port handoff, startup timeout, network cancellation, navigation/reload, idle retirement, logout cleanup'
    );
    rns.destroy();
    shell.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
