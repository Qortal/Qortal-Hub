/**
 * Community STUN coordinator.
 *
 * Endpoint discovery uses a separate, rotating Reticulum announce identity in
 * presence_bridge.py. It never carries a Qortal address, presence destination,
 * or account signature. Electron validates every announced endpoint with a
 * real STUN probe before exposing it to WebRTC.
 */

import net from 'net';
import type { ReticulumBridge } from './reticulum-bridge';
import { log as loggerLog } from './logger';
import { STUN_FIXED_UDP_PORT } from './stun-bootstrap';
import {
  STUN_CACHE_MAX_ROWS,
  STUN_PROBE_FRESHNESS_MS,
  StunCache,
} from './stun-cache';
import { StunUdpServer } from './stun-udp-server';
import { sendStunBindingProbe } from './stun-probe';
import {
  createNatApiClient,
  destroyNatClient,
  mapUdpPort,
  refreshUdpPortMapping,
  unmapUdpPort,
  type NatApiClient,
} from './upnp-nat';

export const ICE_STUN_SERVER_CAP = 6;
export const GET_ICE_SERVERS_DEADLINE_MS = 400;
const PROBE_TIMEOUT_MS = 1500;
const PROBES_PER_MINUTE = 18;
const MAX_CONCURRENT_PROBES = 3;
const MAX_PROBE_QUEUE = 128;
const PROBE_TICK_MS = 2_000;
// Keep discovery warmer than the eight-minute local probe lease. This makes
// call setup a cache hit in the normal case while retaining an on-demand
// refresh when the app starts before any contributor has answered.
const DISCOVERY_REFRESH_INTERVAL_MS = 4 * 60_000;
const DISCOVERY_REQUEST_MIN_INTERVAL_MS = 5_000;
// A discovery announce is intentionally best-effort. Keep previously verified
// endpoints warm independently so one missed announce after restart cannot
// leave calls with an empty ICE pool.
const CACHED_REPROBE_INTERVAL_MS = STUN_PROBE_FRESHNESS_MS / 2;
const CACHED_REPROBE_REQUEST_MIN_INTERVAL_MS = 60_000;
const CACHED_REPROBE_MAX_SUCCESS_AGE_MS = 24 * 60 * 60_000;
const CACHED_REPROBE_QUEUE_TTL_MS = 30_000;
const CACHED_REPROBE_CAP = ICE_STUN_SERVER_CAP;
const ADVERTISE_INTERVAL_MS = 2 * 60_000;
const ADVERTISE_TTL_MS = 10 * 60_000;
const MAPPING_MAINTENANCE_INTERVAL_MS = 60_000;
const MAPPING_REFRESH_FAILURE_THRESHOLD = 2;
const CONTRIBUTION_RETRY_BASE_MS = 30_000;
const CONTRIBUTION_RETRY_MAX_MS = 5 * 60_000;
const CONTRIBUTION_RETRY_JITTER_MS = 5_000;

export function getDirectCallFallbackIceServers(): { urls: string }[] {
  // Kept as a compatibility export. Calls now use verified community entries
  // and fall back to Reticulum when none are available.
  return [];
}

export interface StunCoordinatorOptions {
  stunCacheDbPath: string;
  contributionEnabled?: boolean;
}

type CommunityStunEndpoint = {
  host?: unknown;
  port?: unknown;
  expiresAt?: unknown;
};

let coordinatorInstance: StunCoordinator | null = null;
let coordinatorCleanup: Promise<void> = Promise.resolve();

export function getStunCoordinator(): StunCoordinator | null {
  return coordinatorInstance;
}

