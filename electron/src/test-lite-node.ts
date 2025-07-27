import { LiteNodeClient, SEED_PEERS } from './lite-node';

async function main() {
  console.log('test');
  for (const ip of SEED_PEERS) {
    const client = new LiteNodeClient(ip);
    try {
      await client.connect();

      break; // stop after first successful connection
    } catch (err) {
      console.warn(`Failed to connect to ${ip}:`, err);
    }
  }
}

main();
