import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// What Hub tells its request handlers about the tab a Q-App request came
// from: a private app's, a preview's and Dev Mode's requests are marked, so
// they never use an app budget.

type BridgeListener = (event: {
  data: unknown;
  ports: { postMessage: (reply: unknown) => void }[];
}) => Promise<void>;

let bridgeListener: BridgeListener | null = null;

vi.mock('../qortal/qapp-guest-request-bridge', () => ({
  attachQAppRequestBridge: vi.fn(
    (_view: unknown, _documentId: string, listener: BridgeListener) => {
      bridgeListener = listener;
      return () => {
        bridgeListener = null;
      };
    }
  ),
}));
vi.mock('../qortal/get', () => ({ saveFile: vi.fn() }));

// Installs window.sendMessage, the bridge to Hub's request handlers.
import '../messaging/MessagesToBackground';
import { useQortalMessageListener } from './useQortalMessageListener';

/** The appInfo of the next request that reaches Hub's handlers. */
const nextAppInfo = () =>
  new Promise<Record<string, unknown>>((resolve) => {
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.type === 'backgroundMessage') resolve(message.appInfo);
    });
  });

const publishFromTab = async (
  tab: { isDevMode?: boolean; isPrivate?: boolean; isPreview?: boolean } = {}
) => {
  renderHook(() =>
    useQortalMessageListener(
      7,
      !!tab.isDevMode,
      tab.isDevMode ? 'devapp' : 'Opened-App',
      'APP',
      '',
      { current: {} },
      true,
      'document-1',
      { isPrivate: !!tab.isPrivate, isPreview: !!tab.isPreview }
    )
  );
  const appInfo = nextAppInfo();
  void bridgeListener?.({
    data: {
      action: 'PUBLISH_QDN_RESOURCE',
      service: 'BLOG_POST',
      requestedHandler: 'UI',
    },
    ports: [{ postMessage: () => {} }],
  });
  return appInfo;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the tab a Q-App request came from', () => {
  it('names a Q-App in a tab, unmarked', async () => {
    await expect(publishFromTab()).resolves.toEqual({
      name: 'Opened-App',
      service: 'APP',
      tabId: 7,
    });
  });

  it('marks a private app', async () => {
    await expect(publishFromTab({ isPrivate: true })).resolves.toMatchObject({
      isPrivate: true,
    });
  });

  it('marks a preview of an unpublished app', async () => {
    await expect(publishFromTab({ isPreview: true })).resolves.toMatchObject({
      isPreview: true,
    });
  });

  it('marks an app in Dev Mode', async () => {
    await expect(publishFromTab({ isDevMode: true })).resolves.toMatchObject({
      isDevMode: true,
      name: 'devapp',
    });
  });
});
