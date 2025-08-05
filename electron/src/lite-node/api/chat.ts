import { handleActiveChat, handleChatMessages } from '../messages/handlers';
import { getRandomClient } from '../peerService';
import { MessageType } from '../protocol/messageTypes';
import {
  createGetActiveChatPayload,
  createGetChatMessagesPayload,
  Encoding,
} from '../protocol/payloads';

export async function getActiveChat(
  address: string,
  encoding: Encoding,
  hasChatReference: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACTIVE_CHAT,
    createGetActiveChatPayload(address, encoding, hasChatReference)
  );
  return handleActiveChat(res);
}

export async function getChatMessages(
  txGroupId: number | null,
  involving: string[],
  encoding: Encoding,
  reference: string | null,
  before: number | null,
  after: number | null,
  chatReference: string | null,
  hasChatReference: boolean,
  sender: string | null,
  offset: number,
  limit: number,
  reverse: boolean
): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_CHAT_MESSAGES,
    createGetChatMessagesPayload(
      txGroupId,
      involving,
      encoding,
      reference,
      before,
      after,
      chatReference,
      hasChatReference,
      sender,
      offset,
      limit,
      reverse
    )
  );
  return handleChatMessages(res);
}
