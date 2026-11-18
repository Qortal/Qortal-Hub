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

import {
  authorizeRnsDestination,
  getListItems,
  getUserAccount,
  getUserWallet,
  getUserWalletInfo,
  getUserWalletTransactions,
  getWalletBalance,
  joinGroup,
  lockTab,
  sendChatMessage,
  sessionPermissions,
} from '../get';
import {
  createPermissionPromptQueue,
  MIN_PERMISSION_TIME_TO_SHOW_MS,
  PERMISSION_ALREADY_GIVEN,
  PERMISSION_REQUEST_TIMEOUT_MS,
  permissionSecondsLeft,
  QORTAL_REQUEST_COUNTDOWN_SECONDS,
} from '../permissionPromptQueue';
import {
  AUTO_GRANTED_PERMISSIONS_ON_AUTH,
  getPermission,
  hasSessionPermission,
  setPermission,
  setSessionPermissions,
  VALID_SESSION_PERMISSIONS,
} from '../qortal-requests';
import { getFee, getSaveWallet } from '../../background/background';
import i18n from 'i18next';

type Prompt = {
  requestId: string;
  payload: { text1?: string; expiresAt?: number };
};
let prompts: Prompt[];

// The dialog's answer; `always` is the request's own "always allow" tick.
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

// Each call asks for the approval dialog once, as a Q-App in its own tab.
const ask = (tabId: number) =>
  sessionPermissions({ permissions: ['SEND_COIN'] }, false, {
    tabId,
    name: `App ${tabId}`,
  });

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('approval requests reach the dialog one at a time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prompts = [];
    vi.mocked(hasSessionPermission).mockReturnValue(false);
    VALID_SESSION_PERMISSIONS.splice(
      0,
      VALID_SESSION_PERMISSIONS.length,
      'SEND_COIN'
    );
    vi.mocked(i18n.t).mockImplementation((key: string) => key);
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.action !== 'QORTAL_REQUEST_PERMISSION') return;
      prompts.push({ requestId: message.requestId, payload: message.payload });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows a request that comes while another is on screen only after that one is answered', async () => {
    const first = ask(1);
    const second = ask(2);
    await settle();
    expect(prompts).toHaveLength(1);

    answer(prompts[0], false);
    await expect(first).rejects.toThrow('user_declined_request');
    await settle();
    expect(prompts).toHaveLength(2);

    answer(prompts[1], true);
    await expect(second).resolves.toBe(true);
  });

  it('gives a request that waited only what is left of its minute', async () => {
    const askedAt = Date.now();
    const first = ask(1);
    const second = ask(2);
    first.catch(() => undefined);
    second.catch(() => undefined);
    await settle();
    expect(prompts[0].payload.expiresAt).toBe(
      askedAt + PERMISSION_REQUEST_TIMEOUT_MS
    );

    await vi.advanceTimersByTimeAsync(20_000);
    answer(prompts[0], false);
    await expect(first).rejects.toThrow('user_declined_request');
    await settle();
    expect(prompts).toHaveLength(2);
    // The second request's time counts from when the app asked.
    expect(prompts[1].payload.expiresAt).toBe(
      askedAt + PERMISSION_REQUEST_TIMEOUT_MS
    );

    await vi.advanceTimersByTimeAsync(PERMISSION_REQUEST_TIMEOUT_MS - 20_001);
    let settled = false;
    second.finally(() => (settled = true)).catch(() => undefined);
    await settle();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).rejects.toThrow('user_declined_request');
  });

  it('declines without showing a request whose time ran out while it waited', async () => {
    const first = ask(1);
    const second = ask(2);
    first.catch(() => undefined);
    second.catch(() => undefined);
    await settle();

    await vi.advanceTimersByTimeAsync(
      PERMISSION_REQUEST_TIMEOUT_MS - MIN_PERMISSION_TIME_TO_SHOW_MS + 1
    );
    answer(prompts[0], false);
    await expect(first).rejects.toThrow('user_declined_request');
    await expect(second).rejects.toThrow('user_declined_request');
    await settle();
    expect(prompts).toHaveLength(1);
  });

  it('ends the dialog countdown before the requester stops waiting', () => {
    const now = 1_000_000;
    const expiresAt = now + PERMISSION_REQUEST_TIMEOUT_MS;
    expect(permissionSecondsLeft(expiresAt, now)).toBe(
      QORTAL_REQUEST_COUNTDOWN_SECONDS
    );
    expect(now + permissionSecondsLeft(expiresAt, now) * 1000).toBeLessThan(
      expiresAt
    );
    expect(permissionSecondsLeft(expiresAt, expiresAt - 31_000)).toBe(30);
    expect(permissionSecondsLeft(expiresAt, expiresAt)).toBe(0);
    expect(permissionSecondsLeft(undefined, now)).toBe(
      QORTAL_REQUEST_COUNTDOWN_SECONDS
    );
  });

  it('declines at once a request that would wait behind ten others', async () => {
    const requests = Array.from({ length: 12 }, (_, index) => ask(index + 1));
    requests.forEach((request) => request.catch(() => undefined));
    await settle();

    expect(prompts).toHaveLength(1);
    await expect(requests[11]).rejects.toThrow('user_declined_request');

    for (let shown = 1; shown <= 11; shown += 1) {
      expect(prompts).toHaveLength(shown);
      answer(prompts[shown - 1], true);
      await expect(requests[shown - 1]).resolves.toBe(true);
      await settle();
    }
    expect(prompts).toHaveLength(11);
  });
});

