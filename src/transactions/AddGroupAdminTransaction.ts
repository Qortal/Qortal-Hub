// @ts-nocheck

import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';

export default class AddGroupAdminTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 24;
  }

  set rGroupId(rGroupId) {
    this._rGroupId = rGroupId;
    this._rGroupIdBytes = this.constructor.utils.int32ToBytes(this._rGroupId);
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
    params.push(this._rGroupIdBytes, this._recipient, this._feeBytes);
    return params;
  }
}
