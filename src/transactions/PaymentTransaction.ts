// @ts-nocheck

import { QORT_DECIMALS } from '../constants/constants';
import TransactionBase from './TransactionBase';
export default class PaymentTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 2;
  }

  set recipient(recipient) {
    this._recipient =
      recipient instanceof Uint8Array
        ? recipient
        : this.constructor.Base58.decode(recipient);
  }

  set dialogto(dialogto) {
    this._dialogto = dialogto;
  }

  set dialogamount(dialogamount) {
    this._dialogamount = dialogamount;
  }

  set amount(amount) {
    this._amount = Math.round(amount * QORT_DECIMALS);
    this._amountBytes = this.constructor.utils.int64ToBytes(this._amount);
  }

  get params() {
    const params = super.params;
    params.push(this._recipient, this._amountBytes, this._feeBytes);
    return params;
  }
}
