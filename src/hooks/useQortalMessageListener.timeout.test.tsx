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
});
