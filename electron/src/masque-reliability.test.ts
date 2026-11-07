import { EventEmitter } from 'events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  RelayAccessCoordinator,
  configureRelaySigner,
  setRelayAccount,
  setRelayGroups,
} from './relay-access-coordinator';
import { MoqMasqueTransport } from './moq-masque-transport';
import { QuicMasqueTransport } from './quic-masque-transport';
const ad = (host = '8.8.8.8', ids: number[] = []) => ({
  host,
  port: 47322,
  serverName: 'relay.test',
  certSha256: 'ab'.repeat(32),
  expiresAt: Date.now() + 600000,
  protocolVersion: 3,
  ticketIdentity: 'ef'.repeat(32) + 'cd'.repeat(32),
  ticketKeyId: '12'.repeat(32),
  relayIdentity: 'cd'.repeat(32),
  accessMode: ids.length ? 'groups' : 'public',
  allowedGroupIds: ids,
});
class Sidecar extends EventEmitter {
  prepareRelay = vi.fn(async () => ({ handle: 'ab'.repeat(24), ready: true }));
  authorizeRelay = vi.fn(async () => ({
    handle: 'ab'.repeat(24),
    ready: true,
  }));
  closeRelay = vi.fn(async () => {});
  clearRelays = vi.fn(async () => {});
  openPrivateSession = vi.fn(async () => ({ sessionId: 'native' }));
  closePrivateSession = vi.fn(async () => {});
  openMoqSession = vi.fn(async () => ({ moqSessionId: 'native' }));
  closeMoqSession = vi.fn(async () => {});
}
let sidecar: Sidecar, coordinator: RelayAccessCoordinator;
beforeEach(() => {
  vi.useFakeTimers();
  setRelayAccount('account', true);
  configureRelaySigner(vi.fn());
  sidecar = new Sidecar();
  coordinator = new RelayAccessCoordinator(sidecar as never, () => 0);
});
afterEach(() => {
  coordinator.dispose();
  vi.useRealTimers();
});
it('discovers an accessible relay when the cache contains only ineligible groups', async () => {
  setRelayGroups([]);
  let announced = false;
  const bridge = Object.assign(new EventEmitter(), {
    getCommunityMasqueRelays: vi.fn(async (announce: boolean) => {
      if (announce) announced = true;
      return [ad('8.8.8.8', [42]), ...(announced ? [ad('1.1.1.1')] : [])];
    }),
  });
  await expect(coordinator.select(bridge as never)).resolves.toMatchObject({
    relayAddress: '1.1.1.1:47322',
  });
});
it('does not prepare a relay after disposal while collecting discovery results', async () => {
  let finish!: (value: unknown[]) => void;
  const bridge = Object.assign(new EventEmitter(), {
    getCommunityMasqueRelays: vi.fn(
      () => new Promise<unknown[]>((r) => (finish = r))
    ),
  });
  const result = coordinator.select(bridge as never);
  const checked = expect(result).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  coordinator.dispose();
  finish([ad()]);
  await checked;
  expect(sidecar.prepareRelay).not.toHaveBeenCalled();
});
it.each([
  ['quic', 'death'],
  ['moq', 'death'],
  ['quic', 'SIDECAR_REQUEST_TIMEOUT'],
  ['moq', 'SIDECAR_REQUEST_TIMEOUT'],
  ['quic', 'SIDECAR_NOT_RUNNING'],
  ['moq', 'SIDECAR_WRITE_FAILED'],
])(
  'reconnects %s through the only healthy relay after %s',
  async (kind, failure) => {
    const bridge = Object.assign(new EventEmitter(), {
      getCommunityMasqueRelays: vi.fn(async () => [ad()]),
    });
    const events = vi.fn();
    const provider = {
      getBootstrap: vi.fn(async () => ({
        version: 1,
        transport: 'quic-masque-inner-v1' as const,
        backendRnsDestination: 'ab'.repeat(16),
        backendTransportEndpoint: '127.0.0.1:4445',
        backendTransportServerName: 'backend.test',
        backendTransportCertSha256: 'cd'.repeat(32),
        logicalSessionId: 'logical',
        attachToken: 'token',
        nonce: 'n'.repeat(32),
        ownerBindingHash: 'ef'.repeat(32),
        expiresAt: Date.now() + 10000,
        applicationProtocol: 'moqt-18' as const,
        supportedFeatures: {
          reliable: true,
          datagrams: true,
          moqt: true,
          moqtReliableGroups: true,
        },
      })),
    };
    const Transport =
      kind === 'quic' ? QuicMasqueTransport : MoqMasqueTransport;
    const transport = new Transport(
      events,
      sidecar as never,
      (excluded) => coordinator.select(bridge as never, excluded),
      provider
    );
    try {
      await transport.open({
        owner: { tabId: 'tab', name: 'app', service: 'APP' },
        rnsConnectionId: 'rns',
        purpose: 'realtime',
        publicationNamespace: ['qortal', 'apps', 'sample'],
        publicationTrack: 'events',
      } as never);
      if (failure === 'death') sidecar.emit('death');
      else
        sidecar.emit('event', {
          event: 'error',
          sessionId: 'native',
          code: failure,
          data: Buffer.alloc(0),
        });
      await vi.advanceTimersByTimeAsync(100);
      expect(
        kind === 'quic' ? sidecar.openPrivateSession : sidecar.openMoqSession
      ).toHaveBeenCalledTimes(2);
      expect(events).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error' })
      );
    } finally {
      await transport.close();
    }
  }
);

