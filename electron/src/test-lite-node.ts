import { LiteNodeClient, SEED_PEERS } from './lite-node';

async function main() {
  console.log('test');
  for (const ip of SEED_PEERS) {
    const client = new LiteNodeClient(ip);
    try {
      await client.connect();
      //   console.log(`Successfully connected to ${ip}`);
      // Optionally send HELLO message here
      break;
    } catch (err) {
      console.warn(`Failed to connect to ${ip}:`, err);
    }
  }
}

main();
