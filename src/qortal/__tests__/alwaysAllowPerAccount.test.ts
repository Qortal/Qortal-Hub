import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The "always allow" boxes of the approval window, kept by the real
// getPermission / setPermission: what one account ticks never counts for
// another account signed in on the same Hub.

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
vi.mock('../../subscriptions/useInitializeMySubscriptions', () => ({
  triggerMemberGroupsFetch: vi.fn(),
}));
// Where the choices are kept when the Hub's own store isn't there.
const deviceStore = new Map<string, unknown>();
vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) =>
    deviceStore.has(key) ? structuredClone(deviceStore.get(key)) : null
  ),
  storeData: vi.fn(async (key: string, value: unknown) => {
    deviceStore.set(key, structuredClone(value));
    return 'ok';
  }),
  getSigningContextRevision: vi.fn(() => 0),
}));

import { getListItems, getUserAccount } from '../get';
import {
  clearAllSessionPermissions,
  getAppsWithNotificationPermission,
  getNotificationPermissionKey,
  getPermission,
  setPermission,
} from '../qortal-requests';
import {
  createEndpoint,
  getApiKeyFromStorage,
  getSaveWallet,
} from '../../background/background';

const ACCOUNT_A = 'QAccountAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ACCOUNT_B = 'QAccountBBBBBBBBBBBBBBBBBBBBBBBBBB';

type HubWindow = {
  __qortalCurrentAddress?: string | null;
  appStorage?: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
};
const w = window as unknown as HubWindow;

/** The Hub's own store, as Electron gives it to the page. */
let hubStore: Record<string, unknown>;
const storedChoices = () =>
  (hubStore.qortalRequestPermissions ?? {}) as Record<string, unknown>;

const signIn = (address: string | null) => {
  if (address) w.__qortalCurrentAddress = address;
  else delete w.__qortalCurrentAddress;
};

type Prompt = { requestId: string };
let prompts: Prompt[];

// The approval window's answer; `always` ticks the request's "always" box.
const answer = (prompt: Prompt, accepted: boolean, always = false) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: {
        action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
        requestId: prompt.requestId,
        result: always ? { accepted, checkbox1: true } : { accepted },
      },
    })
  );

const settle = () => vi.advanceTimersByTimeAsync(0);

let nextTab = 1;
/** GET_USER_ACCOUNT from the app in a new tab (no session permissions). */
const signInRequest = () =>
  getUserAccount({
    isFromExtension: true,
    appInfo: { tabId: nextTab++, name: 'Opened-App', service: 'APP' },
  });

const listRequest = () =>
  getListItems(
    { list_name: 'followedNames' },
    { tabId: nextTab++, name: 'Opened-App', service: 'APP' },
    true
  );

beforeEach(() => {
  vi.useFakeTimers();
  prompts = [];
  hubStore = {};
  deviceStore.clear();
  w.appStorage = {
    get: async (key) => structuredClone(hubStore[key]),
    set: async (key, value) => {
      hubStore[key] = structuredClone(value);
    },
  };
  signIn(ACCOUNT_A);
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    prompts.push({ requestId: message.requestId });
  });
  vi.mocked(getSaveWallet).mockImplementation(async () => ({
    address0: w.__qortalCurrentAddress,
    publicKey: `key of ${w.__qortalCurrentAddress}`,
  }));
  // A node of the user's own, not a gateway.
  vi.mocked(getApiKeyFromStorage).mockResolvedValue({
    url: 'http://127.0.0.1:12391',
  } as never);
  vi.mocked(createEndpoint).mockImplementation(async (path: string) => path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('["Publisher"]', { status: 200 }))
  );
});

