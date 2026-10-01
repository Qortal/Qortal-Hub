import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Factories live in ./common.ts; async dynamic import is used because vi.mock()
// is hoisted before regular imports.

vi.mock('../qortal-requests', async () =>
  (await import('./common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () =>
  (await import('./common')).backgroundFactory()
);
vi.mock('../../encryption/encryption', async () =>
  (await import('./common')).encryptionFactory()
);
vi.mock('../../components/Chat/AdminSpaceInner', async () =>
  (await import('./common')).adminSpaceFactory()
);
vi.mock('../../components/Chat/MessageDisplay', async () =>
  (await import('./common')).messageDisplayFactory()
);
vi.mock('../../components/Group/Group', async () =>
  (await import('./common')).groupFactory()
);
vi.mock('../../qdn/encryption/group-encryption', async () =>
  (await import('./common')).groupEncryptionFactory()
);
vi.mock('../../qdn/publish/publish', async () =>
  (await import('./common')).publishFactory()
);
vi.mock('../../transactions/TradeBotCreateRequest', async () =>
  (await import('./common')).tradeBotCreateFactory()
);
vi.mock('../../transactions/TradeBotDeleteRequest', async () =>
  (await import('./common')).tradeBotDeleteFactory()
);
vi.mock('../../transactions/signTradeBotTransaction', async () =>
  (await import('./common')).signTradeBotFactory()
);
vi.mock('../../transactions/transactions', async () =>
  (await import('./common')).transactionsFactory()
);
vi.mock('../../utils/events', async () =>
  (await import('./common')).eventsFactory()
);
vi.mock('../../utils/fileReading/index', async () =>
  (await import('./common')).fileReadingFactory()
);
vi.mock('../../utils/memeTypes', async () =>
  (await import('./common')).mimeTypesFactory()
);
vi.mock('../../utils/queue/queue', async () =>
  (await import('./common')).queueFactory()
);
vi.mock('../../utils/utils', async () =>
  (await import('./common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../encryption/Base58', async () =>
  (await import('./common')).base58Factory()
);
vi.mock('../../encryption/ed2curve', async () =>
  (await import('./common')).ed2curveFactory()
);
vi.mock('../../encryption/nacl-fast', async () =>
  (await import('./common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('./common')).asmcryptoFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);

import {
  authorizeRnsDestination,
  clearRnsDestinationPermissionsByTabId,
  sessionPermissions,
} from '../get';
import {
  hasSessionPermission,
  setSessionPermissions,
  VALID_SESSION_PERMISSIONS,
} from '../qortal-requests';
import english from '../../i18n/locales/en/question.json';
import i18n from 'i18next';

const app = { tabId: 42, name: 'ExampleApp' };
const destination = 'a'.repeat(32);
let prompts: Array<{
  text1: string;
  text2?: string;
  details?: { permissions: string[] };
}>;
let accepted = true;

describe('backend approval through qortalRequest permission dialogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prompts = [];
    accepted = true;
    const granted = new Set<string>();
    vi.mocked(setSessionPermissions).mockImplementation(
      (tab, name, permissions) => {
        for (const permission of permissions)
          granted.add(`${tab}:${name}:${permission}`);
      }
    );
    vi.mocked(hasSessionPermission).mockImplementation(
      (tab, name, permission) => granted.has(`${tab}:${name}:${permission}`)
    );
    VALID_SESSION_PERMISSIONS.splice(
      0,
      VALID_SESSION_PERMISSIONS.length,
      'PRIVATE_DATA_CHANNEL',
      'SEND_COIN'
    );
    vi.mocked(i18n.t).mockImplementation(
      (key: string, options?: { appName?: string }) =>
        key.startsWith('question:permission.')
          ? (english.permission[
              key.slice('question:permission.'.length)
            ]?.replace('{{appName}}', options?.appName ?? '') ?? key)
          : key
    );
    Object.assign(window, { electronAPI: { qappReticulumConnect: vi.fn() } });
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message.action !== 'QORTAL_REQUEST_PERMISSION') return;
      prompts.push(message.payload);
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: window,
          data: {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: message.requestId,
            result: { accepted },
          },
        })
      );
    });
  });

  afterEach(() => {
    clearRnsDestinationPermissionsByTabId(app.tabId);
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows one plain backend prompt, then skips the private transport dialog', async () => {
    await expect(
      authorizeRnsDestination(destination.toUpperCase(), false, app)
    ).resolves.toBe(destination);
    await expect(
      sessionPermissions({ permissions: ['PRIVATE_DATA_CHANNEL'] }, false, app)
    ).resolves.toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].text1).toBe(
      'Allow ExampleApp to connect to its backend?'
    );
    expect(JSON.stringify(prompts[0])).not.toMatch(
      /Reticulum|destination|PRIVATE_DATA_CHANNEL/
    );
    expect(JSON.stringify(prompts[0])).not.toContain(destination);
  });

  it('still prompts for other requested capabilities after approving the backend', async () => {
    await authorizeRnsDestination(destination, false, app);
    await sessionPermissions(
      { permissions: ['PRIVATE_DATA_CHANNEL', 'SEND_COIN'] },
      false,
      app
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1].details?.permissions).toEqual(['SEND_COIN']);
  });

  it('declining the backend does not grant private transport', async () => {
    accepted = false;
    await expect(
      authorizeRnsDestination(destination, false, app)
    ).rejects.toThrow('RNS_PERMISSION_DENIED');
    expect(setSessionPermissions).not.toHaveBeenCalled();
    expect(
      hasSessionPermission(app.tabId, app.name, 'PRIVATE_DATA_CHANNEL')
    ).toBe(false);
  });

  it('validates destination and permission names before approval', async () => {
    await expect(
      authorizeRnsDestination('invalid', false, app)
    ).rejects.toThrow('RNS_DESTINATION_UNREACHABLE');
    await expect(
      sessionPermissions({ permissions: ['INVALID'] }, false, app)
    ).rejects.toThrow();
    expect(prompts).toHaveLength(0);
  });
});
