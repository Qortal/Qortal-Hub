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
vi.mock('../../i18n/i18n', async () =>
  (await import('./common')).i18nFactory()
);
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
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);

vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { getDefaultStore } from 'jotai';
import { appLockedAtom } from '../../atoms/presence';
import { executeEvent } from '../../utils/events';
import { openNewTab, openUserLookup } from '../get';
import { HUB_LOCKED_CODE, refuseWhileHubLocked } from '../hubLocked';
import { dispatchQAppFileSaveRequest } from '../qapp-file-save-request';

const store = getDefaultStore();
const lockHub = (locked: boolean) => store.set(appLockedAtom, locked);
const context = {
  appName: 'Opened-App',
  appService: 'APP',
  isFromExtension: true,
  tabId: 'tab-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  lockHub(false);
});

afterEach(() => {
  lockHub(false);
  delete (window as any).electronAPI;
});

describe('refuseWhileHubLocked', () => {
  it('lets a request through while Hub is unlocked', () => {
    expect(() => refuseWhileHubLocked()).not.toThrow();
  });

  it('refuses it with the locked error while Hub is locked', () => {
    lockHub(true);
    expect(() => refuseWhileHubLocked()).toThrow(
      expect.objectContaining({
        code: HUB_LOCKED_CODE,
        message: 'question:message.error.hub_locked',
      })
    );
  });
});

describe("a Q-App's OPEN_USER_LOOKUP", () => {
  it('opens the user lookup while Hub is unlocked', async () => {
    await expect(openUserLookup({ user: 'Publisher' })).resolves.toBe(true);
    expect(executeEvent).toHaveBeenCalledWith('openUserLookupDrawer', {
      addressOrName: 'Publisher',
    });
  });

  it('opens nothing while Hub is locked, and says why', async () => {
    lockHub(true);
    await expect(openUserLookup({ user: 'Publisher' })).rejects.toMatchObject({
      code: HUB_LOCKED_CODE,
    });
    expect(executeEvent).not.toHaveBeenCalled();
  });
});

describe("a Q-App's OPEN_NEW_TAB", () => {
  const openLink = () =>
    openNewTab({ qortalLink: 'qortal://APP/Opened-App' }, true);

  it('opens the tab while Hub is unlocked', async () => {
    await expect(openLink()).resolves.toBe(true);
    expect(executeEvent).toHaveBeenCalledWith('addTab', expect.anything());
  });

  it('opens no tab behind the lock screen while Hub is locked, and says why', async () => {
    lockHub(true);
    await expect(openLink()).rejects.toMatchObject({ code: HUB_LOCKED_CODE });
    expect(executeEvent).not.toHaveBeenCalled();
  });
});

describe("a Q-App's stream save", () => {
  const qappFileSave = vi.fn(async () => ({ saveId: 'save-1' }));
  beforeEach(() => {
    qappFileSave.mockReset();
    qappFileSave.mockImplementation(async () => ({ saveId: 'save-1' }));
    (window as any).electronAPI = { qappFileSave };
  });

  const open = () =>
    dispatchQAppFileSaveRequest(
      { action: 'FILE_SAVE_OPEN', filename: 'notes.txt', size: 5 },
      context
    );

  it('asks where to save while Hub is unlocked', async () => {
    await expect(open()).resolves.toEqual({ saveId: 'save-1' });
    expect(qappFileSave).toHaveBeenCalledTimes(1);
  });

  it('does not ask while Hub is locked, and says why', async () => {
    lockHub(true);
    await expect(open()).rejects.toMatchObject({ code: HUB_LOCKED_CODE });
    expect(qappFileSave).not.toHaveBeenCalled();
  });

  it('does not start a save whose prompt was answered after Hub locked', async () => {
    let answerPrompt: (value: unknown) => void = () => undefined;
    qappFileSave.mockImplementation(((_owner, request) =>
      request.action === 'FILE_SAVE_OPEN'
        ? new Promise((resolve) => {
            answerPrompt = resolve;
          })
        : Promise.resolve({ aborted: true })) as any);

    const opening = open();
    // The prompt is up; Hub locks; the prompt is answered.
    lockHub(true);
    answerPrompt({ saveId: 'save-1' });

    await expect(opening).rejects.toMatchObject({ code: HUB_LOCKED_CODE });
    expect(qappFileSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabId: 'tab-1' }),
      { action: 'FILE_SAVE_ABORT', saveId: 'save-1' }
    );
  });

  it('goes on writing a save opened before Hub locked', async () => {
    lockHub(true);
    await dispatchQAppFileSaveRequest(
      { action: 'FILE_SAVE_WRITE', saveId: 'save-1', offset: 0, data: 'hello' },
      context
    );
    expect(qappFileSave).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 'tab-1' }),
      expect.objectContaining({ action: 'FILE_SAVE_WRITE', saveId: 'save-1' })
    );
  });
});
