import { ipcRenderer } from 'electron';

// This preload runs only in an isolated Q-App guest. No Electron API is exposed
// to the page. Core's q-apps.js posts UI requests to window.parent; in a guest
// page parent === window, so capture the marked request and bridge its reply port.
const documentId = Array.from(
  globalThis.crypto.getRandomValues(new Uint8Array(16))
)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');
let nextRequestId = 0;
const pending = new Map<number, { port: MessagePort; createdAt: number }>();
const MAX_PENDING_REPLIES = 256;
const MAX_QUEUED_REQUESTS = 256;
const REPLY_TTL_MS = 2 * 60 * 60 * 1000;
const queued: Array<{ documentId: string; requestId: number; data: unknown }> =
  [];
const injectedEvents = new WeakSet<MessageEvent>();
let ready = false;

window.addEventListener('message', (event: MessageEvent) => {
  if (injectedEvents.has(event)) return;
  if (event.source !== window ||
      (event.data?.requestedHandler !== 'UI' &&
       event.data?.action !== 'NAVIGATION_SUCCESS')) return;
  const requestId = ++nextRequestId;
  const port = event.ports?.[0];
  if (!ready && queued.length >= MAX_QUEUED_REQUESTS) {
    port?.postMessage({ result: null, error: 'QAPP_BRIDGE_BUSY' });
    port?.close();
    return;
  }
  if (port) {
    const now = Date.now();
    for (const [id, entry] of pending) {
      if (now - entry.createdAt <= REPLY_TTL_MS) continue;
      pending.delete(id);
      entry.port.close();
    }
    if (pending.size >= MAX_PENDING_REPLIES) {
      port.postMessage({ result: null, error: 'QAPP_BRIDGE_BUSY' });
      port.close();
      return;
    }
    pending.set(requestId, { port, createdAt: now });
  }
  try {
    const request = {
      documentId,
      requestId,
      data: event.data,
    };
    if (ready) ipcRenderer.sendToHost('qapp:request', request);
    else queued.push(request);
  } catch {
    pending.delete(requestId);
    port?.postMessage({ result: null, error: 'QAPP_BRIDGE_ERROR' });
    port?.close();
  }
});

ipcRenderer.on('qapp:ready', (_event, acceptedDocumentId: string) => {
  if (acceptedDocumentId !== documentId) return;
  ready = true;
  for (const request of queued.splice(0)) {
    try {
      ipcRenderer.sendToHost('qapp:request', request);
    } catch {
      const entry = pending.get(request.requestId);
      pending.delete(request.requestId);
      entry?.port.postMessage({ result: null, error: 'QAPP_BRIDGE_ERROR' });
      entry?.port.close();
    }
  }
});

// Main binds this guest to its prepared owner using a token passed only to the
// isolated preload. The shell releases requests as soon as that succeeds.
const guestToken = process.argv
  ?.find((arg) => arg.startsWith('--qapp-guest-token='))
  ?.slice('--qapp-guest-token='.length);
void (async () => {
  if (!guestToken) {
    ipcRenderer.sendToHost('qapp:error');
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await ipcRenderer.invoke('qappGuest:hello', guestToken);
      ipcRenderer.sendToHost('qapp:hello', { documentId });
      return;
    } catch {
      if (attempt < 4)
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  ipcRenderer.sendToHost('qapp:error');
})();

ipcRenderer.on('qapp:response', (_event, response) => {
  if (response?.documentId !== documentId) return;
  const entry = pending.get(response.requestId);
  if (!entry) return;
  pending.delete(response.requestId);
  entry.port.postMessage(response.result);
  entry.port.close();
});

ipcRenderer.on('qapp:event', (_event, data) => {
  const forwardedData = data?.action === 'PERFORMING_NON_MANUAL'
    ? data
    : { ...data, requestedHandler: 'UI' };
  const event = new MessageEvent('message', {
    data: forwardedData,
    origin: window.location.origin,
    source: window,
  });
  injectedEvents.add(event);
  window.dispatchEvent(event);
});
