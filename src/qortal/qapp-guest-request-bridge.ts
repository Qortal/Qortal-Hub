import type { QAppRequest } from '../../electron/src/qapp-request-transport';
import { attachQAppFileClient } from './qapp-file-reference';

// Bind all transfers and replies to this particular guest document. Navigation,
// crashes and React effect cleanup release unfinished Blobs and invalidate replies.
export function attachQAppRequestBridge(
  view: any,
  documentId: string,
  listener: (event: {
    data: any;
    ports: { postMessage: (result: any) => void }[];
  }) => Promise<void>
) {
  let active = true;
  const fileRequests = new Map<number, (completed?: boolean) => void>();
  const send = async (channel: string, data: unknown) => {
    if (!active) return false;
    if (!view.isConnected) {
      dispose();
      return false;
    }
    try {
      await view.send(channel, data);
      return true;
    } catch {
      // A handler can return an unsupported IPC value. That should fail just
      // this request, not permanently disconnect an otherwise healthy guest.
      return false;
    }
  };
  const dispatch = (request: QAppRequest) => {
    if (!active) return;
    const postMessage = (result: any) => {
      fileRequests.get(request.requestId)?.(true);
      fileRequests.delete(request.requestId);
      void (async () => {
        const response = { documentId, requestId: request.requestId, result };
        if (await send('qapp:response', response)) return;
        if (
          !(await send('qapp:response', {
            ...response,
            result: { result: null, error: 'QAPP_BRIDGE_ERROR' },
          }))
        )
          dispose();
      })();
    };
    void listener({ data: request.data, ports: [{ postMessage }] }).catch(() =>
      postMessage({ result: null, error: 'QAPP_BRIDGE_ERROR' })
    );
  };
  const receiveFiles = (event: MessageEvent) => {
    const metadata = event.data;
    if (
      !active ||
      event.source !== window ||
      event.origin !== window.location.origin ||
      metadata?.type !== 'qappFiles:control' ||
      metadata.documentId !== documentId ||
      metadata.guestId !== view.getWebContentsId() ||
      !event.ports[0]
    )
      return;
    const requestId = metadata.requestId;
    if (fileRequests.has(requestId)) {
      event.ports[0].close();
      return;
    }
    const release = attachQAppFileClient(
      event.ports[0],
      (data) => dispatch({ documentId, requestId, data }),
      () => {
        fileRequests.delete(requestId);
        void send('qapp:response', {
          documentId,
          requestId,
          result: { result: null, error: 'QAPP_BRIDGE_ERROR' },
        });
      }
    );
    fileRequests.set(requestId, release);
  };
  const receive = (event: any) => {
    if (!active || event.target !== view) return;
    const request = event.args?.[0];
    if (event.channel === 'qapp:hello' && request?.documentId !== documentId) {
      dispose();
      return;
    }
    if (
      event.channel !== 'qapp:request' ||
      request?.documentId !== documentId ||
      !Number.isSafeInteger(request?.requestId) ||
      request.requestId < 1 ||
      !request.data ||
      typeof request.data !== 'object'
    )
      return;
    dispatch(request);
  };
  const navigating = (event: any) => {
    // Starting a navigation does not necessarily replace this document: it
    // can be cancelled or become a download. Invalidate only on a committed
    // cross-document navigation (or a new preload hello).
    if (event.isMainFrame) dispose();
  };
  function dispose() {
    active = false;
    for (const release of fileRequests.values()) release();
    fileRequests.clear();
    window.removeEventListener('message', receiveFiles);
    view.removeEventListener('ipc-message', receive);
    view.removeEventListener('did-frame-navigate', navigating);
    view.removeEventListener('render-process-gone', dispose);
    view.removeEventListener('destroyed', dispose);
  }
  view.addEventListener('ipc-message', receive);
  window.addEventListener('message', receiveFiles);
  view.addEventListener('did-frame-navigate', navigating);
  view.addEventListener('render-process-gone', dispose);
  view.addEventListener('destroyed', dispose);
  return dispose;
}
