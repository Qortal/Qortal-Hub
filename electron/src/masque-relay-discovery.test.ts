import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverCommunityMasqueRelay,
  validateCommunityMasqueRelay,
} from './masque-relay-discovery';

class BridgeStub extends EventEmitter {
  getCommunityMasqueRelays = vi.fn(async (_announce = false) => []);
}

const relay = {
  host: '8.8.8.8',
  port: 47322,
  serverName: 'relay.example',
  certSha256: 'ab'.repeat(32),
  expiresAt: 1_500_000,
};

describe('community MASQUE relay discovery', () => {
  it('validates v3 service identities and ticket key commitments', () => {
    const value={...relay,protocolVersion:3,relayIdentity:'cd'.repeat(32),ticketIdentity:'ef'.repeat(32)+'cd'.repeat(32),ticketKeyId:'12'.repeat(32),accessMode:'groups',allowedGroupIds:[1144]};
    expect(validateCommunityMasqueRelay(value,{now:()=>1_000_000})).toEqual(value);
    for(const invalid of [{...value,ticketKeyId:'bad'},{...value,ticketIdentity:'ab'.repeat(64)},{...value,allowedGroupIds:[]}])expect(validateCommunityMasqueRelay(invalid,{now:()=>1_000_000})).toBeNull();
  });
  it('validates a pinned literal endpoint with a bounded lease', () => {
    expect(
      validateCommunityMasqueRelay(relay, { now: () => 1_000_000 })
    ).toEqual(relay);
  });

  it('rejects DNS endpoints, bad pins, and loopback by default', () => {
    const options = { now: () => 1_000_000 };
    expect(
      validateCommunityMasqueRelay({ ...relay, host: 'relay.example' }, options)
    ).toBeNull();
    expect(
      validateCommunityMasqueRelay({ ...relay, certSha256: 'bad' }, options)
    ).toBeNull();
    expect(
      validateCommunityMasqueRelay({ ...relay, host: '127.0.0.1' }, options)
    ).toBeNull();
  });

  it('uses a cached relay without waiting', async () => {
    const bridge = new BridgeStub();
    bridge.getCommunityMasqueRelays.mockResolvedValueOnce([relay]);
    await expect(
      discoverCommunityMasqueRelay(bridge as never, {
        now: () => 1_000_000,
        random: () => 0,
      })
    ).resolves.toEqual({
      relayAddress: '8.8.8.8:47322',
      relayServerName: 'relay.example',
      relayCertSha256: 'ab'.repeat(32),
      localFallbackAddress: '127.0.0.1:47322',
    });
  });

  it('accepts a query response event', async () => {
    const bridge = new BridgeStub();
    const pending = discoverCommunityMasqueRelay(bridge as never, {
      now: () => 1_000_000,
      timeoutMs: 500,
    });
    await new Promise((resolve) => setImmediate(resolve));
    bridge.emit('community-masque-relay', relay);
    await expect(pending).resolves.toMatchObject({
      relayAddress: '8.8.8.8:47322',
    });
  });

  it('excludes a failed endpoint when selecting a replacement relay', async () => {
    const bridge = new BridgeStub();
    bridge.getCommunityMasqueRelays.mockResolvedValueOnce([
      relay,
      { ...relay, host: '1.1.1.1', certSha256: 'cd'.repeat(32) },
    ]);
    await expect(
      discoverCommunityMasqueRelay(bridge as never, {
        now: () => 1_000_000,
        random: () => 0,
        excludeRelayAddresses: new Set(['8.8.8.8:47322']),
      })
    ).resolves.toMatchObject({ relayAddress: '1.1.1.1:47322' });
  });

  it('uses one fresh query and only polls the cache while waiting', async () => {
    const bridge = new BridgeStub();
    await expect(
      discoverCommunityMasqueRelay(bridge as never, {
        now: () => 1_000_000,
        timeoutMs: 100,
      })
    ).rejects.toThrow('MASQUE_RELAY_UNAVAILABLE');
    expect(bridge.getCommunityMasqueRelays).toHaveBeenCalledTimes(3);
    expect(bridge.getCommunityMasqueRelays).toHaveBeenNthCalledWith(1, false);
    expect(bridge.getCommunityMasqueRelays).toHaveBeenNthCalledWith(2, true);
    expect(bridge.getCommunityMasqueRelays).toHaveBeenNthCalledWith(3, false);
  });

  it('allows loopback only for an explicit development override', () => {
    expect(
      validateCommunityMasqueRelay(
        { ...relay, host: '127.0.0.1' },
        { now: () => 1_000_000, allowLoopback: true }
      )
    ).not.toBeNull();
  });
});
