// src/lite-node/clientInstance.ts
import { LiteNodeClient } from './LiteNodeClient';

const SEED_PEERS = ['127.0.0.1'];

let client: LiteNodeClient | null = null;

export async function getClient(): Promise<LiteNodeClient> {
  if (client) return client;

  for (const ip of SEED_PEERS) {
    const instance = new LiteNodeClient(ip);
    try {
      await instance.connect();
      client = instance;
      return client;
    } catch (err) {
      console.warn(`❌ Failed to connect to ${ip}:`, err);
    }
  }

  throw new Error('No seed peers could be connected');
}
