import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  externalWebUrl,
  installMainWindowNavigationPolicy,
  isMainWindowUrl,
  requireMainWindowSender,
} from './main-window-policy';

const shell = 'capacitor-electron://-';
describe('main window document boundary', () => {
  it.each(['/', '/index.html', '/apps?name=test#view', '/audio-surface.html'])(
    'preserves packaged routes: %s',
    (route) => {
      expect(isMainWindowUrl(shell + route, shell)).toBe(true);
    }
  );
  it.each([
    'https://evil.invalid/?capacitor-electron',
    'capacitor-electron://evil.invalid/',
    'capacitor-electron://user@-/',
    'capacitor-electron://-:123/',
    'capacitor-electron-audio://-/',
    'file:///tmp/index.html',
    'data:text/html,test',
    'about:blank',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects foreign and opaque documents: %s', (url) => {
    expect(isMainWindowUrl(url, shell)).toBe(false);
  });
  it('accepts the configured scheme without trusting every custom scheme', () => {
    expect(isMainWindowUrl('hub-test://-/index.html', 'hub-test://-')).toBe(
      true
    );
    expect(isMainWindowUrl(shell, 'hub-test://-')).toBe(false);
  });
  it('only opens ordinary web links externally', () => {
    expect(externalWebUrl('https://example.com/test')).toBe(
      'https://example.com/test'
    );
    for (const url of [
      'file:///tmp/a',
      'qortal://app',
      'javascript:alert(1)',
      'https://u:p@example.com',
    ]) {
      expect(externalWebUrl(url)).toBeNull();
    }
  });
  it('checks the registered window, main frame, and current frame URL', () => {
    const mainFrame = { url: shell + '/index.html' };
    const main = { mainFrame, isDestroyed: () => false } as any;
    const event = { sender: main, senderFrame: mainFrame } as any;
    expect(() => requireMainWindowSender(event, main, shell)).not.toThrow();
    expect(() =>
      requireMainWindowSender({ ...event, sender: {} }, main, shell)
    ).toThrow();
    expect(() =>
      requireMainWindowSender(
        { ...event, senderFrame: { url: mainFrame.url } },
        main,
        shell
      )
    ).toThrow();
    expect(() =>
      requireMainWindowSender({ ...event, senderFrame: null }, main, shell)
    ).toThrow();
    mainFrame.url = 'https://evil.invalid/?capacitor-electron';
    expect(() => requireMainWindowSender(event, main, shell)).toThrow();
    expect(() => requireMainWindowSender(event, undefined, shell)).toThrow();
  });
  it('blocks remote navigations and redirects without breaking packaged navigation or subframes', async () => {
    const contents = new EventEmitter() as any;
    contents.setWindowOpenHandler = vi.fn();
    contents.loadURL = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue(undefined);
    installMainWindowNavigationPolicy(contents, shell, open, vi.fn());
    const preventDefault = vi.fn();
    contents.emit('will-navigate', { preventDefault }, shell + '/apps');
    expect(preventDefault).not.toHaveBeenCalled();
    contents.emit('will-navigate', { preventDefault }, 'https://example.com');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/');
    contents.emit(
      'will-redirect',
      { preventDefault },
      'https://evil.invalid',
      false,
      true
    );
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
    contents.emit(
      'will-redirect',
      { preventDefault },
      'https://qapp.invalid',
      false,
      false
    );
    expect(preventDefault).toHaveBeenCalledTimes(2);
    const popup = contents.setWindowOpenHandler.mock.calls[0][0];
    expect(popup({ url: 'https://evil.invalid/?capacitor-electron' })).toEqual({
      action: 'deny',
    });
    expect(popup({ url: shell + '/apps' })).toEqual({ action: 'deny' });
    expect(contents.loadURL).toHaveBeenCalledWith(shell + '/apps');
    expect(popup({ url: 'file:///tmp/a' })).toEqual({ action: 'deny' });
    expect(open).toHaveBeenCalledTimes(2);
  });
});
