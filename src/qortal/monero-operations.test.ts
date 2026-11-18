import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('./monero-wallet', () => ({
  getMoneroWalletContext: vi.fn(),
  getMoneroPublicWallet: vi.fn(),
}));
vi.mock('../utils/chromeStorage', () => ({
  getSigningContextRevision: vi.fn(),
}));
import { getMoneroWalletContext, getMoneroPublicWallet } from './monero-wallet';
import { getSigningContextRevision } from '../utils/chromeStorage';
import {
  getMoneroWalletInfo,
  readMoneroWallet,
  sendMoneroPayment,
} from './monero-operations';
const address = '5' + 'a'.repeat(94);
const ctx = {
  publicWallet: { address, network: 'stagenet' },
  qortalAddress: 'Q' + 'a'.repeat(33),
  privateSpendKey: '1'.repeat(64),
  revision: 1,
};
const draft = {
  id: 'approved-id',
  txId: 'a'.repeat(64),
  recipient: address,
  amountAtomic: '1',
  feeAtomic: '2',
};
const node = vi.fn(async () => ({
  isTestNet: false,
  moneroNetwork: 'stagenet',
}));
let bridge: any;
beforeEach(() => {
  vi.mocked(getSigningContextRevision).mockReturnValue(1);
  vi.mocked(getMoneroWalletContext).mockResolvedValue(ctx as any);
  vi.mocked(getMoneroPublicWallet).mockResolvedValue(ctx.publicWallet as any);
  bridge = {
    status: vi.fn(async () => ({
      result: { initialized: false, daemonHeight: 50 },
    })),
    open: vi.fn(async () => ({ result: { initialized: true } })),
    prepare: vi.fn(async () => ({ result: draft })),
    retry: vi.fn(async () => ({ result: draft })),
    relay: vi.fn(async () => ({ result: draft.txId })),
    cancel: vi.fn(async () => true),
  };
  window.moneroWallet = bridge;
});
afterEach(() => {
  vi.resetAllMocks();
  delete window.moneroWallet;
});
it('requires a fresh explicit initialization approval even after read permission', async () => {
  const ask = vi.fn(async () => ({ accepted: true }));
  await getMoneroWalletInfo(
    { initialize: true, restoreHeight: 0 },
    node,
    ask,
    1
  );
  expect(ask).toHaveBeenCalledOnce();
  expect(bridge.open).toHaveBeenCalledWith(
    expect.objectContaining({
      restoreHeight: 0,
      privateSpendKey: ctx.privateSpendKey,
      network: 'stagenet',
    })
  );
});
it('does not initialize on a read, invalid height or denied approval', async () => {
  const ask = vi.fn(async () => ({ accepted: false }));
  await getMoneroWalletInfo({}, node, ask, 1);
  await expect(
    getMoneroWalletInfo({ initialize: true, restoreHeight: 51 }, node, ask, 1)
  ).rejects.toThrow('question:xmr.invalid');
  await expect(
    getMoneroWalletInfo({ initialize: true, restoreHeight: 0 }, node, ask, 1)
  ).rejects.toThrow('question:xmr.declined');
  expect(bridge.open).not.toHaveBeenCalled();
});
it('rejects mainnet functional operations and unsupported platforms before native access', async () => {
  vi.mocked(getMoneroWalletContext).mockResolvedValue({
    ...ctx,
    publicWallet: { ...ctx.publicWallet, network: 'mainnet' },
  } as any);
  await expect(readMoneroWallet(node, 1)).rejects.toThrow(
    'question:xmr.stagenet'
  );
  expect(bridge.status).not.toHaveBeenCalled();
  delete window.moneroWallet;
  await expect(readMoneroWallet(node, 1)).rejects.toThrow(
    'question:xmr.desktop'
  );
});
it('approves exact decimal amount and fee cap BEFORE signing, then relays only the approved draft', async () => {
  const ask = vi.fn(async () => {
    expect(bridge.prepare).not.toHaveBeenCalled();
    return { accepted: true };
  });
  expect(
    await sendMoneroPayment(
      { recipient: address, amount: '0.000000000001', maxFee: '0.001' },
      node,
      ask
    )
  ).toBe(draft.txId);
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      highlightedText: '0.000000000001 XMR (stagenet)',
      foreignFee: '≤ 0.001 XMR (stagenet)',
    })
  );
  expect(bridge.prepare).toHaveBeenCalledWith(address, {
    recipient: address,
    amountAtomic: '1',
    maxFeeAtomic: '1000000000',
  });
  expect(bridge.relay).toHaveBeenCalledWith(address, draft.id);
  expect(bridge.cancel).toHaveBeenCalledOnce();
});
it.each([1, '0', '-1', '1e-3', '0.0000000000001', '01'])(
  'rejects invalid amount %s before approval',
  async (amount) => {
    const ask = vi.fn();
    await expect(
      sendMoneroPayment({ recipient: address, amount }, node, ask)
    ).rejects.toThrow('question:xmr.invalid');
    expect(ask).not.toHaveBeenCalled();
    expect(bridge.prepare).not.toHaveBeenCalled();
  }
);
it('does not sign or relay after denial or account/Core changes during approval', async () => {
  await expect(
    sendMoneroPayment({ recipient: address, amount: '1' }, node, async () => ({
      accepted: false,
    }))
  ).rejects.toThrow('question:xmr.declined');
  await expect(
    sendMoneroPayment({ recipient: address, amount: '1' }, node, async () => {
      vi.mocked(getSigningContextRevision).mockReturnValue(2);
      return { accepted: true };
    })
  ).rejects.toThrow('question:xmr.changed');
  expect(bridge.prepare).not.toHaveBeenCalled();
  expect(bridge.relay).not.toHaveBeenCalled();
});
it('cancels the prepared draft if context changes during native preparation', async () => {
  bridge.prepare.mockImplementation(async () => {
    vi.mocked(getSigningContextRevision).mockReturnValue(3);
    return { result: draft };
  });
  await expect(
    sendMoneroPayment({ recipient: address, amount: '1' }, node, async () => ({
      accepted: true,
    }))
  ).rejects.toThrow('question:xmr.changed');
  expect(bridge.relay).not.toHaveBeenCalled();
  expect(bridge.cancel).toHaveBeenCalledOnce();
});
it('retries only an existing pending transaction after renewed approval', async () => {
  await sendMoneroPayment(
    { retryPending: true, recipient: 'ignored', amount: '999' },
    node,
    async () => ({ accepted: true })
  );
  expect(bridge.retry).toHaveBeenCalledWith(address);
  expect(bridge.prepare).not.toHaveBeenCalled();
  expect(bridge.relay).toHaveBeenCalledWith(address, draft.id);
});
it('blocks concurrent sends while approval is pending', async () => {
  let approve!: (value: { accepted: boolean }) => void;
  const waiting = sendMoneroPayment(
    { recipient: address, amount: '1' },
    node,
    () =>
      new Promise((resolve) => {
        approve = resolve;
      })
  );
  await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
  await expect(
    sendMoneroPayment({ recipient: address, amount: '1' }, node, vi.fn())
  ).rejects.toThrow('question:xmr.busy');
  approve({ accepted: false });
  await expect(waiting).rejects.toThrow('question:xmr.declined');
});
