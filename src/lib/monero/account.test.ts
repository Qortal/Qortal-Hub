import { describe, expect, it, vi } from 'vitest';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import vectors from './fixtures/account-v1.json';
import {
  deriveMoneroAccount,
  deriveMoneroAccountKeys,
  moneroNetworkForNodeInfo,
  moneroPublicWallet,
} from './account';

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));

describe('Hub XMR account derivation v1', () => {
  for (const vector of vectors.cases) {
    for (const network of ['mainnet', 'stagenet'] as const) {
      it(`matches independent keys/address: v${vector.version}, nonce ${vector.nonce}, seed ${vector.seedHex.slice(0, 4)}/${vector.seedHex.length}, ${network}`, () => {
        const seed = hexToBytes(vector.addressSeedHex);
        expect(
          deriveMoneroAccountKeys(seed, vector.version, vector.nonce, network)
        ).toEqual(vector.wallet[network]);
        expect(bytesToHex(seed)).toBe(vector.addressSeedHex);
      });
    }
  }

  it('separates network, address index and wallet version', () => {
    const seed = new Uint8Array(32).fill(7);
    const keys = [
      deriveMoneroAccountKeys(seed, 1, 0, 'mainnet'),
      deriveMoneroAccountKeys(seed, 1, 1, 'mainnet'),
      deriveMoneroAccountKeys(seed, 2, 0, 'mainnet'),
      deriveMoneroAccountKeys(seed, 1, 0, 'stagenet'),
    ];
    expect(new Set(keys.map((key) => key.privateSpendKey)).size).toBe(4);
    expect(new Set(keys.map((key) => key.address)).size).toBe(4);
  });

  it('rejects unsupported derivation inputs', () => {
    for (const seed of [null, [], new Uint8Array(31), new Uint8Array(64)]) {
      expect(() =>
        deriveMoneroAccountKeys(seed as any, 2, 0, 'mainnet')
      ).toThrow();
    }
    for (const version of [0, 3, NaN, '2']) {
      expect(() =>
        deriveMoneroAccountKeys(
          new Uint8Array(32),
          version as any,
          0,
          'mainnet'
        )
      ).toThrow();
    }
    for (const nonce of [-1, 0.1, NaN, 0x80000000]) {
      expect(() =>
        deriveMoneroAccountKeys(new Uint8Array(32), 2, nonce, 'mainnet')
      ).toThrow();
    }
    for (const network of ['testnet', '', '__proto__', undefined]) {
      expect(() =>
        deriveMoneroAccountKeys(new Uint8Array(32), 2, 0, network as any)
      ).toThrow();
    }
  });
});

it('selects stagenet only for an explicit Qortal test mode', () => {
  expect(moneroNetworkForNodeInfo({ isTestNet: true })).toBe('stagenet');
  expect(moneroNetworkForNodeInfo({ isTestNet: false })).toBe('mainnet');
  for (const info of [null, {}, { isTestNet: 'false' }, { isTestNet: 1 }]) {
    expect(() => moneroNetworkForNodeInfo(info)).toThrow();
  }
});

it('projects only public wallet fields even if secret fields are added', () => {
  const account = deriveMoneroAccount(new Uint8Array(32).fill(7), 2, 0);
  Object.assign(account.mainnet, {
    seed: 'must-not-leak',
    walletData: 'secret',
  });
  const result = moneroPublicWallet(account, 'mainnet');
  expect(Object.keys(result).sort()).toEqual([
    'address',
    'derivationVersion',
    'network',
    'publicSpendKey',
    'publicViewKey',
  ]);
  expect(JSON.stringify(result)).not.toContain(account.mainnet.privateSpendKey);
  expect(JSON.stringify(result)).not.toContain(account.mainnet.privateViewKey);
  expect(JSON.stringify(result)).not.toContain('must-not-leak');
});

it('rejects absent, mismatched or corrupt wallet records', () => {
  const account = deriveMoneroAccount(new Uint8Array(32).fill(7), 2, 0);
  expect(() => moneroPublicWallet(null, 'mainnet')).toThrow();
  for (const patch of [
    { network: 'stagenet' },
    { derivationVersion: 2 },
    { address: '' },
    { publicSpendKey: '' },
    { publicViewKey: null },
  ]) {
    expect(() =>
      moneroPublicWallet(
        { ...account, mainnet: { ...account.mainnet, ...patch } } as any,
        'mainnet'
      )
    ).toThrow();
  }
});

it('honors the explicit temporary Core network override without changing Qortal mode', () => {
  expect(
    moneroNetworkForNodeInfo({ isTestNet: false, moneroNetwork: 'stagenet' })
  ).toBe('stagenet');
  expect(
    moneroNetworkForNodeInfo({ isTestNet: true, moneroNetwork: 'mainnet' })
  ).toBe('mainnet');
  for (const moneroNetwork of ['testnet', '', null, '__proto__'])
    expect(() =>
      moneroNetworkForNodeInfo({ isTestNet: false, moneroNetwork })
    ).toThrow();
});
