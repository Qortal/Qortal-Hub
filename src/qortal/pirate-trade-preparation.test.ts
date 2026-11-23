import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./pirate-wallet-initialization', () => ({
  ensurePirateWalletInitialization: vi.fn(async () => {}),
}));
vi.mock('../background/background', () => ({
  createEndpoint: vi.fn(async (path) => `http://local${path}`),
  getForeignKey: vi.fn(async () => 'private-entropy'),
  getSaveWallet: vi.fn(async () => ({ address0: 'Q-owner' })),
}));
vi.mock('../utils/chromeStorage', () => ({
  getSigningContextRevision: vi.fn(() => 1),
}));
vi.mock('i18next', () => ({
  default: { t: (key: string, params: any) => `${key}${params?.txid || ''}` },
}));
import { preparePirateTrade } from './pirate-trade-preparation';
import { getSigningContextRevision } from '../utils/chromeStorage';
import { createEndpoint } from '../background/background';
const offer = [{ expectedForeignAmount: '0.00030000' }];
const quote = {
  status: 'needsPreparation',
  quoteId: 'a'.repeat(64),
  fee: 10000,
  amount: 50000,
  destination: 'zs1owned',
};
let requests: any[];
const states = (...values: any[]) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/tradefees'))
        return new Response(
          JSON.stringify({ fundingFee: 10000, refundFee: 10000 })
        );
      requests.push(JSON.parse(init.body));
      const value = values.shift();
      if (value instanceof Response) return value;
      return new Response(JSON.stringify(value));
    })
  );
};
beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  vi.useFakeTimers();
  vi.mocked(getSigningContextRevision).mockReturnValue(1);
  vi.mocked(createEndpoint).mockImplementation(async (p) => `http://local${p}`);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('ARRR trade preparation', () => {
  it('retries only reads when Core is busy before quoting and after the one approved payment', async () => {
    const busy = () =>
      new Response(
        JSON.stringify({ message: 'Wallet busy. Please try again later.' }),
        { status: 400 }
      );
    states(
      busy(),
      quote,
      { ...quote, status: 'pending', txid: 'b'.repeat(64) },
      busy(),
      new Response(
        JSON.stringify({
          message: 'Sync in progress (100 / 101). Please try again later.',
        }),
        { status: 400 }
      ),
      { status: 'ready' }
    );
    const promise = preparePirateTrade(
      offer,
      async () => ({ accepted: true }),
      1
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(requests).toHaveLength(6);
    expect(requests.filter((r) => r.approvedQuote)).toHaveLength(1);
  });

  it('does not retry an approved call whose outcome is unknown', async () => {
    states(
      quote,
      new Response(
        JSON.stringify({ message: 'Wallet busy. Please try again later.' }),
        { status: 400 }
      )
    );
    await expect(
      preparePirateTrade(offer, async () => ({ accepted: true }), 1)
    ).rejects.toThrow('unavailable');
    expect(requests).toHaveLength(2);
    expect(requests.filter((r) => r.approvedQuote)).toHaveLength(1);
  });
  it('uses atomic principal plus both fees and queries without consent to spend', async () => {
    states({ status: 'ready' });
    const approve = vi.fn();
    await preparePirateTrade(offer, approve, 1);
    expect(requests).toEqual([
      { entropy58: 'private-entropy', requiredAmount: 50000 },
    ]);
    expect(approve).not.toHaveBeenCalled();
  });
  it('never sends preparation when its separate fee approval is declined', async () => {
    states(quote);
    await expect(
      preparePirateTrade(offer, async () => ({ accepted: false }), 1)
    ).rejects.toThrow('declined');
    expect(requests).toHaveLength(1);
  });
  it('waits for spend readiness after approving the exact quote and fee', async () => {
    states(
      quote,
      { ...quote, status: 'pending', txid: 'b'.repeat(64) },
      { status: 'ready' }
    );
    const promise = preparePirateTrade(
      offer,
      async () => ({ accepted: true }),
      1
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(requests[1]).toMatchObject({
      approvedQuote: quote.quoteId,
      maxFee: 10000,
    });
    expect(requests[2].approvedQuote).toBeUndefined();
  });
  it('reuses an existing pending quote instead of asking Core for another payment', async () => {
    states({ ...quote, status: 'pending' }, { status: 'ready' });
    const approve = vi.fn(async (_payload: any) => ({ accepted: true }));
    await preparePirateTrade(offer, approve, 1);
    expect(approve.mock.calls[0][0].text1).toContain('resume');
    expect(requests[1].approvedQuote).toBe(quote.quoteId);
  });
  it('fails closed when account or node changes while approval is open', async () => {
    states(quote);
    await expect(
      preparePirateTrade(
        offer,
        async () => {
          vi.mocked(getSigningContextRevision).mockReturnValue(2);
          return { accepted: true };
        },
        1
      )
    ).rejects.toThrow('changed');
    expect(requests).toHaveLength(1);
  });
  it('keeps the final trade bound to the original selected Core node', async () => {
    states({ status: 'ready' });
    const guard = await preparePirateTrade(offer, vi.fn(), 1);
    vi.mocked(createEndpoint).mockImplementation(
      async (p) => `http://other${p}`
    );
    await expect(guard()).rejects.toThrow('changed');
  });
  it('rejects unsupported libraries, invalid fees and insufficient funds without a spend', async () => {
    for (const state of [
      new Response('', { status: 404 }),
      { ...quote, fee: 10001 },
      { status: 'insufficient' },
    ]) {
      requests = [];
      states(state);
      const approve = vi.fn();
      await expect(preparePirateTrade(offer, approve, 1)).rejects.toThrow();
      expect(requests).toHaveLength(1);
      expect(approve).not.toHaveBeenCalled();
    }
  });
  it('explains when the selected Core still loads an older native library', async () => {
    states(
      new Response(
        JSON.stringify({
          error: 1205,
          message: 'Unsupported Qortal wallet command: tradepreparation',
        }),
        { status: 400 }
      )
    );
    await expect(preparePirateTrade(offer, vi.fn(), 1)).rejects.toThrow(
      'upgrade'
    );
    expect(requests).toHaveLength(1);
  });
  it('returns pending on timeout and never sends another approved request while polling', async () => {
    const pending = { ...quote, status: 'pending', txid: 'b'.repeat(64) };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (String(url).endsWith('/tradefees'))
          return new Response(
            JSON.stringify({ fundingFee: 10000, refundFee: 10000 })
          );
        requests.push(JSON.parse(init.body));
        return new Response(JSON.stringify(pending));
      })
    );
    const promise = preparePirateTrade(
      offer,
      async () => ({ accepted: true }),
      1
    );
    const result = expect(promise).rejects.toThrow('pending');
    await vi.runAllTimersAsync();
    await result;
    expect(requests.filter((r) => r.approvedQuote)).toHaveLength(1);
  });
});
