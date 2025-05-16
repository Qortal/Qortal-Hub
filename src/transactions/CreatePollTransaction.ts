// @ts-nocheck
import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';
export default class CreatePollTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 8;
    this._options = [];
  }

  addOption(option) {
    const optionBytes = this.constructor.utils.stringtoUTF8Array(option);
    const optionLength = this.constructor.utils.int32ToBytes(
      optionBytes.length
    );
    this._options.push({ length: optionLength, bytes: optionBytes });
  }

  set fee(fee) {
    this._fee = fee * QORT_DECIMALS;
    this._feeBytes = this.constructor.utils.int64ToBytes(this._fee);
  }

  set ownerAddress(ownerAddress) {
    this._ownerAddress =
      ownerAddress instanceof Uint8Array
        ? ownerAddress
        : this.constructor.Base58.decode(ownerAddress);
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

  set rPollDesc(rPollDesc) {
    this._rPollDesc = rPollDesc;
    this._rPollDescBytes = this.constructor.utils.stringtoUTF8Array(
      this._rPollDesc
    );
    this._rPollDescLength = this.constructor.utils.int32ToBytes(
      this._rPollDescBytes.length
    );
  }

  set rOptions(rOptions) {
    const optionsArray = rOptions[0].split(', ').map((opt) => opt.trim());
    this._pollOptions = optionsArray;

    for (let i = 0; i < optionsArray.length; i++) {
      this.addOption(optionsArray[i]);
    }

    this._rNumberOfOptionsBytes = this.constructor.utils.int32ToBytes(
      optionsArray.length
    );
  }

  get params() {
    const params = super.params;
    params.push(
      this._ownerAddress,
      this._rPollNameLength,
      this._rPollNameBytes,
      this._rPollDescLength,
      this._rPollDescBytes,
      this._rNumberOfOptionsBytes
    );

    // Push the dynamic options
    for (let i = 0; i < this._options.length; i++) {
      params.push(this._options[i].length, this._options[i].bytes);
    }

    params.push(this._feeBytes);

    return params;
  }
}
