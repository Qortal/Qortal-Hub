import { describe, expect, it, vi } from 'vitest';
import { attachQAppRequestBridge } from './qapp-guest-request-bridge';

class Guest extends EventTarget {
  isConnected = true;
  getWebContentsId = () => 42;
  send = vi.fn();
  emit(type: string, values: any) {
    const event = new Event(type);
    Object.assign(event, values);
    this.dispatchEvent(event);
  }
  request(documentId = 'current', requestId = 1) {
    this.emit('ipc-message', {
      channel: 'qapp:request',
      args: [{ documentId, requestId, data: { action: 'WHICH_UI' } }],
    });
  }
}

describe('guest request lifecycle', () => {
  it('accepts only this document and discards replies after navigation', async () => {
    const view = new Guest();
    let reply: (data: any) => void;
    const listener = vi.fn(async (event) => {
      reply = event.ports[0].postMessage;
    });
    const dispose = attachQAppRequestBridge(view, 'current', listener);
    view.request('previous');
    view.request('current', -1);
    expect(listener).not.toHaveBeenCalled();
    view.request();
    expect(listener).toHaveBeenCalledTimes(1);
    view.emit('did-start-navigation', { isMainFrame: true, isInPlace: true });
    view.emit('did-frame-navigate', { isMainFrame: false });
    reply({ result: 'ok' });
    expect(view.send).toHaveBeenCalledWith('qapp:response', {
      documentId: 'current',
      requestId: 1,
      result: { result: 'ok' },
    });
    view.send.mockClear();
    view.emit('did-frame-navigate', { isMainFrame: true });
    reply({ result: 'stale' });
    view.request();
    expect(view.send).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
  });

  it.each(['render-process-gone', 'destroyed', 'cleanup', 'new-document'])(
    'discards partial transfers and late replies on %s',
    (reason) => {
      const view = new Guest();
      const listener = vi.fn(async () => undefined);
      const dispose = attachQAppRequestBridge(view, 'current', listener);
      const port = {
        postMessage: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
      } as any;
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            type: 'qappFiles:control',
            guestId: 42,
            documentId: 'current',
            requestId: 1,
          },
          ports: [port],
        })
      );
      expect(view.send).not.toHaveBeenCalled();
      if (reason === 'cleanup') dispose();
      else if (reason === 'new-document')
        view.emit('ipc-message', {
          channel: 'qapp:hello',
          args: [{ documentId: 'next' }],
        });
      else view.emit(reason, {});
      expect(port.postMessage).toHaveBeenCalledWith({
        kind: 'release',
        completed: false,
      });
      expect(port.close).toHaveBeenCalledOnce();
      view.request();
      expect(listener).not.toHaveBeenCalled();
      expect(view.send).not.toHaveBeenCalled();
      dispose();
    }
  );

  it('returns a bridge error when a request listener rejects', async () => {
    const view = new Guest();
    const dispose = attachQAppRequestBridge(view, 'current', async () => {
      throw new Error('test');
    });
    view.request();
    await Promise.resolve();
    expect(view.send).toHaveBeenCalledWith(
      'qapp:response',
      expect.objectContaining({
        result: { result: null, error: 'QAPP_BRIDGE_ERROR' },
      })
    );
    dispose();
  });
  it('keeps serving the current document when a navigation is cancelled', () => {
    const view = new Guest();
    const listener = vi.fn(async () => undefined);
    const dispose = attachQAppRequestBridge(view, 'current', listener);
    view.emit('did-start-navigation', { isMainFrame: true, isInPlace: false });
    view.emit('did-fail-load', { isMainFrame: true, errorCode: -3 });
    view.request();
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
  });

  it.each(['throw', 'reject'])(
    'handles a response send %s without disabling later requests',
    async (failure) => {
      const view = new Guest();
      view.send.mockImplementationOnce(() => {
        if (failure === 'reject')
          return Promise.reject(new Error('could not be cloned'));
        throw new Error('could not be cloned');
      });
      const listener = vi.fn(async (event) =>
        event.ports[0].postMessage({ result: () => undefined })
      );
      const dispose = attachQAppRequestBridge(view, 'current', listener);
      view.request();
      await vi.waitFor(() =>
        expect(view.send).toHaveBeenLastCalledWith('qapp:response', {
          documentId: 'current',
          requestId: 1,
          result: { result: null, error: 'QAPP_BRIDGE_ERROR' },
        })
      );
      view.request('current', 2);
      expect(listener).toHaveBeenCalledTimes(2);
      dispose();
    }
  );
});
