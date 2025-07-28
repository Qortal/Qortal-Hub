import { PeerManager } from './PeerManager';

const SEED_PEERS = ['127.0.0.1'];

async function main() {
  console.log('🚀 Starting PeerManager...');
  const manager = new PeerManager(SEED_PEERS);

  await manager.initialize();

  console.log(`✅ Connected to ${manager.getConnectedCount()} peers.`);
  // You can now use manager.getConnectedClients() to interact with them
}

main();
