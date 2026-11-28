import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeListener = (event: {
  data: unknown;
  ports: { postMessage: (reply: unknown) => void }[];
}) => Promise<void>;

let bridgeListener: BridgeListener | null = null;
const { saveFile } = vi.hoisted(() => ({ saveFile: vi.fn() }));

// The tab's request bridge: it hands each request from the Q-App in the tab
// to the hook's listener.
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
vi.mock('../qortal/get', () => ({ saveFile }));

// Installs window.sendMessage, the bridge to Hub's request handlers.
import '../messaging/MessagesToBackground';
import { forgetTabActivity, isTabBusy } from '../components/Apps/tabActivity';
import { useQortalMessageListener } from './useQortalMessageListener';

const TAB = 'tab-awake';
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

describe('a tab whose app waits for Hub stays awake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() =>
      useQortalMessageListener(
        TAB,
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
    forgetTabActivity(TAB);
    saveFile.mockReset();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('while a payment waits for the approval window, until it is answered', async () => {
    answerRequestsAfter(45 * SECOND);
    const replies = askFromApp({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient: 'QExampleRecipient',
      amount: 1,
    });

    await vi.advanceTimersByTimeAsync(44 * SECOND);
    expect(isTabBusy(TAB)).toBe(true);

    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(replies).toHaveLength(1);
    expect(isTabBusy(TAB)).toBe(false);
  });

  it('while a file is being saved', async () => {
    let finishSave: () => void = () => undefined;
    saveFile.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
    );
    const replies = askFromApp({ action: 'SAVE_FILE', filename: 'a.txt' });

    await vi.advanceTimersByTimeAsync(0);
    expect(isTabBusy(TAB)).toBe(true);

    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(replies).toEqual([{ result: true, error: null }]);
    expect(isTabBusy(TAB)).toBe(false);
  });
});
