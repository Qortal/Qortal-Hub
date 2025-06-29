// @ts-nocheck

import nacl from '../encryption/nacl-fast';
import Base58 from '../encryption/Base58';
import utils from '../utils/utils';

const signTradeBotTransaction = async (unsignedTxn, keyPair) => {
  if (!unsignedTxn) {
    throw new Error('Unsigned Transaction Bytes not defined');
  }

  if (!keyPair) {
    throw new Error('keyPair not defined');
  }

  const txnBuffer = Base58.decode(unsignedTxn);

  if (keyPair.privateKey.length === undefined) {
    const _privateKey = Object.keys(keyPair.privateKey).map(function (key) {
      return keyPair.privateKey[key];
    });
    const privateKey = new Uint8Array(_privateKey);
    const signature = nacl.sign.detached(txnBuffer, privateKey);
    return utils.appendBuffer(txnBuffer, signature);
  } else {
    const signature = nacl.sign.detached(txnBuffer, keyPair.privateKey);
    return utils.appendBuffer(txnBuffer, signature);
  }
};

export default signTradeBotTransaction;