it.each(['clear', 'dispose'] as const)(
  'closes a late prepared handle after %s',
  async (action) => {
    let finish!: (value: any) => void;
    sidecar.prepareRelay.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    );
    const bridge = Object.assign(new EventEmitter(), {
      getCommunityMasqueRelays: vi.fn(async () => [ad()]),
    });
    const pending = coordinator.select(bridge as never);
    const checked = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
    coordinator[action]();
    await checked;
    finish({ handle: 'late', ready: true, expiresAt: Date.now() + 360000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sidecar.closeRelay).toHaveBeenCalledWith('late');
    expect(vi.getTimerCount()).toBe(0);
    if (action === 'clear') {
      await coordinator.select(bridge as never);
      expect(sidecar.prepareRelay).toHaveBeenCalledTimes(2);
      expect(sidecar.authorizeRelay).not.toHaveBeenCalled();
    }
  }
);

it('disposal removes discovery listeners and wait timers immediately', async () => {
  const bridge = Object.assign(new EventEmitter(), {
    getCommunityMasqueRelays: vi.fn(async () => []),
  });
  const pending = coordinator.select(bridge as never);
  const checked = expect(pending).rejects.toThrow('TRANSPORT_CLOSED');
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.listenerCount('community-masque-relay')).toBe(1);
  coordinator.dispose();
  await checked;
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.listenerCount('community-masque-relay')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await expect(coordinator.select(bridge as never)).rejects.toThrow(
    'TRANSPORT_CLOSED'
  );
});

it('a renewal finishing after disposal cannot restore its timer', async () => {
  sidecar.prepareRelay.mockResolvedValueOnce({
    handle: 'renewing',
    ready: true,
    expiresAt: Date.now() + 360000,
  } as any);
  const bridge = Object.assign(new EventEmitter(), {
    getCommunityMasqueRelays: vi.fn(async () => [ad()]),
  });
  await coordinator.select(bridge as never);
  let finish!: (value: any) => void;
  sidecar.authorizeRelay.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve))
  );
  await vi.advanceTimersByTimeAsync(60000);
  expect(sidecar.authorizeRelay).toHaveBeenCalledTimes(1);
  coordinator.dispose();
  finish({ handle: 'renewing', ready: true, expiresAt: Date.now() + 360000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a pending account lookup on disposal without changing the account', async () => {
  let finish!: (value: string) => void;
  configureRelaySigner(
    vi.fn(),
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const bridge = Object.assign(new EventEmitter(), {
    getCommunityMasqueRelays: vi.fn(async () => [ad()]),
  });
  const pending = coordinator.select(bridge as never);
  const checked = expect(pending).rejects.toThrow('TRANSPORT_CLOSED');
  coordinator.dispose();
  await checked;
  finish('new-account');
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.getCommunityMasqueRelays).not.toHaveBeenCalled();
  expect(sidecar.prepareRelay).not.toHaveBeenCalled();
});

it('coalesces initial account loading without cancelling concurrent callers', async () => {
  let finish!: (value: string) => void;
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  configureRelaySigner(vi.fn(), read);
  const bridge = Object.assign(new EventEmitter(), {
    getCommunityMasqueRelays: vi.fn(async () => [ad()]),
  });
  const first = coordinator.select(bridge as never);
  const second = coordinator.select(bridge as never);
  finish('new-account');
  const [a, b] = await Promise.all([first, second]);
  expect(a.preparedRelay).toBe(b.preparedRelay);
  expect(read).toHaveBeenCalledTimes(1);
  expect(sidecar.prepareRelay).toHaveBeenCalledTimes(1);
});
