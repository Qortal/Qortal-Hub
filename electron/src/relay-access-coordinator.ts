import { RelayTicketWallet } from './relay-ticket-wallet';
import net from 'net';
import type { ReticulumBridge } from './reticulum-bridge';
import {
  discoverCommunityMasqueRelay,
  validateCommunityMasqueRelay,
} from './masque-relay-discovery';
import {
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
  type PreparedRelay,
} from './private-transport-sidecar';
import type { TrustedRelayConfig } from './quic-masque-transport';

type Signature = {
  authorAddress: string;
  authorPublicKey: string;
  signature: string;
};
type Signer = (fields: Record<string, unknown>) => Promise<Signature | null>;
let signer: Signer | undefined;
let accountReader: (() => Promise<string>) | undefined;
let groupReader: ((address: string) => Promise<number[] | null>) | undefined;
let groupRead: { epoch: number; promise: Promise<number[] | null> } | undefined;
let accountRead: Promise<void> | undefined;
let account = '';
let generation = 0;
let groups: Set<number> | null = null;
let groupsAt = 0;
const instances = new Set<RelayAccessCoordinator>();

export function configureRelaySigner(
  value: Signer,
  readAccount?: () => Promise<string>,
  readGroups?: (address: string) => Promise<number[] | null>
) {
  signer = value;
  accountReader = readAccount;
  groupReader = readGroups;
}
export function setRelayAccount(address: string, force = false) {
  if (address === account && !force) return;
  const clearHints = !!account || !address;
  account = address;
  generation++;
  if (clearHints) {
    groups = null;
    groupsAt = 0;
  }
  for (const coordinator of instances) coordinator.clear();
}
export function setRelayGroups(ids: number[]) {
  groups = new Set(ids.filter((id) => Number.isInteger(id) && id > 0));
  groupsAt = Date.now();
}

/** Main-process only. Announcements are selection hints; admission is enforced
 * on the peer's actual TLS connection. Neither QApps nor discovery can sign. */
