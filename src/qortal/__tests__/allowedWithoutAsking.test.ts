import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// What the budget panel lists as allowed without asking, with the real
// stores: an account's "always allow" boxes and a tab's session permissions,
// and turning each off.

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

import {
  authorizeRnsDestination,
  clearRnsDestinationPermissionsByTabId,
  getListItems,
  getNotificationPermission,
  getServerConnectionHistory,
  getUserAccount,
  inviteToGroupRequest,
  notificationHasPermission,
  startCrossChainServer,
} from '../get';
import {
  accountChoices,
  allowSessionPermissionAgain,
  clearAllSessionPermissions,
  clearSessionPermissions,
  clearSessionPermissionsByTabId,
  getNotificationPermissionKey,
  getSessionPermissions,
  getTakenBackSessionPermissions,
  hasSessionPermission,
  isSessionPermissionTakenBack,
  notificationsChoice,
  revokeSessionPermission,
  setPermission,
  setSessionPermissions,
  subscribeSessionPermissions,
  turnOffAccountChoice,
  turnOffNotifications,
  turnOnAccountChoice,
  turnOnNotifications,
} from '../qortal-requests';
import {
  SESSION_PERMISSIONS_NOT_READ,
  SESSION_PERMISSIONS_REFUSED_WITHOUT,
  SESSION_TWIN,
} from '../alwaysAllowChoices';
import { executeEvent } from '../../utils/events';
import {
  createEndpoint,
  getApiKeyFromStorage,
  getFee,
  getNameInfoForOthers,
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

let hubStore: Record<string, unknown>;
const signIn = (address: string | null) => {
  if (address) w.__qortalCurrentAddress = address;
  else delete w.__qortalCurrentAddress;
};

type Prompt = { requestId: string };
let prompts: Prompt[];
// The notification permission's own window.
let notificationPrompts: Prompt[];
const answer = (
  prompt: Prompt,
  accepted: boolean,
  action = 'QORTAL_REQUEST_PERMISSION_RESPONSE'
) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: { action, requestId: prompt.requestId, result: { accepted } },
    })
  );
const settle = () => vi.advanceTimersByTimeAsync(0);

const signInFrom = (tabId: string) =>
  getUserAccount({
    isFromExtension: true,
    appInfo: { tabId, name: 'Opened-App', service: 'APP' },
  });

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
  notificationPrompts = [];
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message?.action === 'QORTAL_REQUEST_PERMISSION') {
      prompts.push({ requestId: message.requestId });
    }
    if (message?.action === 'NOTIFICATION_PERMISSION_REQUEST') {
      notificationPrompts.push({ requestId: message.requestId });
    }
  });
  vi.mocked(getSaveWallet).mockImplementation(async () => ({
    address0: w.__qortalCurrentAddress,
    publicKey: 'public key',
  }));
});

