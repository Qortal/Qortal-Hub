import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

// Multi-publishes wait a second between resources.
vi.setConfig({ testTimeout: 20_000 });

// Q-App requests an app budget may pay for (new publishes, poll votes, chat
// messages) and the ones it never pays for, through the real handlers in
// get.ts. Same factories as the other get.ts tests (see ./common.ts), with
// the real Base58 the vote and chat handlers use.

// src/test/setup.ts stubs asmcrypto out.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
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
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);

import { getDefaultStore } from 'jotai';
import { SecureStoragePlugin } from '@evva/capacitor-secure-storage-plugin';
import Base58Untyped from '../../encryption/Base58';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import { appLockedAtom } from '../../atoms/presence';
import {
  publishMultipleQDNResources,
  publishQDNResource,
  sendChatMessage,
  sendCoin,
  voteOnPoll,
} from '../get';
import { isRunningGateway } from '../qortal-requests';
import {
  createEndpoint,
  getBalanceInfo,
  getFee,
  getKeyPair,
  getLastRef,
  getSaveWallet,
  performPowTask,
  processTransactionVersion2,
  resolveRecipient,
  sendCoin as sendCoinFunc,
  sendQortFee,
  signChatFunc,
} from '../../background/background';
import { getAllUserNames, getNameInfo } from '../../encryption/encryption';
import { publishData } from '../../qdn/publish/publish';
import { storeData } from '../../utils/chromeStorage';
import { createTransaction } from '../../transactions/transactions';
import {
  budgetState,
  findAppBudget,
  refillAppBudget,
  removeAppBudget,
  resetAppBudgetsForTests,
  type AppBudgetLimits,
  type BudgetApp,
} from '../appBudgets';
import { HUB_REQUEST } from '../requestingApp';

const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;

const keyPairBytes = Base58.encode(new Uint8Array(32).fill(1)) as string;
// Another account's key: what signs once someone else has signed in.
const otherKeyBytes = Base58.encode(new Uint8Array(32).fill(2)) as string;
// The accounts of those keys (an address is made from its public key): a
// request a budget pays for is signed by the account the budget is for.
const ACCOUNT = String(publicKeyToAddress(Base58.decode(keyPairBytes)));
const OTHER_ACCOUNT = String(publicKeyToAddress(Base58.decode(otherKeyBytes)));
const FEE = '0.01000000';
const FEE_ATOMIC = 1000000;
const QORT = BigInt(100000000);
const DAY = 24 * 60 * 60 * 1000;
const OPENED_APP = { name: 'Opened-App', service: 'APP', tabId: 4 };
const SECOND_TAB = { ...OPENED_APP, tabId: 5 };
const APP: BudgetApp = { service: 'APP', name: 'Opened-App' };
const SITE: BudgetApp = { service: 'WEBSITE', name: 'Opened-App' };
const store = getDefaultStore();

const setAccount = (address: string | null) => {
  (window as any).__qortalCurrentAddress = address;
};

function giveBudget(
  amount: bigint,
  {
    address = ACCOUNT,
    app = APP,
    expiresAt = Date.now() + 30 * DAY,
    limits = 'standard',
    now = Date.now(),
  }: {
    address?: string;
    app?: BudgetApp;
    expiresAt?: number | null;
    limits?: AppBudgetLimits;
    now?: number;
  } = {}
) {
  expect(
    refillAppBudget(address, app, { amount, expiresAt, limits }, now)
  ).toBe(true);
}

const budget = (app: BudgetApp = APP) => findAppBudget(ACCOUNT, app);

// Identifiers the node lists (READY), besides the statuses a test gives.
let onNode = new Set<string>();

/**
 * The node: a resource status per identifier (NOT_PUBLISHED unless given or
 * listed in onNode; FAIL answers 500), a poll, a balance.
 */
function stubNode(statuses: Record<string, string> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path.startsWith('/arbitrary/resource/status/')) {
      const identifier = decodeURIComponent(path.split('/').pop());
      const status =
        statuses[identifier] ??
        (onNode.has(identifier) ? 'READY' : 'NOT_PUBLISHED');
      if (status === 'FAIL') {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ status }) };
    }
    if (path.startsWith('/polls/')) {
      return {
        ok: true,
        json: async () => ({
          pollName: 'Poll-1',
          pollOptions: [{ optionName: 'yes' }, { optionName: 'no' }],
        }),
      };
    }
    if (path.startsWith('/addresses/balance/')) {
      return { ok: true, json: async () => 100, text: async () => '100' };
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Records every approval window; the test answers each one. */
function watchWindows() {
  const shown: { payload: Record<string, any>; requestId: string }[] = [];
  const listener = (event: MessageEvent) => {
    if (event.data?.action !== 'QORTAL_REQUEST_PERMISSION') return;
    shown.push({
      payload: event.data.payload,
      requestId: event.data.requestId,
    });
  };
  window.addEventListener('message', listener);
  onTestFinished(() => window.removeEventListener('message', listener));
  const answer = (index: number, result: Record<string, unknown>) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: shown[index].requestId,
          result,
        },
        origin: window.location.origin,
        source: window,
      })
    );
  return { shown, answer };
}

