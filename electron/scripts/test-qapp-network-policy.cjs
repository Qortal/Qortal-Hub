// Real Chromium regression: unit tests cannot detect a TURN TCP privacy leak.
// Uses loopback listeners, fake capture devices, and isolated temporary storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const {
  withEmbeddedFrameWebRtcBlocked,
} = require('../build/src/embedded-frame-network-policy.js');
const {
  restrictQAppGuestWebRtc,
} = require('../build/src/qapp-guest-network-policy.js');

const storage = fs.mkdtempSync(
  path.join(os.tmpdir(), 'hub-qapp-network-test-')
);
app.setPath('userData', storage);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

const sockets = new Set();
let connections = 0;
let window;
const turn = net.createServer((socket) => {
  connections++;
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
});
const web = http.createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html',
    // An app server must not be able to opt back into WebRTC.
    'Connection-Allowlist': '("*://*:*/*");webrtc=allow',
  });
  response.end('<!doctype html><title>QApp network regression</title>');
});
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error('QApp network policy test timed out');
  app.exit(1);
}, 30_000);

async function checkGuest(scope) {
  const partition = `network-test-${scope}`;
  const guestSession = session.fromPartition(partition);
  const documentTypes = [];
  guestSession.webRequest.onHeadersReceived((details, callback) => {
    documentTypes.push(details.resourceType);
    callback({
      responseHeaders: withEmbeddedFrameWebRtcBlocked(
        details.responseHeaders,
        details,
        scope
      ),
    });
  });
  let guest;
  const loaded = new Promise((resolve, reject) => {
    window.webContents.once('did-attach-webview', (_event, contents) => {
      guest = contents;
      restrictQAppGuestWebRtc(guest);
      guest.once('did-finish-load', resolve);
      guest.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`Guest load failed: ${code} ${description}`))
      );
    });
  });
  await window.webContents.executeJavaScript(`(() => {
    const view = document.createElement('webview');
    view.setAttribute('partition', ${JSON.stringify(partition)});
    view.setAttribute('src', 'http://127.0.0.1:${web.address().port}');
    document.body.appendChild(view);
  })()`);
  await loaded;
  assert.ok(documentTypes.includes('mainFrame'));
  assert.equal(guest.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp');

  const before = connections;
  const result = await guest.executeJavaScript(`(async () => {
    const response = await fetch('/ordinary-http');
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    const audioTracks = stream.getAudioTracks().length;
    stream.getTracks().forEach(track => track.stop());
    window.peer = new RTCPeerConnection({
      iceServers: [{
        urls: 'turn:127.0.0.1:${turn.address().port}?transport=tcp',
        username: 'local-test', credential: 'local-test'
      }],
      iceTransportPolicy: 'relay'
    });
    peer.createDataChannel('local-test');
    await peer.setLocalDescription(await peer.createOffer());
    return { httpOk: response.ok, audioTracks };
  })()`);
  assert.deepEqual(result, { httpOk: true, audioTracks: 1 });
  await delay(3_500);
  const directConnections = connections - before;
  await guest.executeJavaScript('peer.close()');
  await window.webContents.executeJavaScript(
    'document.querySelector("webview").remove()'
  );
  if (scope === 'hub') {
    // Positive control proves that the listener is reachable and that the
    // previous subframe-only header plus UDP policy really leaks via TCP.
    assert.ok(
      directConnections > 0,
      'TURN TCP positive control did not connect'
    );
  } else {
    assert.equal(
      directConnections,
      0,
      'QApp made a direct TURN TCP connection'
    );
  }
  console.log(`${scope}: ${directConnections} direct TURN TCP connections`);
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    await listen(turn);
    await listen(web);
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        webviewTag: true,
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'network-test-shell',
      },
    });
    await window.loadURL('data:text/html,<html><body></body></html>');
    await checkGuest('hub');
    await checkGuest('qapp-guest');
    console.log(
      `QApp WebRTC privacy regression passed (Electron ${process.versions.electron})`
    );
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    clearTimeout(watchdog);
    if (window) window.destroy();
    for (const socket of sockets) socket.destroy();
    turn.close();
    web.closeAllConnections();
    web.close();
    app.exit(exitCode);
  }
});
process.on('exit', () => fs.rmSync(storage, { recursive: true, force: true }));
