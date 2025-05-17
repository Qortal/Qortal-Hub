// @ts-nocheck

import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';
export default class GroupBanTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 26;
  }

  set rGroupId(rGroupId) {
    this._rGroupId = rGroupId;
    this._rGroupIdBytes = this.constructor.utils.int32ToBytes(this._rGroupId);
  }

  set rBanReason(rBanReason) {
    this._rBanReason = rBanReason;
    this._rBanReasonBytes = this.constructor.utils.stringtoUTF8Array(
      this._rBanReason
    );
    this._rBanReasonLength = this.constructor.utils.int32ToBytes(
      this._rBanReasonBytes.length
    );
  }

  set rBanTime(rBanTime) {
    this._rBanTime = rBanTime;
    this._rBanTimeBytes = this.constructor.utils.int32ToBytes(this._rBanTime);
  }

  set recipient(recipient) {
    this._recipient =
      recipient instanceof Uint8Array
        ? recipient
        : this.constructor.Base58.decode(recipient);
    this.theRecipient = recipient;
  }

  set fee(fee) {
    this._fee = fee * QORT_DECIMALS;
    this._feeBytes = this.constructor.utils.int64ToBytes(this._fee);
  }

  get params() {
    const params = super.params;
    params.push(
      this._rGroupIdBytes,
      this._recipient,
      this._rBanReasonLength,
      this._rBanReasonBytes,
      this._rBanTimeBytes,
      this._feeBytes
    );
    return params;
  }
}
