// accountApi.ts

import { SERVICE_NAME_TO_VALUE } from '../constants/service';
import bs58 from 'bs58';

import {
  handleAccount,
  handleAccountBalance,
  handleActiveChat,
  handleAddressGroupInvitesMessage,
  handleArbitraryDataFileList,
  handleArbitraryDataFileMessage,
  handleArbitraryLatestTransaction,
  handleBlockDataMessage,
  handleGroupBansMessage,
  handleGroupJoinRequestsMessage,
  handleGroupMembersMessage,
  handleGroupsMessage,
  handleLastReference,
  handleNamesMessage,
  handlePollsMessage,
  handlePollVotesMessage,
  handlePrimaryNameMessage,
  handleProcessTransactionResponseMessage,
  handlePublicKeyMessage,
  handleSupply,
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
  createGetArbitraryDataFileListPayload,
  createGetArbitraryDataFilePayload,
  createGetArbitraryLatestTransactionPayload,
  createGetBansPayload,
  createGetGroupInvitesPayload,
  createGetGroupJoinRequestsPayload,
  createGetGroupMembersPayload,
  createGetGroupPayload,
  createGetGroupsPayload,
  createGetLastBlockHeightPayload,
  createGetLastReferencePayload,
  createGetNameInfoPayload,
  createGetNamesForSalePayload,
  createGetNamesPayload,
  createGetOwnerGroupsPayload,
  createGetPollPayload,
  createGetPollsPayload,
  createGetPollVotesPayload,
  createGetPrimaryNamePayload,
  createGetPublickeyFromAddressPayload,
  createGetUnitFeePayload,
  createProcessTransactionMessagePayload,
  createSearchNamesPayload,
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

export async function getNamesForSale(
  limit: number,
  offset: number,
  reverse: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_NAMES_FOR_SALE,
    createGetNamesForSalePayload(limit, offset, reverse)
  );

  return handleNamesMessage(res);
}

export async function getPolls(
  limit: number,
  offset: number,
  reverse: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_POLLS,
    createGetPollsPayload(limit, offset, reverse)
  );

  return handlePollsMessage(res);
}

export async function getPoll(pollName: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_POLL,
    createGetPollPayload(pollName)
  );

  const data = handlePollsMessage(res);

  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  throw new Error('No poll data');
}

export async function getArbitraryResource(
  service: string,
  name: string,
  identifier: string
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const serviceInt = SERVICE_NAME_TO_VALUE[service];
  const res: Buffer = await client.sendRequest(
    MessageType.GET_ARBITRARY_LATEST_TRANSACTION,
    createGetArbitraryLatestTransactionPayload(serviceInt, name, identifier)
  );

  const data = handleArbitraryLatestTransaction(res);
  console.log('arbitrary sig', data.signature);

  if (data.signature) {
    const res2: Buffer = await client.sendRequest(
      MessageType.GET_ARBITRARY_DATA_FILE_LIST,
      createGetArbitraryDataFileListPayload(
        bs58.decode(data.signature),
        null,
        Date.now(),
        0,
        null
      )
    );
    const dataFileList = handleArbitraryDataFileList(res2);
    if (dataFileList.hashes?.length > 0) {
      const res3: Buffer = await client.sendRequest(
        MessageType.GET_ARBITRARY_DATA_FILE,
        createGetArbitraryDataFilePayload(
          dataFileList.signature,
          dataFileList.hashes[0]
        )
      );

      console.log('res333', handleArbitraryDataFileMessage(res3));
    }

    console.log('res22');
  }
  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }

  throw new Error('No poll data');
}

export async function getPollVotes(
  pollName: string,
  onlyCounts: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_POLL_VOTES,
    createGetPollVotesPayload(pollName, onlyCounts)
  );
  const data = handlePollVotesMessage(res);
  return data;
}

export async function getSupply(): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_SUPPLY,
    Buffer.from([0x00])
  );
  const data = handleSupply(res);
  return data;
}

export async function getLastBlockHeight(
  includeOnlineSignatures: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_LAST_BLOCK_HEIGHT,
    createGetLastBlockHeightPayload(includeOnlineSignatures)
  );
  const data = handleBlockDataMessage(res);
  return data;
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

export async function getSearchNames(
  query: string,
  limit: number,
  offset: number,
  reverse: boolean,
  prefix: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_SEARCH_NAMES,
    createSearchNamesPayload(query, limit, offset, reverse, prefix)
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

export async function getPublickeyFromAddress(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_PUBLIC_KEY_FROM_ADDRESS,
    createGetPublickeyFromAddressPayload(address)
  );

  return handlePublicKeyMessage(res);
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