const post = (identifier: string, extra: Record<string, unknown> = {}) => ({
  service: 'BLOG_POST',
  identifier,
  data64: 'QQ==',
  ...extra,
});

const publishPost = (
  identifier: string,
  appInfo: Record<string, unknown> = OPENED_APP,
  extra: Record<string, unknown> = {}
) => publishQDNResource(post(identifier, extra), null, true, appInfo);

beforeEach(() => {
  window.localStorage.clear();
  resetAppBudgetsForTests();
  onNode = new Set();
  setAccount(ACCOUNT);
  store.set(appLockedAtom, false);
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(createEndpoint).mockImplementation(
    async (path: string) => `http://127.0.0.1:12391${path}`
  );
  vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: FEE });
  vi.mocked(getNameInfo).mockResolvedValue('Publisher');
  vi.mocked(getAllUserNames).mockResolvedValue(['Publisher']);
  vi.mocked(getBalanceInfo).mockResolvedValue(100);
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: ACCOUNT });
  vi.mocked(getKeyPair).mockResolvedValue({
    privateKey: keyPairBytes,
    publicKey: keyPairBytes,
  });
  vi.mocked(getLastRef).mockResolvedValue('LAST_REF');
  vi.mocked(createTransaction).mockResolvedValue({
    signedBytes: new Uint8Array(4),
    chatBytes: new Uint8Array(4),
  });
  vi.mocked(processTransactionVersion2).mockResolvedValue({
    signature: 'VOTE_SIG',
  });
  vi.mocked(performPowTask).mockResolvedValue({
    nonce: 1,
    chatBytesArray: new Uint8Array(4),
  });
  vi.mocked(signChatFunc).mockResolvedValue({ signature: 'CHAT_SIG' });
  vi.mocked(publishData).mockResolvedValue({ signature: 'PUBLISH_SIG' });
});

