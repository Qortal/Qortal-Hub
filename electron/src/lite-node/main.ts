import { handleAccountBalance } from './messages/handlers';
import { PeerManager } from './PeerManager';
import { MessageType } from './protocol/messageTypes';
import { createGetAccountBalancePayload } from './protocol/payloads';

const SEED_PEERS = ['127.0.0.1'];

async function main() {
  console.log('🚀 Starting PeerManager...');
  const manager = new PeerManager(SEED_PEERS);

  await manager.initialize();

  console.log(`✅ Connected to ${manager.getConnectedCount()} peers.`);

  await new Promise((res) =>
    setTimeout(() => {
      res(null);
    }, 10000)
  );
  const client = manager.getRandomClient();
  if (client) {
    // client.sendMessage(MessageType.PING, createPingPayload());
    const account = 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP';

    const res: Buffer = await client.sendRequest(
      MessageType.GET_ACCOUNT_BALANCE,
      createGetAccountBalancePayload(account, 0)
    );
    handleAccountBalance(res);
    console.log('📡 Sent PING message to random peer');
  } else {
    console.warn('⚠️ No connected clients to send message');
  }
  // You can now use manager.getConnectedClients() to interact with them
}

main();
