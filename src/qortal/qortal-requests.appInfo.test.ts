import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every Q-App action whose handler can open the approval dialog hands that
// handler the request's tab (appInfo), so the dialog can name the app.

vi.mock('./get', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const source = readFileSync(resolve(__dirname, 'qortal-requests.ts'), 'utf8');
  // Anchor on the import that ends at `./get.ts`, not on the first `import {`
  // after `qapp-file-reference`. A second single-line import was added between
  // the two, so the old start position landed mid-statement: the first parsed
  // name came out as `isPdfReaderPayload } from './pdf-reader';\nimport {\n  addForeignServer`,
  // and `addForeignServer` was absorbed into it. That name then had no mock, so
  // the ADD_FOREIGN_SERVER handler threw before calling anything, while
  // removeForeignServer survived as its own entry. Taking the last `import {`
  // before the closing line keeps this working however many imports are added
  // above it.
  const importEnd = source.indexOf("} from './get.ts'");
  const block = source.slice(
    source.lastIndexOf('import {', importEnd),
    importEnd
  );
  const names = block
    .replace('import {', '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return Object.fromEntries(
    names.map((name) => [name, vi.fn(async () => true)])
  );
});
vi.mock('../background/background', async () =>
  (await import('./__tests__/common')).backgroundFactory()
);
vi.mock('../hooks/useQortalMessageListener', async () =>
  (await import('./__tests__/common')).messageListenerFactory()
);
vi.mock('../subscriptions/useInitializeMySubscriptions', () => ({
  triggerMemberGroupsFetch: vi.fn(),
}));
vi.mock('../utils/chromeStorage', () => ({
  getData: vi.fn(),
  storeData: vi.fn(),
}));
vi.mock('../utils/events', async () =>
  (await import('./__tests__/common')).eventsFactory()
);
vi.mock('i18next', async () =>
  (await import('./__tests__/common')).i18nFactory()
);
vi.mock('../i18n/i18n', async () =>
  (await import('./__tests__/common')).i18nFactory()
);

import * as get from './get';
import './qortal-requests';

const ASKING_ACTIONS = [
  'GET_USER_ACCOUNT',
  'SESSION_PERMISSIONS',
  'GET_HOSTED_DATA',
  'DELETE_HOSTED_DATA',
  'GET_LIST_ITEMS',
  'ADD_LIST_ITEMS',
  'DELETE_LIST_ITEM',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'SEND_CHAT_MESSAGE',
  'JOIN_GROUP',
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'GET_USER_WALLET_INFO',
  'GET_USER_WALLET_TRANSACTIONS',
  'UPDATE_FOREIGN_FEE',
  'SET_CURRENT_FOREIGN_SERVER',
  'ADD_FOREIGN_SERVER',
  'REMOVE_FOREIGN_SERVER',
  'SEND_COIN',
  'CREATE_TRADE_BUY_ORDER',
  'CREATE_TRADE_SELL_ORDER',
  'CANCEL_TRADE_SELL_ORDER',
  'LOCK_TAB',
  'ADMIN_ACTION',
  'SIGN_TRANSACTION',
  'REGISTER_NAME',
  'UPDATE_NAME',
  'LEAVE_GROUP',
  'INVITE_TO_GROUP',
  'KICK_FROM_GROUP',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'CANCEL_GROUP_INVITE',
  'CREATE_GROUP',
  'UPDATE_GROUP',
  'SELL_NAME',
  'CANCEL_SELL_NAME',
  'BUY_NAME',
  'SIGN_FOREIGN_FEES',
  'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA',
  'TRANSFER_ASSET',
  'REENCRYPT_GROUP_KEYS',
  'VOTE_ON_POLL',
  'CREATE_POLL',
  'DEPLOY_AT',
];

const appInfo = { name: 'Opened-App', service: 'APP', tabId: 'tab-1' };
let answers: any[];

beforeEach(() => {
  vi.clearAllMocks();
  answers = [];
  vi.spyOn(window, 'postMessage').mockImplementation((data: any) => {
    if (data?.type === 'backgroundMessageResponse') answers.push(data);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('qortal-requests hands each asking handler the request’s tab', () => {
  it.each(ASKING_ACTIONS)('%s', async (action) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'backgroundMessage',
          action,
          requestId: `${action}-1`,
          payload: { resources: [], identifier: 'x', groupId: 1 },
          isExtension: true,
          appInfo,
        },
        origin: window.location.origin,
        source: window,
      })
    );
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    const calls = Object.values(get)
      .filter((fn) => vi.isMockFunction(fn))
      .flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls);
    expect(calls.length).toBeGreaterThan(0);
    const passed = calls.some((args) =>
      args.some(
        (arg) =>
          arg === appInfo ||
          (arg && typeof arg === 'object' && arg.appInfo === appInfo)
      )
    );
    expect(passed).toBe(true);
  });
});