afterEach(() => {
  setAccount(null);
  store.set(appLockedAtom, false);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('a budget pays for new publishes', () => {
  it('publishes a new resource without the window, at the fee it counted', async () => {
    giveBudget(QORT);
    const fetchMock = stubNode();
    const { shown } = watchWindows();

    await expect(publishPost('post-1')).resolves.toEqual({
      signature: 'PUBLISH_SIG',
    });

    expect(shown).toHaveLength(0);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://127.0.0.1:12391/arbitrary/resource/status/BLOG_POST/Publisher/post-1'
    );
    expect(publishData).toHaveBeenCalledWith(
      expect.objectContaining({ feeAmount: FEE_ATOMIC })
    );
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
    expect(budget().recent[0]).toMatchObject({
      kind: 'publish',
      service: 'BLOG_POST',
      identifier: 'post-1',
    });
  });

  it('asks the node about the default resource when no identifier is given', async () => {
    giveBudget(QORT);
    const fetchMock = stubNode();
    watchWindows();
    await publishQDNResource(
      { service: 'BLOG_POST', data64: 'QQ==' },
      null,
      true,
      OPENED_APP
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://127.0.0.1:12391/arbitrary/resource/status/BLOG_POST/Publisher/default'
    );
  });

  it('asks, and leaves the budget alone, for a resource that exists', async () => {
    giveBudget(QORT);
    stubNode({ 'post-1': 'READY' });
    const { shown, answer } = watchWindows();

    const publishing = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    // The window says why the budget doesn't pay.
    expect(shown[0].payload.budget).toEqual({ state: 'replaces' });
    answer(0, { accepted: true });
    await publishing;

    // It pays the fee the window showed, and the budget isn't charged.
    expect(publishData).toHaveBeenCalledWith(
      expect.objectContaining({ feeAmount: FEE_ATOMIC })
    );
    expect(budget()).toMatchObject({ used: '0', actions: 0 });
  });

  it.each([
    ['fails', 'FAIL'],
    ['answers without a status', ''],
  ])(
    "asks when the node can't say whether the resource exists (it %s), and says nothing about the budget",
    async (_label, status) => {
      giveBudget(QORT);
      stubNode({ 'post-1': status });
      const { shown, answer } = watchWindows();
      const publishing = publishPost('post-1');
      await vi.waitFor(() => expect(shown).toHaveLength(1));
      expect(shown[0].payload.budget).toBeUndefined();
      answer(0, { accepted: false });
      await expect(publishing).rejects.toThrow(
        'question:message.generic.user_declined_request'
      );
      expect(publishData).not.toHaveBeenCalled();
    }
  );

  it('says nothing about a budget for an app without one, and leaves the node alone', async () => {
    const fetchMock = stubNode({ 'post-1': 'READY' });
    const { shown, answer } = watchWindows();
    const publishing = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    answer(0, { accepted: false });
    await expect(publishing).rejects.toThrow();
  });

  it("asks when the node's fee can't be read", async () => {
    giveBudget(QORT);
    stubNode();
    vi.mocked(getFee).mockResolvedValue({ timestamp: 1, fee: 'NaN' });
    const { shown, answer } = watchWindows();
    const publishing = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: false });
    await expect(publishing).rejects.toThrow();
    expect(budget().used).toBe('0');
  });

  it('asks for a publish with an app fee', async () => {
    giveBudget(QORT);
    stubNode();
    vi.mocked(resolveRecipient).mockResolvedValue({
      address: 'QrecipientAddress',
      name: null,
    } as any);
    const { shown, answer } = watchWindows();
    const publishing = publishPost('post-1', OPENED_APP, {
      appFee: '0.5',
      appFeeRecipient: 'QrecipientAddress',
    });
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.appFee).toBeDefined();
    // An app fee always asks; the window doesn't blame the resource.
    expect(shown[0].payload.budget).toBeUndefined();
    answer(0, { accepted: false });
    await expect(publishing).rejects.toThrow();
    expect(publishData).not.toHaveBeenCalled();
    expect(budget().used).toBe('0');
  });

  it('gives the fee back when the publish fails', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    watchWindows();
    vi.mocked(publishData).mockRejectedValueOnce(new Error('node said no'));
    await expect(publishPost('post-1')).rejects.toThrow('node said no');
    expect(budget()).toMatchObject({ used: '0', actions: 0 });
    // The 0.01 is there again for the next one.
    await expect(publishPost('post-2')).resolves.toEqual({
      signature: 'PUBLISH_SIG',
    });
    expect(budget().used).toBe('1000000');
  });

  it('asks for the second of two publishes of the same new resource at once', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown, answer } = watchWindows();
    const first = publishPost('post-1');
    const second = publishPost('post-1', SECOND_TAB);
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toEqual({ state: 'publishing' });
    answer(0, { accepted: false });
    await expect(first).resolves.toEqual({ signature: 'PUBLISH_SIG' });
    await expect(second).rejects.toThrow();
    expect(publishData).toHaveBeenCalledTimes(1);
    expect(budget().actions).toBe(1);
  });

  it('asks before publishing again what a budget published a moment ago', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    // The node may not list it yet.
    const again = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toEqual({ state: 'replaces' });
    answer(0, { accepted: false });
    await expect(again).rejects.toThrow();
    expect(publishData).toHaveBeenCalledTimes(1);
  });

  it('publishes several new resources without the window and counts each', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    await expect(
      publishMultipleQDNResources(
        { resources: [post('post-1'), post('post-2')] },
        null,
        true,
        OPENED_APP
      )
    ).resolves.toHaveLength(2);
    expect(shown).toHaveLength(0);
    expect(publishData).toHaveBeenCalledTimes(2);
    expect(budget()).toMatchObject({ used: '2000000', actions: 2 });
  });

  it('asks for several resources when one of them exists, and counts only those published', async () => {
    giveBudget(QORT);
    stubNode({ 'post-2': 'READY' });
    const { shown, answer } = watchWindows();
    const publishing = publishMultipleQDNResources(
      { resources: [post('post-1'), post('post-2')] },
      null,
      true,
      OPENED_APP
    );
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toEqual({ state: 'replaces' });
    answer(0, { accepted: true });
    await publishing;
    expect(publishData).toHaveBeenCalledTimes(2);
    expect(budget().actions).toBe(0);
  });

  it('gives back the fee of a resource that failed in a multi-publish', async () => {
    giveBudget(BigInt(2 * FEE_ATOMIC));
    stubNode();
    const { shown } = watchWindows();
    vi.mocked(publishData)
      .mockResolvedValueOnce({ signature: 'PUBLISH_SIG' })
      .mockRejectedValueOnce(new Error('node said no'));
    await publishMultipleQDNResources(
      { resources: [post('post-1'), post('post-2')] },
      null,
      true,
      OPENED_APP
    );
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
    // The failed one's 0.01 is free again.
    await publishPost('post-3');
    expect(shown).toHaveLength(0);
    expect(budget().used).toBe('2000000');
  });
});

describe('votes and chat messages', () => {
  it('votes without the window and counts the vote fee', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    await expect(
      voteOnPoll({ pollName: 'Poll-1', optionIndex: 1 }, true, OPENED_APP)
    ).resolves.toEqual({ signature: 'VOTE_SIG' });
    expect(shown).toHaveLength(0);
    expect(createTransaction).toHaveBeenCalledWith(
      9,
      expect.anything(),
      expect.objectContaining({ fee: FEE, rPollName: 'Poll-1' })
    );
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
    expect(budget().recent[0]).toMatchObject({ kind: 'vote', poll: 'Poll-1' });
  });

  it('gives the fee back when the vote fails', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown } = watchWindows();
    vi.mocked(processTransactionVersion2).mockResolvedValueOnce({
      message: 'rejected',
    });
    await expect(
      voteOnPoll({ pollName: 'Poll-1', optionIndex: 0 }, true, OPENED_APP)
    ).rejects.toThrow('rejected');
    expect(budget()).toMatchObject({ used: '0', actions: 0 });
    // The 0.01 is there again for the next vote.
    await voteOnPoll({ pollName: 'Poll-1', optionIndex: 0 }, true, OPENED_APP);
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
  });

  it('gives back the place under the limits of a chat message that failed', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    const chat = () =>
      sendChatMessage({ groupId: 7, message: 'hi' }, true, OPENED_APP);
    for (let i = 0; i < 19; i += 1) await chat();
    vi.mocked(signChatFunc).mockResolvedValueOnce({
      error: true,
      message: 'not sent',
    });
    await expect(chat()).rejects.toThrow('not sent');
    // 19 sent and one failed: the 20th of the minute still fits.
    await chat();
    expect(shown).toHaveLength(0);
    expect(budget().actions).toBe(20);
  });

  it('sends a chat message without the window, counting it toward the limits only', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    await expect(
      sendChatMessage({ groupId: 7, message: 'hello' }, true, OPENED_APP)
    ).resolves.toEqual({ signature: 'CHAT_SIG' });
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '0', actions: 1 });
    expect(budget().recent[0]).toMatchObject({ kind: 'chat', groupId: 7 });
  });
});

