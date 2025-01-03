// @ts-nocheck

import { DYNAMIC_FEE_TIMESTAMP } from "../constants/constants"
import Base58 from "../deps/Base58"
import publicKeyToAddress from "../utils/generateWallet/publicKeyToAddress"
import TransactionBase from "./TransactionBase"


export default class RemoveRewardShareTransaction extends TransactionBase {
	constructor() {
		super()
		this.type = 38
	}


	set rewardShareKeyPairPublicKey(rewardShareKeyPairPublicKey) {
		this._rewardShareKeyPairPublicKey = Base58.decode(rewardShareKeyPairPublicKey)
	}

	set recipient(recipient) {
		const _address = publicKeyToAddress(this._keyPair.publicKey)
		this._recipient = recipient instanceof Uint8Array ? recipient : this.constructor.Base58.decode(recipient)

		if (new Date(this._timestamp).getTime() >= DYNAMIC_FEE_TIMESTAMP) {
			this.fee = _address === recipient ? 0 : 0.01
		} else {
			this.fee = _address === recipient ? 0 : 0.001
		}
	}

	set percentageShare(share) {
		this._percentageShare = share * 100
		this._percentageShareBytes = this.constructor.utils.int64ToBytes(this._percentageShare)
	}

	get params() {
		const params = super.params
		params.push(
			this._recipient,
			this._rewardShareKeyPairPublicKey,
			this._percentageShareBytes,
			this._feeBytes
		)
		return params
	}
}
