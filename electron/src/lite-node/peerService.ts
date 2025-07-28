// peerService.ts
import { PeerManager } from './PeerManager';

const SEED_PEERS = ['127.0.0.1'];

const manager = new PeerManager(SEED_PEERS);

let initialized = false;

export async function startPeerManager() {
  if (!initialized) {
    await manager.initialize();
    initialized = true;
    console.log(`✅ Connected to ${manager.getConnectedCount()} peers.`);
  }
}

export function getRandomClient() {
  return manager.getRandomClient();
}

export function getPeerManager() {
  return manager;
}