describe('a request the budget took is signed in its session by its own account, or not at all', () => {
  const ownKeys = { privateKey: keyPairBytes, publicKey: keyPairBytes };
  const otherKeys = { privateKey: otherKeyBytes, publicKey: otherKeyBytes };
  const CHANGED = 'question:message.error.account_changed';

  /** A promise the test settles. */
  function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  /**
   * Signing in stores the wallet (a logout removes it): either starts a new
   * signing session.
   */
  const signIn = async (address: string, keys: typeof ownKeys) => {
    await storeData('walletInfo', { address0: address });
    setAccount(address);
    vi.mocked(getSaveWallet).mockResolvedValue({ address0: address });
    vi.mocked(getKeyPair).mockResolvedValue(keys);
  };
  const switchAccount = () => signIn(OTHER_ACCOUNT, otherKeys);
  const signInAgain = () => signIn(ACCOUNT, ownKeys);

  /**
   * publishData as it works: it uploads (`whileUploading` runs then), reads
   * the key pair and signs.
   */
  const publishDataSigns = (
    whileUploading?: (call: number) => Promise<void> | void
  ) => {
    let calls = 0;
    vi.mocked(publishData).mockImplementation(async (options: any) => {
      calls += 1;
      await whileUploading?.(calls);
      const { publicKey } = await getKeyPair();
      options.beforeSigning?.(publicKey);
      return { signature: 'PUBLISH_SIG' };
    });
  };

  const vote = () =>
    voteOnPoll({ pollName: 'Poll-1', optionIndex: 1 }, true, OPENED_APP);

  it('stops a vote when the account changes while it waits for the wallet, and gives the budget back', async () => {
    // One vote's fee: a hold left behind would make the next vote ask.
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown } = watchWindows();
    const wallet = deferred<{ address0: string }>();
    vi.mocked(getSaveWallet).mockReturnValueOnce(wallet.promise);
    const voting = vote();
    await vi.waitFor(() => expect(getSaveWallet).toHaveBeenCalledTimes(1));
    await switchAccount();
    wallet.resolve({ address0: OTHER_ACCOUNT });

    await expect(voting).rejects.toThrow(CHANGED);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(processTransactionVersion2).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '0', actions: 0, recent: [] });
    expect(findAppBudget(OTHER_ACCOUNT, APP)).toBeNull();

    await signInAgain();
    await expect(vote()).resolves.toEqual({ signature: 'VOTE_SIG' });
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
  });

  it('stops a vote when the same account logged out and in again meanwhile', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown } = watchWindows();
    const wallet = deferred<{ address0: string }>();
    vi.mocked(getSaveWallet).mockReturnValueOnce(wallet.promise);
    const voting = vote();
    await vi.waitFor(() => expect(getSaveWallet).toHaveBeenCalledTimes(1));
    await signInAgain();
    wallet.resolve({ address0: ACCOUNT });

    // Its own keys, but taken before the logout: it isn't signed.
    await expect(voting).rejects.toThrow(CHANGED);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(budget()).toMatchObject({ used: '0', actions: 0 });

    await expect(vote()).resolves.toEqual({ signature: 'VOTE_SIG' });
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
  });

  it("stops a vote about to be signed with another account's key", async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    watchWindows();
    vi.mocked(getKeyPair).mockResolvedValueOnce(otherKeys);
    await expect(vote()).rejects.toThrow(CHANGED);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(budget()).toMatchObject({ used: '0', actions: 0 });
  });

  it('counts a vote that was being sent when the account changed', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    watchWindows();
    const sent = deferred<{ signature: string }>();
    vi.mocked(processTransactionVersion2).mockReturnValueOnce(sent.promise);
    const voting = vote();
    await vi.waitFor(() =>
      expect(processTransactionVersion2).toHaveBeenCalledTimes(1)
    );
    await switchAccount();
    sent.resolve({ signature: 'VOTE_SIG' });

    // Signed by its own account before the change: its fee was spent.
    await expect(voting).resolves.toEqual({ signature: 'VOTE_SIG' });
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
  });

  it("doesn't send a chat message once another account signed in", async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    // The account changes while the handler reads the balance.
    vi.mocked(getBalanceInfo).mockImplementationOnce(async () => {
      await switchAccount();
      return 100;
    });
    await expect(
      sendChatMessage({ groupId: 7, message: 'hi' }, true, OPENED_APP)
    ).rejects.toThrow(CHANGED);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(signChatFunc).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ actions: 0, recent: [] });
  });

  it("doesn't send a direct message once another account signed in", async () => {
    giveBudget(QORT);
    const node = stubNode();
    const recipientKey = Base58.encode(new Uint8Array(32).fill(3)) as string;
    const recipient = String(publicKeyToAddress(Base58.decode(recipientKey)));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/addresses/publickey/')
          ? new Response(recipientKey, {
              headers: { 'content-type': 'text/plain' },
            })
          : node(url)
      )
    );
    const { shown } = watchWindows();
    vi.mocked(getBalanceInfo).mockImplementationOnce(async () => {
      await switchAccount();
      return 100;
    });
    await expect(
      sendChatMessage({ recipient, message: 'hi' }, true, OPENED_APP)
    ).rejects.toThrow(CHANGED);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(signChatFunc).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ actions: 0, recent: [] });
  });

  it("doesn't sign a publish when another account signed in during the upload", async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown } = watchWindows();
    publishDataSigns(() => switchAccount());
    await expect(publishPost('post-1')).rejects.toThrow(CHANGED);
    expect(budget()).toMatchObject({ used: '0', actions: 0 });

    // Back as the first account: the same new resource can be paid for.
    await signInAgain();
    publishDataSigns();
    await expect(publishPost('post-1')).resolves.toEqual({
      signature: 'PUBLISH_SIG',
    });
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
  });

  it('stops the rest of a multi-publish once another account signed in, counting only what was signed', async () => {
    giveBudget(BigInt(3 * FEE_ATOMIC));
    stubNode();
    const { shown } = watchWindows();
    publishDataSigns(async (call) => {
      if (call === 2) await switchAccount();
    });
    const result: any = await publishMultipleQDNResources(
      { resources: [post('post-1'), post('post-2'), post('post-3')] },
      null,
      true,
      OPENED_APP
    );
    // The third isn't uploaded at all.
    expect(publishData).toHaveBeenCalledTimes(2);
    expect(result.error.unsuccessfulPublishes).toEqual([
      expect.objectContaining({ identifier: 'post-2', reason: CHANGED }),
      expect.objectContaining({ identifier: 'post-3', reason: CHANGED }),
    ]);
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });

    // What the other two held is free again.
    await signInAgain();
    publishDataSigns();
    await publishMultipleQDNResources(
      { resources: [post('post-4'), post('post-5')] },
      null,
      true,
      OPENED_APP
    );
    expect(shown).toHaveLength(0);
    expect(budget()).toMatchObject({ used: '3000000', actions: 3 });
  });

  it('still publishes what the user approved in the window', async () => {
    giveBudget(QORT);
    stubNode({ 'post-1': 'READY' });
    const { shown, answer } = watchWindows();
    publishDataSigns();
    const publishing = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: true });
    await expect(publishing).resolves.toEqual({ signature: 'PUBLISH_SIG' });
    expect(budget().actions).toBe(0);
  });

  it('asks for a publish when the account logged out and in while the node was asked about it', async () => {
    giveBudget(QORT);
    const fetchMock = stubNode();
    const { shown, answer } = watchWindows();
    const asNode = fetchMock.getMockImplementation();
    fetchMock.mockImplementationOnce(async (url: string) => {
      await signInAgain();
      return asNode(url);
    });
    const publishing = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: false });
    await expect(publishing).rejects.toThrow();
    expect(publishData).not.toHaveBeenCalled();
    expect(budget()).toMatchObject({ used: '0', actions: 0 });
  });

  it('asks for a vote that comes while the wallet is being changed', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown, answer } = watchWindows();
    const stored = deferred<{ value: boolean }>();
    vi.mocked(SecureStoragePlugin.set).mockReturnValueOnce(stored.promise);
    const changing = storeData('walletInfo', { address0: ACCOUNT });
    // Ends the change whatever happens, so the next test has a session.
    onTestFinished(async () => {
      stored.resolve({ value: true });
      await changing;
    });
    const voting = vote();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: false });
    await expect(voting).rejects.toThrow();
    expect(createTransaction).not.toHaveBeenCalled();
    expect(budget().actions).toBe(0);
  });
});

