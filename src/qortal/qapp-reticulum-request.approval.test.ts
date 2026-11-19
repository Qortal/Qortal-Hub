import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The backend approval a Q-App's RNS_CONNECT asks for names the app with its
// service, as every other approval does.

vi.mock('./qortal-requests', async () =>
  (await import('./__tests__/common')).qortalRequestsFactory()
);
vi.mock('../background/background', async () =>
  (await import('./__tests__/common')).backgroundFactory()
);
vi.mock('../encryption/encryption', async () =>
  (await import('./__tests__/common')).encryptionFactory()
);
vi.mock('../components/Chat/AdminSpaceInner', async () =>
  (await import('./__tests__/common')).adminSpaceFactory()
);
vi.mock('../components/Chat/MessageDisplay', async () =>
  (await import('./__tests__/common')).messageDisplayFactory()
);
vi.mock('../components/Group/Group', async () =>
  (await import('./__tests__/common')).groupFactory()
);
vi.mock('../qdn/encryption/group-encryption', async () =>
  (await import('./__tests__/common')).groupEncryptionFactory()
);
vi.mock('../qdn/publish/publish', async () =>
  (await import('./__tests__/common')).publishFactory()
);
vi.mock('../transactions/TradeBotCreateRequest', async () =>
  (await import('./__tests__/common')).tradeBotCreateFactory()
);
vi.mock('../transactions/TradeBotDeleteRequest', async () =>
  (await import('./__tests__/common')).tradeBotDeleteFactory()
);
vi.mock('../transactions/signTradeBotTransaction', async () =>
  (await import('./__tests__/common')).signTradeBotFactory()
);
vi.mock('../transactions/transactions', async () =>
  (await import('./__tests__/common')).transactionsFactory()
);
vi.mock('../utils/events', async () =>
  (await import('./__tests__/common')).eventsFactory()
);
vi.mock('../utils/fileReading/index', async () =>
  (await import('./__tests__/common')).fileReadingFactory()
);
vi.mock('../utils/memeTypes', async () =>
  (await import('./__tests__/common')).mimeTypesFactory()
);
vi.mock('../utils/queue/queue', async () =>
  (await import('./__tests__/common')).queueFactory()
);
vi.mock('../utils/utils', async () =>
  (await import('./__tests__/common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./__tests__/common')).shortUidFactory()
);
vi.mock('../utils/decode', async () =>
  (await import('./__tests__/common')).decodeFactory()
);
vi.mock('i18next', async () =>
  (await import('./__tests__/common')).i18nFactory()
);
vi.mock('../i18n/i18n', async () =>
  (await import('./__tests__/common')).i18nFactory()
);
vi.mock('aes-js', async () =>
  (await import('./__tests__/common')).aesFactory()
);
vi.mock('../encryption/Base58', async () =>
  (await import('./__tests__/common')).base58Factory()
);
vi.mock('../encryption/ed2curve', async () =>
  (await import('./__tests__/common')).ed2curveFactory()
);
vi.mock('../encryption/nacl-fast', async () =>
  (await import('./__tests__/common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('./__tests__/common')).asmcryptoFactory()
);
vi.mock('../hooks/useQortalMessageListener', async () =>
  (await import('./__tests__/common')).messageListenerFactory()
);
vi.mock('./qapp-save-file', async () =>
  (await import('./__tests__/common')).messageListenerFactory()
);

import i18n from 'i18next';
import { clearRnsDestinationPermissionsByTabId } from './get';
import { dispatchQAppReticulumRequest } from './qapp-reticulum-request';

let prompts: Array<{ requestingApp?: unknown }>;

describe('the backend approval of a Q-App’s RNS_CONNECT', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prompts = [];
    vi.mocked(i18n.t).mockImplementation((key: string) => key);
    Object.assign(window, {
      electronAPI: { qappReticulumConnect: vi.fn().mockResolvedValue(true) },
    });
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.action !== 'QORTAL_REQUEST_PERMISSION') return;
      prompts.push(message.payload);
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: window,
          data: {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message.requestId,
            result: { accepted: false },
          },
        })
      );
    });
  });

  afterEach(() => {
    clearRnsDestinationPermissionsByTabId(7);
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('names the app with its service, like every other approval', async () => {
    const request = dispatchQAppReticulumRequest(
      { action: 'RNS_CONNECT', destination: 'a'.repeat(32) },
      {
        appName: 'Opened-App',
        appService: 'WEBSITE',
        isFromExtension: true,
        tabId: 7,
      }
    );
    request.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await request.catch(() => undefined);

    expect(prompts).toHaveLength(1);
    expect(prompts[0].requestingApp).toEqual({
      name: 'Opened-App',
      service: 'WEBSITE',
    });
  });
});
