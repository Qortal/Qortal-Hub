import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { registerMainWindowWalletStorage } from './main-window-storage';

it('preserves wallet storage while rejecting foreign senders and path traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-wallet-storage-'));
  try {
    const file = join(dir, 'wallet-storage.json');
    const handlers = new Map<string, (...args: any[]) => Promise<any>>();
    const event = { trusted: true } as any;
    const getFilePath = vi.fn(async () => file);
    registerMainWindowWalletStorage({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn as any) },
      checkSender: (e: any) => {
        if (!e.trusted) throw new Error('Untrusted');
      },
      getFilePath,
      onError: vi.fn(),
    });
    const read = handlers.get('walletStorage:read')!;
    const write = handlers.get('walletStorage:write')!;
    expect(await read(event, 'wallet-storage.json')).toBeNull();
    const data = JSON.stringify({
      wallets: ['synthetic-backup'],
      customNodes: [],
    });
    expect(await write(event, 'wallet-storage.json', data)).toBe(true);
    expect(await read(event, 'wallet-storage.json')).toBe(data);
    for (const path of [
      '../secret',
      '/tmp/secret',
      'app-settings.json',
      null,
    ]) {
      await expect(read(event, path)).rejects.toThrow('Invalid wallet');
      await expect(write(event, path, 'bad')).rejects.toThrow('Invalid wallet');
    }
    event.trusted = false;
    await expect(read(event, 'wallet-storage.json')).rejects.toThrow(
      'Untrusted'
    );
    await expect(write(event, 'wallet-storage.json', 'bad')).rejects.toThrow(
      'Untrusted'
    );
    expect(await readFile(file, 'utf8')).toBe(data);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
