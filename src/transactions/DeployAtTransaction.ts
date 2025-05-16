// @ts-nocheck

import TransactionBase from './TransactionBase';
import { QORT_DECIMALS } from '../constants/constants';
export default class DeployAtTransaction extends TransactionBase {
  constructor() {
    super();
    this.type = 16;
  }

  set fee(fee) {
    this._fee = fee * QORT_DECIMALS;
    this._feeBytes = this.constructor.utils.int64ToBytes(this._fee);
  }

  set rAmount(rAmount) {
    this._rAmount = Math.round(rAmount * QORT_DECIMALS);
    this._rAmountBytes = this.constructor.utils.int64ToBytes(this._rAmount);
  }

  set rName(rName) {
    this._rName = rName;
    this._rNameBytes = this.constructor.utils.stringtoUTF8Array(
      this._rName.toLocaleLowerCase()
    );
    this._rNameLength = this.constructor.utils.int32ToBytes(
      this._rNameBytes.length
    );
  }

  set rDescription(rDescription) {
    this._rDescription = rDescription;
    this._rDescriptionBytes = this.constructor.utils.stringtoUTF8Array(
      this._rDescription.toLocaleLowerCase()
    );
    this._rDescriptionLength = this.constructor.utils.int32ToBytes(
      this._rDescriptionBytes.length
    );
  }

  set atType(atType) {
    this._atType = atType;
    this._atTypeBytes = this.constructor.utils.stringtoUTF8Array(this._atType);
    this._atTypeLength = this.constructor.utils.int32ToBytes(
      this._atTypeBytes.length
    );
  }

  set rTags(rTags) {
    this._rTags = rTags;
    this._rTagsBytes = this.constructor.utils.stringtoUTF8Array(
      this._rTags.toLocaleLowerCase()
    );
    this._rTagsLength = this.constructor.utils.int32ToBytes(
      this._rTagsBytes.length
    );
  }

  set rCreationBytes(rCreationBytes) {
    const decode = this.constructor.Base58.decode(rCreationBytes);
    this._rCreationBytes = this.constructor.utils.stringtoUTF8Array(decode);
    this._rCreationBytesLength = this.constructor.utils.int32ToBytes(
      this._rCreationBytes.length
    );
  }

  set rAssetId(rAssetId) {
    this._rAssetId = this.constructor.utils.int64ToBytes(rAssetId);
  }

  get params() {
    const params = super.params;
    params.push(
      this._rNameLength,
      this._rNameBytes,
      this._rDescriptionLength,
      this._rDescriptionBytes,
      this._atTypeLength,
      this._atTypeBytes,
      this._rTagsLength,
      this._rTagsBytes,
      this._rCreationBytesLength,
      this._rCreationBytes,
      this._rAmountBytes,
      this._rAssetId,
      this._feeBytes
    );
    return params;
  }
}
