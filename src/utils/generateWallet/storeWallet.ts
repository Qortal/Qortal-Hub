// @ts-nocheck

import { AES_CBC, HmacSha512 } from 'asmcrypto.js';
import Base58 from '../../encryption/Base58.js';
import { doInitWorkers, kdf } from '../../encryption/kdf.js';
import { crypto as cryptoVals } from '../../constants/decryptWallet.js';

const getRandomValues = crypto
  ? crypto.getRandomValues.bind(crypto)
  : msCrypto.getRandomValues.bind(msCrypto);
export const generateSaveWalletData = async (wallet, password, kdfThreads) => {
  const threads = doInitWorkers(cryptoVals.kdfThreads);

  let iv = new Uint8Array(16);
  getRandomValues(iv);
  let salt = new Uint8Array(32);
  getRandomValues(salt);
  const key = await kdf(password, salt, threads);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const encryptedSeed = AES_CBC.encrypt(
    wallet._byteSeed,
    encryptionKey,
    false,
    iv
  );
  const mac = new HmacSha512(macKey).process(encryptedSeed).finish().result;
  return {
    address0: wallet._addresses[0].address,
    encryptedSeed: Base58.encode(encryptedSeed),
    salt: Base58.encode(salt),
    iv: Base58.encode(iv),
    version: wallet._walletVersion,
    mac: Base58.encode(mac),
    kdfThreads,
  };
};
