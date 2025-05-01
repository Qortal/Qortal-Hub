// @ts-nocheck

import { QORT_DECIMALS } from '../constants/constants'
import TransactionBase from './TransactionBase'

export default class TransferAssetTransaction extends TransactionBase {
  constructor() {
    super()
    this.type = 12 
  }

  set recipient(recipient) {
    this._recipient = recipient instanceof Uint8Array ? recipient : this.constructor.Base58.decode(recipient)
  }

  set amount(amount) {
    this._amount = Math.round(amount * QORT_DECIMALS)
    this._amountBytes = this.constructor.utils.int64ToBytes(this._amount)
  }

  set assetId(assetId) {
    this._assetId = this.constructor.utils.int64ToBytes(assetId)
  }

  get params() {
    const params = super.params
    params.push(
      this._recipient,
      this._assetId,
      this._amountBytes,
      this._feeBytes
    )
    return params
  }
}
