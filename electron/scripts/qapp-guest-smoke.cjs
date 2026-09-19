const { app, BrowserWindow, ipcMain, session } = require('electron');
const { join } = require('path');
const { pathToFileURL } = require('url');
const http = require('http');
const { restrictQAppGuestWebRtc } = require('../build/src/qapp-guest-network-policy.js');

const preload = join(__dirname, '..', 'build', 'src', 'qapp-guest-preload.js');
const preloadUrl = `${pathToFileURL(preload)}?authorization=smoke`;
const partitionOne = `qapp-smoke-one-${process.pid}`;
const partitionTwo = `qapp-smoke-two-${process.pid}`;

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (process.env.QAPP_HEADER_POLICY_PROBE === '1' && req.url?.endsWith('/two'))
      res.setHeader('Connection-Allowlist', '(response-origin);webrtc=block');
    res.end(req.url?.endsWith('/one')
      ? `<body>QApp<script>
          // Probe before DOM-ready: the guest policy must already be active.
          const earlyPc = new RTCPeerConnection({ iceServers: [] });
          earlyPc.createDataChannel('early-probe');
          let earlyCandidates = 0;
          earlyPc.onicecandidate = (event) => { if (event.candidate) earlyCandidates++; };
          earlyPc.createOffer().then((offer) => earlyPc.setLocalDescription(offer));
          setTimeout(() => {
            document.body.dataset.earlyCandidates = String(earlyCandidates);
            earlyPc.close();
          }, 1000);
        </script><script type="module">
          await new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              document.body.dataset.earlyReply = JSON.stringify(event.data);
              resolve();
            };
            window.parent.postMessage({ requestedHandler: 'UI', action: 'EARLY_REQUEST' }, '*', [channel.port2]);
          });
        </script></body>`
      : req.url?.endsWith('/iframe-probe')
        ? `<script>
            const pc = new RTCPeerConnection({ iceServers: [] });
            const candidates = [];
            pc.onicecandidate = (event) => { if (event.candidate) candidates.push(event.candidate.candidate); };
            pc.createDataChannel('probe');
            pc.createOffer().then((offer) => pc.setLocalDescription(offer));
            setTimeout(() => { parent.postMessage({ iframeCandidateCount: candidates.length }, '*'); pc.close(); }, 1200);
          </script>`
        : '<body>QApp</body>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appOrigin = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true },
  });
  const attachedPartitions = new Map();
  const pendingPartitions = [];
  ipcMain.handle('qappGuest:hello', (event, token) => {
    if (event.sender.getType() !== 'webview' ||
        attachedPartitions.get(event.sender.id) !== token)
      throw new Error('Guest identity mismatch');
    return true;
  });
  let sent = false;
  win.webContents.on('will-attach-webview', (_event, prefs, params) => {
    pendingPartitions.push(params.partition);
    prefs.preload = preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.additionalArguments = [`--qapp-guest-token=${params.partition}`];
  });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    attachedPartitions.set(guest.id, pendingPartitions.shift());
    if (attachedPartitions.get(guest.id) === partitionOne)
      restrictQAppGuestWebRtc(guest);
    guest.on('preload-error', (_event, _path, error) => { throw error; });
    guest.on('dom-ready', async () => {
      if (sent || !guest.getURL().endsWith('/render/APP/one')) return;
      sent = true;
      await guest.executeJavaScript("window.addEventListener('message', event => { if (event.data?.action === 'PERFORMING_NON_MANUAL') document.body.dataset.navigationMarker = String(event.data.requestedHandler); })");
      guest.send('qapp:event', { action: 'MOQ_OBJECT', payload: new Uint8Array([1, 2, 3]) });
      guest.send('qapp:event', { action: 'PERFORMING_NON_MANUAL', currentIndex: 0 });
      guest.executeJavaScript(`(() => { const channel = new MessageChannel(); channel.port1.onmessage = e => { document.body.dataset.reply = JSON.stringify(e.data); }; window.parent.postMessage({requestedHandler:'UI',action:'WHICH_UI'},'*',[channel.port2]); })()`);
      guest.executeJavaScript("window.parent.postMessage({action:'NAVIGATION_SUCCESS',path:'/previous'},'*')");
    });
  });
  const hostHtml = `<webview id="guest" style="display:flex;width:400px;height:300px" partition="${partitionOne}" preload="${preloadUrl}"></webview>
    <webview id="guest2" style="display:flex;width:400px;height:300px" partition="${partitionTwo}" preload="${preloadUrl}"></webview>
    <script>document.getElementById('guest').addEventListener('ipc-message', e => {
      if (e.channel === 'qapp:hello') {
        document.getElementById('guest').send('qapp:ready', e.args[0].documentId);
        return;
      }
      document.body.dataset.count = String(Number(document.body.dataset.count || 0) + 1);
      if (e.channel === 'qapp:request' && e.args[0].data?.action === 'NAVIGATION_SUCCESS')
        document.body.dataset.navigationSuccess = e.args[0].data.path;
      if(e.channel==='qapp:request') document.getElementById('guest').send('qapp:response', {documentId:e.args[0].documentId,requestId:e.args[0].requestId,result:{result:'success',error:null}});
    }); document.getElementById('guest').setAttribute('src','${appOrigin}/render/APP/one');
    document.getElementById('guest2').setAttribute('src','${appOrigin}/render/APP/two');</script>`;
  await win.loadURL(`data:text/html,${encodeURIComponent(hostHtml)}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const webview = win.webContents;
  const state = await webview.executeJavaScript(`(() => { const guest = document.getElementById('guest'); return {id:guest?.getWebContentsId?.(),id2:document.getElementById('guest2')?.getWebContentsId?.(),hostHeight:guest?.getBoundingClientRect().height,requestCount:document.body.dataset.count,navigationSuccess:document.body.dataset.navigationSuccess}; })()`);
  const guest = require('electron').webContents.fromId(state.id);
  state.guestHeight = await guest.executeJavaScript('window.innerHeight');
  state.guestReply = await guest.executeJavaScript('document.body.dataset.reply');
  state.earlyReply = await guest.executeJavaScript('document.body.dataset.earlyReply');
  state.navigationMarker = await guest.executeJavaScript('document.body.dataset.navigationMarker');
  state.earlyCandidates = await guest.executeJavaScript('document.body.dataset.earlyCandidates');
  const guest2 = require('electron').webContents.fromId(state.id2);
  await guest.executeJavaScript("localStorage.setItem('qapp-secret','one-only')");
  state.isolation = await guest2.executeJavaScript("({sameOrigin:location.origin, otherSecret:localStorage.getItem('qapp-secret'), topIsSelf:top===window, frameCount:top.frames.length, opener:window.opener, innerHeight:window.innerHeight})");
  const gather = `new Promise(async resolve => { const pc = new RTCPeerConnection({iceServers:[]}); const candidates=[]; pc.onicecandidate=e => { if(e.candidate) candidates.push(e.candidate.candidate) }; pc.createDataChannel('probe'); await pc.setLocalDescription(await pc.createOffer()); setTimeout(() => { pc.close(); resolve(candidates); }, 1200); })`;
  const [blockedCandidates, controlCandidates] = await Promise.all([
    guest.executeJavaScript(gather), guest2.executeJavaScript(gather),
  ]);
  if (guest.getWebRTCIPHandlingPolicy() !== 'disable_non_proxied_udp' ||
      state.earlyCandidates !== '0' ||
      blockedCandidates.length !== 0 || controlCandidates.length === 0)
    throw new Error('Q-App guest WebRTC direct-network restriction failed');
  process.stdout.write(
    `WebRTC direct-candidate test: qapp early=${state.earlyCandidates}, ` +
    `qapp=${blockedCandidates.length}, unrestricted-control=${controlCandidates.length}\n`
  );
  if (process.env.QAPP_HEADER_POLICY_PROBE === '1') {
    const controlHeader = await guest2.executeJavaScript(
      "fetch(location.href).then((response) => response.headers.get('connection-allowlist'))"
    );
    process.stdout.write(
      `Header-only probe: header=${controlHeader}, direct-candidates=${controlCandidates.length}\n`
    );
    if (controlHeader !== '(response-origin);webrtc=block' || controlCandidates.length === 0)
      throw new Error('Connection-Allowlist header probe did not run');
  }
  const iframeProbeWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const iframeProbeUrl = `${appOrigin}/render/APP/iframe-probe`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame' || details.url !== iframeProbeUrl)
      return callback({ responseHeaders: details.responseHeaders });
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Connection-Allowlist': ['(response-origin);webrtc=block'],
      },
    });
  });
  await iframeProbeWindow.loadURL(`data:text/html,${encodeURIComponent(`
    <script>
      addEventListener('message', (event) => document.body.dataset.candidates = String(event.data?.iframeCandidateCount));
    </script><iframe src="${iframeProbeUrl}"></iframe>
  `)}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const oldIframeCandidates = await iframeProbeWindow.webContents.executeJavaScript(
    'document.body.dataset.candidates'
  );
  iframeProbeWindow.destroy();
  process.stdout.write(`Old iframe header-path test: direct-candidates=${oldIframeCandidates}\n`);
  if (Number(oldIframeCandidates) === 0)
    throw new Error('Old iframe WebRTC header unexpectedly blocked direct candidates');
  if (state.requestCount !== '3' ||
      state.navigationSuccess !== '/previous' ||
      state.navigationMarker !== 'undefined' ||
      state.guestHeight !== state.hostHeight ||
      state.isolation.innerHeight !== state.hostHeight ||
      JSON.parse(state.guestReply).result !== 'success' ||
      JSON.parse(state.earlyReply).result !== 'success' ||
      state.isolation.otherSecret !== null ||
      state.isolation.topIsSelf !== true ||
      state.isolation.frameCount !== 0 ||
      state.isolation.opener !== null) {
    throw new Error('Q-App guest bridge or isolation smoke test failed');
  }
  const nested = await webview.executeJavaScript(`(() => {
    const wrapper = document.createElement('iframe');
    document.body.appendChild(wrapper);
    const guest = wrapper.contentDocument.createElement('webview');
    guest.setAttribute('partition', '${partitionOne}');
    guest.setAttribute('preload', '${preloadUrl}');
    guest.setAttribute('src', 'data:text/html,%3Cbody%3ENested%3C/body%3E');
    guest.style.cssText = 'width:100px;height:100px';
    wrapper.contentDocument.body.appendChild(guest);
    return Boolean(guest);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const viewCount = require('electron').webContents.getAllWebContents().filter(w=>w.getType()==='webview').length;
  if (viewCount !== 2) throw new Error('A nested guest unexpectedly attached');
  process.stdout.write('Q-App guest isolation, early request, layout, and direct WebRTC policy smoke test passed\n');
  win.destroy();
  server.close();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
setTimeout(() => app.exit(1), 8000).unref();
