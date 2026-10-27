import { waitForRelayOperation } from './relay-operation';
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

type RelayEpoch = { account: number; signal: AbortSignal };

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
let accountRead:
  | {
      epoch: number;
      appliedGeneration?: number;
      promise: Promise<string>;
    }
  | undefined;
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
  for (const coordinator of instances)
    coordinator.clear('RELAY_ACCOUNT_CHANGED');
}
export function setRelayGroups(ids: number[]) {
  groups = new Set(ids.filter((id) => Number.isInteger(id) && id > 0));
  groupsAt = Date.now();
}

/** Main-process only. Announcements are selection hints; admission is enforced
 * on the peer's actual TLS connection. Neither QApps nor discovery can sign. */
export class RelayAccessCoordinator {
  private lifecycle = new AbortController();
  private disposed = false;
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
  clear(reason = 'RELAY_CONNECTION_CLOSED') {
    this.lifecycle.abort(new PrivateTransportSidecarError(reason));
    this.lifecycle = new AbortController();
    this.discovery = null;
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
    if (this.disposed) return;
    this.disposed = true;
    this.clear('TRANSPORT_CLOSED');
    this.sidecar.off('death', this.onDeath);
    instances.delete(this);
  }
  async select(
    bridge: ReticulumBridge,
    excluded: ReadonlySet<string> = new Set(),
    allowLoopback = false
  ): Promise<TrustedRelayConfig> {
    if (this.disposed)
      throw new PrivateTransportSidecarError('TRANSPORT_CLOSED');
    if (accountReader) {
      if (!accountRead) {
        const read = { epoch: generation, promise: accountReader() };
        accountRead = read;
        const finished = () => {
          if (accountRead === read) accountRead = undefined;
        };
        void read.promise.then(finished, finished);
      }
      const read = accountRead;
      const signal = this.lifecycle.signal;
      const address = await waitForRelayOperation(read.promise, signal);
      if (this.disposed)
        throw new PrivateTransportSidecarError('TRANSPORT_CLOSED');
      // Concurrent readers can share the account transition caused by this
      // exact read, but must not revive work after an unrelated clear/switch.
      if (read.appliedGeneration !== generation) {
        signal.throwIfAborted();
        if (read.epoch !== generation) throw new Error('RELAY_ACCOUNT_CHANGED');
        setRelayAccount(address);
        read.appliedGeneration = generation;
      } else if (
        signal.aborted &&
        signal.reason?.code !== 'RELAY_ACCOUNT_CHANGED'
      ) {
        signal.throwIfAborted();
      }
    }
    const epoch = { account: generation, signal: this.lifecycle.signal };
    return waitForRelayOperation(
      this.selectCurrent(bridge, excluded, allowLoopback, epoch),
      epoch.signal
    );
  }
  private async selectCurrent(
    bridge: ReticulumBridge,
    excluded: ReadonlySet<string>,
    allowLoopback: boolean,
    epoch: RelayEpoch
  ): Promise<TrustedRelayConfig> {
    this.bridge = bridge;
    const deadline = Date.now() + 60_000;
    try {
      return await this.selectPass(
        bridge,
        excluded,
        allowLoopback,
        deadline,
        epoch
      );
    } catch (error) {
      this.assertCurrent(epoch);
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
          'RELAY_NO_ELIGIBLE_RELAY',
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
      const discovery = this.discover(
        bridge,
        rejected,
        allowLoopback,
        Math.min(5_000, deadline - Date.now()),
        epoch
      );
      try {
        await discovery;
      } catch {
        this.assertCurrent(epoch);
        throw error;
      }
      return this.selectPass(bridge, rejected, allowLoopback, deadline, epoch);
    }
  }
  private async selectPass(
    bridge: ReticulumBridge,
    excluded: ReadonlySet<string>,
    allowLoopback: boolean,
    deadlineAt: number,
    epoch: RelayEpoch
  ): Promise<TrustedRelayConfig> {
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
    this.assertCurrent(epoch);
    if (!candidates.some((r) => !excluded.has(r.relayAddress))) {
      await this.discover(
        bridge,
        excluded,
        allowLoopback,
        Math.max(1, Math.min(8_000, deadlineAt - Date.now())),
        epoch
      );
      candidates = await collect();
      this.assertCurrent(epoch);
    }
    if (
      candidates.length &&
      candidates.every((r) => r.accessMode === 'groups') &&
      (!groups || Date.now() - groupsAt >= 30_000) &&
      groupReader &&
      account
    ) {
      if (!groupRead || groupRead.epoch !== epoch.account) {
        const operation = groupReader(account).catch(() => null);
        groupRead = { epoch: epoch.account, promise: operation };
        void operation.finally(() => {
          if (groupRead?.promise === operation) groupRead = undefined;
        });
      }
      const hints = await groupRead.promise;
      this.assertCurrent(epoch);
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
    const eligible = candidates.filter((r) => this.isEligible(r));
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
          cleanup();
          reject(new Error('MASQUE_RELAY_UNAVAILABLE'));
        },
        Math.max(1, deadlineAt - Date.now())
      );
      let hedge: NodeJS.Timeout | undefined;
      const aborted = () => {
        finished = true;
        cleanup();
        reject(epoch.signal.reason);
      };
      epoch.signal.addEventListener('abort', aborted, { once: true });
      const cleanup = () => {
        clearTimeout(deadline);
        clearTimeout(hedge);
        epoch.signal.removeEventListener('abort', aborted);
      };
      let lastError: unknown = new Error('MASQUE_RELAY_UNAVAILABLE');
      const next = () => {
        if (finished) return;
        if (!this.isCurrent(epoch)) {
          finished = true;
          cleanup();
          reject(epoch.signal.reason ?? new Error('RELAY_ACCOUNT_CHANGED'));
          return;
        }
        if (index >= Math.min(6, candidates.length)) {
          if (!active) {
            finished = true;
            cleanup();
            reject(lastError);
          }
          return;
        }
        const candidate = candidates[index++];
        active++;
        this.prepare(candidate, epoch)
          .then((result) => {
            if (finished) return;
            if (!this.isCurrent(epoch)) {
              finished = true;
              cleanup();
              reject(epoch.signal.reason ?? new Error('RELAY_ACCOUNT_CHANGED'));
              return;
            }
            finished = true;
            cleanup();
            resolve(result);
          })
          .catch((error) => {
            lastError = error;
            active--;
            next();
          });
      };
      next();
      hedge = setTimeout(() => {
        if (!finished && active < 2) next();
      }, 300);
      hedge.unref?.();
    });
  }
  private isCurrent(epoch: RelayEpoch) {
    return (
      !this.disposed && !epoch.signal.aborted && epoch.account === generation
    );
  }
  private assertCurrent(epoch: RelayEpoch) {
    epoch.signal.throwIfAborted();
    if (!this.isCurrent(epoch)) throw new Error('RELAY_ACCOUNT_CHANGED');
  }
  private isEligible(
    relay: Pick<TrustedRelayConfig, 'accessMode' | 'allowedGroupIds'>
  ) {
    return !(
      relay.accessMode === 'groups' &&
      groups &&
      Date.now() - groupsAt < 30_000 &&
      !relay.allowedGroupIds?.some((id) => groups!.has(id))
    );
  }
  private discover(
    bridge: ReticulumBridge,
    excluded: ReadonlySet<string>,
    allowLoopback: boolean,
    timeoutMs: number,
    epoch: RelayEpoch
  ) {
    this.assertCurrent(epoch);
    if (!this.discovery) {
      const operation = discoverCommunityMasqueRelay(bridge, {
        allowLoopback,
        timeoutMs,
        excludeRelayAddresses: excluded,
        acceptRelay: (relay) => this.isEligible(relay),
        signal: epoch.signal,
      }).finally(() => {
        if (this.discovery === operation) this.discovery = null;
      });
      this.discovery = operation;
    }
    return this.discovery;
  }
  private key(r: TrustedRelayConfig) {
    return `${generation}:${r.relayAddress}:${r.relayCertSha256}:${JSON.stringify(r.allowedGroupIds ?? [])}`;
  }
  private prepare(
    relay: TrustedRelayConfig,
    epoch: RelayEpoch
  ): Promise<TrustedRelayConfig> {
    this.assertCurrent(epoch);
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
            this.assertCurrent(epoch);
            this.ready.delete(key);
          }
        }
        this.assertCurrent(epoch);
        if (prepared && prior) connectedRelay = prior;
        if (!prepared || prepared.challenge)
          await this.ensureTickets(relay, epoch);
        this.assertCurrent(epoch);
        if (!prepared) {
          try {
            prepared = await this.sidecar.prepareRelay({
              ...relay,
              legacyRelay: ![2, 3].includes(relay.protocolVersion ?? 1),
            });
          } catch (error) {
            this.assertCurrent(epoch);
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
        this.assertCurrent(epoch);
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
        this.assertCurrent(epoch);
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
    epoch: RelayEpoch
  ) {
    this.assertCurrent(epoch);
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
    this.assertCurrent(epoch);
    if (!result.ready) throw new Error('RELAY_AUTH_UNAVAILABLE');
    return result;
  }
  private async ensureTickets(relay: TrustedRelayConfig, epoch: RelayEpoch) {
    this.assertCurrent(epoch);
    if (relay.accessMode !== 'groups') return;
    if (!this.bridge || !account || !signer)
      throw new Error('RELAY_AUTH_UNAVAILABLE');
    // Refresh signed key commitment after hourly rotation, including renewals.
    const candidates = await this.bridge.getCommunityMasqueRelays(false);
    this.assertCurrent(epoch);
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
    await this.tickets.ensure(this.bridge, current, account, signer, () =>
      this.isCurrent(epoch)
    );
  }
  private scheduleRenewal(
    key: string,
    relay: TrustedRelayConfig,
    expires: number | undefined,
    epoch: RelayEpoch,
    retryDelay?: number
  ) {
    this.assertCurrent(epoch);
    const old = this.renewals.get(key);
    if (old) clearTimeout(old);
    if (!expires || !relay.preparedRelay) return;
    const timer = setTimeout(
      async () => {
        this.renewals.delete(key);
        if (!this.isCurrent(epoch)) return;
        if (this.pending.has(key)) {
          this.scheduleRenewal(key, relay, expires, epoch, 1_000);
          return;
        }
        const renewal = (async () => {
          await this.ensureTickets(relay, epoch);
          this.assertCurrent(epoch);
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
          if (!this.isCurrent(epoch)) return;
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
          if (this.isCurrent(epoch) && Date.now() + 5_000 < expires) {
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
