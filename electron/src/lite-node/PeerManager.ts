import { LiteNodeClient } from './LiteNodeClient';
import { discoveredPeers } from './peers';

const MAX_CONNECTIONS = 10;

export class PeerManager {
  private connections: Map<string, LiteNodeClient> = new Map();

  constructor(private seedPeers: string[]) {}

  async initialize() {
    const initialList = this.seedPeers.map((ip) => `${ip}:12392`);
    for (const peer of initialList) {
      if (this.connections.size >= MAX_CONNECTIONS) break;
      await this.connectToPeer(peer);
    }

    this.fillConnections();
  }

  private async connectToPeer(peer: string): Promise<void> {
    if (this.connections.has(peer)) return;

    const [host, portStr] = peer.split(':');
    const port = Number(portStr);
    if (!host || isNaN(port)) return;

    const client = new LiteNodeClient(host, port);
    try {
      await client.connect();
      this.connections.set(peer, client);
      console.log(`✅ Connected to peer: ${peer}`);
    } catch (err) {
      console.warn(`❌ Failed to connect to ${peer}:`, err);
    }
  }

  async fillConnections() {
    for (const peer of discoveredPeers) {
      if (this.connections.size >= MAX_CONNECTIONS) break;
      await this.connectToPeer(peer);
    }
  }

  getConnectedClients(): LiteNodeClient[] {
    return Array.from(this.connections.values());
  }

  getConnectedCount(): number {
    return this.connections.size;
  }

  // Optionally add:
  // - method to disconnect a peer
  // - method to replace a dropped peer
  // - heartbeat/ping checker to prune stale connections
}
