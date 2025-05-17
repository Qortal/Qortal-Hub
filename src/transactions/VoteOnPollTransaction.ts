// @ts-nocheck
import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';
export default class VoteOnPollTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 9;
  }

  set fee(fee) {
    this._fee = fee * QORT_DECIMALS;
    this._feeBytes = this.constructor.utils.int64ToBytes(this._fee);
  }

  set rPollName(rPollName) {
    this._rPollName = rPollName;
    this._rPollNameBytes = this.constructor.utils.stringtoUTF8Array(
      this._rPollName
    );
    this._rPollNameLength = this.constructor.utils.int32ToBytes(
      this._rPollNameBytes.length
    );
  }

  set rOptionIndex(rOptionIndex) {
    this._rOptionIndex = rOptionIndex;
    this._rOptionIndexBytes = this.constructor.utils.int32ToBytes(
      this._rOptionIndex
    );
  }

  get params() {
    const params = super.params;
    params.push(
      this._rPollNameLength,
      this._rPollNameBytes,
      this._rOptionIndexBytes,
      this._feeBytes
    );
    return params;
  }
}
