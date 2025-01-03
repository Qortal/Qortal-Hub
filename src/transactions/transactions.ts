// @ts-nocheck

import PaymentTransaction from './PaymentTransaction.js'
import ChatTransaction from './ChatTransaction.js'
import GroupChatTransaction from './GroupChatTransaction.js'
import GroupInviteTransaction from './GroupInviteTransaction.js'
import CancelGroupInviteTransaction from './CancelGroupInviteTransaction.js'
import GroupKickTransaction from './GroupKickTransaction.js'
import GroupBanTransaction from './GroupBanTransaction.js'
import CancelGroupBanTransaction from './CancelGroupBanTransaction.js'
import CreateGroupTransaction from './CreateGroupTransaction.js'
import LeaveGroupTransaction from './LeaveGroupTransaction.js'
import JoinGroupTransaction from './JoinGroupTransaction.js'
import AddGroupAdminTransaction from './AddGroupAdminTransaction.js'
import RemoveGroupAdminTransaction from './RemoveGroupAdminTransaction.js'
import RegisterNameTransaction from './RegisterNameTransaction.js'
import VoteOnPollTransaction from './VoteOnPollTransaction.js'
import CreatePollTransaction from './CreatePollTransaction.js'
import DeployAtTransaction from './DeployAtTransaction.js'
import RewardShareTransaction from './RewardShareTransaction.js'
import RemoveRewardShareTransaction from './RemoveRewardShareTransaction.js'


export const transactionTypes = {
	3: RegisterNameTransaction,
	2: PaymentTransaction,
	8: CreatePollTransaction,
	9: VoteOnPollTransaction,
	16: DeployAtTransaction,
	18: ChatTransaction,
	181: GroupChatTransaction,
	22: CreateGroupTransaction,
	24: AddGroupAdminTransaction,
	25: RemoveGroupAdminTransaction,
	26: GroupBanTransaction,
	27: CancelGroupBanTransaction,
	28: GroupKickTransaction,
	29: GroupInviteTransaction,
	30: CancelGroupInviteTransaction,
	31: JoinGroupTransaction,
	32: LeaveGroupTransaction,
	38: RewardShareTransaction,
	381: RemoveRewardShareTransaction
}


export const createTransaction = (type, keyPair, params) => {
	const tx = new transactionTypes[type]()
	tx.keyPair = keyPair
	Object.keys(params).forEach(param => {
	
		tx[param] = params[param]
	})

	return tx
}