describe('who a budget is for', () => {
  const askedForPost = async (appInfo: Record<string, unknown>) => {
    const { shown, answer } = watchWindows();
    const publishing = publishPost('post-1', appInfo);
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: false });
    await expect(publishing).rejects.toThrow();
    expect(publishData).not.toHaveBeenCalled();
  };

  it("doesn't use another account's budget on the same PC", async () => {
    giveBudget(QORT, { address: OTHER_ACCOUNT });
    stubNode();
    await askedForPost(OPENED_APP);
    expect(findAppBudget(OTHER_ACCOUNT, APP).used).toBe('0');
  });

  it("doesn't use a website's budget for a Q-App of the same name", async () => {
    giveBudget(QORT, { app: SITE });
    stubNode();
    await askedForPost(OPENED_APP);
    expect(budget(SITE).used).toBe('0');
  });

  it('shares the budget between two tabs of the app', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    await publishPost('post-1', OPENED_APP);
    await publishPost('post-2', SECOND_TAB);
    expect(shown).toHaveLength(0);
    expect(budget().actions).toBe(2);
  });

  it("never uses a budget for Hub's own requests, a private app, a preview or Dev Mode", async () => {
    giveBudget(QORT);
    stubNode();
    await askedForPost(HUB_REQUEST);
    vi.clearAllMocks();
    // Even one that names an app.
    await askedForPost({ ...OPENED_APP, ...HUB_REQUEST });
    vi.clearAllMocks();
    await askedForPost({ ...OPENED_APP, isPrivate: true });
    vi.clearAllMocks();
    await askedForPost({ ...OPENED_APP, isPreview: true });
    vi.clearAllMocks();
    await askedForPost({ ...OPENED_APP, isDevMode: true });
    expect(budget().used).toBe('0');
  });

  it("doesn't use a budget while Hub is locked", async () => {
    giveBudget(QORT);
    stubNode();
    store.set(appLockedAtom, true);
    // The request goes to the window, which a locked Hub declines.
    await askedForPost(OPENED_APP);
    expect(budget().used).toBe('0');
  });

  it('still asks for a payment', async () => {
    giveBudget(QORT);
    stubNode();
    vi.mocked(resolveRecipient).mockResolvedValue({
      address: 'QrecipientAddress',
      name: null,
    } as any);
    vi.mocked(sendQortFee).mockResolvedValue(FEE);
    const { shown, answer } = watchWindows();
    const paying = sendCoin(
      { coin: 'QORT', amount: '0.01', recipient: 'QrecipientAddress' },
      true,
      OPENED_APP
    );
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toBeUndefined();
    answer(0, { accepted: false });
    await expect(paying).rejects.toThrow();
    expect(sendCoinFunc).not.toHaveBeenCalled();
    expect(budget().used).toBe('0');
  });
});

