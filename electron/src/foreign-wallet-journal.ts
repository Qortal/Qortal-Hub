import fs from 'node:fs/promises';
import path from 'node:path';

/** Immutable per-wallet reservations. Corruption and disk errors fail closed. */
export function createForeignWalletJournal(directory: string) {
  const fileFor = (key: string) => {
    if (
      typeof key !== 'string' ||
      !/^foreign-send-v1:(BTC|LTC|DOGE|DGB|RVN):[a-f0-9]{64}$/.test(key)
    )
      throw new Error('Invalid journal key');
    return path.join(directory, key.replace(/:/g, '-') + '.json');
  };
  const validate = (raw: string) => {
    if (typeof raw !== 'string' || raw.length > 500000)
      throw new Error('Invalid journal');
    const entry = JSON.parse(raw);
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(entry.txId) ||
      !Array.isArray(entry.outpoints) ||
      entry.outpoints.length < 1 ||
      entry.outpoints.length > 1000 ||
      (entry.rawTransactionHex !== undefined &&
        (typeof entry.rawTransactionHex !== 'string' ||
          entry.rawTransactionHex.length > 400000 ||
          !/^(?:[a-f0-9]{2})+$/.test(entry.rawTransactionHex))) ||
      (entry.broadcastBefore !== undefined &&
        (!Number.isSafeInteger(entry.broadcastBefore) ||
          entry.broadcastBefore <= 0)) ||
      entry.outpoints.some(
        (point: unknown) =>
          typeof point !== 'string' || !/^[a-f0-9]{64}:[0-9]{1,10}$/.test(point)
      )
    )
      throw new Error('Invalid journal');
    return raw;
  };
  const read = async (key: string): Promise<string | null> => {
    try {
      return validate(await fs.readFile(fileFor(key), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const syncDirectory = async () => {
    // Windows does not support opening directories for fsync via Node.
    if (process.platform === 'win32') return;
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };
  const mutate = async <T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    await fs.mkdir(directory, { recursive: true });
    const lock = fileFor(key) + '.lock';
    await fs.mkdir(lock);
    try {
      return await operation();
    } finally {
      await fs.rmdir(lock);
    }
  };
  return {
    get: read,
    set: (key: string, raw: string) =>
      mutate(key, async () => {
        const filename = fileFor(key);
        validate(raw);
        await fs.mkdir(directory, { recursive: true });
        // O_EXCL also arbitrates independent Electron instances. A partially written
        // reservation is deliberately retained on failure and blocks further sends.
        const handle = await fs.open(filename, 'wx', 0o600);
        try {
          await handle.writeFile(raw, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await syncDirectory();
      }),
    delete: (key: string, expectedTxId: string) =>
      mutate(key, async () => {
        const current = await read(key);
        if (!current || JSON.parse(current).txId !== expectedTxId)
          throw new Error('Journal changed before reconciliation');
        // Only the host's reconciliation path calls this after observing the spend.
        await fs.unlink(fileFor(key));
        await syncDirectory();
      }),
  };
}
