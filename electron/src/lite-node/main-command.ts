// src/main.ts
import readline from 'readline';

import { MessageType } from './protocol/messageTypes';
import { LiteNodeClient } from './LiteNodeClient';
import { createGetAccountBalancePayload } from './protocol/payloads';

const SEED_PEERS = ['127.0.0.1'];

let activeClient: LiteNodeClient | null = null;

async function main() {
  process.once('SIGINT', () => {
    console.log('\n🛑 Caught SIGINT, closing client...');
    activeClient?.close();
    process.exit(0);
  });

  for (const ip of SEED_PEERS) {
    const client = new LiteNodeClient(ip);
    try {
      await client.connect();
      activeClient = client;
      console.log(`✅ Connected to ${ip}`);
      break;
    } catch (err) {
      console.warn(`❌ Failed to connect to ${ip}:`, err);
    }
  }

  if (!activeClient) {
    console.error('❌ Could not connect to any peer');
    process.exit(1);
  }

  // ⌨️ Start command line input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', (input) => {
    const trimmed = input.trim();
    if (trimmed.startsWith('balance')) {
      const parts = trimmed.split(' ');
      const address = parts[1];
      if (!address) return console.log('⚠️ Usage: balance <QortalAddress>');

      const payload = createGetAccountBalancePayload(address, 0);
      activeClient!.sendMessage(MessageType.GET_ACCOUNT_BALANCE, payload);
      console.log(`📤 Sent GET_ACCOUNT_BALANCE for ${address}`);
    }

    // More commands can go here...
    else if (trimmed === 'exit') {
      rl.close();
    } else {
      console.log('❓ Unknown command');
    }
  });

  rl.on('close', () => {
    console.log('👋 Exiting...');
    activeClient?.close();
    process.exit(0);
  });

  console.log('🟢 Enter a command (e.g., `balance Q...`, `exit`)');
}

main();
