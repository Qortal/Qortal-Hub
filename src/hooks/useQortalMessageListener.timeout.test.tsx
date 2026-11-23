import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeListener = (event: {
  data: unknown;
  ports: { postMessage: (reply: unknown) => void }[];
}) => Promise<void>;

let bridgeListener: BridgeListener | null = null;

vi.mock('../qortal/qapp-guest-request-bridge', () => ({
  attachQAppRequestBridge: vi.fn(
    (_view: unknown, _documentId: string, listener: BridgeListener) => {
      bridgeListener = listener;
      return () => {
        bridgeListener = null;
      };
    }
  ),
}));
vi.mock('../qortal/get', () => ({ saveFile: vi.fn() }));

// Installs window.sendMessage, the bridge to Hub's request handlers.
import '../messaging/MessagesToBackground';
import { useQortalMessageListener } from './useQortalMessageListener';

const SECOND = 1000;

/** Hub's request handlers: they answer each request after `delayMs`. */
const answerRequestsAfter = (delayMs: number) =>
  vi.spyOn(window, 'postMessage').mockImplementation((message) => {
    if (message?.type !== 'backgroundMessage') return;
    setTimeout(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: window,
          data: {
            type: 'backgroundMessageResponse',
            requestId: message.requestId,
            payload: { answered: message.action },
          },
        })
      );
    }, delayMs);
  });

/** Sends one request from the Q-App in the tab, returns what the app gets. */
const askFromApp = (request: Record<string, unknown>) => {
  const replies: unknown[] = [];
  void bridgeListener?.({
    data: { ...request, requestedHandler: 'UI' },
    ports: [{ postMessage: (reply) => replies.push(reply) }],
  });
  return replies;
};

describe('a Q-App request that waits for the user', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() =>
      useQortalMessageListener(
        1,
        false,
        'Example',
        'APP',
        '',
        { current: {} },
        true,
        'document-1'
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('gets the answer to a payment approved after 45 s', async () => {
    answerRequestsAfter(45 * SECOND);
    const replies = askFromApp({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient: 'QExampleRecipient',
      amount: 1,
    });

    await vi.advanceTimersByTimeAsync(45 * SECOND);

    expect(replies).toEqual([
      { result: { answered: 'SEND_COIN' }, error: null },
    ]);
  });

  it('gets the answer to a sign-in approved after 45 s', async () => {
    answerRequestsAfter(45 * SECOND);
    const replies = askFromApp({ action: 'GET_USER_ACCOUNT' });

    await vi.advanceTimersByTimeAsync(45 * SECOND);

    expect(replies).toEqual([
      { result: { answered: 'GET_USER_ACCOUNT' }, error: null },
    ]);
  });

  it('still tells the app after 30 s that a read did not come back', async () => {
    answerRequestsAfter(45 * SECOND);
    const replies = askFromApp({ action: 'GET_NODE_STATUS' });

    await vi.advanceTimersByTimeAsync(30 * SECOND);

    expect(replies).toHaveLength(1);
    expect(JSON.stringify(replies[0])).toContain('timed out');
  });

  // 30 min for each resource is more than a timer can hold from 1,194
  // resources on: a longer wait runs out at once.
  it('gets the answer to a batch of 1,200 publishes approved after 45 s', async () => {
    answerRequestsAfter(45 * SECOND);
    const replies = askFromApp({
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resources: Array.from({ length: 1200 }, () => ({})),
    });

    await vi.advanceTimersByTimeAsync(45 * SECOND);

    expect(replies).toEqual([
      { result: { answered: 'PUBLISH_MULTIPLE_QDN_RESOURCES' }, error: null },
    ]);
  });

  // Reads that Hub shares between identical requests, and that ask the user
  // in the approval dialog before they answer.
  describe('a read that asks the user first', () => {
    it.each([
      ['GET_USER_WALLET', { coin: 'LTC' }],
      ['GET_USER_WALLET_INFO', { coin: 'LTC' }],
      ['GET_USER_WALLET_TRANSACTIONS', { coin: 'LTC' }],
      ['GET_LIST_ITEMS', { list_name: 'blockedNames' }],
      ['GET_HOSTED_DATA', {}],
    ])('gets the answer to %s approved after 45 s', async (action, payload) => {
      answerRequestsAfter(45 * SECOND);
      const replies = askFromApp({ action, ...payload });

      await vi.advanceTimersByTimeAsync(45 * SECOND);

      expect(replies).toEqual([{ result: { answered: action }, error: null }]);
    });

    // The app's own qortalRequest gives the balance alone two minutes.
    it('gets the answer to a balance that took 75 s after an approval at 50 s', async () => {
      answerRequestsAfter(125 * SECOND);
      const replies = askFromApp({
        action: 'GET_WALLET_BALANCE',
        coin: 'BTC',
      });

      await vi.advanceTimersByTimeAsync(125 * SECOND);

      expect(replies).toEqual([
        { result: { answered: 'GET_WALLET_BALANCE' }, error: null },
      ]);
    });
  });

  // Hub stops waiting after 5 minutes, yet the payment may still go through.
  it('tells the app Hub cannot say whether a QORT payment went through when it stopped waiting', async () => {
    answerRequestsAfter(6 * 60 * SECOND);
    const replies = askFromApp({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient: 'QExampleRecipient',
      amount: 1,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * SECOND + SECOND);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      result: null,
      error: {
        error: 'PAYMENT_OUTCOME_UNKNOWN',
        code: 'PAYMENT_OUTCOME_UNKNOWN',
      },
    });
  });

  it('still tells the app that another request timed out', async () => {
    answerRequestsAfter(6 * 60 * SECOND);
    const replies = askFromApp({
      action: 'SEND_COIN',
      coin: 'LTC',
      recipient: 'ltc-receiver',
      amount: 1,
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * SECOND + SECOND);

    expect(replies).toHaveLength(1);
    expect(JSON.stringify(replies[0])).toContain('timed out');
    expect(JSON.stringify(replies[0])).not.toContain('PAYMENT_OUTCOME_UNKNOWN');
  });
});
