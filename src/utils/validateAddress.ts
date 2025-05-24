// @ts-nocheck

import Base58 from '../encryption/Base58';

export const validateAddress = (address) => {
  let isAddress = false;

  try {
    const decodePubKey = Base58.decode(address);

    if (!(decodePubKey instanceof Uint8Array && decodePubKey.length == 25)) {
      isAddress = false;
    } else {
      isAddress = true;
    }
  } catch (error) {
    console.log(error);
  }

  return isAddress;
};
