// accountApi.ts

import {
  handleAccount,
  handleAccountBalance,
  handleActiveChat,
  handleAddressGroupInvitesMessage,
  handleGroupBansMessage,
  handleGroupJoinRequestsMessage,
  handleGroupMembersMessage,
  handleGroupsMessage,
  handleLastReference,
  handleNamesMessage,
  handlePrimaryNameMessage,
  handleProcessTransactionResponseMessage,
  handleUnitFee,
} from '../messages/handlers';
import { getRandomClient } from '../peerService';
import { MessageType } from '../protocol/messageTypes';
import {
  createGetAccountBalancePayload,
  createGetAccountGroupsPayload,
  createGetAccountMessagePayload,
  createGetAddressGroupInvitesPayload,
  createGetAddressNamesPayload,
  createGetBansPayload,
  createGetGroupInvitesPayload,
  createGetGroupJoinRequestsPayload,
  createGetGroupMembersPayload,
  createGetGroupPayload,
  createGetGroupsPayload,
  createGetLastReferencePayload,
  createGetNameInfoPayload,
  createGetNamesPayload,
  createGetOwnerGroupsPayload,
  createGetPrimaryNamePayload,
  createGetUnitFeePayload,
  createProcessTransactionMessagePayload,
} from '../protocol/payloads';

export async function getAccountBalance(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACCOUNT_BALANCE,
    createGetAccountBalancePayload(address, 0)
  );

  return handleAccountBalance(res);
}

export async function getUnitFee(
  txType: string,
  timestamp?: number
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_UNIT_FEE,
    createGetUnitFeePayload(txType, timestamp)
  );

  return handleUnitFee(res);
}

export async function getGroups(
  limit: number,
  offset: number,
  reverse: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_GROUPS,
    createGetGroupsPayload(limit, offset, reverse)
  );

  return handleGroupsMessage(res, false);
}

export async function getGroupMembers(
  groupId: number,
  onlyAdmins: boolean,
  limit: number,
  offset: number,
  reverse: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_GROUP_MEMBERS,
    createGetGroupMembersPayload(groupId, onlyAdmins, limit, offset, reverse)
  );

  return handleGroupMembersMessage(res);
}

export async function getAllNames(
  limit: number,
  offset: number,
  reverse: boolean,
  after?: number
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_NAMES,
    createGetNamesPayload(limit, offset, reverse, after)
  );

  return handleNamesMessage(res);
}

export async function getGroup(groupId: number): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_GROUP,
    createGetGroupPayload(groupId)
  );

  const data = handleGroupsMessage(res, false);

  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  throw new Error('No group data');
}

export async function getBans(groupId: number): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_GROUP_BANS,
    createGetBansPayload(groupId)
  );

  const data = handleGroupBansMessage(res);

  return data;
}

export async function getAddressGroupInvites(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ADDRESS_GROUP_INVITES,
    createGetAddressGroupInvitesPayload(address)
  );

  return handleAddressGroupInvitesMessage(res);
}

export async function getAccountGroups(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACCOUNT_GROUPS,
    createGetAccountGroupsPayload(address)
  );

  return handleGroupsMessage(res, true);
}

export async function getOwnerGroups(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_OWNER_GROUPS,
    createGetOwnerGroupsPayload(address)
  );

  return handleGroupsMessage(res, false);
}

export async function getGroupInvites(groupId: number): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_GROUP_INVITES,
    createGetGroupInvitesPayload(groupId)
  );

  const data = handleAddressGroupInvitesMessage(res);

  return data;
}

export async function getGroupJoinRequests(groupId: number): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_GROUP_JOIN_REQUESTS,
    createGetGroupJoinRequestsPayload(groupId)
  );

  const data = handleGroupJoinRequestsMessage(res);

  return data;
}

export async function getLastReference(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_LAST_REFERENCE,
    createGetLastReferencePayload(address)
  );

  return handleLastReference(res);
}

export async function getPrimaryName(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_PRIMARY_NAME,
    createGetPrimaryNamePayload(address)
  );

  return handlePrimaryNameMessage(res);
}

export async function getNameInfo(name: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_NAME,
    createGetNameInfoPayload(name)
  );

  const data = handleNamesMessage(res);
  console.log('data', data);
  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  throw new Error('No name data');
}

export async function getNames(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACCOUNT_NAMES,
    createGetAddressNamesPayload(address)
  );

  const data = handleNamesMessage(res);
  console.log('data', data);
  if (Array.isArray(data)) {
    return data;
  }

  throw new Error('No name data');
}

export async function getAccount(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACCOUNT,
    createGetAccountMessagePayload(address)
  );

  return handleAccount(res);
}

export async function processTransaction(signedBytes: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.PROCESS_TRANSACTION,
    createProcessTransactionMessagePayload(signedBytes)
  );
  console.log('res2', res);
  return handleProcessTransactionResponseMessage(res);
}