describe('a request that waits its turn is checked again when its turn comes', () => {
  // Puts a first request on screen; it stays there until `answerFirst`.
  const queueWithOneOnScreen = async () => {
    const ask = createPermissionPromptQueue();
    let answerFirst: (answer: string) => void = () => undefined;
    const first = ask(
      () => new Promise<string>((resolve) => (answerFirst = resolve)),
      'declined'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { ask, first, answerFirst: (answer: string) => answerFirst(answer) };
  };

  it('is not shown when the answer in front of it allowed it', async () => {
    const { ask, first, answerFirst } = await queueWithOneOnScreen();
    let allowed = false;
    const show = vi.fn(async () => 'shown');
    const second = ask(show, 'declined', () => allowed);

    // Accepting the first one allows the second.
    allowed = true;
    answerFirst('accepted');

    await expect(first).resolves.toBe('accepted');
    await expect(second).resolves.toBe(PERMISSION_ALREADY_GIVEN);
    expect(show).not.toHaveBeenCalled();
  });

  it('is shown when that check fails', async () => {
    const { ask, first, answerFirst } = await queueWithOneOnScreen();
    const second = ask(
      async () => 'shown',
      'declined',
      () => {
        throw new Error('storage failed');
      }
    );

    answerFirst('accepted');

    await expect(first).resolves.toBe('accepted');
    await expect(second).resolves.toBe('shown');
  });

  it('is not checked again when nothing was in front of it', async () => {
    const ask = createPermissionPromptQueue();
    const alreadyAllowed = vi.fn(() => true);

    await expect(
      ask(async () => 'shown', 'declined', alreadyAllowed)
    ).resolves.toBe('shown');
    expect(alreadyAllowed).not.toHaveBeenCalled();
  });
});

type App = { tabId: number; name: string; service: string };
// The "always allow" ticks Hub keeps between sessions.
let stored: Map<string, unknown>;

// Long enough for Hub's storage to answer a read or finish a write, far too
// short for a request to run out.
const settleStorage = () => vi.advanceTimersByTimeAsync(100);
const storageTakes = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const texts = () => prompts.map((prompt) => prompt.payload.text1);
const quiet = <T>(request: Promise<T>) => {
  request.catch(() => undefined);
  return request;
};

const app: App = { tabId: 3, name: 'Example', service: 'APP' };
const signIn = (from: App = app) =>
  quiet(getUserAccount({ isFromExtension: true, appInfo: from }));

// Session permissions and stored ticks as Hub keeps them. Storage takes a
// moment; the handlers don't wait for their writes.
const mockHubPermissions = () => {
  const granted = new Set<string>();
  vi.mocked(setSessionPermissions).mockImplementation(
    (tab, name, permissions) => {
      for (const permission of permissions)
        granted.add(`${tab}:${name}:${permission}`);
      return [];
    }
  );
  vi.mocked(hasSessionPermission).mockImplementation((tab, name, permission) =>
    granted.has(`${tab}:${name}:${permission}`)
  );
  vi.mocked(getPermission).mockImplementation(async (key: string) => {
    await storageTakes(2);
    return stored.get(key) ?? null;
  });
  vi.mocked(setPermission).mockImplementation(
    async (key: string, value: unknown) => {
      await storageTakes(20);
      stored.set(key, value);
    }
  );
};

describe('a request that waited behind one that has just allowed it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prompts = [];
    stored = new Map();
    mockHubPermissions();
    // Signing in grants these for the session, as in qortal-requests.ts.
    AUTO_GRANTED_PERMISSIONS_ON_AUTH.splice(
      0,
      AUTO_GRANTED_PERMISSIONS_ON_AUTH.length,
      'GET_USER_ACCOUNT',
      'LOCK_TAB',
      'GET_USER_WALLET',
      'GET_WALLET_BALANCE',
      'GET_USER_WALLET_INFO',
      'GET_USER_WALLET_TRANSACTIONS',
      'GET_LIST_ITEMS',
      'START_CROSSCHAIN_SERVER'
    );
    VALID_SESSION_PERMISSIONS.splice(
      0,
      VALID_SESSION_PERMISSIONS.length,
      'JOIN_GROUP',
      'PRIVATE_DATA_CHANNEL'
    );
    vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
    vi.mocked(getSaveWallet).mockResolvedValue({
      address0: 'Q-test-address',
      publicKey: 'test-public-key',
    } as never);
    vi.mocked(i18n.t).mockImplementation((key: string) => key);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ groupId: 7, groupName: 'Example group' }),
      }))
    );
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.action !== 'QORTAL_REQUEST_PERMISSION') return;
      prompts.push({ requestId: message.requestId, payload: message.payload });
    });
  });

  afterEach(async () => {
    // Let requests still on screen or waiting run out, so the next test
    // starts with an empty queue.
    await vi.advanceTimersByTimeAsync(62_000);
    await vi.advanceTimersByTimeAsync(62_000);
    AUTO_GRANTED_PERMISSIONS_ON_AUTH.splice(
      0,
      AUTO_GRANTED_PERMISSIONS_ON_AUTH.length
    );
    VALID_SESSION_PERMISSIONS.splice(0, VALID_SESSION_PERMISSIONS.length);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // What an accepted sign-in grants the tab for the session, asked while the
  // sign-in dialog was still on screen.
  it.each<[string, () => Promise<unknown>]>([
    ['its lists', () => getListItems({ list_name: 'blockedNames' }, app, true)],
    ['its wallet', () => getUserWallet({ coin: 'LTC' }, true, app)],
    [
      'its wallet balance',
      () => getWalletBalance({ coin: 'LTC' }, false, true, app),
    ],
    ['its wallet info', () => getUserWalletInfo({ coin: 'LTC' }, true, app)],
    [
      'its wallet transactions',
      () => getUserWalletTransactions({ coin: 'LTC' }, true, app),
    ],
    [
      'a lock on its tab',
      () => lockTab({ lockMessage: 'Unsaved work' }, true, app),
    ],
    ['a second sign-in from its tab', () => signIn()],
  ])(
    'does not ask for %s once the sign-in it waited behind is accepted',
    async (_what, ask) => {
      signIn();
      await settleStorage();
      expect(texts()).toEqual(['question:permission.authenticate']);

      quiet(ask());
      await settleStorage();
      expect(prompts).toHaveLength(1);

      answer(prompts[0], true);
      await settleStorage();
      await settleStorage();

      expect(texts()).toEqual(['question:permission.authenticate']);
    }
  );

  it('still asks for what the declined sign-in it waited behind did not grant', async () => {
    signIn();
    await settleStorage();
    const wallet = quiet(getUserWallet({ coin: 'LTC' }, true, app));
    await settleStorage();
    expect(prompts).toHaveLength(1);

    answer(prompts[0], false);
    await settleStorage();

    expect(texts()).toEqual([
      'question:permission.authenticate',
      'question:permission.get_wallet_info',
    ]);
    answer(prompts[1], false);
    await expect(wallet).rejects.toThrow();
  });

  it('does not ask to join a group once the session permissions it waited behind allow it', async () => {
    const granted = sessionPermissions(
      { permissions: ['JOIN_GROUP'] },
      true,
      app
    );
    await settleStorage();
    quiet(joinGroup({ groupId: 7 }, true, app));
    await settleStorage();
    expect(prompts).toHaveLength(1);

    answer(prompts[0], true);
    await expect(granted).resolves.toBe(true);
    await settleStorage();

    expect(texts()).toEqual(['question:permission.session_permissions']);
  });

  it('does not ask twice for session permissions the user has just granted', async () => {
    const first = sessionPermissions(
      { permissions: ['JOIN_GROUP'] },
      true,
      app
    );
    await settleStorage();
    const second = quiet(
      sessionPermissions({ permissions: ['JOIN_GROUP'] }, true, app)
    );
    await settleStorage();
    expect(prompts).toHaveLength(1);

    answer(prompts[0], true);
    await expect(first).resolves.toBe(true);
    await settleStorage();

    expect(texts()).toEqual(['question:permission.session_permissions']);
    await expect(second).resolves.toBe(true);
  });

  it('does not ask for the private channel the backend approval it waited behind has given', async () => {
    vi.stubGlobal('electronAPI', { qappReticulumConnect: vi.fn() });
    quiet(authorizeRnsDestination('ab'.repeat(16), true, app));
    await settleStorage();
    const channel = quiet(
      sessionPermissions({ permissions: ['PRIVATE_DATA_CHANNEL'] }, true, app)
    );
    await settleStorage();
    expect(texts()).toEqual(['question:permission.backend_connection']);

    answer(prompts[0], true);
    await settleStorage();
    await settleStorage();

    expect(
      hasSessionPermission(app.tabId, app.name, 'PRIVATE_DATA_CHANNEL')
    ).toBe(true);
    expect(texts()).toEqual(['question:permission.backend_connection']);
    await expect(channel).resolves.toBe(true);
  });
});

