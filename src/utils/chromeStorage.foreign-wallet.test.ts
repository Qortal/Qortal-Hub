import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { SecureStoragePlugin } from '@evva/capacitor-secure-storage-plugin';
import { storeData, getData, removeKeysAndLogout } from './chromeStorage';
const storage = new Map<string, string>();
const privateKeys = Object.fromEntries(
  ['btc', 'ltc', 'doge', 'dgb', 'rvn'].map((c) => [
    `${c}PrivateKey`,
    `${c}-secret`,
  ])
);
const publicKeys = Object.fromEntries(
  ['BTC', 'LTC', 'DOGE', 'DGB', 'RVN'].map((c) => [c, `${c}-public`])
);
beforeEach(() => {
  // Node WebCrypto rejects jsdom's cross-realm ArrayBuffer; retain real AES-GCM
  // while normalizing that one boundary to a native Buffer.
  vi.stubGlobal('crypto', {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: {
      generateKey: webcrypto.subtle.generateKey.bind(webcrypto.subtle),
      encrypt: webcrypto.subtle.encrypt.bind(webcrypto.subtle),
      decrypt: (algorithm, key, data) =>
        webcrypto.subtle.decrypt(
          algorithm,
          key,
          Buffer.from(new Uint8Array(data))
        ),
    },
  });
  storage.clear();
  vi.mocked(SecureStoragePlugin.set).mockImplementation(
    async ({ key, value }) => {
      storage.set(key, value);
      return { value: true };
    }
  );
  vi.mocked(SecureStoragePlugin.get).mockImplementation(async ({ key }) => ({
    value: storage.get(key),
  }));
});
afterEach(() => {
  delete window.foreignWalletSigner;
  vi.unstubAllGlobals();
});
function signer() {
  window.foreignWalletSigner = {
    importKeys: vi.fn(async () => publicKeys),
    publicKey: vi.fn(),
    sign: vi.fn(),
    clear: vi.fn(async () => {}),
  };
  return window.foreignWalletSigner;
}
it('passes only foreign roots to native storage and removes them from renderer key records', async () => {
  const native = signer();
  await storeData('keyPair', {
    ...privateKeys,
    privateKey: 'qortal-secret',
    arrrSeed58: 'pirate-secret',
  });
  expect(native.importKeys).toHaveBeenCalledWith(privateKeys);
  const result = await getData('keyPair');
  expect(result.privateKey).toBe('qortal-secret');
  expect(result.arrrSeed58).toBe('pirate-secret');
  for (const [coin, value] of Object.entries(publicKeys)) {
    expect(result[`${coin.toLowerCase()}PublicKey`]).toBe(value);
    expect(result).not.toHaveProperty(`${coin.toLowerCase()}PrivateKey`);
  }
});
it('migrates existing encrypted renderer records once', async () => {
  await storeData('keyPair', privateKeys);
  const native = signer();
  expect(await getData('keyPair')).not.toHaveProperty('ltcPrivateKey');
  await getData('keyPair');
  expect(native.importKeys).toHaveBeenCalledOnce();
});
it('fails closed if the native key import fails', async () => {
  const native = signer();
  vi.mocked(native.importKeys).mockRejectedValue(new Error('failed'));
  await expect(storeData('keyPair', privateKeys)).rejects.toThrow();
  expect(storage.has('keyPair')).toBe(false);
});
it('clears the signing session on logout', async () => {
  const native = signer();
  await removeKeysAndLogout(
    ['keyPair'],
    { source: { postMessage: vi.fn() }, origin: 'test' } as any,
    { requestId: 'logout' }
  );
  expect(native.clear).toHaveBeenCalledOnce();
});
