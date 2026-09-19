import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../background/background', () => ({
  getSaveWallet: async () => ({ address0: 'QORT' }),
  getKeyPair: async () => ({ ltcPrivateKey: 'private' }),
  createEndpoint: async () => 'https://node.test/respond/local',
}));
vi.mock('../lib/foreign-wallet/foreign-wallets', () => ({
  walletPublicKey: () => 'public',
}));
vi.mock('../lib/foreign-wallet/trade-plan', () => ({
  validateLocalTradePlan: vi.fn(() => [
    { address: 'funding', value: 100000001n },
  ]),
}));
vi.mock('./foreign-coin-send', () => ({
  LocalWalletError: class extends Error {},
  sendLocalForeignCoin: vi.fn(),
}));
import { fundLocalTrades } from './local-trade-funding';
import { sendLocalForeignCoin } from './foreign-coin-send';
import { validateLocalTradePlan } from '../lib/foreign-wallet/trade-plan';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('preserves recovery details and snapshots offers before approval', async () => {
  const offers = [{ qortalAtAddress: 'original', expectedForeignAmount: '1' }];
  const recovery = {
    text1: 'Recover previous payment',
    text2: 'old transaction',
    text3: 'old recipient',
  };
  const approve = vi.fn(async () => {
    offers[0].qortalAtAddress = 'mutated';
    return { accepted: true };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify([{ lockTime: Date.now() / 1000 + 3600 }]))
    )
  );
  vi.mocked(sendLocalForeignCoin).mockImplementation(
    async (_data, _approve, _payments, _validate, approveRecovery) => {
      await approveRecovery(recovery);
      return 'txid';
    }
  );
  const result = await fundLocalTrades(offers, 'LTC', approve);
  expect(approve).toHaveBeenLastCalledWith(recovery);
  expect(result.extra.atAddresses).toEqual(['original']);
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1].body as string).addresses
  ).toEqual(['original']);
  expect(
    vi.mocked(validateLocalTradePlan).mock.calls[0][1][0].qortalAtAddress
  ).toBe('original');
});