/** Only accept globally routable IPv4 literals; never probe a hostname/LAN. */
export function isPublicCommunityStunHost(host: string): boolean {
  if (net.isIP(host) !== 4) return false;
  const octets = host.split('.').map(Number);
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export class StunCoordinator {
  private readonly cache: StunCache;
  private bridge: ReticulumBridge | null = null;
  private udpServer: StunUdpServer | null = null;
  private pendingUdpServer: StunUdpServer | null = null;
  private natClient: NatApiClient | null = null;
  private localStunUdpBound = false;
  private contributionEnabled = true;
  private contributionGeneration = 0;
  private contributionTask: Promise<void> = Promise.resolve();
  private publicHost: string | null = null;
  private contributionMappingHealthy = false;
  private mappingRefreshFailures = 0;
  private mappingRefreshInFlight: Promise<void> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private advertiseTimer: ReturnType<typeof setInterval> | null = null;
  private mappingMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private contributionRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private contributionRetryAttempt = 0;
  private probeBudget = PROBES_PER_MINUTE;
  private probeBudgetReset = Date.now();
  private probeQueue: { host: string; stunPort: number; expiresAt: number }[] =
    [];
  private probing = new Set<string>();
  private activeProbes = 0;
  private probeGeneration = 0;
  private running = false;
  private lastServedIceServers: { urls: string }[] = [];
  private lastLoggedIceUrlsKey: string | null = null;
  private lastDiscoveryRequestAt = 0;
  private lastCachedReprobeAt = 0;
  private readonly onDiscoveredEndpoint = (payload: CommunityStunEndpoint) => {
    this.acceptDiscoveredEndpoint(payload);
  };
  private readonly onBridgeReady = () => {
    if (this.bridge) this.requestBridgeEndpoints(this.bridge, true);
    if (this.publicHost) void this.advertiseContribution();
  };

  constructor(stunCacheDbPath: string) {
    this.cache = new StunCache(stunCacheDbPath);
  }

  didBindStunUdp(): boolean {
    return this.localStunUdpBound;
  }

  async start(
    bridge: ReticulumBridge,
    opts: StunCoordinatorOptions
  ): Promise<void> {
    if (this.running) {
      this.stop();
      await this.contributionTask.catch(() => {});
    }
    this.running = true;
    this.bindBridge(bridge);
    this.contributionEnabled = opts.contributionEnabled !== false;
    this.cache.open();
    this.probeBudget = PROBES_PER_MINUTE;
    this.probeBudgetReset = Date.now();
    this.queueCachedReprobes(0);
    this.requestBridgeEndpoints(bridge, true);

    this.probeTimer = setInterval(() => {
      this.refillProbeBudget();
      this.drainProbeQueue();
    }, PROBE_TICK_MS);
    this.probeTimer.unref?.();

    this.discoveryTimer = setInterval(() => {
      if (this.bridge) this.requestBridgeEndpoints(this.bridge);
      this.queueCachedReprobes();
    }, DISCOVERY_REFRESH_INTERVAL_MS);
    this.discoveryTimer.unref?.();

    this.queueContributionRefresh();
    loggerLog(
      `[STUN] Community coordinator started contribution=${this.contributionEnabled ? 'on' : 'off'}`
    );
  }

  stop(): void {
    this.running = false;
    this.contributionGeneration += 1;
    this.probeGeneration += 1;
    if (this.probeTimer) clearInterval(this.probeTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.advertiseTimer) clearInterval(this.advertiseTimer);
    if (this.mappingMaintenanceTimer)
      clearInterval(this.mappingMaintenanceTimer);
    this.probeTimer = null;
    this.discoveryTimer = null;
    this.advertiseTimer = null;
    this.mappingMaintenanceTimer = null;
    this.clearContributionRetry();
    this.stopLocalUdpImmediately();
    this.bridge?.off('community-stun-endpoint', this.onDiscoveredEndpoint);
    this.bridge?.off('ready', this.onBridgeReady);
    this.bridge = null;
    this.queueContributionRefresh();
    this.cache.close();
    this.probeQueue = [];
    this.probing.clear();
    this.activeProbes = 0;
    this.lastDiscoveryRequestAt = 0;
    this.lastCachedReprobeAt = 0;
    this.lastLoggedIceUrlsKey = null;
    if (coordinatorInstance === this) coordinatorInstance = null;
    loggerLog('[STUN] Community coordinator stopped');
  }

  async waitForStop(): Promise<void> {
    await this.contributionTask.catch(() => {});
  }

  setContributionEnabled(enabled: boolean): void {
    if (this.contributionEnabled === enabled) return;
    this.contributionEnabled = enabled;
    this.contributionGeneration += 1;
    this.contributionRetryAttempt = 0;
    this.clearContributionRetry();
    this.queueContributionRefresh();
    if (!enabled) {
      if (this.advertiseTimer) clearInterval(this.advertiseTimer);
      if (this.mappingMaintenanceTimer)
        clearInterval(this.mappingMaintenanceTimer);
      this.advertiseTimer = null;
      this.mappingMaintenanceTimer = null;
      this.stopLocalUdpImmediately();
      void this.bridge?.configureCommunityStun(null).catch(() => {});
    }
  }

  /** Reattach discovery after sleep recovery or a managed bridge restart. */
  setBridge(bridge: ReticulumBridge): void {
    if (!this.running || this.bridge === bridge) return;
    this.bindBridge(bridge);
    this.requestBridgeEndpoints(bridge, true);
    if (this.publicHost) void this.advertiseContribution();
  }

  getIceServersForRenderer(): { urls: string }[] {
    if (!this.running) return [];
    let out: { urls: string }[] = [];
    try {
      out = this.cache.selectTopIceServers(ICE_STUN_SERVER_CAP);
    } catch {
      out = [];
    }
    // Discovery replies arrive asynchronously after the bridge returns its
    // current snapshot. An empty pool must therefore trigger another bounded,
    // deduplicated query instead of becoming a permanent result for calls.
    if (out.length === 0 && this.bridge) {
      this.requestBridgeEndpoints(this.bridge);
    }
    if (out.length === 0) {
      this.queueCachedReprobes(CACHED_REPROBE_REQUEST_MIN_INTERVAL_MS);
    }
    this.lastServedIceServers = out.map((server) => ({ ...server }));
    const urlsKey = out.map((server) => server.urls).join('|');
    if (urlsKey !== this.lastLoggedIceUrlsKey) {
      this.lastLoggedIceUrlsKey = urlsKey;
      loggerLog('[STUN] Verified community ICE pool', {
        count: out.length,
        candidates: this.cache.describeSelection(ICE_STUN_SERVER_CAP),
      });
    }
    return out;
  }

  peekLastServedIceServers(): { urls: string }[] {
    if (!this.running) return [];
    return this.lastServedIceServers.map((server) => ({ ...server }));
  }

  recordCallStunBundleOutcome(stunUrls: string[], success: boolean): void {
    if (!this.running) return;
    const keys = stunUrls
      .map((url) => this.stunKeyFromUrl(url))
      .filter((key): key is string => key !== null);
    this.cache.recordCallBundleOutcome(keys, success);
  }

  recordObservedStunSources(stunUrls: string[]): void {
    if (!this.running) return;
    const keys = stunUrls
      .map((url) => this.stunKeyFromUrl(url))
      .filter((key): key is string => key !== null);
    this.cache.recordObservedSourceKeys(keys);
  }

  private stunKeyFromUrl(url: string): string | null {
    const match = /^stun:(\d+\.\d+\.\d+\.\d+):(\d+)$/i.exec(url.trim());
    if (!match || !isPublicCommunityStunHost(match[1])) return null;
    const port = Number(match[2]);
    return port === STUN_FIXED_UDP_PORT ? `${match[1]}:${port}` : null;
  }

  private acceptDiscoveredEndpoint(payload: CommunityStunEndpoint): void {
    if (!this.running) return;
    const host = typeof payload.host === 'string' ? payload.host.trim() : '';
    const port = Number(payload.port);
    const expiresAt = Number(payload.expiresAt);
    const now = Date.now();
    if (
      !isPublicCommunityStunHost(host) ||
      port !== STUN_FIXED_UDP_PORT ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 60 * 60_000
    ) {
      return;
    }
    this.enqueueProbe(host, port, expiresAt);
    this.drainProbeQueue();
  }

  private queueCachedReprobes(
    minAttemptAgeMs = CACHED_REPROBE_INTERVAL_MS
  ): void {
    if (!this.running) return;
    const now = Date.now();
    if (
      minAttemptAgeMs > 0 &&
      now - this.lastCachedReprobeAt < CACHED_REPROBE_REQUEST_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.lastCachedReprobeAt = now;
    const candidates = this.cache.getReprobeCandidates(STUN_CACHE_MAX_ROWS, {
      now,
      maxSuccessAgeMs: CACHED_REPROBE_MAX_SUCCESS_AGE_MS,
      minAttemptAgeMs,
    });
    let queued = 0;
    for (const candidate of candidates) {
      if (
        !isPublicCommunityStunHost(candidate.host) ||
        candidate.stunPort !== STUN_FIXED_UDP_PORT
      ) {
        continue;
      }
      if (
        this.enqueueProbe(
          candidate.host,
          candidate.stunPort,
          now + CACHED_REPROBE_QUEUE_TTL_MS
        )
      ) {
        queued += 1;
        if (queued >= CACHED_REPROBE_CAP) break;
      }
    }
    if (queued > 0) {
      loggerLog(`[STUN] Queued cached endpoint revalidation count=${queued}`);
      this.drainProbeQueue();
    }
  }

  private enqueueProbe(
    host: string,
    stunPort: number,
    expiresAt: number
  ): boolean {
    const key = `${host}:${stunPort}`;
    if (this.probing.has(key)) return false;
    const existing = this.probeQueue.find(
      (entry) => `${entry.host}:${entry.stunPort}` === key
    );
    if (existing) {
      existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
      return false;
    }
    if (this.probeQueue.length >= MAX_PROBE_QUEUE) return false;
    this.probeQueue.push({ host, stunPort, expiresAt });
    return true;
  }

  private refillProbeBudget(): void {
    const now = Date.now();
    if (now - this.probeBudgetReset >= 60_000) {
      this.probeBudget = PROBES_PER_MINUTE;
      this.probeBudgetReset = now;
    }
  }

  private drainProbeQueue(): void {
    this.refillProbeBudget();
    while (
      this.activeProbes < MAX_CONCURRENT_PROBES &&
      this.probeBudget > 0 &&
      this.probeQueue.length > 0
    ) {
      const target = this.probeQueue.shift();
      if (!target || target.expiresAt <= Date.now()) continue;
      const key = `${target.host}:${target.stunPort}`;
      this.probeBudget -= 1;
      this.activeProbes += 1;
      this.probing.add(key);
      const probeGeneration = this.probeGeneration;
      void sendStunBindingProbe(target.host, target.stunPort, PROBE_TIMEOUT_MS)
        .then((result) => {
          if (!this.running || probeGeneration !== this.probeGeneration) return;
          this.cache.upsertProbeResult(
            target.host,
            target.stunPort,
            result.ok,
            result.rttMs
          );
          loggerLog('[STUN][probe]', {
            ok: result.ok,
            rttMs: result.rttMs ?? null,
            failureReason: result.failureReason ?? null,
          });
        })
        .catch((error) => {
          if (!this.running || probeGeneration !== this.probeGeneration) return;
          loggerLog(
            `[STUN][probe] result persistence failed reason=${error instanceof Error ? error.message : String(error)}`
          );
        })
        .finally(() => {
          if (probeGeneration !== this.probeGeneration) return;
          this.probing.delete(key);
          this.activeProbes = Math.max(0, this.activeProbes - 1);
          this.drainProbeQueue();
        });
    }
  }

  private queueContributionRefresh(): void {
    const generation = this.contributionGeneration;
    this.contributionTask = this.contributionTask
      .catch(() => {})
      .then(async () => {
        await this.stopContributionResources();
        if (
          !this.running ||
          !this.contributionEnabled ||
          generation !== this.contributionGeneration
        ) {
          return;
        }
        await this.startContribution(generation);
      });
  }

  private async startContribution(generation: number): Promise<void> {
    const server = new StunUdpServer(STUN_FIXED_UDP_PORT);
    if (!(await server.tryBind())) {
      this.scheduleContributionRetry('udp-port-unavailable');
      return;
    }
    this.pendingUdpServer = server;
    if (
      !this.running ||
      !this.contributionEnabled ||
      generation !== this.contributionGeneration
    ) {
      server.stop();
      if (this.pendingUdpServer === server) this.pendingUdpServer = null;
      return;
    }
    let client: NatApiClient | null = null;
    try {
      client = await createNatApiClient({
        description: 'Qortal Hub Community STUN',
      });
      if (
        !this.running ||
        !this.contributionEnabled ||
        generation !== this.contributionGeneration
      ) {
        server.stop();
        if (this.pendingUdpServer === server) this.pendingUdpServer = null;
        await destroyNatClient(client);
        return;
      }
      const mapped = await mapUdpPort(client, {
        publicPort: STUN_FIXED_UDP_PORT,
        privatePort: STUN_FIXED_UDP_PORT,
        description: 'Qortal Hub Community STUN',
      });
      const externalIp =
        mapped && typeof client.externalIp === 'function'
          ? String(await client.externalIp()).trim()
          : '';
      if (
        !mapped ||
        !isPublicCommunityStunHost(externalIp) ||
        !this.running ||
        !this.contributionEnabled ||
        generation !== this.contributionGeneration
      ) {
        server.stop();
        if (this.pendingUdpServer === server) this.pendingUdpServer = null;
        await unmapUdpPort(client, STUN_FIXED_UDP_PORT, STUN_FIXED_UDP_PORT);
        await destroyNatClient(client);
        if (
          this.running &&
          this.contributionEnabled &&
          generation === this.contributionGeneration
        ) {
          this.scheduleContributionRetry('public-mapping-unavailable');
        }
        return;
      }
      this.udpServer = server;
      if (this.pendingUdpServer === server) this.pendingUdpServer = null;
      this.localStunUdpBound = true;
      this.natClient = client;
      this.publicHost = externalIp;
      this.contributionMappingHealthy = true;
      this.mappingRefreshFailures = 0;
      this.contributionRetryAttempt = 0;
      this.clearContributionRetry();
      await this.advertiseContribution();
      this.advertiseTimer = setInterval(
        () => void this.advertiseContribution(),
        ADVERTISE_INTERVAL_MS
      );
      this.advertiseTimer.unref?.();
      this.mappingMaintenanceTimer = setInterval(
        () => void this.maintainContributionMapping(),
        MAPPING_MAINTENANCE_INTERVAL_MS
      );
      this.mappingMaintenanceTimer.unref?.();
      loggerLog(
        '[STUN] Community contribution active endpoint=verified-public'
      );
    } catch (error) {
      server.stop();
      if (this.pendingUdpServer === server) this.pendingUdpServer = null;
      loggerLog(
        `[STUN] Community contribution unavailable reason=${error instanceof Error ? error.message : String(error)}`
      );
      if (this.natClient === client) {
        await this.stopContributionResources();
      } else if (client) {
        await unmapUdpPort(client, STUN_FIXED_UDP_PORT, STUN_FIXED_UDP_PORT);
        await destroyNatClient(client);
      }
      if (
        this.running &&
        this.contributionEnabled &&
        generation === this.contributionGeneration
      ) {
        this.scheduleContributionRetry('startup-failed');
      }
    }
  }

  private bindBridge(bridge: ReticulumBridge): void {
    this.bridge?.off('community-stun-endpoint', this.onDiscoveredEndpoint);
    this.bridge?.off('ready', this.onBridgeReady);
    this.bridge = bridge;
    bridge.on('community-stun-endpoint', this.onDiscoveredEndpoint);
    bridge.on('ready', this.onBridgeReady);
  }

  private requestBridgeEndpoints(bridge: ReticulumBridge, force = false): void {
    const now = Date.now();
    if (
      !force &&
      now - this.lastDiscoveryRequestAt < DISCOVERY_REQUEST_MIN_INTERVAL_MS
    ) {
      return;
    }
    this.lastDiscoveryRequestAt = now;
    void bridge
      .getCommunityStunEndpoints()
      .then((endpoints) => {
        if (!this.running || this.bridge !== bridge) return;
        for (const endpoint of endpoints) {
          this.acceptDiscoveredEndpoint(endpoint);
        }
      })
      .catch(() => {});
  }

  private scheduleContributionRetry(reason: string): void {
    if (
      !this.running ||
      !this.contributionEnabled ||
      this.contributionRetryTimer
    ) {
      return;
    }
    const exponent = Math.min(this.contributionRetryAttempt, 4);
    const baseDelay = Math.min(
      CONTRIBUTION_RETRY_BASE_MS * 2 ** exponent,
      CONTRIBUTION_RETRY_MAX_MS
    );
    const delayMs =
      baseDelay + Math.floor(Math.random() * CONTRIBUTION_RETRY_JITTER_MS);
    this.contributionRetryAttempt += 1;
    this.contributionRetryTimer = setTimeout(() => {
      this.contributionRetryTimer = null;
      if (!this.running || !this.contributionEnabled) return;
      this.queueContributionRefresh();
    }, delayMs);
    this.contributionRetryTimer.unref?.();
    loggerLog(
      `[STUN] Community contribution retry scheduled reason=${reason} delayMs=${delayMs}`
    );
  }

  private clearContributionRetry(): void {
    if (this.contributionRetryTimer) {
      clearTimeout(this.contributionRetryTimer);
      this.contributionRetryTimer = null;
    }
  }

  private async advertiseContribution(): Promise<void> {
    if (
      !this.running ||
      !this.contributionEnabled ||
      !this.publicHost ||
      !this.contributionMappingHealthy
    )
      return;
    try {
      const client = this.natClient;
      if (client && typeof client.externalIp === 'function') {
        const refreshedHost = String(await client.externalIp()).trim();
        if (isPublicCommunityStunHost(refreshedHost)) {
          this.publicHost = refreshedHost;
        }
      }
      if (
        !this.running ||
        !this.contributionEnabled ||
        !this.publicHost ||
        !this.contributionMappingHealthy
      ) {
        return;
      }
      const advertised = await this.bridge?.configureCommunityStun({
        host: this.publicHost,
        port: STUN_FIXED_UDP_PORT,
        expiresAt: Date.now() + ADVERTISE_TTL_MS,
      });
      if (advertised === false) {
        loggerLog('[STUN] Anonymous advertisement deferred bridge=not-ready');
      }
    } catch (error) {
      // Keep the UDP service/mapping alive. The bridge `ready` listener and
      // periodic timer retry advertising after transient bridge failures.
      loggerLog(
        `[STUN] Anonymous advertisement deferred reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private maintainContributionMapping(): Promise<void> {
    if (this.mappingRefreshInFlight) return this.mappingRefreshInFlight;
    const refresh = this.refreshContributionMapping();
    const tracked = refresh.finally(() => {
      if (this.mappingRefreshInFlight === tracked) {
        this.mappingRefreshInFlight = null;
      }
    });
    this.mappingRefreshInFlight = tracked;
    return tracked;
  }

  private async refreshContributionMapping(): Promise<void> {
    const client = this.natClient;
    if (
      !this.running ||
      !this.contributionEnabled ||
      !client ||
      !this.udpServer
    ) {
      return;
    }

    const refreshed = await refreshUdpPortMapping(client, {
      publicPort: STUN_FIXED_UDP_PORT,
      privatePort: STUN_FIXED_UDP_PORT,
      description: 'Qortal Hub Community STUN',
    });
    if (
      !this.running ||
      !this.contributionEnabled ||
      client !== this.natClient
    ) {
      return;
    }

    if (!refreshed) {
      this.mappingRefreshFailures += 1;
      loggerLog(
        `[STUN] Community mapping refresh failed attempts=${this.mappingRefreshFailures}`
      );
      if (
        this.mappingRefreshFailures >= MAPPING_REFRESH_FAILURE_THRESHOLD &&
        this.contributionMappingHealthy
      ) {
        this.contributionMappingHealthy = false;
        await this.bridge?.configureCommunityStun(null).catch(() => false);
        if (
          !this.running ||
          !this.contributionEnabled ||
          client !== this.natClient
        ) {
          return;
        }
        loggerLog(
          '[STUN] Community advertisement paused mapping=unavailable; restarting contribution'
        );
        // A UPnP client can retain a gateway/socket state that no longer works
        // after a router restart, network change, or sleep/wake cycle. Retrying
        // that same client forever cannot recover. Re-enter the normal
        // contribution lifecycle so the stale client and UDP listener are
        // released, the gateway is rediscovered, and a fresh mapping is made.
        // startContribution() already applies bounded exponential backoff when
        // rediscovery or remapping is still unavailable.
        this.contributionGeneration += 1;
        this.contributionRetryAttempt = 0;
        this.clearContributionRetry();
        this.queueContributionRefresh();
      }
      return;
    }

    const wasHealthy = this.contributionMappingHealthy;
    this.mappingRefreshFailures = 0;
    this.contributionMappingHealthy = true;
    if (!wasHealthy) {
      loggerLog('[STUN] Community mapping restored');
      await this.advertiseContribution();
    }
  }

  private async stopContributionResources(): Promise<void> {
    if (this.mappingMaintenanceTimer) {
      clearInterval(this.mappingMaintenanceTimer);
      this.mappingMaintenanceTimer = null;
    }
    const mappingRefresh = this.mappingRefreshInFlight;
    this.mappingRefreshInFlight = null;
    if (mappingRefresh) {
      await mappingRefresh.catch(() => {});
    }
    const client = this.natClient;
    this.natClient = null;
    this.publicHost = null;
    this.contributionMappingHealthy = false;
    this.mappingRefreshFailures = 0;
    this.stopLocalUdpImmediately();
    if (client) {
      await unmapUdpPort(client, STUN_FIXED_UDP_PORT, STUN_FIXED_UDP_PORT);
      await destroyNatClient(client);
    }
  }

  private stopLocalUdpImmediately(): void {
    this.pendingUdpServer?.stop();
    this.pendingUdpServer = null;
    this.udpServer?.stop();
    this.udpServer = null;
    this.localStunUdpBound = false;
  }
}

export async function startStunCoordinator(
  bridge: ReticulumBridge,
  opts: StunCoordinatorOptions
): Promise<StunCoordinator> {
  stopStunCoordinator();
  await coordinatorCleanup;
  const coordinator = new StunCoordinator(opts.stunCacheDbPath);
  await coordinator.start(bridge, opts);
  coordinatorInstance = coordinator;
  return coordinator;
}

export function stopStunCoordinator(): void {
  const coordinator = coordinatorInstance;
  coordinatorInstance = null;
  if (!coordinator) return;
  coordinator.stop();
  coordinatorCleanup = coordinator.waitForStop();
}

export function rebindStunCoordinatorBridge(bridge: ReticulumBridge): void {
  coordinatorInstance?.setBridge(bridge);
}
