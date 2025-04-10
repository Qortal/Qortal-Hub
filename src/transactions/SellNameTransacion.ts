// @ts-nocheck

import { QORT_DECIMALS } from "../constants/constants"
import TransactionBase from "./TransactionBase"


export default class SellNameTransacion extends TransactionBase {
	constructor() {
		super()
		this.type = 5
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

	set sellPrice(sellPrice) {
		this.showSellPrice = sellPrice
		this._sellPrice = sellPrice * QORT_DECIMALS
		this._sellPriceBytes = this.constructor.utils.int64ToBytes(this._sellPrice)
	}

	get params() {
		const params = super.params
		params.push(
			this._nameLength,
			this._nameBytes,
			this._sellPriceBytes,
			this._feeBytes
		)
		return params
	}
}
