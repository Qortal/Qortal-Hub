// @ts-nocheck


import { QORT_DECIMALS } from "../constants/constants";
import TransactionBase from "./TransactionBase";

export default class UpdateGroupTransaction extends TransactionBase {
    constructor() {
        super()
        this.type = 23
    }




    set fee(fee) {
        this._fee = fee * QORT_DECIMALS
        this._feeBytes = this.constructor.utils.int64ToBytes(this._fee)
    }
    set newOwner(newOwner) {
        this._newOwner = newOwner instanceof Uint8Array ? newOwner : this.constructor.Base58.decode(newOwner)
    }
    set newIsOpen(newIsOpen) {

        this._rGroupType = new Uint8Array(1)
        this._rGroupType[0] = newIsOpen
    }
    set newDescription(newDescription) {
        this._rGroupDescBytes = this.constructor.utils.stringtoUTF8Array(newDescription.toLocaleLowerCase())
        this._rGroupDescLength = this.constructor.utils.int32ToBytes(this._rGroupDescBytes.length)
    }
    set newApprovalThreshold(newApprovalThreshold) {
        this._rGroupApprovalThreshold = new Uint8Array(1)
        this._rGroupApprovalThreshold[0] = newApprovalThreshold;
    }
    set newMinimumBlockDelay(newMinimumBlockDelay) {
        this._rGroupMinimumBlockDelayBytes = this.constructor.utils.int32ToBytes(newMinimumBlockDelay)
    }
    set newMaximumBlockDelay(newMaximumBlockDelay) {

        this._rGroupMaximumBlockDelayBytes = this.constructor.utils.int32ToBytes(newMaximumBlockDelay)
    }

    set _groupId(_groupId){
        this._groupBytes = this.constructor.utils.int32ToBytes(_groupId)
    }
    get params() {
        const params = super.params
        params.push(
            this._groupBytes,
            this._newOwner,
            this._rGroupDescLength,
            this._rGroupDescBytes,
            this._rGroupType,
            this._rGroupApprovalThreshold,
            this._rGroupMinimumBlockDelayBytes,
            this._rGroupMaximumBlockDelayBytes,
            this._feeBytes
        )
        return params
    }
}