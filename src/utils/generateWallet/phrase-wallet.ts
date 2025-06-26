// @ts-nocheck
/*
Copyright 2017-2018 @ irontiga and vbcs (original developer)
*/

import Base58 from '../../encryption/Base58.js';
import { Sha256, Sha512 } from 'asmcrypto.js';
import nacl from '../../encryption/nacl-fast.js';
import utils from '../../utils/utils';

import { generateSaveWalletData } from './storeWallet.js';

import publicKeyToAddress from './publicKeyToAddress';
import AltcoinHDWallet from '../../encryption/AltcoinHDWallet.js';

export default class PhraseWallet {
  constructor(seed, walletVersion) {
    this._walletVersion = walletVersion || 2;
    this.seed = seed;

    this.savedSeedData = {};
    this.hasBeenSaved = false;
  }

  set seed(seed) {
    this._byteSeed = seed;
    this._base58Seed = Base58.encode(seed);

    this._addresses = [];

    this.genAddress(0);
  }

  getAddress(nonce) {
    return this._addresses[nonce];
  }

  get addresses() {
    return this._addresses;
  }

  get addressIDs() {
    return this._addresses.map((addr) => {
      return addr.address;
    });
  }

  get seed() {
    return this._byteSeed;
  }

  addressExists(nonce) {
    return this._addresses[nonce] != undefined;
  }

  _genAddressSeed(seed) {
    let newSeed = new Sha512().process(seed).finish().result;
    newSeed = new Sha512()
      .process(utils.appendBuffer(newSeed, seed))
      .finish().result;
    return newSeed;
  }

  genAddress(nonce) {
    if (nonce >= this._addresses.length) {
      this._addresses.length = nonce + 1;
    }

    if (this.addressExists(nonce)) {
      return this.addresses[nonce];
    }

    const nonceBytes = utils.int32ToBytes(nonce);

    let addrSeed = new Uint8Array();
    addrSeed = utils.appendBuffer(addrSeed, nonceBytes);
    addrSeed = utils.appendBuffer(addrSeed, this._byteSeed);
    addrSeed = utils.appendBuffer(addrSeed, nonceBytes);

    if (this._walletVersion == 1) {
      addrSeed = new Sha256()
        .process(new Sha256().process(addrSeed).finish().result)
        .finish().result;

      addrSeed = this._byteSeed;
    } else {
      addrSeed = this._genAddressSeed(addrSeed).slice(0, 32);
    }

    const addrKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(addrSeed));

    const address = publicKeyToAddress(addrKeyPair.publicKey);
    const qoraAddress = publicKeyToAddress(addrKeyPair.publicKey, true);

    // Create Bitcoin HD Wallet
    const btcSeed = [...addrSeed];
    const btcWallet = new AltcoinHDWallet({
      mainnet: {
        private: 0x0488ade4,
        public: 0x0488b21e,
        prefix: 0,
      },
      testnet: {
        private: 0x04358394,
        public: 0x043587cf,
        prefix: 0x6f,
      },
    }).createWallet(new Uint8Array(btcSeed), false);

    // Create Litecoin HD Wallet
    const ltcSeed = [...addrSeed];
    const ltcWallet = new AltcoinHDWallet({
      mainnet: {
        private: 0x0488ade4,
        public: 0x0488b21e,
        prefix: 0x30,
      },
      testnet: {
        private: 0x04358394,
        public: 0x043587cf,
        prefix: 0x6f,
      },
    }).createWallet(new Uint8Array(ltcSeed), false, 'LTC');

    // Create Dogecoin HD Wallet
    const dogeSeed = [...addrSeed];
    const dogeWallet = new AltcoinHDWallet({
      mainnet: {
        private: 0x02fac398,
        public: 0x02facafd,
        prefix: 0x1e,
      },
      testnet: {
        private: 0x04358394,
        public: 0x043587cf,
        prefix: 0x71,
      },
    }).createWallet(new Uint8Array(dogeSeed), false, 'DOGE');

    // Create Digibyte HD Wallet
    const dgbSeed = [...addrSeed];
    const dgbWallet = new AltcoinHDWallet({
      mainnet: {
        private: 0x0488ade4,
        public: 0x0488b21e,
        prefix: 0x1e,
      },
      testnet: {
        private: 0x04358394,
        public: 0x043587cf,
        prefix: 0x7e,
      },
    }).createWallet(new Uint8Array(dgbSeed), false, 'DGB');

    // Create Ravencoin HD Wallet
    const rvnSeed = [...addrSeed];
    const rvnWallet = new AltcoinHDWallet({
      mainnet: {
        private: 0x0488ade4,
        public: 0x0488b21e,
        prefix: 0x3c,
      },
      testnet: {
        private: 0x04358394,
        public: 0x043587cf,
        prefix: 0x6f,
      },
    }).createWallet(new Uint8Array(rvnSeed), false, 'RVN');

    // Create Pirate Chain HD Wallet
    const arrrSeed = [...addrSeed];
    const arrrWallet = new AltcoinHDWallet({
      mainnet: {
        private: 0x0488ade4,
        public: 0x0488b21e,
        prefix: [0x16, 0x9a],
      },
      testnet: {
        private: 0x04358394,
        public: 0x043587cf,
        prefix: [0x14, 0x51],
      },
    }).createWallet(new Uint8Array(arrrSeed), false, 'ARRR');

    this._addresses[nonce] = {
      address,
      btcWallet,
      ltcWallet,
      dogeWallet,
      dgbWallet,
      rvnWallet,
      arrrWallet,
      qoraAddress,
      keyPair: {
        publicKey: addrKeyPair.publicKey,
        privateKey: addrKeyPair.secretKey,
      },
      base58PublicKey: Base58.encode(addrKeyPair.publicKey),
      seed: addrSeed,
      nonce: nonce,
    };
    return this._addresses[nonce];
  }

  generateSaveWalletData(...args) {
    return generateSaveWalletData(this, ...args);
  }
}
