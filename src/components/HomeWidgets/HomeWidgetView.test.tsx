import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Activity } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));

import { qappGuestUrlAllowed } from '../../../electron/src/qapp-guest-policy';
import { HomeWidgetView, widgetGuestOwner } from './HomeWidgetView';
import type { SavedHomeWidget } from './homeWidgets';
import { WIDGET_REQUEST_NOT_ALLOWED } from './widgetRequests';

const DOCUMENT_ID = 'a'.repeat(32);

const weather: SavedHomeWidget = {
  name: 'Q-Weather',
  identifier: 'go-widget-now',
  title: 'Weather Now',
  x: 0,
  y: 0,
  w: 4,
  h: 5,
  sizedBy: 'default',
};

const stubGuestApi = () => {
  const prepare = vi.fn().mockImplementation((owner, url) =>
    qappGuestUrlAllowed(url, url, owner, false)
      ? Promise.resolve({
          partition: 'persist:qapp-test',
          preload: 'file:///test/qapp-guest-preload.js?authorization=x',
        })
      : Promise.reject(new Error('QAPP_INVALID_URL'))
  );
  const release = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('electronAPI', {
    qappGuestPrepare: prepare,
    qappGuestRelease: release,
  });
  return { prepare, release };
};

const renderView = (
  props: Partial<Parameters<typeof HomeWidgetView>[0]> = {}
) => {
  const onAskSize = vi.fn();
  const utils = render(
    <HomeWidgetView
      baseUrl="http://127.0.0.1:12391"
      columns={15}
      heightPx={248}
      interactive
      isOnScreen={() => true}
      loadDelayMs={0}
      onAskSize={onAskSize}
      reloadKey={0}
      visible
      widget={weather}
      widthPx={386}
      {...props}
    />
  );
  return { ...utils, onAskSize };
};

/** The webview, once prepared, with a fake send() to read what it is told. */
const guestView = async (container: HTMLElement) => {
  await waitFor(() =>
    expect(container.querySelector('webview')?.getAttribute('src')).toBeTruthy()
  );
  const view = container.querySelector('webview')! as HTMLElement & {
    send: ReturnType<typeof vi.fn>;
  };
  Object.assign(view, { send: vi.fn().mockResolvedValue(undefined) });
  return view;
};

const hello = (view: HTMLElement) =>
  act(() => {
    view.dispatchEvent(
      Object.assign(new Event('ipc-message'), {
        channel: 'qapp:hello',
        args: [{ documentId: DOCUMENT_ID }],
      })
    );
  });

const domReady = (view: HTMLElement) =>
  act(() => {
    view.dispatchEvent(new Event('dom-ready'));
  });

const ask = async (view: HTMLElement, requestId: number, data: object) => {
  await act(async () => {
    view.dispatchEvent(
      Object.assign(new Event('ipc-message'), {
        channel: 'qapp:request',
        args: [
          {
            documentId: DOCUMENT_ID,
            requestId,
            data: { requestedHandler: 'UI', ...data },
          },
        ],
      })
    );
  });
};

const events = (view: { send: ReturnType<typeof vi.fn> }) =>
  view.send.mock.calls
    .filter(([channel]) => channel === 'qapp:event')
    .map(([, message]) => message);