describe('when the budget is used up, ended or at its limit', () => {
  const topUp = {
    amount: '1',
    end: { kind: 'month' },
    limits: 'standard',
  };

  it('lets only one of two requests take the last 0.01; the other offers a refill', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    const first = publishPost('post-1');
    const second = publishPost('post-2', SECOND_TAB);
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toMatchObject({
      state: 'used_up',
      used: '0',
      total: '0.01',
      fee: '0.01',
      count: 1,
    });
    answer(0, { accepted: false });
    await expect(first).resolves.toEqual({ signature: 'PUBLISH_SIG' });
    await expect(second).rejects.toThrow();
    expect(publishData).toHaveBeenCalledTimes(1);
    expect(budget()).toMatchObject({ used: '1000000', total: '1000000' });
  });

  it('publishes nothing and leaves the budget as it was when the refill is declined', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    const second = publishPost('post-2');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: false });
    await expect(second).rejects.toThrow();
    expect(publishData).toHaveBeenCalledTimes(1);
    expect(budget()).toMatchObject({ used: '1000000', total: '1000000' });
  });

  it('approves just this one without touching the budget', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    const second = publishPost('post-2');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: true });
    await second;
    expect(publishData).toHaveBeenCalledTimes(2);
    expect(budget()).toMatchObject({
      used: '1000000',
      total: '1000000',
      actions: 1,
    });
  });

  it('tops up and approves, and a request waiting behind it uses the new budget without a window', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    const second = publishPost('post-2');
    const third = publishPost('post-3', SECOND_TAB);
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: true, budgetTopUp: topUp });
    await expect(second).resolves.toEqual({ signature: 'PUBLISH_SIG' });
    await expect(third).resolves.toEqual({ signature: 'PUBLISH_SIG' });
    expect(shown).toHaveLength(1);
    expect(budget()).toMatchObject({
      total: '101000000',
      used: '3000000',
      actions: 3,
    });
  });

  it('checks the top-up the window sends: an amount out of range only approves this one', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    const second = publishPost('post-2');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: true, budgetTopUp: { ...topUp, amount: '5000' } });
    await second;
    expect(budget()).toMatchObject({ total: '1000000', actions: 1 });
  });

  it('says when a budget ended while Hub was running, and renews it on top up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    giveBudget(QORT, { expiresAt: start + DAY });
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    expect(shown).toHaveLength(0);

    vi.setSystemTime(start + DAY);
    const later = publishPost('post-2');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toMatchObject({
      state: 'ended',
      endedAt: start + DAY,
    });
    answer(0, { accepted: true, budgetTopUp: topUp });
    await later;
    // 0.99 were left when it ended; the new month has 1 QORT, less this one.
    const renewed = budget();
    expect(BigInt(renewed.total) - BigInt(renewed.used)).toBe(
      QORT - BigInt(FEE_ATOMIC)
    );
    expect(renewed.expiresAt).toBeGreaterThan(start + DAY);
  });

  it('shows a request that waited the budget as it is when its window opens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    // It ends in 5 s: well within the minute a waiting request has.
    giveBudget(BigInt(FEE_ATOMIC), { expiresAt: start + 5000 });
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    const second = publishPost('post-2');
    const third = publishPost('post-3', SECOND_TAB);
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget.state).toBe('used_up');
    // The budget ends while the first window is open.
    vi.setSystemTime(start + 5000);
    answer(0, { accepted: false });
    await expect(second).rejects.toThrow();
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1].payload.budget).toMatchObject({
      state: 'ended',
      endedAt: start + 5000,
    });
    answer(1, { accepted: false });
    await expect(third).rejects.toThrow();
  });

  it('says when the app reached its limit, and approving one is not counted', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown, answer } = watchWindows();
    for (let i = 0; i < 20; i += 1) {
      await sendChatMessage({ groupId: 7, message: 'hi' }, true, OPENED_APP);
    }
    expect(shown).toHaveLength(0);
    const twentyFirst = sendChatMessage(
      { groupId: 7, message: 'hi' },
      true,
      OPENED_APP
    );
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toMatchObject({
      state: 'limit',
      limit: { per: 'minute', max: 20 },
    });
    answer(0, { accepted: true });
    await twentyFirst;
    expect(budget().actions).toBe(20);
  });
});