describe('"always allow" ticked on a request that another one waited behind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prompts = [];
    stored = new Map();
    mockHubPermissions();
    vi.mocked(getSaveWallet).mockResolvedValue({
      address0: 'Q-test-address',
      publicKey: 'test-public-key',
    } as never);
    vi.mocked(i18n.t).mockImplementation((key: string) => key);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [] }))
    );
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.action !== 'QORTAL_REQUEST_PERMISSION') return;
      prompts.push({ requestId: message.requestId, payload: message.payload });
    });
  });

  afterEach(async () => {
    await vi.advanceTimersByTimeAsync(62_000);
    await vi.advanceTimersByTimeAsync(62_000);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // The user ticks "always" on the first of two requests of one kind from
  // one app and accepts it. Whatever Hub still shows for the second one is
  // accepted as it stands, without a tick.
  it.each<[string, string, (n: number) => Promise<unknown>]>([
    [
      'two chat messages from one app',
      'qAPPSendChatMessage-Example',
      (n) =>
        sendChatMessage({ message: `message ${n}`, groupId: 5 }, true, app),
    ],
    [
      'a sign-in from each of two tabs of one app',
      'qAPPAutoAuth-Example',
      (n) =>
        getUserAccount({
          isFromExtension: true,
          appInfo: { ...app, tabId: n },
        }),
    ],
    [
      'its LTC wallet read from each of two tabs of one app',
      'qAPPAutoGetUserWallet-Example-LTC',
      (n) => getUserWallet({ coin: 'LTC' }, true, { ...app, tabId: n }),
    ],
  ])('keeps the "always allow" just ticked for %s', async (_what, key, ask) => {
    quiet(ask(1));
    await settleStorage();
    quiet(ask(2));
    await settleStorage();
    expect(prompts).toHaveLength(1);

    answer(prompts[0], true, true);
    await settleStorage();
    await settleStorage();
    expect(stored.get(key)).toBe(true);

    for (const prompt of prompts.slice(1)) {
      answer(prompt, true);
      await settleStorage();
      await settleStorage();
    }

    expect(stored.get(key)).toBe(true);
  });
});