export class RelayAccessCoordinator {
  private tickets: RelayTicketWallet;
  private bridge?: ReticulumBridge;
  private pending = new Map<string, Promise<TrustedRelayConfig>>();
  private ready = new Map<string, TrustedRelayConfig>();
  private failures = new Map<string, number>();
  private failedEndpoints = new Map<string, number>();
  private renewals = new Map<string, NodeJS.Timeout>();
  private discovery: Promise<unknown> | null = null;
  private onDeath = () => this.clear();
  constructor(
    private sidecar: PrivateTransportSidecar,
    private random = Math.random
  ) {
    this.tickets = new RelayTicketWallet(sidecar);
    instances.add(this);
    sidecar.on('death', this.onDeath);
  }
  clear() {
    this.tickets.clear();
    for (const timer of this.renewals.values()) clearTimeout(timer);
    this.renewals.clear();
    this.pending.clear();
    this.ready.clear();
    this.failures.clear();
    this.failedEndpoints.clear();
    void this.sidecar.clearRelays().catch(() => undefined);
  }
  dispose() {
    this.clear();
    this.sidecar.off('death', this.onDeath);
    instances.delete(this);
  }
  async select(
    bridge: ReticulumBridge,
    excluded: ReadonlySet<string> = new Set(),
    allowLoopback = false
  ): Promise<TrustedRelayConfig> {
    this.bridge = bridge;
    const deadline = Date.now() + 60_000;
    try {
      return await this.selectPass(bridge, excluded, allowLoopback, deadline);
    } catch (error) {
      const code =
        error instanceof PrivateTransportSidecarError
          ? error.code
          : error instanceof Error
            ? error.message
            : '';
      if (
        ![
          'RELAY_CONNECT_FAILED',
          'RELAY_ACCESS_DENIED',
          'RELAY_MEMBERSHIP_UNAVAILABLE',
          'RELAY_FULL',
          'RELAY_BUSY',
          'MASQUE_RELAY_UNAVAILABLE',
        ].includes(code) ||
        Date.now() >= deadline
      )
        throw error;
      const rejected = new Set(excluded);
      for (const [endpoint, until] of this.failedEndpoints)
        if (until > Date.now()) rejected.add(endpoint);
      // Cached relays can all be dead or inaccessible. Ask the network once
      // for a fresh alternative instead of requiring a manual reconnect.
      this.discovery ??= discoverCommunityMasqueRelay(bridge, {
        allowLoopback,
        excludeRelayAddresses: rejected,
        timeoutMs: Math.min(5_000, deadline - Date.now()),
      }).finally(() => {
        this.discovery = null;
      });
      try {
        await this.discovery;
      } catch {
        throw error;
      }
      return this.selectPass(bridge, rejected, allowLoopback, deadline);
    }
  }
  private async selectPass(
    bridge: ReticulumBridge,
    excluded: ReadonlySet<string>,
    allowLoopback: boolean,
    deadlineAt: number
  ): Promise<TrustedRelayConfig> {
    if (accountReader) {
      if (!accountRead) {
        const before = generation;
        accountRead = accountReader()
          .then((address) => {
            if (before !== generation) throw new Error('RELAY_ACCOUNT_CHANGED');
            setRelayAccount(address);
          })
          .finally(() => {
            accountRead = undefined;
          });
      }
      await accountRead;
    }
    const epoch = generation;
    const collect = async () =>
      (await bridge.getCommunityMasqueRelays(false))
        .map((value) => validateCommunityMasqueRelay(value, { allowLoopback }))
        .filter(Boolean)
        .map(
          (relay) =>
            ({
              relayAddress: `${net.isIP(relay!.host) === 6 ? `[${relay!.host}]` : relay!.host}:${relay!.port}`,
              relayServerName: relay!.serverName,
              relayCertSha256: relay!.certSha256,
              localFallbackAddress: `127.0.0.1:${relay!.port}`,
              protocolVersion: relay!.protocolVersion,
              relayIdentity: relay!.relayIdentity,
              ticketIdentity: relay!.ticketIdentity,
              ticketKeyId: relay!.ticketKeyId,
              accessMode: relay!.accessMode,
              allowedGroupIds: relay!.allowedGroupIds,
            }) satisfies TrustedRelayConfig
        );
    let candidates = await collect();
    if (!candidates.some((r) => !excluded.has(r.relayAddress))) {
      this.discovery ??= discoverCommunityMasqueRelay(bridge, {
        allowLoopback,
        excludeRelayAddresses: excluded,
        timeoutMs: Math.max(1, Math.min(8_000, deadlineAt - Date.now())),
      }).finally(() => {
        this.discovery = null;
      });
      await this.discovery;
      candidates = await collect();
    }
    if (
      candidates.length &&
      candidates.every((r) => r.accessMode === 'groups') &&
      (!groups || Date.now() - groupsAt >= 30_000) &&
      groupReader &&
      account
    ) {
      if (!groupRead || groupRead.epoch !== epoch) {
        const operation = groupReader(account).catch(() => null);
        groupRead = { epoch, promise: operation };
        void operation.finally(() => {
          if (groupRead?.promise === operation) groupRead = undefined;
        });
      }
      const hints = await groupRead.promise;
      if (epoch !== generation) throw new Error('RELAY_ACCOUNT_CHANGED');
      if (hints) setRelayGroups(hints);
    }
    const score = (relay: TrustedRelayConfig) => {
      if (this.ready.has(this.key(relay))) return 0;
      if (relay.accessMode !== 'groups') return 1;
      if (groups && relay.allowedGroupIds?.some((id) => groups!.has(id)))
        return 1;
      return 2;
    };
    candidates = candidates.filter(
      (r) =>
        !excluded.has(r.relayAddress) &&
        (this.failures.get(this.key(r)) ?? 0) <= Date.now()
    );
    const tieBreak = new Map(
      candidates.map((r) => [this.key(r), this.random()])
    );
    candidates.sort(
      (a, b) =>
        score(a) - score(b) ||
        tieBreak.get(this.key(a))! - tieBreak.get(this.key(b))!
    );
    // Unknown/stale membership is lower priority, never permanent exclusion.
    const eligible = candidates.filter(
      (r) =>
        !(
          r.accessMode === 'groups' &&
          groups &&
          Date.now() - groupsAt < 30_000 &&
          !r.allowedGroupIds?.some((id) => groups!.has(id))
        )
    );
    if (candidates.length && !eligible.length)
      throw new PrivateTransportSidecarError('RELAY_NO_ELIGIBLE_RELAY');
    candidates = eligible;
    if (!candidates.length) throw new Error('MASQUE_RELAY_UNAVAILABLE');
    let index = 0,
      finished = false,
      active = 0;
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => {
          finished = true;
          reject(new Error('MASQUE_RELAY_UNAVAILABLE'));
        },
        Math.max(1, deadlineAt - Date.now())
      );
      let lastError: unknown = new Error('MASQUE_RELAY_UNAVAILABLE');
      const next = () => {
        if (finished) return;
        if (epoch !== generation) {
          finished = true;
          clearTimeout(deadline);
          reject(new Error('RELAY_ACCOUNT_CHANGED'));
          return;
        }
        if (index >= Math.min(6, candidates.length)) {
          if (!active) {
            finished = true;
            clearTimeout(deadline);
            reject(lastError);
          }
          return;
        }
        const candidate = candidates[index++];
        active++;
        this.prepare(candidate, epoch)
          .then((result) => {
            if (finished) return;
            if (epoch !== generation) {
              finished = true;
              clearTimeout(deadline);
              reject(new Error('RELAY_ACCOUNT_CHANGED'));
              return;
            }
            finished = true;
            clearTimeout(deadline);
            resolve(result);
          })
          .catch((error) => {
            lastError = error;
            active--;
            next();
          });
      };
      next();
      const hedge = setTimeout(() => {
        if (!finished && active < 2) next();
      }, 300);
      hedge.unref?.();
    });
  }
  private key(r: TrustedRelayConfig) {
    return `${generation}:${r.relayAddress}:${r.relayCertSha256}:${JSON.stringify(r.allowedGroupIds ?? [])}`;
  }
  private prepare(
    relay: TrustedRelayConfig,
    epoch: number
  ): Promise<TrustedRelayConfig> {
    const key = this.key(relay);
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 32)
      return Promise.reject(new PrivateTransportSidecarError('RELAY_BUSY'));
    const operation = (async () => {
      let prepared: PreparedRelay | undefined;
      let connectedRelay = relay;
      const prior = this.ready.get(key);
      try {
        if (prior?.preparedRelay) {
          try {
            prepared = await this.sidecar.authorizeRelay(prior.preparedRelay);
          } catch {
            this.ready.delete(key);
          }
        }
        if (prepared && prior) connectedRelay = prior;
        if (!prepared || prepared.challenge)
          await this.ensureTickets(relay, epoch);
        if (!prepared) {
          try {
            prepared = await this.sidecar.prepareRelay({
              ...relay,
              legacyRelay: ![2, 3].includes(relay.protocolVersion ?? 1),
            });
          } catch (error) {
            // Same-host fallback requires possession of the advertised TLS key.
            if (
              !(error instanceof PrivateTransportSidecarError) ||
              error.code !== 'RELAY_CONNECT_FAILED' ||
              !relay.localFallbackAddress ||
              relay.localFallbackAddress === relay.relayAddress
            )
              throw error;
            connectedRelay = {
              ...relay,
              relayAddress: relay.localFallbackAddress,
            };
            prepared = await this.sidecar.prepareRelay({
              ...connectedRelay,
              legacyRelay: ![2, 3].includes(relay.protocolVersion ?? 1),
            });
          }
        }
        prepared = await this.complete(relay, prepared, epoch);
        if (this.ready.size >= 512 && !this.ready.has(key)) {
          const disposable = [...this.ready.keys()].find(
            (k) => !this.renewals.has(k)
          );
          if (disposable) this.ready.delete(disposable);
          else throw new PrivateTransportSidecarError('RELAY_POOL_FULL');
        }
        const ready = { ...connectedRelay, preparedRelay: prepared.handle };
        this.ready.set(key, ready);
        this.scheduleRenewal(key, ready, prepared.expiresAt, epoch);
        return ready;
      } catch (error) {
        if (prepared?.handle)
          void this.sidecar.closeRelay(prepared.handle).catch(() => undefined);
        this.ready.delete(key);
        const code =
          error instanceof PrivateTransportSidecarError ? error.code : '';
        if (this.failures.size >= 256)
          this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(
          key,
          Date.now() + (code === 'RELAY_ACCESS_DENIED' ? 15_000 : 5_000)
        );
        if (this.failedEndpoints.size >= 256)
          this.failedEndpoints.delete(
            this.failedEndpoints.keys().next().value!
          );
        this.failedEndpoints.set(relay.relayAddress, Date.now() + 5_000);
        throw error;
      }
    })().finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
    this.pending.set(key, operation);
    return operation;
  }
  private async complete(
    relay: TrustedRelayConfig,
    result: PreparedRelay,
    epoch: number
  ) {
    if (epoch !== generation) throw new Error('RELAY_ACCOUNT_CHANGED');
    if (result.challenge) {
      if (
        relay.protocolVersion !== 3 ||
        relay.accessMode !== 'groups' ||
        JSON.stringify(result.challenge) !==
          '{"type":"masque-ticket-required-v1"}'
      )
        throw new PrivateTransportSidecarError('RELAY_PROTOCOL_UNSUPPORTED');
      result = await this.sidecar.authorizeRelay(
        result.handle,
        this.tickets.take(relay)
      );
    }
    if (!result.ready || epoch !== generation)
      throw new Error('RELAY_AUTH_UNAVAILABLE');
    return result;
  }
  private async ensureTickets(relay: TrustedRelayConfig, epoch: number) {
    if (relay.accessMode !== 'groups') return;
    if (!this.bridge || !account || !signer)
      throw new Error('RELAY_AUTH_UNAVAILABLE');
    // Refresh signed key commitment after hourly rotation, including renewals.
    const candidates = await this.bridge.getCommunityMasqueRelays(false);
    const latest = candidates
      .map((v) => validateCommunityMasqueRelay(v, { allowLoopback: true }))
      .find(
        (v) =>
          v?.relayIdentity === relay.relayIdentity &&
          v?.certSha256 === relay.relayCertSha256 &&
          JSON.stringify(v?.allowedGroupIds) ===
            JSON.stringify(relay.allowedGroupIds)
      );
    const current = latest
      ? {
          ...relay,
          ticketIdentity: latest.ticketIdentity,
          ticketKeyId: latest.ticketKeyId,
          protocolVersion: latest.protocolVersion,
        }
      : relay;
    await this.tickets.ensure(
      this.bridge,
      current,
      account,
      signer,
      () => epoch === generation
    );
  }
  private scheduleRenewal(
    key: string,
    relay: TrustedRelayConfig,
    expires: number | undefined,
    epoch: number,
    retryDelay?: number
  ) {
    const old = this.renewals.get(key);
    if (old) clearTimeout(old);
    if (!expires || !relay.preparedRelay) return;
    const timer = setTimeout(
      async () => {
        this.renewals.delete(key);
        if (epoch !== generation) return;
        if (this.pending.has(key)) {
          this.scheduleRenewal(key, relay, expires, epoch, 1_000);
          return;
        }
        const renewal = (async () => {
          await this.ensureTickets(relay, epoch);
          let result = await this.sidecar.authorizeRelay(
            relay.preparedRelay!,
            '',
            true
          );
          result = await this.complete(relay, result, epoch);
          this.scheduleRenewal(key, relay, result.expiresAt, epoch);
          return relay;
        })();
        this.pending.set(key, renewal);
        try {
          await renewal;
        } catch (error) {
          this.ready.delete(key);
          if (
            error instanceof PrivateTransportSidecarError &&
            [
              'RELAY_ACCESS_DENIED',
              'RELAY_PROOF_INVALID',
              'RELAY_CONNECTION_CLOSED',
            ].includes(error.code)
          ) {
            this.failures.set(key, Date.now() + 15_000);
            return;
          }
          // The relay's deadline remains authoritative if renewal is unavailable.
          // Retry promptly while it remains valid; never extend cached permission.
          if (epoch === generation && Date.now() + 5_000 < expires) {
            this.scheduleRenewal(key, relay, expires, epoch, 5_000);
          }
        } finally {
          if (this.pending.get(key) === renewal) this.pending.delete(key);
        }
      },
      retryDelay ?? Math.max(1_000, expires - Date.now() - 5 * 60_000)
    );
    timer.unref?.();
    this.renewals.set(key, timer);
  }
}
