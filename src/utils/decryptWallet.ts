// @ts-nocheck

import { crypto } from '../constants/decryptWallet';
import Base58 from '../encryption/Base58';
import { AES_CBC, HmacSha512 } from 'asmcrypto.js';
import { doInitWorkers, kdf } from '../encryption/kdf';
import i18n from 'i18next';

export const decryptStoredWallet = async (password, wallet) => {
  const threads = doInitWorkers(crypto.kdfThreads);
  const encryptedSeedBytes = Base58.decode(wallet.encryptedSeed);
  const iv = Base58.decode(wallet.iv);
  const salt = Base58.decode(wallet.salt);

  const key = await kdf(password, salt, threads);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const mac = new HmacSha512(macKey)
    .process(encryptedSeedBytes)
    .finish().result;
  if (Base58.encode(mac) !== wallet.mac) {
    throw new Error(i18n.t('auth:message.error.incorrect_password'));
  }
  const decryptedBytes = AES_CBC.decrypt(
    encryptedSeedBytes,
    encryptionKey,
    false,
    iv
  );
  return decryptedBytes;
};

export const decryptStoredWalletFromSeedPhrase = async (password) => {
  const threads = doInitWorkers(crypto.kdfThreads);
  const salt = new Uint8Array(void 0);

  const seed = await kdf(password, salt, threads);
  return seed;
};
