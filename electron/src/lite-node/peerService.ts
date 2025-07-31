// peerService.ts
import { PeerManager } from './PeerManager';
export const isDevelopment = true;
const SEED_PEERS = [
  'node1.qortal.org',
  'node2.qortal.org',
  'node3.qortal.org',
  'node4.qortal.org',
  'node5.qortal.org',
  'node6.qortal.org',
  'node7.qortal.org',
  'node8.qortal.org',
  'node9.qortal.org',
  'node10.qortal.org',
  'node11.qortal.org',
  'node12.qortal.org',
  'node13.qortal.org',
  'node14.qortal.org',
  'node15.qortal.org',
  'node.qortal.ru',
  'node2.qortal.ru',
  'node3.qortal.ru',
  'node.qortal.uk',
  'qnode1.crowetic.com',
  'bootstrap.qortal.org',
  'proxynodes.qortal.link',
  'api.qortal.org',
  'bootstrap2-ssh.qortal.org',
  'bootstrap3-ssh.qortal.org',
  'node2.qortalnodes.live',
  'node3.qortalnodes.live',
  'node4.qortalnodes.live',
  'node5.qortalnodes.live',
  'node6.qortalnodes.live',
  'node7.qortalnodes.live',
  'node8.qortalnodes.live',
];

const manager = new PeerManager(isDevelopment ? ['127.0.0.1'] : SEED_PEERS);

let initialized = false;

export async function startPeerManager() {
  if (!initialized) {
    await manager.initialize();
    initialized = true;
    console.log(`✅ Connected to ${manager.getConnectedCount()} peers.`);
  }
}

export function getRandomClient() {
  return manager.getBestClient();
}

export function getPeerManager() {
  return manager;
}
