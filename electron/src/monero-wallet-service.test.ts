import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MoneroWalletService } from './monero-wallet-service';
const directories: string[] = [];
const services: MoneroWalletService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.clear()));
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xmr-lock-'));
  directories.push(root);
  const service = new MoneroWalletService(root);
  services.push(service);
  return { root, service };
}
it('does not steal a live process lock and releases only its own token', async () => {
  const { root, service } = setup();
  const second = new MoneroWalletService(root);
  services.push(second);
  (service as any).lock(root + '/cache');
  expect(() => (second as any).lock(root + '/cache')).toThrow('busy');
  await service.clear();
  expect(() => (second as any).lock(root + '/cache')).not.toThrow();
  const owner = JSON.parse(
    fs.readFileSync(root + '/cache/session-lock/owner', 'utf8')
  );
  owner.token = 'replaced';
  fs.writeFileSync(root + '/cache/session-lock/owner', JSON.stringify(owner));
  await second.clear();
  expect(fs.existsSync(root + '/cache/session-lock')).toBe(true);
});
it('recovers a dead process lock under an exclusive recovery guard', async () => {
  const { root, service } = setup();
  fs.mkdirSync(root + '/cache/session-lock', { recursive: true });
  fs.writeFileSync(
    root + '/cache/session-lock/owner',
    JSON.stringify({ pid: 2147483647, token: 'old' })
  );
  (service as any).lock(root + '/cache');
  expect(fs.existsSync(root + '/cache/recovery-lock')).toBe(false);
  const owner = JSON.parse(
    fs.readFileSync(root + '/cache/session-lock/owner', 'utf8')
  );
  expect(owner.pid).toBe(process.pid);
  await service.clear();
});
it('fails closed on corrupt locks or an existing recovery guard', () => {
  const { root, service } = setup();
  fs.mkdirSync(root + '/cache/session-lock', { recursive: true });
  fs.writeFileSync(root + '/cache/session-lock/owner', '{');
  expect(() => (service as any).lock(root + '/cache')).toThrow('busy');
  fs.mkdirSync(root + '/cache/recovery-lock');
  fs.writeFileSync(
    root + '/cache/session-lock/owner',
    JSON.stringify({ pid: 2147483647 })
  );
  expect(() => (service as any).lock(root + '/cache')).toThrow('busy');
});
it('rejects invalid identifiers before creating wallet directories or workers', async () => {
  const { root, service } = setup();
  await expect(
    service.open(1, {
      network: 'mainnet',
      qortalAddress: '../account',
      address: 'invalid',
      privateSpendKey: 'secret',
      restoreHeight: 0,
    } as any)
  ).rejects.toThrow('invalid');
  expect(fs.readdirSync(root)).toEqual([]);
});
it('binds cached public state to its host owner and account', () => {
  const { service } = setup();
  (service as any).owner = 1;
  (service as any).current = { address: 'public', transactions: [] };
  expect(() => service.status(2, 'public')).toThrow('changed');
  expect(() => service.status(1, 'other')).toThrow('changed');
  const status = service.status(1, 'public');
  status.transactions.push({} as any);
  expect(service.status(1, 'public').transactions).toEqual([]);
});
it('fails closed on a wrong-network daemon, HTTP errors and unavailable probes', async () => {
  const { service } = setup();
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  try {
    for (const info of [
      { nettype: 'mainnet', height: 1, status: 'OK' },
      { nettype: 'stagenet', height: '1', status: 'OK' },
    ]) {
      mock.mockResolvedValue({ ok: true, json: async () => info });
      await expect(service.probe()).rejects.toThrow('network');
    }
    mock.mockRejectedValue(Error('raw secret error'));
    await expect(service.probe()).rejects.toThrow('daemon');
  } finally {
    vi.unstubAllGlobals();
  }
});
