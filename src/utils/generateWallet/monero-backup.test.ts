import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import legacyWallets from './fixtures/pre-xmr-wallets.json';
import legacyBackup from './fixtures/pre-xmr-backup-v2.json';
import vectors from '../../lib/monero/fixtures/account-v1.json';

vi.unmock('asmcrypto.js');
vi.unmock('asmcrypto.js/asmcrypto.all.js');
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../i18n/i18n', () => ({ default: { t: (key: string) => key } }));
// jsdom cannot launch a Vite worker. Adapt only that boundary; run the real
// bcrypt computation, KDF, AES and HMAC, without substituting a test KDF.
vi.mock('../../encryption/bcryptworker.worker.js?worker', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  return {
    default: class {
      onmessage: any;
      onerror: any;
      terminate() {}
      postMessage(data: any) {
        queueMicrotask(() => {
          try {
            this.onmessage({
              data: { result: bcrypt.hashSync(data.hashBase64, data.salt) },
            });
          } catch (error) {
            this.onerror(error);
          }
        });
      }
    },
  };
});
import PhraseWallet from './phrase-wallet';
import {
  decryptStoredWallet,
  decryptStoredWalletFromSeedPhrase,
} from '../decryptWallet';
import { createAccount } from './generateWallet';

describe('adding XMR preserves every existing wallet', () => {
  it.each(legacyWallets)('v$version nonce $nonce / $seedHex', (fixture) => {
    const wallet = new PhraseWallet(
      hexToBytes(fixture.seedHex),
      fixture.version
    );
    const record = wallet.genAddress(fixture.nonce);
    const { xmrWallet, ...legacy } = record;
    expect(bytesToHex(sha256(utf8ToBytes(JSON.stringify(legacy))))).toBe(
      fixture.legacySha256
    );
    const expected = vectors.cases.find(
      (v) =>
        v.seedHex === fixture.seedHex &&
        v.version === fixture.version &&
        v.nonce === fixture.nonce
    )!;
    expect(bytesToHex(record.seed)).toBe(expected.addressSeedHex);
    expect(xmrWallet).toEqual(expected.wallet);
  });
});

it('restores both XMR networks from an ordinary pre-XMR encrypted backup', async () => {
  const seed = await decryptStoredWallet(
    'public-xmr-backup-fixture',
    structuredClone(legacyBackup)
  );
  const restored = new PhraseWallet(seed, legacyBackup.version);
  expect(bytesToHex(seed)).toBe('07'.repeat(32));
  expect(restored.addresses[0].address).toBe(legacyBackup.address0);
  expect(restored.addresses[0].xmrWallet).toEqual(
    vectors.cases.find(
      (v) => v.version === 2 && v.nonce === 0 && v.seedHex === '07'.repeat(32)
    )!.wallet
  );
}, 60000);

it.each([1, 2])(
  'round-trips the unchanged encrypted backup format for wallet v%i',
  async (version) => {
    const original = new PhraseWallet(new Uint8Array(32).fill(7), version);
    const backup = await original.generateSaveWalletData(
      'public-new-xmr-fixture',
      16
    );
    expect(Object.keys(backup).sort()).toEqual([
      'address0',
      'encryptedSeed',
      'iv',
      'kdfThreads',
      'mac',
      'salt',
      'version',
    ]);
    const serialized = JSON.stringify(backup);
    for (const network of ['mainnet', 'stagenet']) {
      expect(serialized).not.toContain(
        original.addresses[0].xmrWallet[network].privateSpendKey
      );
      expect(serialized).not.toContain(
        original.addresses[0].xmrWallet[network].privateViewKey
      );
    }
    const recoveredSeed = await decryptStoredWallet(
      'public-new-xmr-fixture',
      JSON.parse(serialized)
    );
    const fresh = new PhraseWallet(recoveredSeed, backup.version);
    expect(fresh.addresses[0].xmrWallet).toEqual(
      original.addresses[0].xmrWallet
    );
    expect(fresh.genAddress(1).xmrWallet).toEqual(
      original.genAddress(1).xmrWallet
    );
  },
  60000
);

it('rejects a wrong password or a modified legacy backup', async () => {
  await expect(
    decryptStoredWallet('wrong-public-password', legacyBackup)
  ).rejects.toThrow();
  await expect(
    decryptStoredWallet('public-xmr-backup-fixture', {
      ...legacyBackup,
      mac: 'invalid-fixture-mac',
    })
  ).rejects.toThrow();
}, 60000);

it('creates XMR through the normal phrase account flow and reproduces it on phrase restore', async () => {
  const phrase =
    'public synthetic phrase for unfunded Hub XMR account tests only';
  const created = await createAccount(phrase);
  const restoredSeed = await decryptStoredWalletFromSeedPhrase(phrase);
  const restored = new PhraseWallet(restoredSeed, 2);
  expect(restored.addresses[0].xmrWallet).toEqual(
    created.addresses[0].xmrWallet
  );
  // New phrase accounts use a 64-byte root. Exercise their actual encrypted
  // backup too, independently of the 32-byte legacy backup fixture.
  const backup = await created.generateSaveWalletData(
    'public-phrase-account-backup',
    16
  );
  const backupSeed = await decryptStoredWallet(
    'public-phrase-account-backup',
    JSON.parse(JSON.stringify(backup))
  );
  expect(backupSeed.length).toBe(64);
  const fresh = new PhraseWallet(backupSeed, backup.version);
  expect(fresh.addresses[0].xmrWallet).toEqual(created.addresses[0].xmrWallet);
}, 60000);
