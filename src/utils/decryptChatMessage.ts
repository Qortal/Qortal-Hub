// @ts-nocheck

import Base58 from '../encryption/Base58';
import ed2curve from '../encryption/ed2curve';
import nacl from '../encryption/nacl-fast';
import { Sha256 } from 'asmcrypto.js';

export const decryptChatMessage = (
  encryptedMessage,
  privateKey,
  recipientPublicKey,
  lastReference
) => {
  const test = encryptedMessage;
  let _encryptedMessage = atob(encryptedMessage);
  const binaryLength = _encryptedMessage.length;
  const bytes = new Uint8Array(binaryLength);

  for (let i = 0; i < binaryLength; i++) {
    bytes[i] = _encryptedMessage.charCodeAt(i);
  }

  const _base58RecipientPublicKey =
    recipientPublicKey instanceof Uint8Array
      ? Base58.encode(recipientPublicKey)
      : recipientPublicKey;
  const _recipientPublicKey = Base58.decode(_base58RecipientPublicKey);

  const _lastReference =
    lastReference instanceof Uint8Array
      ? lastReference
      : Base58.decode(lastReference);

  const convertedPrivateKey = ed2curve.convertSecretKey(privateKey);
  const convertedPublicKey = ed2curve.convertPublicKey(_recipientPublicKey);
  const sharedSecret = new Uint8Array(32);
  nacl.lowlevel.crypto_scalarmult(
    sharedSecret,
    convertedPrivateKey,
    convertedPublicKey
  );

  const _chatEncryptionSeed = new Sha256()
    .process(sharedSecret)
    .finish().result;
  const _decryptedMessage = nacl.secretbox.open(
    bytes,
    _lastReference.slice(0, 24),
    _chatEncryptionSeed
  );

  let decryptedMessage = '';

  _decryptedMessage === false
    ? decryptedMessage
    : (decryptedMessage = new TextDecoder('utf-8').decode(_decryptedMessage));

  return decryptedMessage;
};
