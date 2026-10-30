import { ipcRenderer } from 'electron';
import { prepareQAppRequest, type QAppRequest } from './qapp-request-transport';

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
const fileRequests = new Map<number, QAppRequest>();
const fileQueue: {
  request: QAppRequest;
  bytes: number;
  files: number;
  expires: number;
}[] = [];
const activeFiles = new Map<
  number,
  { expires: number; retry?: ReturnType<typeof setTimeout> }
>();

function finishFileRequest(requestId: number) {
  clearTimeout(activeFiles.get(requestId)?.retry);
  activeFiles.delete(requestId);
  fileRequests.delete(requestId);
  pumpFiles();
}
function pumpFiles() {
  while (ready && activeFiles.size < 4 && fileQueue.length) {
    const { request, bytes, files, expires } = fileQueue.shift();
    if (Date.now() >= expires) {
      failRequest(request.requestId);
      continue;
    }
    fileRequests.set(request.requestId, request);
    activeFiles.set(request.requestId, { expires });
    void openFiles(request.requestId, bytes, files);
  }
}
async function openFiles(requestId: number, bytes: number, files: number) {
  const state = activeFiles.get(requestId);
  if (!ready || !state) return;
  if (Date.now() >= state.expires) {
    failRequest(requestId);
    return;
  }
  try {
    const result = await ipcRenderer.invoke(
      'qappFiles:open',
      documentId,
      requestId,
      bytes,
      files
    );
    if (activeFiles.get(requestId) !== state) return;
    // Backpressure stays in the originating guest. In particular a burst of
    // parallel qortalRequests must not fail just because four are already live.
    if (result?.busy)
      state.retry = setTimeout(
        () => void openFiles(requestId, bytes, files),
        1000
      );
  } catch {
    if (activeFiles.get(requestId) === state) failRequest(requestId);
  }
}
ipcRenderer.on('qappFiles:input', (event, metadata) => {
  const port = event.ports[0];
  if (metadata?.documentId !== documentId || !ready || !port) {
    for (const entry of event.ports) entry.close();
    return;
  }
  const request = fileRequests.get(metadata.requestId);
  fileRequests.delete(metadata.requestId);
  if (!request) {
    for (const entry of event.ports) entry.close();
    return;
  }
  try {
    port.postMessage(request.data);
  } catch {
    failRequest(request.requestId);
  } finally {
    port.close();
  }
});

const failRequest = (requestId: number) => {
  const entry = pending.get(requestId);
  pending.delete(requestId);
  entry?.port.postMessage({ result: null, error: 'QAPP_BRIDGE_ERROR' });
  entry?.port.close();
  finishFileRequest(requestId);
};
ipcRenderer.on('qappFiles:failed', (_event, metadata) => {
  if (metadata?.documentId === documentId) failRequest(metadata.requestId);
});
const sendRequest = (request: QAppRequest) => {
  try {
    const prepared = prepareQAppRequest(request.data);
    if (!prepared.files.length) {
      ipcRenderer.sendToHost('qapp:request', request);
      return;
    }
    if (fileQueue.length >= MAX_QUEUED_REQUESTS) {
      failRequest(request.requestId);
      return;
    }
    fileQueue.push({
      request,
      bytes: prepared.files.reduce((sum, file) => sum + file.size, 0),
      files: prepared.files.length,
      expires: Date.now() + REPLY_TTL_MS,
    });
    pumpFiles();
  } catch {
    failRequest(request.requestId);
  }
};
window.addEventListener('pagehide', () => {
  ready = false;
  queued.length = 0;
  fileRequests.clear();
  fileQueue.length = 0;
  for (const state of activeFiles.values()) clearTimeout(state.retry);
  activeFiles.clear();
  for (const entry of pending.values()) entry.port.close();
  pending.clear();
});

window.addEventListener('message', (event: MessageEvent) => {
  if (injectedEvents.has(event)) return;
  if (
    event.source !== window ||
    (event.data?.requestedHandler !== 'UI' &&
      event.data?.action !== 'NAVIGATION_SUCCESS')
  )
    return;
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
    if (ready) sendRequest(request);
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
  for (const request of queued.splice(0)) sendRequest(request);
});

// Main binds this guest to its prepared owner using a token passed only to the
// isolated preload. The shell releases requests as soon as that succeeds.
const guestToken = process.argv
  ?.find((arg) => arg.startsWith('--qapp-guest-token='))
  ?.slice('--qapp-guest-token='.length);
const announceGuest = async () => {
  if (!guestToken) {
    ipcRenderer.sendToHost('qapp:error');
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await ipcRenderer.invoke('qappGuest:hello', guestToken, documentId);
      ipcRenderer.sendToHost('qapp:hello', { documentId });
      return;
    } catch {
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  ipcRenderer.sendToHost('qapp:error');
};
void announceGuest();
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  void announceGuest();
});

ipcRenderer.on('qapp:response', (_event, response) => {
  if (response?.documentId !== documentId) return;
  finishFileRequest(response.requestId);
  const entry = pending.get(response.requestId);
  if (!entry) return;
  pending.delete(response.requestId);
  entry.port.postMessage(response.result);
  entry.port.close();
});

ipcRenderer.on('qapp:event', (_event, data) => {
  const forwardedData =
    data?.action === 'PERFORMING_NON_MANUAL'
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
