import { handleActiveChat } from '../messages/handlers';
import { getRandomClient } from '../peerService';
import { MessageType } from '../protocol/messageTypes';
import { createGetActiveChatPayload, Encoding } from '../protocol/payloads';

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
