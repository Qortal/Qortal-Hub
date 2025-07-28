import { LiteNodeClient } from './LiteNodeClient';
import { discoveredPeers } from './peers';

type PeerStats = {
  successCount: number;
  failureCount: number;
  lastSuccess?: number;
  lastFailure?: number;
};

export class PeerManager {
  private peerStatsMap = new Map<string, PeerStats>();

  private maxConnections: number;
  public connectedClients = new Map<string, LiteNodeClient>();
  private seedPeers: string[];

  constructor(seedPeers: string[], maxConnections = 10) {
    this.seedPeers = seedPeers;
    this.maxConnections = maxConnections;
  }

  async initialize() {
    await this.tryConnectToPeers(this.seedPeers);

    // Start peer discovery loop
    this.discoveryLoop();
  }

  public updatePeerStats(peerKey: string, success: boolean) {
    const stats = this.peerStatsMap.get(peerKey) || {
      successCount: 0,
      failureCount: 0,
    };

    if (success) {
      stats.successCount += 1;
      stats.lastSuccess = Date.now();
    } else {
      stats.failureCount += 1;
      stats.lastFailure = Date.now();
    }

    this.peerStatsMap.set(peerKey, stats);
  }

  private async tryConnectToPeers(peers: string[]) {
    console.log(
      `[${new Date().toLocaleTimeString()}] 🔌 Total list peers: ${this.getConnectedCount()}`
    );

    const sortedPeers = peers.sort((a, b) => {
      const statsA = this.peerStatsMap.get(a) || {
        successCount: 0,
        failureCount: 0,
      };
      const statsB = this.peerStatsMap.get(b) || {
        successCount: 0,
        failureCount: 0,
      };

      const scoreA = statsA.successCount - statsA.failureCount;
      const scoreB = statsB.successCount - statsB.failureCount;

      return scoreB - scoreA; // higher score first
    });
    for (const peer of sortedPeers) {
      if (this.connectedClients.size >= this.maxConnections) break;
      if (this.connectedClients.has(peer)) continue;

      const [host, portStr] = peer.split(':');
      const port = parseInt(portStr || '12392', 10);

      const client = new LiteNodeClient(host, port, this);
      try {
        await client.connect();
        console.log(`✅ Connected to ${peer}`);
      } catch (err) {
        this.updatePeerStats(peer, false);
        console.warn(`❌ Failed to connect to ${peer}:`, err);
      }
    }
  }

  private async discoveryLoop() {
    setInterval(async () => {
      console.log(`🔌 Total connected peers: ${this.getConnectedCount()}`);
      if (this.connectedClients.size >= this.maxConnections) return;

      const peerList = Array.from(discoveredPeers);
      await this.tryConnectToPeers(peerList);
    }, 10_000); // Try every 10 seconds
  }

  getConnectedCount() {
    return this.connectedClients.size;
  }

  getConnectedClients() {
    return Array.from(this.connectedClients.values());
  }

  getRandomClient(): LiteNodeClient | null {
    const clients = Array.from(this.connectedClients.values());
    if (clients.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * clients.length);
    return clients[randomIndex];
  }

  removePeer(peerKey: string) {
    const client = this.connectedClients.get(peerKey);
    if (client) {
      client.destroy(); // Optional: clean up socket explicitly
    }
    this.connectedClients.delete(peerKey);
    console.log(`❌ Removed ${peerKey} from connected peers`);
  }
}
