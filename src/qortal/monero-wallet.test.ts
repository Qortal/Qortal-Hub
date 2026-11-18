import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.unmock('asmcrypto.js');
vi.unmock('asmcrypto.js/asmcrypto.all.js');
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('../background/background', () => ({
  getKeyPair: vi.fn(),
  getSaveWallet: vi.fn(),
}));
vi.mock('../utils/chromeStorage', () => ({
  getSigningContextRevision: vi.fn(),
}));
import { getKeyPair, getSaveWallet } from '../background/background';
import { getSigningContextRevision } from '../utils/chromeStorage';
import PhraseWallet from '../utils/generateWallet/phrase-wallet';
import { getMoneroPublicWallet } from './monero-wallet';

const record = new PhraseWallet(new Uint8Array(32).fill(7), 2).addresses[0];
const keys = { publicKey: record.base58PublicKey, xmrWallet: record.xmrWallet };
beforeEach(() => {
  vi.mocked(getSigningContextRevision).mockReturnValue(1);
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: record.address });
  vi.mocked(getKeyPair).mockResolvedValue(keys);
});
afterEach(() => {
  vi.resetAllMocks();
});

it.each([false, true])(
  'returns public-only XMR for Qortal mode %s',
  async (isTestNet) => {
    const result = await getMoneroPublicWallet(async () => ({ isTestNet }));
    const expected = record.xmrWallet[isTestNet ? 'stagenet' : 'mainnet'];
    expect(result.address).toBe(expected.address);
    expect(result.network).toBe(expected.network);
    expect(Object.keys(result).sort()).toEqual([
      'address',
      'derivationVersion',
      'network',
      'publicSpendKey',
      'publicViewKey',
    ]);
    expect(JSON.stringify(result)).not.toContain(expected.privateSpendKey);
    expect(JSON.stringify(result)).not.toContain(expected.privateViewKey);
  }
);

it('does not default to mainnet if Core mode is unavailable', async () => {
  await expect(getMoneroPublicWallet(async () => ({}))).rejects.toThrow(
    'question:message.error.node_info'
  );
});

it('rejects an account change during the node request', async () => {
  await expect(
    getMoneroPublicWallet(async () => {
      vi.mocked(getSigningContextRevision).mockReturnValue(3);
      return { isTestNet: false };
    })
  ).rejects.toThrow('question:local_send.changed');
});

it('rejects an in-progress account/Core change before reading keys', async () => {
  vi.mocked(getSigningContextRevision).mockReturnValue(null);
  await expect(getMoneroPublicWallet(vi.fn())).rejects.toThrow(
    'question:local_send.changed'
  );
  expect(getKeyPair).not.toHaveBeenCalled();
});

it('rejects an account change while the permission prompt was open', async () => {
  await expect(getMoneroPublicWallet(vi.fn(), 0)).rejects.toThrow(
    'question:local_send.changed'
  );
  expect(getKeyPair).not.toHaveBeenCalled();
});

it('rejects a key record belonging to another Qortal account', async () => {
  vi.mocked(getSaveWallet).mockResolvedValue({ address0: 'other-account' });
  await expect(
    getMoneroPublicWallet(async () => ({ isTestNet: false }))
  ).rejects.toThrow('auth:message.error.wallet_account_mismatch');
});

it('returns a translated account error for a malformed public key', async () => {
  vi.mocked(getKeyPair).mockResolvedValue({
    ...keys,
    publicKey: 'invalid key',
  });
  await expect(
    getMoneroPublicWallet(async () => ({ isTestNet: false }))
  ).rejects.toThrow('auth:message.error.wallet_account_mismatch');
});

it('requires a fresh unlock for an old session with no XMR keys', async () => {
  vi.mocked(getKeyPair).mockResolvedValue({
    publicKey: record.base58PublicKey,
  });
  await expect(
    getMoneroPublicWallet(async () => ({ isTestNet: false }))
  ).rejects.toThrow('auth:wallet_errors.invalid_security_data');
});