afterEach(() => {
  clearAllSessionPermissions();
  delete w.appStorage;
  signIn(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('"always allow" boxes belong to the account that ticked them', () => {
  it('asks another account on the same Hub again', async () => {
    const first = signInRequest();
    await settle();
    expect(prompts).toHaveLength(1);
    answer(prompts[0], true, true);
    await expect(first).resolves.toEqual({
      address: ACCOUNT_A,
      publicKey: `key of ${ACCOUNT_A}`,
    });
    await settle();

    // The same account, in another tab: the box counts.
    await expect(signInRequest()).resolves.toMatchObject({
      address: ACCOUNT_A,
    });
    expect(prompts).toHaveLength(1);

    signIn(ACCOUNT_B);
    const forB = signInRequest();
    await settle();
    expect(prompts).toHaveLength(2);
    answer(prompts[1], true);
    await expect(forB).resolves.toMatchObject({ address: ACCOUNT_B });
    await settle();

    // B answered without the box; A's box still counts for A.
    signIn(ACCOUNT_A);
    await expect(signInRequest()).resolves.toMatchObject({
      address: ACCOUNT_A,
    });
    expect(prompts).toHaveLength(2);
  });

  it("doesn't let one account's lists box count for another", async () => {
    signIn(ACCOUNT_B);
    const forB = listRequest();
    await settle();
    answer(prompts[0], true, true);
    await expect(forB).resolves.toEqual(['Publisher']);
    await settle();

    signIn(ACCOUNT_A);
    const forA = listRequest();
    forA.catch(() => undefined);
    await settle();
    expect(prompts).toHaveLength(2);
    answer(prompts[1], false);
    await expect(forA).rejects.toThrow();
  });

  it('no longer counts a box ticked before boxes were kept per account, and clears it at the next one', async () => {
    const notificationKey = getNotificationPermissionKey('Opened-App');
    hubStore.qortalRequestPermissions = {
      'qAPPAutoAuth-Opened-App': true,
      qAPPAutoLists: true,
      [notificationKey]: true,
    };

    const request = signInRequest();
    await settle();
    expect(prompts).toHaveLength(1);
    answer(prompts[0], true, true);
    await request;
    await settle();

    expect(storedChoices()).toEqual({
      [notificationKey]: true,
      [`account:${ACCOUNT_A}:qAPPAutoAuth-Opened-App`]: true,
    });
  });

  it('keeps nothing and counts nothing while no account is signed in', async () => {
    hubStore.qortalRequestPermissions = { 'qAPPAutoAuth-Opened-App': true };
    signIn(null);

    await setPermission('qAPPAutoLists', true);
    expect(storedChoices()).toEqual({ 'qAPPAutoAuth-Opened-App': true });
    await expect(getPermission('qAPPAutoAuth-Opened-App')).resolves.toBe(null);
    await expect(getPermission('qAPPAutoLists')).resolves.toBe(null);
  });

  it("turns one account's box off without touching another's", async () => {
    await setPermission('qAPPSendChatMessage-Opened-App', true);
    signIn(ACCOUNT_B);
    await setPermission('qAPPSendChatMessage-Opened-App', true);

    signIn(ACCOUNT_A);
    await setPermission('qAPPSendChatMessage-Opened-App', false);
    await expect(getPermission('qAPPSendChatMessage-Opened-App')).resolves.toBe(
      false
    );
    signIn(ACCOUNT_B);
    await expect(getPermission('qAPPSendChatMessage-Opened-App')).resolves.toBe(
      true
    );
  });

  it('keeps choices per account where the Hub has no store of its own', async () => {
    delete w.appStorage;
    deviceStore.set('qortalRequestPermissions', {
      'qAPPAutoWalletBalance-Opened-App-BTC': true,
    });

    await expect(
      getPermission('qAPPAutoWalletBalance-Opened-App-BTC')
    ).resolves.toBe(null);
    await setPermission('qAPPAutoWalletBalance-Opened-App-BTC', true);
    await expect(
      getPermission('qAPPAutoWalletBalance-Opened-App-BTC')
    ).resolves.toBe(true);
    signIn(ACCOUNT_B);
    await expect(
      getPermission('qAPPAutoWalletBalance-Opened-App-BTC')
    ).resolves.toBe(null);
    expect(deviceStore.get('qortalRequestPermissions')).toEqual({
      [`account:${ACCOUNT_A}:qAPPAutoWalletBalance-Opened-App-BTC`]: true,
    });
  });
});

describe('notification permissions', () => {
  it('stay with the account they were given for, as before', async () => {
    await setPermission(getNotificationPermissionKey('Opened-App'), true);
    await setPermission('qAPPAutoLists', true);

    await expect(
      getPermission(getNotificationPermissionKey('Opened-App'))
    ).resolves.toBe(true);
    await expect(getAppsWithNotificationPermission()).resolves.toEqual([
      'opened-app',
    ]);
    signIn(ACCOUNT_B);
    await expect(
      getPermission(getNotificationPermissionKey('Opened-App'))
    ).resolves.toBe(null);
    await expect(getAppsWithNotificationPermission()).resolves.toEqual([]);
  });
});
