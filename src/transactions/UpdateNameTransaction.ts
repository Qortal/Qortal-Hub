// @ts-nocheck

import { QORT_DECIMALS } from "../constants/constants"
import TransactionBase from "./TransactionBase"


export default class UpdateNameTransaction extends TransactionBase {
	constructor() {
		super()
		this.type = 4
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

	set newName(newName) {
		this.newNameText = newName
		this._newNameBytes = this.constructor.utils.stringtoUTF8Array(newName)
		this._newNameLength = this.constructor.utils.int32ToBytes(this._newNameBytes.length)
	}

	set newData(newData) {
		this.newDataText = newData.length === 0 ? "Registered Name on the Qortal Chain" : newData
		this._newDataBytes = this.constructor.utils.stringtoUTF8Array(this.newDataText)
		this._newDataLength = this.constructor.utils.int32ToBytes(this._newDataBytes.length)
	}

	get params() {
		const params = super.params
		params.push(
			this._nameLength,
			this._nameBytes,
			this._newNameLength,
			this._newNameBytes,
			this._newDataLength,
			this._newDataBytes,
			this._feeBytes
		)
		return params
	}
}
