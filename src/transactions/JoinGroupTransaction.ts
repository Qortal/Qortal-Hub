// @ts-nocheck

import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';
export default class JoinGroupTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 31;
  }

  set fee(fee) {
    this._fee = fee * QORT_DECIMALS;
    this._feeBytes = this.constructor.utils.int64ToBytes(this._fee);
  }

  set registrantAddress(registrantAddress) {
    this._registrantAddress =
      registrantAddress instanceof Uint8Array
        ? registrantAddress
        : this.constructor.Base58.decode(registrantAddress);
  }

  set rGroupId(rGroupId) {
    this._rGroupId = rGroupId;
    this._rGroupIdBytes = this.constructor.utils.int32ToBytes(this._rGroupId);
  }

  get params() {
    const params = super.params;
    params.push(this._rGroupIdBytes, this._feeBytes);
    return params;
  }
}
