/**
 * The "always allow" boxes of the approval window, as an account ticked them:
 * read back from the keys `get.ts` stores them under, so the budget panel can
 * list them and turn them off.
 */

export type AlwaysAllowKind =
  | 'sign_in'
  | 'chat'
  | 'wallet'
  | 'balance'
  | 'wallet_info'
  | 'transactions'
  | 'lists';

export type AlwaysAllowChoice = {
  kind: AlwaysAllowKind;
  /** The key it is stored under, for turning it off. */
  key: string;
  /** The app it was given to; null for one that covers every app. */
  app: string | null;
  /** For the wallet look-ups: the coin. */
  coin: string | null;
};

/** In the order the panel lists them. */
export const ALWAYS_ALLOW_KINDS: AlwaysAllowKind[] = [
  'sign_in',
  'chat',
  'wallet',
  'balance',
  'wallet_info',
  'transactions',
  'lists',
];

// The lists box names no app: it lets every app read the node's lists.
const LISTS_KEY = 'qAPPAutoLists';

/**
 * What a box also stands for in a tab: its use (a sign-in above all) gives
 * the tab this session permission, which would let the next request through
 * after the box is turned off.
 */
export const SESSION_TWIN: Record<AlwaysAllowKind, string | null> = {
  sign_in: 'GET_USER_ACCOUNT',
  chat: null,
  wallet: 'GET_USER_WALLET',
  balance: 'GET_WALLET_BALANCE',
  wallet_info: 'GET_USER_WALLET_INFO',
  transactions: 'GET_USER_WALLET_TRANSACTIONS',
  lists: 'GET_LIST_ITEMS',
};

/**
 * Session permissions no request reads. An app's SESSION_PERMISSIONS request
 * can give a tab any of VALID_SESSION_PERMISSIONS, but the group actions ask
 * with or without them, and GET_SERVER_CONNECTION_HISTORY never asks: holding
 * them lets nothing through, so the panel leaves them out.
 */
export const SESSION_PERMISSIONS_NOT_READ = new Set([
  'ADD_GROUP_ADMIN',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'CREATE_GROUP',
  'GET_SERVER_CONNECTION_HISTORY',
  'INVITE_TO_GROUP',
  'KICK_FROM_GROUP',
  'REMOVE_GROUP_ADMIN',
]);

/**
 * Session permissions without which the request is refused instead of asked:
 * START_CROSSCHAIN_SERVER stands for the sign-in's session. Taken back, the
 * app can't do it in that tab until it is allowed again or the tab closes.
 */
export const SESSION_PERMISSIONS_REFUSED_WITHOUT = new Set([
  'START_CROSSCHAIN_SERVER',
]);

// A coin as wallets name it. The key keeps whatever the app sent, so
// anything else can't be told apart from the app's name.
const COIN = /^[A-Za-z0-9]{2,10}$/;

const PREFIXES: { kind: AlwaysAllowKind; prefix: string; perCoin: boolean }[] =
  [
    { kind: 'sign_in', prefix: 'qAPPAutoAuth-', perCoin: false },
    { kind: 'chat', prefix: 'qAPPSendChatMessage-', perCoin: false },
    { kind: 'wallet', prefix: 'qAPPAutoGetUserWallet-', perCoin: true },
    { kind: 'balance', prefix: 'qAPPAutoWalletBalance-', perCoin: true },
    { kind: 'wallet_info', prefix: 'getUserWalletInfo-', perCoin: true },
    {
      kind: 'transactions',
      prefix: 'getUserWalletTransactions-',
      perCoin: true,
    },
  ];

/**
 * What a stored key allows, or null for a key that isn't one of the boxes.
 * A name may hold dashes; the coin is what follows the last one, and must
 * look like a coin.
 */
export function alwaysAllowChoiceOf(key: unknown): AlwaysAllowChoice | null {
  if (typeof key !== 'string') return null;
  if (key === LISTS_KEY) return { kind: 'lists', key, app: null, coin: null };
  for (const { kind, prefix, perCoin } of PREFIXES) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!perCoin) return rest ? { kind, key, app: rest, coin: null } : null;
    const dash = rest.lastIndexOf('-');
    if (dash <= 0 || !COIN.test(rest.slice(dash + 1))) return null;
    return { kind, key, app: rest.slice(0, dash), coin: rest.slice(dash + 1) };
  }
  return null;
}

/** A box as stored: ticked (`on`) or turned off. */
export type StoredChoice = AlwaysAllowChoice & { on: boolean };

/**
 * The boxes stored for an account, ticked or turned off, in the panel's
 * order. Only a tick or a Turn off is stored, so an `off` one was turned off.
 */
export function storedChoices(
  entries: { key: string; value: unknown }[]
): StoredChoice[] {
  return entries
    .filter((entry) => typeof entry.value === 'boolean')
    .map((entry) => {
      const choice = alwaysAllowChoiceOf(entry.key);
      return choice ? { ...choice, on: entry.value === true } : null;
    })
    .filter((choice): choice is StoredChoice => !!choice)
    .sort(
      (a, b) =>
        (a.app ?? '').localeCompare(b.app ?? '') ||
        ALWAYS_ALLOW_KINDS.indexOf(a.kind) -
          ALWAYS_ALLOW_KINDS.indexOf(b.kind) ||
        (a.coin ?? '').localeCompare(b.coin ?? '')
    );
}

/** Names are one name whatever their case. */
export const isChoiceForApp = (choice: AlwaysAllowChoice, name: string) =>
  choice.app !== null && choice.app.toLowerCase() === name.toLowerCase();
