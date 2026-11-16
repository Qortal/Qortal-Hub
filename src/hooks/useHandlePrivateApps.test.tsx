import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance the hook's messages come from.
import '../i18n/i18n';

const NODE = 'http://127.0.0.1:12391';

vi.mock('../App', () => ({ getBaseApiReact: () => 'http://127.0.0.1:12391' }));
// As in src/test/setup.ts, plus the address the hook builds previews at.
vi.mock('../background/background', () => ({
  createEndpoint: async (path: string) => `http://127.0.0.1:12391${path}`,
  performPowTask: vi.fn(async () => ({ success: true, nonce: 0, hash: '00' })),
}));
vi.mock('../components/Apps/AppsNavBarDesktop', () => ({
  saveToLocalStorage: vi.fn(),
}));

import { infoSnackGlobalAtom } from '../atoms/global';
import { useHandlePrivateApps } from './useHandlePrivateApps';

const minter = {
  service: 'DOCUMENT',
  name: 'Minter',
  identifier: 'app-id',
  groupId: 42,
};
const APP_DATA = `${NODE}/arbitrary/DOCUMENT/Minter/app-id?encoding=base64`;
const PREVIEW_BUILD = `${NODE}/arbitrary/APP/Minter/zip?preview=true`;
const PREVIEW_URL = `${NODE}/render/hash/abc?secret=xyz`;

let store: ReturnType<typeof createStore>;
let messages: Record<string, any>[];
let events: { type: string; detail: any }[];
let sendMessage: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

const record = (event: Event) => {
  events.push({ type: event.type, detail: (event as CustomEvent).detail });
};

const renderOpenApp = () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => useHandlePrivateApps(), { wrapper }).result.current
    .openApp;
};

const eventsOf = (type: string) =>
  events.filter((event) => event.type === type).map((event) => event.detail);

describe('useHandlePrivateApps openApp', () => {
  beforeEach(() => {
    store = createStore();
    messages = [];
    store.sub(infoSnackGlobalAtom, () => {
      const message = store.get(infoSnackGlobalAtom);
      if (message) messages.push(message);
    });
    events = [];
    document.addEventListener('addTab', record);
    document.addEventListener('closeGlobalSnackBar', record);

    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === APP_DATA) {
        return { ok: true, status: 200, text: async () => 'ZW5jcnlwdGVk' };
      }
      if (url === PREVIEW_BUILD && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          text: async () => '/render/hash/abc?secret=xyz',
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);
    sendMessage = vi.fn(async () =>
      btoa(JSON.stringify({ app: 'UEsDBA==', name: 'Minter Helper' }))
    );
    (window as any).sendMessage = sendMessage;
  });

  afterEach(() => {
    document.removeEventListener('addTab', record);
    document.removeEventListener('closeGlobalSnackBar', record);
    delete (window as any).sendMessage;
    vi.unstubAllGlobals();
  });

  const openedTab = expect.objectContaining({
    service: 'DOCUMENT',
    name: 'Minter',
    identifier: 'app-id',
    url: PREVIEW_URL,
    isPreview: true,
    isPrivate: true,
    privateAppProperties: { ...minter, appName: 'Minter Helper', logo: null },
  });

  it('opens the app with the addTab event when nothing else is asked', async () => {
    const openApp = renderOpenApp();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await openApp(minter, false, undefined);
    });

    expect(opened).toBe(true);
    expect(eventsOf('addTab')).toEqual([{ data: openedTab }]);
    // Its messages, from fetching to opened, are marked as its own.
    const [first] = messages;
    expect(first.sourceId).toEqual(expect.any(String));
    expect(messages.map((message) => message.sourceId)).toEqual(
      messages.map(() => first.sourceId)
    );
    expect(messages[messages.length - 1]?.type).toBe('success');
  });

  it('gives the tab to openTab instead, when asked', async () => {
    const openApp = renderOpenApp();
    const openTab = vi.fn();
    let opened: boolean | undefined;
    await act(async () => {
      opened = await openApp(minter, false, undefined, {
        isWanted: () => true,
        openTab,
      });
    });

    expect(opened).toBe(true);
    expect(openTab).toHaveBeenCalledWith(openedTab);
    expect(eventsOf('addTab')).toEqual([]);
  });

  it.each([
    ['after the download', 1],
    ['after decrypting', 2],
    ['after the preview is built', 3],
  ])(
    'stops quietly once the app is no longer wanted, %s',
    async (_when, wantedChecks) => {
      const openApp = renderOpenApp();
      const openTab = vi.fn();
      let checks = 0;
      let opened: boolean | undefined;
      await act(async () => {
        opened = await openApp(minter, false, undefined, {
          isWanted: () => {
            checks += 1;
            return checks < wantedChecks;
          },
          openTab,
        });
      });

      expect(opened).toBe(false);
      expect(openTab).not.toHaveBeenCalled();
      expect(eventsOf('addTab')).toEqual([]);
      expect(sendMessage).toHaveBeenCalledTimes(wantedChecks >= 2 ? 1 : 0);
      expect(
        fetchMock.mock.calls.filter(([url]) => url === PREVIEW_BUILD)
      ).toHaveLength(wantedChecks >= 3 ? 1 : 0);
      // Its message closes, and says nothing more.
      expect(eventsOf('closeGlobalSnackBar')).toEqual([
        { sourceId: messages[0].sourceId },
      ]);
      expect(messages.map((message) => message.type)).not.toContain('error');
      expect(messages.map((message) => message.type)).not.toContain('success');
    }
  );

  it('reports a failure only while the app is still wanted', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline');
    });
    const openApp = renderOpenApp();
    let wanted = true;
    await act(async () => {
      await openApp(minter, false, undefined, { isWanted: () => wanted });
    });
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'error',
      message: 'offline',
    });

    messages = [];
    wanted = false;
    await act(async () => {
      await openApp(minter, false, undefined, { isWanted: () => wanted });
    });
    expect(messages.map((message) => message.type)).not.toContain('error');
    expect(eventsOf('closeGlobalSnackBar')).toEqual([
      { sourceId: messages[0].sourceId },
    ]);
  });
});
