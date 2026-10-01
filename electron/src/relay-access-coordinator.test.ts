import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RelayAccessCoordinator,
  configureRelaySigner,
  setRelayAccount,
  setRelayGroups,
} from './relay-access-coordinator';
import { PrivateTransportSidecarError } from './private-transport-sidecar';
import { RelayTicketWallet } from './relay-ticket-wallet';

class Sidecar extends EventEmitter {
  prepareRelay = vi.fn(
    async (_config: unknown) =>
      ({ handle: 'ab'.repeat(24), ready: true }) as any
  );
  authorizeRelay = vi.fn(
    async (_handle: string, _proof?: string, _renew?: boolean) =>
      ({ handle: 'ab'.repeat(24), ready: true }) as any
  );
  closeRelay = vi.fn(async (_handle: string) => {});
  clearRelays = vi.fn(async () => {});
}
const advertisement = (host = '8.8.8.8', ids: number[] = []) => ({
  host,
  port: 47322,
  serverName: 'relay.test',
  certSha256: 'ab'.repeat(32),
  expiresAt: Date.now() + 600_000,
  protocolVersion: 3,
  ticketIdentity: 'ef'.repeat(32) + 'cd'.repeat(32),
  ticketKeyId: '12'.repeat(32),
  relayIdentity: 'cd'.repeat(32),
  accessMode: ids.length ? 'groups' : 'public',
  allowedGroupIds: ids,
});
const bridgeFor = (...relays: unknown[]) =>
  ({ getCommunityMasqueRelays: vi.fn(async () => relays) }) as never;
