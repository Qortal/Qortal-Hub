// @ts-nocheck

import TransactionBase from './TransactionBase'

import { Sha256 } from 'asmcrypto.js'
import nacl from '../deps/nacl-fast'
import ed2curve from '../deps/ed2curve'
import { DYNAMIC_FEE_TIMESTAMP } from '../constants/constants'
import publicKeyToAddress from '../utils/generateWallet/publicKeyToAddress'

export default class RewardShareTransaction extends TransactionBase {
	constructor() {
		super()
		this.type = 38
	}



	set recipientPublicKey(recipientPublicKey) {
		this._base58RecipientPublicKey = recipientPublicKey instanceof Uint8Array ? this.constructor.Base58.encode(recipientPublicKey) : recipientPublicKey
		this._recipientPublicKey = this.constructor.Base58.decode(this._base58RecipientPublicKey)
		this.recipient = publicKeyToAddress(this._recipientPublicKey)

		const convertedPrivateKey = ed2curve.convertSecretKey(this._keyPair.privateKey)
		const convertedPublicKey = ed2curve.convertPublicKey(this._recipientPublicKey)
		const sharedSecret = new Uint8Array(32)

		nacl.lowlevel.crypto_scalarmult(sharedSecret, convertedPrivateKey, convertedPublicKey)

		this._rewardShareSeed = new Sha256().process(sharedSecret).finish().result
		this._base58RewardShareSeed = this.constructor.Base58.encode(this._rewardShareSeed)
		this._rewardShareKeyPair = nacl.sign.keyPair.fromSeed(this._rewardShareSeed)

		if (new Date(this._timestamp).getTime() >= DYNAMIC_FEE_TIMESTAMP) {
			this.fee = (recipientPublicKey === this.constructor.Base58.encode(this._keyPair.publicKey) ? 0 : 0.01)
		} else {
			this.fee = (recipientPublicKey === this.constructor.Base58.encode(this._keyPair.publicKey) ? 0 : 0.001)
		}
	}

	set recipient(recipient) {
		this._recipient = recipient instanceof Uint8Array ? recipient : this.constructor.Base58.decode(recipient)
	}

	set percentageShare(share) {
		this._percentageShare = share * 100
		this._percentageShareBytes = this.constructor.utils.int64ToBytes(this._percentageShare)
	}

	get params() {
		const params = super.params
		params.push(
			this._recipient,
			this._rewardShareKeyPair.publicKey,
			this._percentageShareBytes,
			this._feeBytes
		)
		return params
	}
}