afterEach(async () => {
  // A window left open would hold the next test's requests in the queue.
  prompts.forEach((prompt) => answer(prompt, false));
  await settle();
  vi.unstubAllGlobals();
  clearAllSessionPermissions();
  clearRnsDestinationPermissionsByTabId('t1');
  delete w.appStorage;
  signIn(null);
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('an account\'s "always allow" boxes', () => {
  it('are listed for that account only, by the keys their callers use', async () => {
    await setPermission('qAPPAutoAuth-Opened-App', true);
    await setPermission('qAPPAutoWalletBalance-Opened-App-BTC', false);
    signIn(ACCOUNT_B);
    await setPermission('qAPPSendChatMessage-Opened-App', true);

    await expect(accountChoices(ACCOUNT_A)).resolves.toEqual([
      { key: 'qAPPAutoAuth-Opened-App', value: true },
      { key: 'qAPPAutoWalletBalance-Opened-App-BTC', value: false },
    ]);
    await expect(accountChoices(ACCOUNT_B)).resolves.toEqual([
      { key: 'qAPPSendChatMessage-Opened-App', value: true },
    ]);
    await expect(accountChoices('')).resolves.toEqual([]);
  });

  it('are turned off for the signed-in account alone, and the app asks again', async () => {
    await setPermission('qAPPAutoAuth-Opened-App', true);
    signIn(ACCOUNT_B);
    await setPermission('qAPPAutoAuth-Opened-App', true);

    // Not while another account is signed in.
    await expect(
      turnOffAccountChoice(ACCOUNT_A, 'qAPPAutoAuth-Opened-App')
    ).resolves.toBe(false);
    signIn(ACCOUNT_A);
    await expect(signInFrom('t1')).resolves.toMatchObject({
      address: ACCOUNT_A,
    });
    expect(prompts).toHaveLength(0);

    await expect(
      turnOffAccountChoice(ACCOUNT_A, 'qAPPAutoAuth-Opened-App')
    ).resolves.toBe(true);
    const asked = signInFrom('t2');
    await settle();
    expect(prompts).toHaveLength(1);
    answer(prompts[0], true);
    await asked;

    signIn(ACCOUNT_B);
    await expect(signInFrom('t3')).resolves.toMatchObject({
      address: ACCOUNT_B,
    });
    expect(prompts).toHaveLength(1);
  });
});

describe("a tab's session permissions", () => {
  it('lose one permission at a time, in that tab only, and the app asks again', async () => {
    setSessionPermissions('t1', 'Opened-App', [
      'GET_USER_ACCOUNT',
      'GET_LIST_ITEMS',
    ]);
    setSessionPermissions('t2', 'Opened-App', ['GET_USER_ACCOUNT']);

    revokeSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT');
    expect(getSessionPermissions('t1', 'Opened-App')).toEqual([
      'GET_LIST_ITEMS',
    ]);
    expect(getSessionPermissions('t2', 'Opened-App')).toEqual([
      'GET_USER_ACCOUNT',
    ]);

    await expect(signInFrom('t2')).resolves.toMatchObject({
      address: ACCOUNT_A,
    });
    expect(prompts).toHaveLength(0);
    const asked = signInFrom('t1');
    await settle();
    expect(prompts).toHaveLength(1);
    answer(prompts[0], false);
    await expect(asked).rejects.toThrow();
  });

  it("take a notification permission out of the account's part of the session too", () => {
    setSessionPermissions('t1', 'Opened-App', ['NOTIFICATION_PERMISSION']);
    revokeSessionPermission('t1', 'Opened-App', 'NOTIFICATION_PERMISSION');
    expect(getSessionPermissions('t1', 'Opened-App')).toEqual([]);
  });

  it('tell their listeners of every change, until they leave', () => {
    const listener = vi.fn();
    const leave = subscribeSessionPermissions(listener);
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_ACCOUNT']);
    revokeSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT');
    clearSessionPermissions('t1', 'Opened-App');
    clearSessionPermissionsByTabId('t1');
    clearAllSessionPermissions();
    expect(listener).toHaveBeenCalledTimes(5);

    leave();
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_ACCOUNT']);
    expect(listener).toHaveBeenCalledTimes(5);
  });
});

// What the panel's Turn off does for what it lists, and that the next such
// request asks again.
describe('taking back and allowing again', () => {
  it("a sign-in doesn't hand back what was taken back from the tab", async () => {
    await setPermission('qAPPAutoAuth-Opened-App', true);
    await signInFrom('t1');
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_USER_WALLET')).toBe(
      true
    );
    revokeSessionPermission('t1', 'Opened-App', 'GET_USER_WALLET', {
      takeBack: true,
    });

    // The tab signs in afresh, as after its Sign in box went off and on.
    revokeSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT');
    await signInFrom('t1');
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT')).toBe(
      true
    );
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_WALLET_BALANCE')).toBe(
      true
    );
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_USER_WALLET')).toBe(
      false
    );
    expect(getTakenBackSessionPermissions('t1', 'Opened-App')).toEqual([
      'GET_USER_WALLET',
    ]);
    // Another tab of the app signs in with everything.
    await signInFrom('t2');
    expect(hasSessionPermission('t2', 'Opened-App', 'GET_USER_WALLET')).toBe(
      true
    );
    clearSessionPermissionsByTabId('t2');
  });

  it('gives the sign-in back when the user approves one in the window, though it was taken back', async () => {
    setSessionPermissions('t1', 'Opened-App', ['GET_USER_ACCOUNT']);
    revokeSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT', {
      takeBack: true,
    });
    const asked = signInFrom('t1');
    await settle();
    expect(prompts).toHaveLength(1);
    answer(prompts[0], true);
    await expect(asked).resolves.toMatchObject({ address: ACCOUNT_A });
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_USER_ACCOUNT')).toBe(
      true
    );
    expect(
      isSessionPermissionTakenBack('t1', 'Opened-App', 'GET_USER_ACCOUNT')
    ).toBe(false);
  });

  it('remembers only what the user took back, until it is allowed again or the tab closes', () => {
    setSessionPermissions('t1', 'Opened-App', [
      'GET_WALLET_BALANCE',
      'LOCK_TAB',
      'GET_LIST_ITEMS',
    ]);
    // Taken out along with a box: not remembered.
    revokeSessionPermission('t1', 'Opened-App', 'GET_WALLET_BALANCE');
    revokeSessionPermission('t1', 'Opened-App', 'LOCK_TAB', {
      takeBack: true,
    });
    revokeSessionPermission('t1', 'Opened-App', 'GET_LIST_ITEMS', {
      takeBack: true,
    });
    expect(getTakenBackSessionPermissions('t1', 'Opened-App').sort()).toEqual([
      'GET_LIST_ITEMS',
      'LOCK_TAB',
    ]);
    expect(getTakenBackSessionPermissions('t1', 'Other-App')).toEqual([]);

    allowSessionPermissionAgain('t1', 'Opened-App', 'LOCK_TAB');
    expect(hasSessionPermission('t1', 'Opened-App', 'LOCK_TAB')).toBe(true);
    expect(isSessionPermissionTakenBack('t1', 'Opened-App', 'LOCK_TAB')).toBe(
      false
    );
    // Approved in a window: no longer taken back either.
    setSessionPermissions('t1', 'Opened-App', ['GET_LIST_ITEMS']);
    expect(getTakenBackSessionPermissions('t1', 'Opened-App')).toEqual([]);

    revokeSessionPermission('t1', 'Opened-App', 'LOCK_TAB', {
      takeBack: true,
    });
    clearSessionPermissionsByTabId('t1');
    expect(getTakenBackSessionPermissions('t1', 'Opened-App')).toEqual([]);
    revokeSessionPermission('t1', 'Opened-App', 'LOCK_TAB', {
      takeBack: true,
    });
    clearSessionPermissions('t1', 'Opened-App');
    expect(getTakenBackSessionPermissions('t1', 'Opened-App')).toEqual([]);
    revokeSessionPermission('t1', 'Opened-App', 'LOCK_TAB', {
      takeBack: true,
    });
    clearAllSessionPermissions();
    expect(getTakenBackSessionPermissions('t1', 'Opened-App')).toEqual([]);
  });

  it("keeps a taken-back notification permission in the account's part of the session", () => {
    setSessionPermissions('t1', 'Opened-App', ['NOTIFICATION_PERMISSION']);
    revokeSessionPermission('t1', 'Opened-App', 'NOTIFICATION_PERMISSION', {
      takeBack: true,
    });
    expect(
      isSessionPermissionTakenBack(
        't1',
        'Opened-App',
        'NOTIFICATION_PERMISSION'
      )
    ).toBe(true);
    signIn(ACCOUNT_B);
    expect(getTakenBackSessionPermissions('t1', 'Opened-App')).toEqual([]);
    signIn(ACCOUNT_A);
  });

  it('turns a box back on for the signed-in account only', async () => {
    await setPermission('qAPPAutoAuth-Opened-App', true);
    await turnOffAccountChoice(ACCOUNT_A, 'qAPPAutoAuth-Opened-App');
    signIn(ACCOUNT_B);
    expect(
      await turnOnAccountChoice(ACCOUNT_A, 'qAPPAutoAuth-Opened-App')
    ).toBe(false);
    signIn(ACCOUNT_A);
    expect(hubStore.qortalRequestPermissions).toMatchObject({
      [`account:${ACCOUNT_A}:qAPPAutoAuth-Opened-App`]: false,
    });
    expect(
      await turnOnAccountChoice(ACCOUNT_A, 'qAPPAutoAuth-Opened-App')
    ).toBe(true);
    expect(hubStore.qortalRequestPermissions).toMatchObject({
      [`account:${ACCOUNT_A}:qAPPAutoAuth-Opened-App`]: true,
    });
    // Signing in goes through again without a window.
    await expect(signInFrom('t1')).resolves.toMatchObject({
      address: ACCOUNT_A,
    });
    expect(prompts).toHaveLength(0);
  });

  it('turns notifications back on, for the signed-in account only', async () => {
    await expect(notificationsChoice(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      'none'
    );
    await setPermission(getNotificationPermissionKey('Opened-App'), true);
    await expect(notificationsChoice(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      'on'
    );
    await turnOffNotifications(ACCOUNT_A, 'Opened-App');
    await expect(notificationsChoice(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      'off'
    );
    vi.mocked(executeEvent).mockClear();

    signIn(ACCOUNT_B);
    await expect(turnOnNotifications(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      false
    );
    signIn(ACCOUNT_A);
    await expect(notificationsChoice(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      'off'
    );
    expect(executeEvent).not.toHaveBeenCalledWith(
      'notifications-websocket-reconnect',
      undefined
    );
    await expect(turnOnNotifications(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      true
    );
    await expect(notificationsChoice(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      'on'
    );
    expect(executeEvent).toHaveBeenCalledWith(
      'notifications-websocket-reconnect',
      undefined
    );
  });
});

describe('turning off what the panel lists', () => {
  const APP = { tabId: 't1', name: 'Opened-App', service: 'APP' };
  // Hub's tab ids are text; these two are typed with a number.
  const NOTIFYING_APP = APP as never;

  it('the Sign in box: the tab loses the sign-in it gave, and signing in asks', async () => {
    await setPermission('qAPPAutoAuth-Opened-App', true);
    // The box lets a sign-in through, and gives the tab its look-ups.
    await expect(signInFrom('t1')).resolves.toMatchObject({
      address: ACCOUNT_A,
    });
    expect(prompts).toHaveLength(0);

    expect(
      await turnOffAccountChoice(ACCOUNT_A, 'qAPPAutoAuth-Opened-App')
    ).toBe(true);
    revokeSessionPermission('t1', 'Opened-App', SESSION_TWIN.sign_in);

    const asked = signInFrom('t1');
    await settle();
    expect(prompts).toHaveLength(1);
    answer(prompts[0], false);
    await expect(asked).rejects.toThrow();
  });

  it('notifications: they stop, and the next request asks', async () => {
    const first = getNotificationPermission({ appInfo: NOTIFYING_APP });
    await settle();
    answer(notificationPrompts[0], true, 'NOTIFICATION_PERMISSION_RESPONSE');
    await expect(first).resolves.toBe(true);
    await settle();
    await expect(
      notificationHasPermission({ appInfo: NOTIFYING_APP })
    ).resolves.toBe(true);

    // Not while another account is signed in.
    signIn(ACCOUNT_B);
    await expect(turnOffNotifications(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      false
    );
    signIn(ACCOUNT_A);
    await expect(turnOffNotifications(ACCOUNT_A, 'Opened-App')).resolves.toBe(
      true
    );
    revokeSessionPermission('t1', 'Opened-App', 'NOTIFICATION_PERMISSION');
    expect(executeEvent).toHaveBeenCalledWith(
      'notifications-websocket-reconnect',
      undefined
    );
    await expect(
      notificationHasPermission({ appInfo: NOTIFYING_APP })
    ).resolves.toBe(false);

    const second = getNotificationPermission({ appInfo: NOTIFYING_APP });
    second.catch(() => undefined);
    await settle();
    expect(notificationPrompts).toHaveLength(2);
  });

  it("the private data channel: the tab's Reticulum destinations go too, and connecting asks", async () => {
    const destination = 'a'.repeat(32);
    // Hub's native Reticulum transport, as Electron gives it to the page.
    vi.stubGlobal('electronAPI', { qappReticulumConnect: vi.fn() });
    const first = authorizeRnsDestination(destination, true, APP);
    await settle();
    answer(prompts[0], true);
    await first;
    expect(
      hasSessionPermission('t1', 'Opened-App', 'PRIVATE_DATA_CHANNEL')
    ).toBe(true);

    revokeSessionPermission('t1', 'Opened-App', 'PRIVATE_DATA_CHANNEL');
    const second = authorizeRnsDestination(destination, true, APP);
    second.catch(() => undefined);
    await settle();
    expect(prompts).toHaveLength(2);
    expect(
      hasSessionPermission('t1', 'Opened-App', 'PRIVATE_DATA_CHANNEL')
    ).toBe(false);
  });
});

describe('what holding a session permission changes', () => {
  const APP = { tabId: 't1', name: 'Opened-App', service: 'APP' } as never;
  const nodeAnswers = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

  beforeEach(() => {
    // A local node: node actions aren't refused as on a public one.
    vi.mocked(getApiKeyFromStorage).mockResolvedValue({
      url: 'http://127.0.0.1:12391',
    } as never);
    vi.mocked(createEndpoint).mockImplementation(
      async (path: string) => `http://127.0.0.1:12391${path}`
    );
  });

  it("refuses a taken-back START_CROSSCHAIN_SERVER without a window until it's allowed again", async () => {
    expect(
      SESSION_PERMISSIONS_REFUSED_WITHOUT.has('START_CROSSCHAIN_SERVER')
    ).toBe(true);
    const signingIn = signInFrom('t1');
    await settle();
    answer(prompts[0], true);
    await signingIn;
    revokeSessionPermission('t1', 'Opened-App', 'START_CROSSCHAIN_SERVER', {
      takeBack: true,
    });
    nodeAnswers(true);

    await expect(
      startCrossChainServer({ coin: 'LTC' }, true, APP)
    ).rejects.toThrow('User not authenticated');
    expect(prompts).toHaveLength(1);

    allowSessionPermissionAgain('t1', 'Opened-App', 'START_CROSSCHAIN_SERVER');
    await expect(
      startCrossChainServer({ coin: 'LTC' }, true, APP)
    ).resolves.not.toThrow();
    expect(prompts).toHaveLength(1);
  });

  it("asks for a group action with or without the tab's permission, so the panel leaves it out", async () => {
    expect(SESSION_PERMISSIONS_NOT_READ.has('INVITE_TO_GROUP')).toBe(true);
    // An app's own request for session permissions can give the tab this.
    setSessionPermissions('t1', 'Opened-App', ['INVITE_TO_GROUP']);
    vi.mocked(getNameInfoForOthers).mockResolvedValue('Invitee' as never);
    vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
    nodeAnswers({ groupName: 'Some group' });

    inviteToGroupRequest(
      {
        groupId: 7,
        inviteTime: 3600,
        inviteeAddress: 'QInviteeAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      true,
      APP
    ).catch(() => undefined);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
  });

  it("answers GET_SERVER_CONNECTION_HISTORY without a window, with or without the tab's permission, so the panel leaves it out", async () => {
    expect(
      SESSION_PERMISSIONS_NOT_READ.has('GET_SERVER_CONNECTION_HISTORY')
    ).toBe(true);
    nodeAnswers([]);
    expect(
      hasSessionPermission('t1', 'Opened-App', 'GET_SERVER_CONNECTION_HISTORY')
    ).toBe(false);
    await expect(
      getServerConnectionHistory({ coin: 'BTC' })
    ).resolves.not.toThrow();
    expect(prompts).toHaveLength(0);
  });

  it('keeps a look-up taken back when it is approved once in its own window', async () => {
    setSessionPermissions('t1', 'Opened-App', ['GET_LIST_ITEMS']);
    revokeSessionPermission('t1', 'Opened-App', 'GET_LIST_ITEMS', {
      takeBack: true,
    });
    nodeAnswers(['Blocked-Name']);

    const listing = getListItems({ list_name: 'blockedNames' }, APP, true);
    listing.catch(() => undefined);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    answer(prompts[0], true);
    await expect(listing).resolves.toEqual(['Blocked-Name']);
    expect(
      isSessionPermissionTakenBack('t1', 'Opened-App', 'GET_LIST_ITEMS')
    ).toBe(true);
    expect(hasSessionPermission('t1', 'Opened-App', 'GET_LIST_ITEMS')).toBe(
      false
    );
  });
});
