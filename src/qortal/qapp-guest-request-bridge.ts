import {
  QAppBinaryReceiver,
  type QAppRequest,
} from '../../electron/src/qapp-request-transport';

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
  const binary = new QAppBinaryReceiver(
    documentId,
    (ack) => {
      void send('qapp:binary-ack', ack).then((sent) => {
        if (!sent) dispose();
      });
    },
    dispatch
  );
  const receive = (event: any) => {
    if (!active || event.target !== view) return;
    const request = event.args?.[0];
    if (event.channel === 'qapp:hello' && request?.documentId !== documentId) {
      dispose();
      return;
    }
    if (event.channel === 'qapp:binary') {
      binary.receive(request);
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
    binary.dispose();
    view.removeEventListener('ipc-message', receive);
    view.removeEventListener('did-frame-navigate', navigating);
    view.removeEventListener('render-process-gone', dispose);
    view.removeEventListener('destroyed', dispose);
  }
  view.addEventListener('ipc-message', receive);
  view.addEventListener('did-frame-navigate', navigating);
  view.addEventListener('render-process-gone', dispose);
  view.addEventListener('destroyed', dispose);
  return dispose;
}