let coordinator: RelayAccessCoordinator;
let sidecar: Sidecar;
beforeEach(() => {
  vi.spyOn(RelayTicketWallet.prototype, 'ensure').mockResolvedValue(undefined);
  vi.spyOn(RelayTicketWallet.prototype, 'take').mockReturnValue(
    '{"epoch":1,"keyId":"key","message":"anonymous","signature":"blind"}'
  );
  setRelayAccount('account-A', true);
  configureRelaySigner(async () => ({
    authorAddress: 'account-A',
    authorPublicKey: 'key',
    signature: 'signature',
  }));
  sidecar = new Sidecar();
  coordinator = new RelayAccessCoordinator(sidecar as never, () => 0);
});
afterEach(() => {
  coordinator.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shared relay selection and authorization', () => {
  it.each([{ ids: [] }, { ids: [9] }])(
    'does not contact restricted relays with fresh nonmatching groups %j',
    async ({ ids }) => {
      setRelayGroups(ids);
      await expect(
        coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])))
      ).rejects.toMatchObject({ code: 'RELAY_NO_ELIGIBLE_RELAY' });
      expect(RelayTicketWallet.prototype.ensure).not.toHaveBeenCalled();
      expect(sidecar.prepareRelay).not.toHaveBeenCalled();
      expect(sidecar.authorizeRelay).not.toHaveBeenCalled();
    }
  );
  it('still tries a restricted relay when membership is unknown', async () => {
    await coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])));
    expect(RelayTicketWallet.prototype.ensure).toHaveBeenCalledTimes(1);
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
  });
  it('does not exclude a relay using stale nonmembership information', async () => {
    vi.useFakeTimers();
    setRelayGroups([]);
    await vi.advanceTimersByTimeAsync(30_000);
    await coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])));
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
  });
  it('uses a public alternative without contacting the ineligible relay', async () => {
    setRelayGroups([]);
    const selected = await coordinator.select(
      bridgeFor(advertisement('8.8.8.8', [42]), advertisement('1.1.1.1'))
    );
    expect(selected.relayAddress).toBe('1.1.1.1:47322');
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
    expect(RelayTicketWallet.prototype.ensure).not.toHaveBeenCalled();
  });
  it('treats a successful empty Core membership result as known nonmembership', async () => {
    configureRelaySigner(vi.fn(), undefined, async () => []);
    await expect(
      coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])))
    ).rejects.toMatchObject({ code: 'RELAY_NO_ELIGIBLE_RELAY' });
    expect(sidecar.prepareRelay).not.toHaveBeenCalled();
  });
  it('shares a concurrent preparation between applications', async () => {
    const bridge = bridgeFor(advertisement());
    const [a, b] = await Promise.all([
      coordinator.select(bridge),
      coordinator.select(bridge),
    ]);
    expect(a.preparedRelay).toBe(b.preparedRelay);
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
    await coordinator.select(bridge);
    expect(sidecar.authorizeRelay).toHaveBeenCalledTimes(1);
  });
  it('moves immediately past a rejected relay', async () => {
    sidecar.prepareRelay.mockRejectedValueOnce(
      new PrivateTransportSidecarError('RELAY_ACCESS_DENIED')
    );
    const result = await coordinator.select(
      bridgeFor(advertisement(), advertisement('1.1.1.1'))
    );
    expect(result.relayAddress).toBe('1.1.1.1:47322');
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(2);
  });
  it('discovers a new relay automatically when its cached relay fails', async () => {
    const bridge = new EventEmitter() as EventEmitter & {
      getCommunityMasqueRelays: ReturnType<typeof vi.fn>;
    };
    let fresh = false;
    bridge.getCommunityMasqueRelays = vi.fn(async (announce: boolean) => {
      if (announce) fresh = true;
      return [advertisement(), ...(fresh ? [advertisement('1.1.1.1')] : [])];
    });
    sidecar.prepareRelay.mockRejectedValueOnce(
      new PrivateTransportSidecarError('RELAY_ACCESS_DENIED')
    );
    await expect(coordinator.select(bridge as never)).resolves.toMatchObject({
      relayAddress: '1.1.1.1:47322',
    });
    expect(bridge.getCommunityMasqueRelays).toHaveBeenCalledWith(true);
  });
  it('hedges a slow relay without waiting for its timeout', async () => {
    vi.useFakeTimers();
    sidecar.prepareRelay.mockImplementationOnce(() => new Promise(() => {}));
    const pending = coordinator.select(
      bridgeFor(advertisement(), advertisement('1.1.1.1'))
    );
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toMatchObject({
      relayAddress: '1.1.1.1:47322',
    });
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(2);
  });
  it('prefers a known matching group without treating the hint as authorization', async () => {
    setRelayGroups([42]);
    await coordinator.select(
      bridgeFor(advertisement('8.8.8.8', [9]), advertisement('1.1.1.1', [42]))
    );
    expect(sidecar.prepareRelay.mock.calls[0][0]).toMatchObject({
      relayAddress: '1.1.1.1:47322',
    });
  });
  it('loads group hints independently when chat has not supplied memberships', async () => {
    const readGroups = vi.fn(async () => [42]);
    configureRelaySigner(
      async () => ({
        authorAddress: 'account-A',
        authorPublicKey: 'key',
        signature: 'signature',
      }),
      undefined,
      readGroups
    );
    await coordinator.select(
      bridgeFor(advertisement('8.8.8.8', [9]), advertisement('1.1.1.1', [42]))
    );
    expect(readGroups).toHaveBeenCalledWith('account-A');
    expect(sidecar.prepareRelay.mock.calls[0][0]).toMatchObject({
      relayAddress: '1.1.1.1:47322',
    });
  });
  it('rejects late results after an account change and releases their connection', async () => {
    let finish!: (value: any) => void;
    sidecar.prepareRelay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = coordinator.select(bridgeFor(advertisement()));
    const checked = expect(pending).rejects.toThrow('RELAY_ACCOUNT_CHANGED');
    await vi.waitFor(() =>
      expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1)
    );
    setRelayAccount('account-B');
    finish({ handle: 'ab'.repeat(24), ready: true });
    await checked;
    expect(sidecar.closeRelay).toHaveBeenCalledWith('ab'.repeat(24));
  });
  it('sends only an anonymous ticket over QUIC', async () => {
    const challenge = {
      type: 'masque-ticket-required-v1',
    };
    sidecar.prepareRelay.mockResolvedValueOnce({
      handle: 'ab'.repeat(24),
      ready: false,
      challenge,
    });
    await coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])));
    expect(JSON.parse(sidecar.authorizeRelay.mock.calls[0][1]!)).toMatchObject({
      message: 'anonymous',
    });
    expect(sidecar.authorizeRelay.mock.calls[0][1]).not.toContain('account-A');
  });
  it('never signs a mismatched policy', async () => {
    const sign = vi.fn();
    configureRelaySigner(sign);
    sidecar.prepareRelay.mockResolvedValueOnce({
      handle: 'ab'.repeat(24),
      ready: false,
      challenge: { type: 'masque-relay-auth-v1' },
    });
    await expect(
      coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])))
    ).rejects.toThrow('RELAY_PROTOCOL_UNSUPPORTED');
    expect(sign).not.toHaveBeenCalled();
  });
  it('removes its sidecar listener on disposal', () => {
    coordinator.dispose();
    expect(sidecar.listenerCount('death')).toBe(0);
  });
  it('renews an expiring grant and shares renewal with new applications', async () => {
    vi.useFakeTimers();
    const handle = 'ab'.repeat(24);
    sidecar.prepareRelay.mockResolvedValueOnce({
      handle,
      ready: true,
      expiresAt: Date.now() + 360_000,
    });
    const bridge = bridgeFor(advertisement('8.8.8.8', [42]));
    await coordinator.select(bridge);
    sidecar.authorizeRelay.mockResolvedValueOnce({
      handle,
      ready: true,
      expiresAt: Date.now() + 43_200_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sidecar.authorizeRelay).toHaveBeenCalledWith(handle, '', true);
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
  });
  it('does not keep renewing a connection after confirmed rejection', async () => {
    vi.useFakeTimers();
    sidecar.prepareRelay.mockResolvedValueOnce({
      handle: 'ab'.repeat(24),
      ready: true,
      expiresAt: Date.now() + 60_000,
    });
    await coordinator.select(bridgeFor(advertisement('8.8.8.8', [42])));
    sidecar.authorizeRelay.mockRejectedValue(
      new PrivateTransportSidecarError('RELAY_ACCESS_DENIED')
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sidecar.authorizeRelay).toHaveBeenCalledTimes(1);
  });
});
