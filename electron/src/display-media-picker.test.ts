import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { desktopCapturer, ipcMain, systemPreferences } from 'electron';
import { installDisplayMediaPicker } from './display-media-picker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(
  platform: NodeJS.Platform = 'linux',
  guest = false,
  authorized = true
) {
  const bus = new EventEmitter();
  vi.spyOn(ipcMain, 'on').mockImplementation(((...args: any[]) =>
    bus.on(args[0], args[1])) as any);
  vi.spyOn(ipcMain, 'removeListener').mockImplementation(((...args: any[]) =>
    bus.removeListener(args[0], args[1])) as any);
  const getSources = vi.spyOn(desktopCapturer, 'getSources').mockResolvedValue([
    {
      id: 'screen:1',
      name: 'Screen',
      thumbnail: { toDataURL: () => 'data:image/png;base64,AA==' },
    },
  ] as any);
  let handler: any;
  const root = {};
  const guestRoot = {};
  const frame = {
    detached: false,
    top: guest ? guestRoot : root,
    url: 'https://app.test',
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
  };
  const webContents = {
    mainFrame: root,
    send: vi.fn(),
    session: {
      setDisplayMediaRequestHandler: (fn: any) => {
        handler = fn;
      },
    },
  };
  const window = { webContents, isDestroyed: () => false, once: vi.fn() };
  const guestContents = {
    mainFrame: guestRoot,
    session: webContents.session,
    getType: () => 'webview',
    isDestroyed: () => false,
    send: vi.fn(),
  };
  installDisplayMediaPicker(
    window as any,
    platform,
    webContents.session as any,
    () => authorized,
    () => guestContents as any
  );
  const callback = vi.fn();
  const request = {
    frame,
    userGesture: true,
    videoRequested: true,
    securityOrigin: 'https://app.test',
  };
  handler(request, callback);
  const requestId = webContents.send.mock.calls[0]?.[1]?.requestId;
  const send = (channel: string, payload: object, trusted = true) =>
    bus.emit(
      channel,
      { sender: trusted ? webContents : {}, senderFrame: root },
      { requestId, ...payload }
    );
  return {
    frame,
    callback,
    send,
    getSources,
    handler,
    request,
    webContents,
    guestContents,
    bus,
  };
}

it('reports missing macOS screen permission before denying capture', async () => {
  vi.spyOn(systemPreferences, 'getMediaAccessStatus').mockReturnValue('denied');
  const f = fixture('darwin');
  f.send('display-media:authorize', { accepted: true });
  await vi.waitFor(() => expect(f.callback).toHaveBeenCalledWith({}));
  expect(f.getSources).not.toHaveBeenCalled();
  expect(f.frame.executeJavaScript.mock.calls[0][0]).toContain(
    'SCREEN_OS_PERMISSION_REQUIRED'
  );
});

it('allows an owned guest capture and denies an unowned guest', async () => {
  const owned = fixture('linux', true);
  owned.send('display-media:authorize', { accepted: true });
  await vi.waitFor(() => expect(owned.guestContents.send).toHaveBeenCalled());
  owned.send('display-media:select', { sourceId: 'screen:1' });
  expect(owned.callback).toHaveBeenCalledWith({
    video: expect.objectContaining({ id: 'screen:1' }),
  });

  const unowned = fixture('linux', true, false);
  expect(unowned.callback).toHaveBeenCalledWith({});
  expect(unowned.webContents.send).not.toHaveBeenCalled();
});

it('does not enumerate before approval and grants only the selected one-use source', async () => {
  const f = fixture();
  expect(f.getSources).not.toHaveBeenCalled();
  f.send('display-media:select', { sourceId: 'screen:1' });
  f.send('display-media:authorize', { accepted: true }, false);
  expect(f.callback).not.toHaveBeenCalled();
  expect(f.getSources).not.toHaveBeenCalled();
  f.send('display-media:authorize', { accepted: true });
  await vi.waitFor(() => expect(f.frame.executeJavaScript).toHaveBeenCalled());
  expect(f.frame.executeJavaScript.mock.calls[0][0]).toContain(
    'QAPP_SCREEN_CAPTURE_SOURCES'
  );
  f.send('display-media:select', { sourceId: 'screen:1', requestId: 'wrong' });
  expect(f.callback).not.toHaveBeenCalled();
  f.send('display-media:select', { sourceId: 'screen:1' });
  expect(f.callback).toHaveBeenCalledWith({
    video: expect.objectContaining({ id: 'screen:1' }),
  });
  f.send('display-media:select', { sourceId: 'screen:1' });
  expect(f.callback).toHaveBeenCalledTimes(1);
  expect(f.bus.listenerCount('display-media:authorize')).toBe(0);
  for (const [script] of f.frame.executeJavaScript.mock.calls)
    expect(script).toContain('"requestedHandler":"UI"');
});

it('denies rejection without disclosing thumbnails', () => {
  const f = fixture();
  f.send('display-media:authorize', { accepted: false });
  expect(f.callback).toHaveBeenCalledWith({});
  expect(f.getSources).not.toHaveBeenCalled();
});

it.each(['navigation', 'detached', 'unknown-source'])(
  'denies %s after approval',
  async (failure) => {
    const f = fixture();
    f.send('display-media:authorize', { accepted: true });
    await vi.waitFor(() =>
      expect(f.frame.executeJavaScript).toHaveBeenCalled()
    );
    if (failure === 'navigation') f.frame.url = 'https://elsewhere.test';
    if (failure === 'detached') f.frame.detached = true;
    f.send('display-media:select', {
      sourceId: failure === 'unknown-source' ? 'window:99' : 'screen:1',
    });
    expect(f.callback).toHaveBeenCalledWith({});
  }
);

it('times out and denies concurrent requests and missing gestures', () => {
  vi.useFakeTimers();
  const f = fixture();
  const second = vi.fn();
  f.handler(f.request, second);
  expect(second).toHaveBeenCalledWith({});
  vi.advanceTimersByTime(60_000);
  expect(f.callback).toHaveBeenCalledWith({});
  const third = vi.fn();
  f.handler({ ...f.request, userGesture: false }, third);
  expect(third).toHaveBeenCalledWith({});
});
