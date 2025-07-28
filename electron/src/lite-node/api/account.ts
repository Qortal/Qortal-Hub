// accountApi.ts

import { handleAccountBalance } from '../messages/handlers';
import { getRandomClient, startPeerManager } from '../peerService';
import { MessageType } from '../protocol/messageTypes';
import { createGetAccountBalancePayload } from '../protocol/payloads';

export async function getAccountBalance(address: string): Promise<any> {
  const client = getRandomClient();
  if (!client) throw new Error('No available peers');

  const res: Buffer = await client.sendRequest(
    MessageType.GET_ACCOUNT_BALANCE,
    createGetAccountBalancePayload(address, 0)
  );

  return handleAccountBalance(res);
}

(async () => {
  await startPeerManager();
})();
