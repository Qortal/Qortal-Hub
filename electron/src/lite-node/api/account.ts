// accountApi.ts

import {
  handleAccount,
  handleAccountBalance,
  handleActiveChat,
} from '../messages/handlers';
import { getRandomClient } from '../peerService';
import { MessageType } from '../protocol/messageTypes';
import {
  createGetAccountBalancePayload,
  createGetAccountMessagePayload,
  createGetActiveChatPayload,
  Encoding,
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

export async function getAccount(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACCOUNT,
    createGetAccountMessagePayload(address)
  );

  return handleAccount(res);
}
