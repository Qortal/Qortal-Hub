// @ts-nocheck
import Base58 from '../../encryption/Base58.js';
import BROKEN_RIPEMD160 from '../../encryption/broken-ripemd160.js';
import RIPEMD160 from '../../encryption/ripemd160.js';
import utils from '../../utils/utils';
import { Buffer } from 'buffer';
import { Sha256 } from 'asmcrypto.js';
import { ADDRESS_VERSION } from '../../constants/constants.js';

const repeatSHA256 = (passphrase, hashes) => {
  let hash = passphrase;
  for (let i = 0; i < hashes; i++) {
    hash = new Sha256().process(hash).finish().result;
  }
  return hash;
};

const publicKeyToAddress = (publicKey, qora = false) => {
  const publicKeySha256 = new Sha256().process(publicKey).finish().result;
  const _publicKeyHash = qora
    ? new BROKEN_RIPEMD160().digest(publicKeySha256)
    : new RIPEMD160().update(Buffer.from(publicKeySha256)).digest('hex');
  const publicKeyHash = qora ? _publicKeyHash : _publicKeyHash;

  let address = new Uint8Array();

  address = utils.appendBuffer(address, [ADDRESS_VERSION]);
  address = utils.appendBuffer(address, publicKeyHash);

  const checkSum = repeatSHA256(address, 2);
  address = utils.appendBuffer(address, checkSum.subarray(0, 4));

  address = Base58.encode(address);

  return address;
};

export default publicKeyToAddress;
