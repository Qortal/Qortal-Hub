/**
 * Decentralized STUN: UDP server, probe scheduler, cache ranking, getIceServers merge.
 */

import type { P2PNetwork } from './p2p-network';
import { log as loggerLog } from './logger';
import {
  buildBootstrapIceServers,
  STUN_FIXED_UDP_PORT,
} from './stun-bootstrap';
import { StunCache } from './stun-cache';
import { StunUdpServer } from './stun-udp-server';
import { sendStunBindingProbe } from './stun-probe';

/** Max `stun:` URLs passed to RTCPeerConnection (plan: 3–6, default 6). */
export const ICE_STUN_SERVER_CAP = 6;

/** IPC `hub:getIceServers`: return last snapshot if computation exceeds this (ms). */
export const GET_ICE_SERVERS_DEADLINE_MS = 400;
const PROBE_TIMEOUT_MS = 1500;
const PROBES_PER_MINUTE = 5;
const MAX_CONCURRENT_PROBES = 3;
const PROBE_TICK_MS = 12_000;
const PREWARM_JITTER_MAX_MS = 15_000;

// Small public fallback used only when the legacy toggle is enabled.
const LEGACY_PUBLIC_STUN: { urls: string }[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function dedupeUrls(servers: { urls: string }[]): { urls: string }[] {
  const seen = new Set<string>();
  const out: { urls: string }[] = [];
  for (const s of servers) {
    if (!s.urls || seen.has(s.urls)) continue;
    seen.add(s.urls);
    out.push(s);
  }
  return out;
}

function stunKeyFromUrl(url: string): string | null {
  if (!/^stun:/i.test(url)) return null;
  const withoutScheme = url.slice(5).trim();
  const idx = withoutScheme.lastIndexOf(':');
  if (idx <= 0) return null;
  const host = withoutScheme.slice(0, idx).trim();
  const port = withoutScheme.slice(idx + 1).trim();
  if (!host || !/^\d+$/.test(port)) return null;
  return `${host}:${port}`;
}

export interface StunCoordinatorOptions {
  initialPeers: string[];
  stunCacheDbPath: string;
  legacyPublicStunFallback?: boolean;
}

let coordinatorInstance: StunCoordinator | null = null;

export function getStunCoordinator(): StunCoordinator | null {
  return coordinatorInstance;
}

export class StunCoordinator {
  private network: P2PNetwork | null = null;
  private readonly cache: StunCache;
  private udpServer: StunUdpServer | null = null;
  private localStunUdpBound = false;
  private initialPeers: string[] = [];
  private legacyFallback = false;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private probeBudget = PROBES_PER_MINUTE;
  private probeBudgetReset = Date.now();
  private probeQueue: { host: string; stunPort: number }[] = [];
  private activeProbes = 0;
  private running = false;
  /** Last list returned to renderer (for a future async getIceServers deadline path). */
  private lastServedIceServers: { urls: string }[] = [];
  /** Dedupe log spam when renderer polls getIceServers on an interval. */
  private lastLoggedIceUrlsKey: string | null = null;

  constructor(stunCacheDbPath: string) {
    this.cache = new StunCache(stunCacheDbPath);
  }

  didBindStunUdp(): boolean {
    return this.localStunUdpBound;
  }

  async start(network: P2PNetwork, opts: StunCoordinatorOptions): Promise<void> {
    this.stop();
    this.running = true;
    this.network = network;
    this.initialPeers = [...opts.initialPeers];
    this.legacyFallback = opts.legacyPublicStunFallback === true;
    this.cache.open();

    this.udpServer = new StunUdpServer(STUN_FIXED_UDP_PORT);
    const bound = await this.udpServer.tryBind();
    this.localStunUdpBound = bound;
    if (!bound) {
      this.udpServer = null;
    }

    const jitter = Math.floor(Math.random() * PREWARM_JITTER_MAX_MS);
    setTimeout(() => this.seedProbesFromPeers(), jitter);

    this.probeTimer = setInterval(() => {
      this.refillProbeBudget();
      this.drainProbeQueue();
    }, PROBE_TICK_MS);
    this.probeTimer.unref?.();

    network.on('peer-connected', () => {
      this.enqueuePeersFromNetwork();
    });

    loggerLog('[STUN] Coordinator started');
  }

  stop(): void {
    this.running = false;
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    this.udpServer?.stop();
    this.udpServer = null;
    this.localStunUdpBound = false;
    this.cache.close();
    this.network = null;
    this.probeQueue = [];
    this.lastLoggedIceUrlsKey = null;
    if (coordinatorInstance === this) coordinatorInstance = null;
    loggerLog('[STUN] Coordinator stopped');
  }

  setLegacyPublicStunFallback(enabled: boolean): void {
    this.legacyFallback = enabled;
  }

  /** IPC: merge cache + bootstrap + optional legacy; cap ICE_STUN_SERVER_CAP. */
  getIceServersForRenderer(): { urls: string }[] {
    const bootstrap = buildBootstrapIceServers(this.initialPeers);
    let ranked: { urls: string }[] = [];
    try {
      ranked = this.cache.selectTopIceServers(ICE_STUN_SERVER_CAP);
    } catch {
      ranked = [];
    }
    const pool = dedupeUrls([
      ...ranked,
      ...bootstrap,
      ...(this.legacyFallback ? LEGACY_PUBLIC_STUN : []),
    ]);
    if (pool.length === 0) {
      loggerLog(
        '[STUN][telemetry] getIceServers empty pool (no cache rank, bootstrap, or legacy)'
      );
    }
    const out = pool.slice(0, ICE_STUN_SERVER_CAP);
    this.lastServedIceServers = out.map((s) => ({ urls: s.urls }));
    const urlsKey = out.map((s) => s.urls).join('|');
    if (urlsKey !== this.lastLoggedIceUrlsKey) {
      this.lastLoggedIceUrlsKey = urlsKey;
      loggerLog('[STUN] ICE URLs for renderer (capped)', out.map((s) => s.urls));
      loggerLog(
        '[STUN][debug] ranked candidates',
        this.cache.describeSelection(ICE_STUN_SERVER_CAP)
      );
    }
    return out;
  }

  /** Snapshot from the last successful `getIceServersForRenderer` (may be empty). */
  peekLastServedIceServers(): { urls: string }[] {
    return this.lastServedIceServers.map((s) => ({ urls: s.urls }));
  }

  recordCallStunBundleOutcome(stunUrls: string[], success: boolean): void {
    const keys = stunUrls
      .map(stunKeyFromUrl)
      .filter((k): k is string => k != null);
    this.cache.recordCallBundleOutcome(keys, success);
  }

  recordObservedStunSources(stunUrls: string[]): void {
    const keys = stunUrls
      .map(stunKeyFromUrl)
      .filter((k): k is string => k != null);
    if (keys.length === 0) return;
    this.cache.recordObservedSourceKeys(keys);
    loggerLog('[STUN][telemetry] observed ICE source urls', {
      urls: stunUrls.length,
      matchedKeys: keys.length,
    });
  }

  private refillProbeBudget(): void {
    const now = Date.now();
    if (now - this.probeBudgetReset >= 60_000) {
      this.probeBudget = PROBES_PER_MINUTE;
      this.probeBudgetReset = now;
    }
  }

  private seedProbesFromPeers(): void {
    this.enqueuePeersFromNetwork();
    for (const addr of this.initialPeers) {
      const idx = addr.lastIndexOf(':');
      if (idx <= 0) continue;
      const host = addr.slice(0, idx).trim();
      const tlsPort = parseInt(addr.slice(idx + 1), 10);
      if (!host || Number.isNaN(tlsPort)) continue;
      this.enqueueProbe(host, STUN_FIXED_UDP_PORT);
    }
  }

  private enqueuePeersFromNetwork(): void {
    const net = this.network;
    if (!net) return;
    for (const p of net.getPeers()) {
      if (!p.connected) continue;
      const stunPort = p.remoteStunUdpPort ?? STUN_FIXED_UDP_PORT;
      if (!p.host || !stunPort) continue;
      this.enqueueProbe(p.host, stunPort);
    }
  }

  private enqueueProbe(host: string, stunPort: number): void {
    if (stunPort < 1 || stunPort > 65535) return;
    const key = `${host}:${stunPort}`;
    if (this.probeQueue.some((q) => `${q.host}:${q.stunPort}` === key)) return;
    this.probeQueue.push({ host, stunPort });
  }

  private drainProbeQueue(): void {
    while (
      this.activeProbes < MAX_CONCURRENT_PROBES &&
      this.probeBudget > 0 &&
      this.probeQueue.length > 0
    ) {
      const t = this.probeQueue.shift();
      if (!t) break;
      this.probeBudget--;
      this.activeProbes++;
      sendStunBindingProbe(t.host, t.stunPort, PROBE_TIMEOUT_MS)
        .then((res) => {
          this.cache.upsertProbeResult(t.host, t.stunPort, res.ok, res.rttMs);
          loggerLog('[STUN][probe]', {
            host: t.host,
            stunPort: t.stunPort,
            ok: res.ok,
            rttMs: res.rttMs ?? null,
          });
        })
        .finally(() => {
          this.activeProbes--;
        });
    }
  }
}

export async function startStunCoordinator(
  network: P2PNetwork,
  opts: StunCoordinatorOptions
): Promise<StunCoordinator> {
  stopStunCoordinator();
  const c = new StunCoordinator(opts.stunCacheDbPath);
  await c.start(network, opts);
  coordinatorInstance = c;
  return c;
}

export function stopStunCoordinator(): void {
  coordinatorInstance?.stop();
}
