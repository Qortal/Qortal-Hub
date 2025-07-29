import { LiteNodeClient } from './LiteNodeClient';
import { discoveredPeers } from './peers';

type PeerStats = {
  successCount: number;
  failureCount: number;
  lastSuccess?: number;
  lastFailure?: number;
};

function safeBigIntToNumber(big: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (big > max) throw new Error(`Timestamp too large: ${big.toString()}`);
  return Number(big);
}

export class PeerManager {
  private peerStatsMap = new Map<string, PeerStats>();

  private maxConnections: number;
  public connectedClients = new Map<string, LiteNodeClient>();
  private seedPeers: string[];

  private readonly MAX_BLOCK_LAG = 2; // block height difference tolerance
  private readonly MAX_TIME_LAG = 2 * 60 * 1000; // 10 minutes in ms
  private peerChainTips: Map<string, { height: number; timestamp: number }> =
    new Map();

  constructor(seedPeers: string[], maxConnections = 10) {
    this.seedPeers = seedPeers;
    this.maxConnections = maxConnections;
  }

  async initialize() {
    console.log('initialized');
    this.tryConnectToPeers(this.seedPeers);
    this.startPruneLoop();

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

  public updatePeerChainTip(
    peerKey: string,
    height: number,
    timestamp: number
  ) {
    this.peerChainTips.set(peerKey, { height, timestamp });
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
    console.log('hello');
    setInterval(async () => {
      console.log(`🔌 Total connected peers: ${this.getConnectedCount()}`);
      if (this.connectedClients.size >= this.maxConnections) return;

      const peerList = Array.from(discoveredPeers);
      await this.tryConnectToPeers(peerList);
    }, 10_000); // Try every 10 seconds
  }

  public pruneStalePeers(latestHeight: number, latestTimestamp: number) {
    for (const [peerKey, client] of this.connectedClients.entries()) {
      if (
        client.lastKnownBlockHeight === null ||
        client.lastKnownBlockTimestamp === null
      ) {
        continue; // skip peers we haven't heard from
      }

      const heightLag = latestHeight - client.lastKnownBlockHeight;
      const timeLag = latestTimestamp - client.lastKnownBlockTimestamp;

      if (heightLag > this.MAX_BLOCK_LAG || timeLag > this.MAX_TIME_LAG) {
        console.warn(
          `❌ Pruning stale peer ${peerKey} (lagging by ${heightLag} blocks, ${timeLag / 1000}s)`
        );

        this.removePeer(peerKey);
      }
    }
  }
  private startPruneLoop() {
    setInterval(() => {
      let maxHeight = 0;
      let maxTimestamp = 0;

      for (const client of this.connectedClients.values()) {
        if (
          client.lastKnownBlockHeight &&
          client.lastKnownBlockHeight > maxHeight
        ) {
          maxHeight = client.lastKnownBlockHeight;
        }

        if (
          client.lastKnownBlockTimestamp &&
          client.lastKnownBlockTimestamp > maxTimestamp
        ) {
          maxTimestamp = client.lastKnownBlockTimestamp;
        }
      }

      if (maxHeight && maxTimestamp) {
        console.log(
          `🧹 Pruning check: maxHeight=${maxHeight}, maxTimestamp=${new Date(
            maxTimestamp
          ).toLocaleTimeString()}`
        );
        this.pruneStalePeers(maxHeight, maxTimestamp);
      }
    }, 30_000); // Run every 30 seconds
  }

  getConnectedCount() {
    return this.connectedClients.size;
  }

  getConnectedClients() {
    return Array.from(this.connectedClients.values());
  }

  public getBestClient(): LiteNodeClient | null {
    const sorted = [...this.connectedClients.values()]
      .filter(
        (c) =>
          c.lastKnownBlockHeight !== null && c.lastKnownBlockTimestamp !== null
      )
      .sort((a, b) => {
        const heightDiff =
          (b.lastKnownBlockHeight ?? 0) - (a.lastKnownBlockHeight ?? 0);
        if (heightDiff !== 0) return heightDiff;
        return (
          (b.lastKnownBlockTimestamp ?? 0) - (a.lastKnownBlockTimestamp ?? 0)
        );
      });

    return sorted[0] || null;
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
