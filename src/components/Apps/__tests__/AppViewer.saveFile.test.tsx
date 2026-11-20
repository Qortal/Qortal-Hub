import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Q-App's SAVE_FILE asks with the tab's app, so the approval names it.

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));
vi.mock('../../../i18n/i18n', () => ({
  default: { t: (key: string) => key },
}));
vi.mock('../../../qortal/get', () => ({
  saveFile: vi.fn(),
  authorizeRnsDestination: vi.fn(),
}));
vi.mock('../../../qortal/qortal-requests', () => ({
  hasSessionPermission: vi.fn(() => false),
}));

const bridges = vi.hoisted(
  () =>
    [] as Array<{
      documentId: string;
      listener: (event: {
        data: any;
        ports: { postMessage: (result: any) => void }[];
      }) => Promise<void>;
    }>
);
vi.mock('../../../qortal/qapp-guest-request-bridge', () => ({
  attachQAppRequestBridge: (_view, documentId, listener) => {
    bridges.push({ documentId, listener });
    return () => undefined;
  },
}));

import { AppViewer } from '../AppViewer';
import { saveFile } from '../../../qortal/get';

let sendMessage: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

const documentIdFor = (tabId: string) =>
  tabId
    .padEnd(32, '0')
    .replace(/[^a-f0-9]/g, 'a')
    .slice(0, 32);

const openTab = async (app: any, isDevMode: boolean) => {
  const { container } = render(<AppViewer app={app} isDevMode={isDevMode} />);
  await waitFor(() =>
    expect(container.querySelector('webview')).not.toBeNull()
  );
  const view = container.querySelector('webview')!;
  Object.assign(view, { send: vi.fn() });
  const documentId = documentIdFor(app.tabId);
  act(() =>
    view.dispatchEvent(
      Object.assign(new Event('ipc-message'), {
        channel: 'qapp:hello',
        args: [{ documentId }],
      })
    )
  );
  await waitFor(() =>
    expect(bridges.some((bridge) => bridge.documentId === documentId)).toBe(
      true
    )
  );
  return bridges
    .filter((bridge) => bridge.documentId === documentId)
    .slice(-1)[0].listener;
};

const ask = (listener, data) =>
  new Promise((resolve) =>
    listener({
      data: { requestedHandler: 'UI', ...data },
      ports: [{ postMessage: resolve }],
    })
  );

beforeEach(() => {
  bridges.length = 0;
  vi.stubGlobal('electronAPI', {
    qappGuestPrepare: vi.fn().mockResolvedValue({
      partition: 'persist:test',
      preload: 'file:///test/qapp-guest-preload.js',
    }),
    qappGuestRelease: vi.fn().mockResolvedValue(true),
  });
  sendMessage = vi.fn().mockResolvedValue({ ok: true });
  (window as any).sendMessage = sendMessage;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a Q-App’s SAVE_FILE', () => {
  it('asks with the tab’s app', async () => {
    const tab = await openTab(
      { tabId: 'tab-1', name: 'Opened-App', service: 'APP' },
      false
    );
    await ask(tab, {
      action: 'SAVE_FILE',
      filename: 'a.txt',
      blob: new Blob(['x']),
    });
    expect(vi.mocked(saveFile).mock.calls[0][4]).toEqual({
      name: 'Opened-App',
      service: 'APP',
      tabId: 'tab-1',
    });
  });
});