describe('what a budget never pays for, new or not', () => {
  /** Whether `request` opened the window (then declined). */
  const asksFor = async (request: () => Promise<unknown>) => {
    giveBudget(QORT);
    stubNode();
    const { shown, answer } = watchWindows();
    const pending = request();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const asked = shown.length;
    // Always asked for its own sake: nothing about what it would replace.
    if (asked) expect(shown[0].payload.budget).toBeUndefined();
    if (asked) answer(0, { accepted: false });
    await Promise.allSettled([pending]);
    return asked;
  };

  it.each([
    [
      "the account's avatar",
      { service: 'THUMBNAIL', identifier: 'qortal_avatar' },
    ],
    [
      "Hub's own settings",
      {
        service: 'DOCUMENT_PRIVATE',
        identifier: 'ext_saved_settings',
        encrypt: true,
        publicKeys: ['own-public-key'],
      },
    ],
    ['a Q-App under the account name', { service: 'APP' }],
    ['a website under the account name', { service: 'WEBSITE' }],
    [
      "a page of Hub's library",
      { service: 'JSON', identifier: 'qhub_app_page_v1_APP' },
    ],
    [
      'a group key',
      {
        service: 'DOCUMENT_PRIVATE',
        identifier: 'admins-symmetric-qchat-group-7',
        encrypt: true,
        publicKeys: ['k'],
      },
    ],
  ])('asks before publishing %s', async (_label, fields) => {
    await expect(
      asksFor(() =>
        publishQDNResource(
          { data64: 'QQ==', ...fields },
          null,
          true,
          OPENED_APP
        )
      )
    ).resolves.toBe(1);
    expect(budget().used).toBe('0');
  });

  it("asks before voting on a rating in Hub's library", async () => {
    await expect(
      asksFor(() =>
        voteOnPoll(
          { pollName: 'app-library-APP-rating-Other-App', optionIndex: 0 },
          true,
          OPENED_APP
        )
      )
    ).resolves.toBe(1);
  });
});

