import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessageBackground } from '../messaging/MessagesToBackground';
import { qappRequestTimeout } from './qapp-request-timeout';

describe('Q-App send request lifetime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { payload: { txid: 'fixture-transaction' } },
    { error: 'send_failed', message: 'Broadcast failed: tx-expiring-soon' },
  ])(
    'delivers a Core reply after 30 seconds without resubmission',
    async (reply) => {
      const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
      const action = 'SEND_COIN';
      const pending = sendMessageBackground(
        action,
        { coin: 'ARRR' },
        qappRequestTimeout({ action }),
        false,
        {}
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(settled).toBe(false);
      expect(post).toHaveBeenCalledTimes(1);
      const request = post.mock.calls[0][0];
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: window,
          data: {
            type: 'backgroundMessageResponse',
            requestId: request.requestId,
            ...reply,
          },
        })
      );
      await expect(pending).resolves.toEqual(
        'payload' in reply ? reply.payload : reply
      );
      expect(vi.getTimerCount()).toBe(0);
      expect(post).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps ordinary reads bounded to 30 seconds', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const action = 'GET_WALLET_BALANCE';
    const pending = sendMessageBackground(
      action,
      {},
      qappRequestTimeout({ action }),
      false,
      {}
    );
    const rejected = expect(pending).rejects.toMatchObject({
      error: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
  });

  it('retains existing publication budgets and the bounded send budget', () => {
    expect(qappRequestTimeout({ action: 'SEND_COIN' })).toBe(600_000);
    expect(qappRequestTimeout({ action: 'PUBLISH_QDN_RESOURCE' })).toBe(
      3_600_000
    );
    expect(
      qappRequestTimeout({
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        payload: { resources: [{}, {}] },
      })
    ).toBe(3_600_000);
    expect(
      qappRequestTimeout({ action: 'PUBLISH_MULTIPLE_QDN_RESOURCES' })
    ).toBe(30_000);
  });

  it('keeps an ARRR buy reply attached throughout preparation and confirmation', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const action = 'CREATE_TRADE_BUY_ORDER';
    const payload = { foreignBlockchain: 'PIRATECHAIN' };
    const budget = qappRequestTimeout({ action, payload });
    expect(budget).toBe(1_800_000);
    const pending = sendMessageBackground(action, payload, budget, false, {});
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(settled).toBe(false);
    const request = post.mock.calls[0][0];
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: 'backgroundMessageResponse',
          requestId: request.requestId,
          payload: { success: true },
        },
      })
    );
    await expect(pending).resolves.toEqual({ success: true });
    expect(post).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      qappRequestTimeout({ action, payload: { foreignBlockchain: 'LITECOIN' } })
    ).toBe(30_000);
  });
});

it('allows time for XMR read and initialization approvals without extending other wallet reads', () => {
  for (const action of ['GET_USER_WALLET', 'GET_USER_WALLET_INFO']) {
    expect(qappRequestTimeout({ action, payload: { coin: 'XMR' } })).toBe(
      600000
    );
    expect(qappRequestTimeout({ action, payload: { coin: 'BTC' } })).toBe(
      30000
    );
  }
});
