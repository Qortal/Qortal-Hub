import { createHash } from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import { RelayTicketWallet, relayPolicy } from './relay-ticket-wallet';

function fixture() {
  const relay = {
    protocolVersion: 3 as const,
    accessMode: 'groups' as const,
    allowedGroupIds: [1144],
    relayIdentity: 'cd'.repeat(32),
    ticketIdentity: 'ef'.repeat(32) + 'cd'.repeat(32),
    ticketKeyId: 'ab'.repeat(32),
    relayCertSha256: '12'.repeat(32),
    relayAddress: '8.8.8.8:47322',
    relayServerName: 'relay',
  };
  const descriptor = {
    epoch: Math.floor(Date.now() / 3600000),
    expiresAt: Date.now() + 43200000,
    publicKey: 'key',
    keyId: relay.ticketKeyId,
    relayPin: relay.relayCertSha256,
    policy: relayPolicy(relay),
  };
  const blinded = ['a', 'b', 'c'];
  const sidecar = {
    prepareRelayTickets: vi.fn(async () => ({
      handle: 'ab'.repeat(24),
      blinded,
    })),
    finalizeRelayTickets: vi.fn(async () => ({
      tickets: ['ticket1', 'ticket2', 'ticket3'],
      expiresAt: descriptor.expiresAt,
    })),
  };
  const bridge = {
    relayTicketRequest: vi.fn(
      async (_id: string, path: string, _data: unknown) => {
        if (path === '/catalog') return descriptor;
        if (path === '/challenge')
          return {
            type: 'masque-ticket-issue-v1',
            relayPin: relay.relayCertSha256,
            policy: relayPolicy(relay),
            binding: createHash('sha256')
              .update(JSON.stringify({ key: descriptor.keyId, blinded }))
              .digest('hex'),
            nonce: '34'.repeat(32),
            expiresAt: Date.now() + 60000,
          };
        return { signatures: ['s1', 's2', 's3'] };
      }
    ),
    getCommunityMasqueRelays: vi.fn(async () => []),
  };
  const sign = vi.fn(async () => ({
    authorAddress: 'account-A',
    authorPublicKey: 'pub',
    signature: 'sig',
  }));
  const wallet = new RelayTicketWallet(sidecar as never);
  const ensure = () =>
    wallet.ensure(bridge as never, relay, 'account-A', sign, () => true);
  return { wallet, sidecar, bridge, relay, descriptor, sign, ensure };
}
describe('anonymous relay ticket wallet', () => {
  it('coalesces issuance, keeps spares and spends each ticket once', async () => {
    const f = fixture();
    await Promise.all([f.ensure(), f.ensure()]);
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.bridge.relayTicketRequest.mock.calls.map((c) => c[1])).toEqual([
      '/catalog',
      '/challenge',
      '/issue',
    ]);
    expect(f.wallet.take(f.relay)).toBe('ticket1');
    await f.ensure();
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.wallet.take(f.relay)).toBe('ticket2');
    expect(f.wallet.take(f.relay)).toBe('ticket3');
    expect(() => f.wallet.take(f.relay)).toThrow();
  });
  it('does not sign a wrong relay or policy', async () => {
    const f = fixture();
    f.descriptor.policy = '00'.repeat(32);
    await expect(f.ensure()).rejects.toThrow('RELAY_PROOF_INVALID');
    expect(f.sign).not.toHaveBeenCalled();
  });
  it('sends account proof only through Reticulum', async () => {
    const f = fixture();
    await f.ensure();
    const issued = f.bridge.relayTicketRequest.mock.calls.find(
      (c) => c[1] === '/issue'
    )![2] as any;
    expect(issued.proof.authorAddress).toBe('account-A');
    expect(
      JSON.stringify(f.sidecar.prepareRelayTickets.mock.calls)
    ).not.toContain('account-A');
    expect(
      JSON.stringify(f.sidecar.finalizeRelayTickets.mock.calls)
    ).not.toContain('account-A');
  });
  it('discards all tickets on logout', async () => {
    const f = fixture();
    await f.ensure();
    f.wallet.clear();
    expect(() => f.wallet.take(f.relay)).toThrow();
    await f.ensure();
    expect(f.sign).toHaveBeenCalledTimes(2);
  });
  it('rejects an account change during issuance', async () => {
    const f = fixture();
    f.sign.mockImplementationOnce(async () => {
      f.wallet.clear();
      return {
        authorAddress: 'account-A',
        authorPublicKey: 'pub',
        signature: 'sig',
      };
    });
    await expect(f.ensure()).rejects.toThrow('RELAY_ACCOUNT_CHANGED');
    expect(f.sidecar.finalizeRelayTickets).not.toHaveBeenCalled();
    expect(() => f.wallet.take(f.relay)).toThrow();
  });
  it('fails closed on membership failure without caching credentials', async () => {
    const f = fixture();
    f.bridge.relayTicketRequest.mockRejectedValueOnce(
      new Error('RELAY_MEMBERSHIP_UNAVAILABLE')
    );
    await expect(f.ensure()).rejects.toThrow('RELAY_MEMBERSHIP_UNAVAILABLE');
    expect(() => f.wallet.take(f.relay)).toThrow();
    await f.ensure();
    expect(f.sign).toHaveBeenCalledTimes(1);
  });
  it('refuses old account-proof relays', async () => {
    const f = fixture();
    f.relay.protocolVersion = 2 as never;
    await expect(f.ensure()).rejects.toThrow('RELAY_PROTOCOL_UNSUPPORTED');
    expect(f.sign).not.toHaveBeenCalled();
  });
});
