import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createForeignWalletJournal } from './foreign-wallet-journal';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});
it('persists reservations across restarts and refuses concurrent reservations', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'foreign-wallet-test-')
  );
  directories.push(directory);
  const key = `foreign-send-v1:LTC:${'a'.repeat(64)}`;
  const raw = JSON.stringify({
    txId: 'b'.repeat(64),
    outpoints: [`${'c'.repeat(64)}:0`],
  });
  const first = createForeignWalletJournal(directory);
  const second = createForeignWalletJournal(directory);
  const results = await Promise.allSettled([
    first.set(key, raw),
    second.set(key, raw),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled')
  ).toHaveLength(1);
  expect(await createForeignWalletJournal(directory).get(key)).toBe(raw);
  await expect(first.delete(key, 'd'.repeat(64))).rejects.toThrow();
  await first.delete(key, 'b'.repeat(64));
  expect(await second.get(key)).toBeNull();
});
it('refuses corrupt journals and path traversal instead of reporting no pending send', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'foreign-wallet-test-')
  );
  directories.push(directory);
  const key = `foreign-send-v1:BTC:${'a'.repeat(64)}`;
  const journal = createForeignWalletJournal(directory);
  await fs.writeFile(
    path.join(directory, key.replace(/:/g, '-') + '.json'),
    '{'
  );
  await expect(journal.get(key)).rejects.toThrow();
  await expect(journal.get('../wallet')).rejects.toThrow();
  await expect(journal.set(key, '{}')).rejects.toThrow();
});
