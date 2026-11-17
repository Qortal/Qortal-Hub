import {
  TIME_HOURS_1_IN_MILLISECONDS,
  TIME_MINUTES_1_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_MINUTES_30_IN_MILLISECONDS,
  TIME_SECONDS_30_IN_MILLISECONDS,
} from '../constants/constants';

/**
 * How long Hub waits for the answer to a Q-App request before it tells the
 * app that the request timed out.
 *
 * A request that can change something may first wait for the user's approval,
 * for up to the approval dialog's minute, and then do its work. If Hub gave up
 * sooner, an Accept would still carry the request out, a payment for example,
 * after the app had been told it timed out.
 */

/** Requests that can change something: an approval plus the work after it. */
export const QAPP_ACTION_REQUEST_TIMEOUT_MS =
  5 * TIME_MINUTES_1_IN_MILLISECONDS;

/**
 * Read-only requests. Hub gives identical ones in flight the same answer, so
 * a read that hangs must not hold its retries back for long.
 */
export const QAPP_READ_REQUEST_TIMEOUT_MS = TIME_SECONDS_30_IN_MILLISECONDS;

/** The longest wait a timer can hold. A longer one would run out at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Read-only requests that ask the user in the approval dialog before they
 * answer. They wait at least as long as a request that can change something.
 */
const READS_THAT_ASK_THE_USER = new Set([
  'GET_HOSTED_DATA',
  'GET_LIST_ITEMS',
  'GET_USER_ACCOUNT',
  'GET_USER_WALLET',
  'GET_USER_WALLET_INFO',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_WALLET_BALANCE',
]);

/**
 * How long the app's own qortalRequest waits by default, where Core's
 * q-apps.js (getDefaultTimeout) gives an action more than 30 s. Hub never
 * gives up before the app does.
 */
const APP_DEFAULT_TIMEOUT_MS = new Map<string, number>([
  ['GET_USER_ACCOUNT', TIME_HOURS_1_IN_MILLISECONDS],
  ['SAVE_FILE', TIME_HOURS_1_IN_MILLISECONDS],
  ['SIGN_TRANSACTION', TIME_HOURS_1_IN_MILLISECONDS],
  ['DECRYPT_DATA', TIME_HOURS_1_IN_MILLISECONDS],
  ['PUBLISH_QDN_RESOURCE', TIME_HOURS_1_IN_MILLISECONDS],
  ['PUBLISH_MULTIPLE_QDN_RESOURCES', TIME_HOURS_1_IN_MILLISECONDS],
  ['FETCH_QDN_RESOURCE', TIME_MINUTES_1_IN_MILLISECONDS],
  ['SEND_CHAT_MESSAGE', TIME_MINUTES_1_IN_MILLISECONDS],
  ['GET_WALLET_BALANCE', TIME_MINUTES_2_IN_MILLISECONDS],
  ['CREATE_TRADE_BUY_ORDER', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['CREATE_TRADE_SELL_ORDER', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['CANCEL_TRADE_SELL_ORDER', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['VOTE_ON_POLL', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['CREATE_POLL', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['JOIN_GROUP', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['DEPLOY_AT', QAPP_ACTION_REQUEST_TIMEOUT_MS],
  ['SEND_COIN', QAPP_ACTION_REQUEST_TIMEOUT_MS],
]);

/**
 * `readOnly`: the request only reads (Hub's de-duplicated requests). Anything
 * else may wait for an approval and change something. A read that asks the
 * user first gets the same time.
 */
export function qappRequestTimeoutMs(
  action: unknown,
  payload: unknown,
  readOnly: boolean
): number {
  const resources =
    payload && typeof payload === 'object'
      ? (payload as { resources?: unknown }).resources
      : undefined;
  // A batch of publishes gets time for each of its resources.
  const batchMs =
    action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' && Array.isArray(resources)
      ? resources.length * TIME_MINUTES_30_IN_MILLISECONDS
      : 0;
  const onlyReads =
    readOnly &&
    !(typeof action === 'string' && READS_THAT_ASK_THE_USER.has(action));
  return Math.min(
    LONGEST_TIMER_MS,
    Math.max(
      onlyReads ? QAPP_READ_REQUEST_TIMEOUT_MS : QAPP_ACTION_REQUEST_TIMEOUT_MS,
      typeof action === 'string'
        ? (APP_DEFAULT_TIMEOUT_MS.get(action) ?? 0)
        : 0,
      batchMs
    )
  );
}
