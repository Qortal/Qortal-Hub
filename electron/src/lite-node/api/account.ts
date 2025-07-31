// accountApi.ts

import {
  handleAccount,
  handleAccountBalance,
  handleActiveChat,
  handleLastReference,
  handleProcessTransactionResponseMessage,
  handleUnitFee,
} from '../messages/handlers';
import { getRandomClient } from '../peerService';
import { MessageType } from '../protocol/messageTypes';
import {
  createGetAccountBalancePayload,
  createGetAccountMessagePayload,
  createGetActiveChatPayload,
  createGetLastReferencePayload,
  createGetUnitFeePayload,
  createProcessTransactionMessagePayload,
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

export async function getLastReference(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_LAST_REFERENCE,
    createGetLastReferencePayload(address)
  );

  return handleLastReference(res);
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
