// @ts-nocheck

import { QORT_DECIMALS } from "../constants/constants"
import TransactionBase from "./TransactionBase"


export default class CancelSellNameTransacion extends TransactionBase {
	constructor() {
		super()
		this.type = 6
	}

	set fee(fee) {
		this._fee = fee * QORT_DECIMALS
		this._feeBytes = this.constructor.utils.int64ToBytes(this._fee)
	}

	set name(name) {
		this.nameText = name
		this._nameBytes = this.constructor.utils.stringtoUTF8Array(name)
		this._nameLength = this.constructor.utils.int32ToBytes(this._nameBytes.length)
	}

	get params() {
		const params = super.params
		params.push(
			this._nameLength,
			this._nameBytes,
			this._feeBytes
		)
		return params
	}
}
