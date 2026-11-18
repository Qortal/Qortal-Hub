import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Installs window.sendMessage, the bridge to Hub's request handlers.
import '../../messaging/MessagesToBackground';
import { createWidgetRequestHandler } from './widgetRequests';

const SECOND = 1000;
const owner = { tabId: 'home-widget:Clock:', name: 'Clock', service: 'APP' };

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

describe('a Home widget request that waits for the user’s approval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // The two requests a widget may send that ask in the approval dialog.
  it.each(['GET_USER_ACCOUNT', 'GET_WALLET_BALANCE'])(
    'gets the answer to %s approved after 45 s',
    async (action) => {
      answerRequestsAfter(45 * SECOND);
      const handler = createWidgetRequestHandler({
        owner,
        isOnScreen: () => true,
        answerOwn: vi.fn(),
      });
      const replies: unknown[] = [];
      void handler({
        data: { requestedHandler: 'UI', action, coin: 'QORT' },
        ports: [{ postMessage: (reply) => replies.push(reply) }],
      });

      await vi.advanceTimersByTimeAsync(45 * SECOND);

      expect(replies).toEqual([{ result: { answered: action }, error: null }]);
    }
  );

  // A balance can take a while after the approval: the app's own
  // qortalRequest gives the balance alone two minutes.
  it('gets the answer to a balance that took 75 s after an approval at 50 s', async () => {
    answerRequestsAfter(125 * SECOND);
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => true,
      answerOwn: vi.fn(),
    });
    const replies: unknown[] = [];
    void handler({
      data: {
        requestedHandler: 'UI',
        action: 'GET_WALLET_BALANCE',
        coin: 'BTC',
      },
      ports: [{ postMessage: (reply) => replies.push(reply) }],
    });

    await vi.advanceTimersByTimeAsync(125 * SECOND);

    expect(replies).toEqual([
      { result: { answered: 'GET_WALLET_BALANCE' }, error: null },
    ]);
  });
});
