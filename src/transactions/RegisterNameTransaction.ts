// @ts-nocheck

import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';
export default class RegisterNameTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 3;
  }

  set fee(fee) {
    this._fee = fee * QORT_DECIMALS;
    this._feeBytes = this.constructor.utils.int64ToBytes(this._fee);
  }

  set name(name) {
    this.nameText = name;
    this._nameBytes = this.constructor.utils.stringtoUTF8Array(name);
    this._nameLength = this.constructor.utils.int32ToBytes(
      this._nameBytes.length
    );
  }

  set value(value) {
    this.valueText =
      value.length === 0 ? 'Registered Name on the Qortal Chain' : value;
    this._valueBytes = this.constructor.utils.stringtoUTF8Array(this.valueText);
    this._valueLength = this.constructor.utils.int32ToBytes(
      this._valueBytes.length
    );
  }

  get params() {
    const params = super.params;
    params.push(
      this._nameLength,
      this._nameBytes,
      this._valueLength,
      this._valueBytes,
      this._feeBytes
    );
    return params;
  }
}