describe('a publish and what happened while it waited', () => {
  const chat = () =>
    sendChatMessage({ groupId: 7, message: 'hi' }, true, OPENED_APP);
  const publishesOf = (identifier: string) =>
    vi
      .mocked(publishData)
      .mock.calls.filter(
        ([args]) => decodeURIComponent((args as any).identifier) === identifier
      ).length;

  beforeEach(() => {
    // A publish is on the node as soon as it is done.
    vi.mocked(publishData).mockImplementation(async (args: any) => {
      onNode.add(decodeURIComponent(args.identifier));
      return { signature: 'PUBLISH_SIG' };
    });
  });

  it('asks before replacing what was published while it waited, when the limit eased', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    giveBudget(QORT, { now: start });
    stubNode();
    const { shown, answer } = watchWindows();
    for (let i = 0; i < 20; i += 1) await chat();
    // Half a minute later post-1 twice (two tabs): the first asks (the
    // limit), the second waits behind it.
    vi.setSystemTime(start + 30_000);
    const first = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    const second = publishPost('post-1', SECOND_TAB);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Approved once the minute is over: post-1 is published.
    vi.setSystemTime(start + 61_000);
    answer(0, { accepted: true });
    await first;
    // The one that waited would replace it: it asks.
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1].payload.budget).toEqual({ state: 'replaces' });
    answer(1, { accepted: false });
    await expect(second).rejects.toThrow();
    expect(publishesOf('post-1')).toBe(1);
  });

  it('asks before replacing what was approved in the window while it waited behind a top-up', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-0');
    const first = publishPost('post-1');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    const vote = voteOnPoll(
      { pollName: 'Poll-1', optionIndex: 0 },
      true,
      OPENED_APP
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = publishPost('post-1', SECOND_TAB);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // "Approve this one only", then "Top up and approve" on the vote.
    answer(0, { accepted: true });
    await first;
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    answer(1, {
      accepted: true,
      budgetTopUp: { amount: '1', end: { kind: 'month' }, limits: 'standard' },
    });
    await vote;
    await vi.waitFor(() => expect(shown).toHaveLength(3));
    expect(shown[2].payload.budget).toEqual({ state: 'replaces' });
    answer(2, { accepted: false });
    await expect(second).rejects.toThrow();
    expect(publishesOf('post-1')).toBe(1);
  });

  it('asks the node again for a publish that waited: published elsewhere meanwhile, it asks', async () => {
    giveBudget(BigInt(FEE_ATOMIC));
    stubNode();
    const { shown, answer } = watchWindows();
    // The budget's last 0.01 goes to post-0.
    await publishPost('post-0');
    // Used up: post-a opens the refill window and post-1 waits behind it.
    const first = publishPost('post-a');
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    const second = publishPost('post-1', SECOND_TAB);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Meanwhile post-1 comes from another device.
    onNode.add('post-1');
    answer(0, {
      accepted: true,
      budgetTopUp: { amount: '1', end: { kind: 'month' }, limits: 'standard' },
    });
    await first;
    // The refilled budget doesn't replace it: post-1 asks, and says why.
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1].payload.budget).toEqual({ state: 'replaces' });
    answer(1, { accepted: false });
    await expect(second).rejects.toThrow();
    expect(publishesOf('post-1')).toBe(0);
  });

  it('still says why when a publish of something that exists waited behind another window', async () => {
    giveBudget(QORT);
    stubNode({ 'post-1': 'READY' });
    vi.mocked(resolveRecipient).mockResolvedValue({
      address: 'QrecipientAddress',
      name: null,
    } as any);
    const { shown, answer } = watchWindows();
    // An app fee makes the first one ask; post-1 waits behind it.
    const first = publishPost('post-0', OPENED_APP, {
      appFee: '0.5',
      appFeeRecipient: 'QrecipientAddress',
    });
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    const second = publishPost('post-1', SECOND_TAB);
    await new Promise((resolve) => setTimeout(resolve, 50));
    answer(0, { accepted: false });
    await expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1].payload.budget).toEqual({ state: 'replaces' });
    answer(1, { accepted: false });
    await expect(second).rejects.toThrow();
    expect(publishData).not.toHaveBeenCalled();
  });

  it('asks before publishing again what is being published after the window', async () => {
    giveBudget(QORT);
    stubNode({ 'post-1': 'NOT_PUBLISHED' });
    const { shown, answer } = watchWindows();
    let finishUpload: () => void = () => {};
    vi.mocked(publishData).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve({ signature: 'PUBLISH_SIG' });
        })
    );
    // An app fee makes the first one ask; it is approved and still uploads.
    vi.mocked(resolveRecipient).mockResolvedValue({
      address: 'QrecipientAddress',
      name: null,
    } as any);
    const first = publishPost('post-1', OPENED_APP, {
      appFee: '0.5',
      appFeeRecipient: 'QrecipientAddress',
    });
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    answer(0, { accepted: true });
    await vi.waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    // The node doesn't list it yet; the budget still mustn't publish it.
    const second = publishPost('post-1', SECOND_TAB);
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1].payload.budget).toEqual({ state: 'publishing' });
    answer(1, { accepted: false });
    await expect(second).rejects.toThrow();
    finishUpload();
    await first;
    expect(publishData).toHaveBeenCalledTimes(1);
  });

  it("doesn't charge a publish under way to a budget added after its own was removed", async () => {
    giveBudget(QORT);
    stubNode();
    const { shown } = watchWindows();
    let finishUpload: () => void = () => {};
    vi.mocked(publishData).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve({ signature: 'PUBLISH_SIG' });
        })
    );
    const slow = publishPost('big-1');
    await vi.waitFor(() => expect(publishData).toHaveBeenCalledTimes(1));
    expect(removeAppBudget(ACCOUNT, APP)).toBe(true);
    giveBudget(BigInt(FEE_ATOMIC));
    // The new budget pays its own one post.
    await publishPost('post-2');
    expect(shown).toHaveLength(0);
    finishUpload();
    await slow;
    expect(budget()).toMatchObject({ used: '1000000', actions: 1 });
    expect(budget().recent.map((action) => action.identifier)).toEqual([
      'post-2',
    ]);
  });

  it('asks for a chat message once the budget shows as used up', async () => {
    // 0.015 QORT: one post leaves 0.005, less than the next fee.
    giveBudget(BigInt(1500000));
    stubNode();
    const { shown, answer } = watchWindows();
    await publishPost('post-1');
    expect(budgetState(budget(), Date.now())).toBe('used_up');
    const message = chat();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toMatchObject({ state: 'used_up' });
    answer(0, { accepted: false });
    await expect(message).rejects.toThrow();
  });

  it('asks for more resources at once than the limits allow, without a limit note', async () => {
    giveBudget(QORT);
    stubNode();
    const { shown, answer } = watchWindows();
    const resources = Array.from({ length: 21 }, (_, i) => post(`p-${i}`));
    const publishing = publishMultipleQDNResources(
      { resources },
      null,
      true,
      OPENED_APP
    );
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].payload.budget).toBeUndefined();
    answer(0, { accepted: false });
    await expect(publishing).rejects.toThrow();
  });

  it('shows a renewed budget that a waiting vote can no longer use as used up, not ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    giveBudget(QORT, { now: start, expiresAt: start + 5000 });
    stubNode();
    vi.setSystemTime(start + 5000);
    const { shown, answer } = watchWindows();
    const vote = () =>
      voteOnPoll({ pollName: 'Poll-1', optionIndex: 0 }, true, OPENED_APP);
    const first = vote();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    const second = vote();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown[0].payload.budget).toMatchObject({ state: 'ended' });
    answer(0, {
      accepted: true,
      budgetTopUp: {
        amount: '0.01',
        end: { kind: 'month' },
        limits: 'standard',
      },
    });
    await first;
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1].payload.budget).toMatchObject({ state: 'used_up' });
    answer(1, { accepted: false });
    await expect(second).rejects.toThrow();
  });
});