afterEach(async () => {
  cleanup();
  // An unmounted view releases its guest a tick later: let that land on this
  // test's stub, not the next one's.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe('HomeWidgetView', () => {
  it('prepares an isolated guest for the widget with a Core render address', async () => {
    const { prepare } = stubGuestApi();
    const { container } = renderView();
    const view = await guestView(container);
    const [owner, url, isDevMode] = prepare.mock.calls[0];
    expect(owner).toEqual(widgetGuestOwner(weather));
    expect(owner.tabId).not.toBe('Q-Weather');
    expect(isDevMode).toBe(false);
    expect(url).toBe(
      'http://127.0.0.1:12391/render/APP/Q-Weather?theme=dark&lang=en&identifier=go-widget-now&goWidget=1'
    );
    expect(view.getAttribute('src')).toBe(url);
    expect(view.getAttribute('partition')).toBe('persist:qapp-test');
  });

  it('releases the guest after its hello and tells it theme, language and visibility', async () => {
    stubGuestApi();
    const { container } = renderView();
    const view = await guestView(container);
    hello(view);
    expect(view.send).toHaveBeenCalledWith('qapp:ready', DOCUMENT_ID);
    expect(events(view)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'THEME_CHANGED', theme: 'dark' }),
        expect.objectContaining({ action: 'LANGUAGE_CHANGED', language: 'en' }),
        expect.objectContaining({
          action: 'GO_WIDGET_VISIBILITY',
          payload: { visible: true },
        }),
      ])
    );
  });

  it('tells the page theme, language and visibility again once it has loaded', async () => {
    stubGuestApi();
    const { container } = renderView();
    const view = await guestView(container);
    hello(view);
    view.send.mockClear();
    domReady(view);
    expect(events(view)).toEqual([
      expect.objectContaining({ action: 'THEME_CHANGED', theme: 'dark' }),
      expect.objectContaining({ action: 'LANGUAGE_CHANGED', language: 'en' }),
      expect.objectContaining({
        action: 'GO_WIDGET_VISIBILITY',
        payload: { visible: true },
      }),
    ]);
    expect(view.send).not.toHaveBeenCalledWith('qapp:ready', DOCUMENT_ID);
  });

  it('tells a page nothing on load before its document said hello', async () => {
    stubGuestApi();
    const { container } = renderView();
    const view = await guestView(container);
    domReady(view);
    expect(view.send).not.toHaveBeenCalled();
  });

  it('refuses what widgets may not do and answers GO_WIDGET_SET_SIZE', async () => {
    stubGuestApi();
    const { container, onAskSize } = renderView();
    const view = await guestView(container);
    hello(view);
    await ask(view, 1, { action: 'SEND_COIN', amount: 1 });
    await waitFor(() =>
      expect(view.send).toHaveBeenCalledWith('qapp:response', {
        documentId: DOCUMENT_ID,
        requestId: 1,
        result: {
          result: null,
          error: expect.objectContaining({ code: WIDGET_REQUEST_NOT_ALLOWED }),
        },
      })
    );
    await ask(view, 2, {
      action: 'GO_WIDGET_SET_SIZE',
      width: 'half',
      height: 140,
    });
    await waitFor(() =>
      expect(view.send).toHaveBeenCalledWith('qapp:response', {
        documentId: DOCUMENT_ID,
        requestId: 2,
        result: { result: { applied: true }, error: null },
      })
    );
    expect(onAskSize).toHaveBeenCalledWith('Q-Weather\u0000go-widget-now', {
      w: 2,
      h: 3,
    });
  });

  it('keeps the user’s size when the widget asks for another', async () => {
    stubGuestApi();
    const { container, onAskSize } = renderView({
      widget: { ...weather, sizedBy: 'user' },
    });
    const view = await guestView(container);
    hello(view);
    await ask(view, 1, { action: 'GO_WIDGET_SET_SIZE', height: 500 });
    await waitFor(() =>
      expect(view.send).toHaveBeenCalledWith('qapp:response', {
        documentId: DOCUMENT_ID,
        requestId: 1,
        result: { result: { applied: false }, error: null },
      })
    );
    expect(onAskSize).not.toHaveBeenCalled();
  });

  it('tells the widget when it goes out of sight', async () => {
    stubGuestApi();
    const { container, rerender } = renderView();
    const view = await guestView(container);
    hello(view);
    view.send.mockClear();
    rerender(
      <HomeWidgetView
        baseUrl="http://127.0.0.1:12391"
        columns={15}
        heightPx={248}
        interactive
        isOnScreen={() => true}
        loadDelayMs={0}
        onAskSize={vi.fn()}
        reloadKey={0}
        visible={false}
        widget={weather}
        widthPx={386}
      />
    );
    expect(events(view)).toEqual([
      expect.objectContaining({
        action: 'GO_WIDGET_VISIBILITY',
        payload: { visible: false },
      }),
    ]);
  });

  it('stays loaded while Home’s Activity hides it, and is told so', async () => {
    const { release } = stubGuestApi();
    const view = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <HomeWidgetView
          baseUrl="http://127.0.0.1:12391"
          columns={15}
          heightPx={248}
          interactive
          isOnScreen={() => true}
          loadDelayMs={0}
          onAskSize={vi.fn()}
          reloadKey={0}
          visible
          widget={weather}
          widthPx={386}
        />
      </Activity>
    );
    const { container, rerender } = render(view('visible'));
    const webview = await guestView(container);
    hello(webview);
    webview.send.mockClear();
    rerender(view('hidden'));
    expect(events(webview)).toEqual([
      expect.objectContaining({
        action: 'GO_WIDGET_VISIBILITY',
        payload: { visible: false },
      }),
    ]);
    webview.send.mockClear();
    rerender(view('visible'));
    await waitFor(() =>
      expect(events(webview)).toContainEqual(
        expect.objectContaining({
          action: 'GO_WIDGET_VISIBILITY',
          payload: { visible: true },
        })
      )
    );
    // The same guest all along: not reloaded, not released.
    expect(container.querySelector('webview')).toBe(webview);
    expect(webview.send).not.toHaveBeenCalledWith('qapp:ready', DOCUMENT_ID);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(release).not.toHaveBeenCalled();
  });

  it('tells a widget that reloads while Home is hidden that it is not visible', async () => {
    stubGuestApi();
    const view = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <HomeWidgetView
          baseUrl="http://127.0.0.1:12391"
          columns={15}
          heightPx={248}
          interactive
          isOnScreen={() => true}
          loadDelayMs={0}
          onAskSize={vi.fn()}
          reloadKey={0}
          visible
          widget={weather}
          widthPx={386}
        />
      </Activity>
    );
    const { container, rerender } = render(view('visible'));
    const webview = await guestView(container);
    hello(webview);
    rerender(view('hidden'));
    webview.send.mockClear();
    // The widget reloads itself: a new document says hello, then loads.
    act(() => {
      webview.dispatchEvent(
        Object.assign(new Event('ipc-message'), {
          channel: 'qapp:hello',
          args: [{ documentId: 'b'.repeat(32) }],
        })
      );
    });
    domReady(webview);
    const visibility = events(webview).filter(
      (message) => message.action === 'GO_WIDGET_VISIBILITY'
    );
    expect(visibility).toHaveLength(2);
    for (const message of visibility) {
      expect(message.payload).toEqual({ visible: false });
    }
  });

  it('offers a retry when the guest fails, with the same address', async () => {
    const { prepare } = stubGuestApi();
    const { container } = renderView();
    const view = await guestView(container);
    const src = view.getAttribute('src');
    act(() => {
      view.dispatchEvent(
        Object.assign(new Event('ipc-message'), { channel: 'qapp:error' })
      );
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'core:retry' }));
    const replacement = await guestView(container);
    expect(replacement).not.toBe(view);
    expect(replacement.getAttribute('src')).toBe(src);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('releases the guest when the widget is removed', async () => {
    const { release } = stubGuestApi();
    const { container, unmount } = renderView();
    await guestView(container);
    unmount();
    await waitFor(() =>
      expect(release).toHaveBeenCalledWith(widgetGuestOwner(weather))
    );
  });

  it('shows a retry instead of a frame where guests are not available', async () => {
    vi.stubGlobal('electronAPI', {});
    renderView();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
