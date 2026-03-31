/**
 * Reticulum hub-to-hub mesh coordinator (separate from TLS P2P).
 *
 * Transport uses managed rnsd config (TCPServerInterface + TCPClientInterface).
 * Runtime interface changes require restarting the shared rnsd instance; debouncing
 * avoids restart storms (see MIN_MESH_DAEMON_RESTART_INTERVAL_MS).
 */

import { ipcMain } from 'electron';
import { debug as loggerDebug, log as loggerLog } from './logger';
import {
  buildCurrentManagedReticulumConfig,
  computeManagedReticulumConfigFingerprint,
  getReticulumInstanceIndex,
  startBundledReticulumDaemon,
  stopBundledReticulumDaemon,
  writeManagedReticulumConfigIfManaged,
} from './reticulum-daemon';
import { rebindReticulumBridgeConsumers } from './reticulum-bridge-rebind';
import {
  getReticulumBridge,
  startReticulumBridge,
  stopReticulumBridge,
} from './reticulum-bridge';
import {
  MESH_FANOUT_PRESENCE_DEBOUNCE_MS,
  MESH_MAINTENANCE_INTERVAL_MS,
  MAX_IMMEDIATE_MESH_PROBES_PER_EVENT,
  MAX_MESH_STORED_ENDPOINTS,
  MAX_PENDING_MESH_CHANGES_BEFORE_RESTART,
  MAX_SHARED_PEERS_PER_MESSAGE,
  MIN_MESH_DAEMON_RESTART_INTERVAL_MS,
} from './reticulum-mesh-constants';
import {
  loadReticulumMeshState,
  saveReticulumMeshState,
  selectMeshOutboundHostsForConfig,
  type ReticulumMeshPeerEntry,
  type ReticulumMeshState,
} from './reticulum-mesh-store';
import { getPresenceManager } from './presence';
import {
  createNatApiClient,
  destroyNatClient,
  mapTcpPort,
  unmapTcpPort,
} from './upnp-nat';

let pendingChangeCount = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** Last time mesh-driven rnsd restart completed (debounce against MIN_MESH_DAEMON_RESTART_INTERVAL_MS). */
let lastMeshRestartAt = Date.now();
/** SHA-256 hex of last written managed config; skips apply when gossip does not change disk output. */
let lastAppliedFingerprint: string | null = null;
/** Carried into flushMeshConfigNow for logging (last scheduling path wins). */
let pendingApplyReason: string | undefined;
let meshUpnpClient: unknown = null;
let meshUpnpStopped = false;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

type MeshMsg = {
  t: string;
  senderHash: string;
  message: Record<string, unknown>;
};

function parseTcpEndpoint(s: string): { host: string; port: number } | null {
  const t = s.trim();
  if (!t.startsWith('tcp://')) return null;
  const rest = t.slice('tcp://'.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const host = rest.slice(0, lastColon).trim();
  const port = parseInt(rest.slice(lastColon + 1), 10);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host, port };
}

function peerKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

/** IPv4 only — mesh wire uses `tcp://host:port` without bracketed v6. */
function isLikelyIpv4String(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(m);
  if (!match) return false;
  return match.slice(1).every((oct) => {
    const n = parseInt(oct, 10);
    return n >= 0 && n <= 255;
  });
}

async function tryMeshWanGossipEndpoint(
  listenPort: number
): Promise<{ endpoint: string; reachable: boolean } | null> {
  const client = meshUpnpClient as { externalIp?: () => Promise<string> } | null;
  if (!client || typeof client.externalIp !== 'function') {
    return null;
  }
  try {
    const timeoutMs = 900;
    const ip = await Promise.race([
      client.externalIp(),
      new Promise<string>((_, reject) => {
        const t = setTimeout(() => reject(new Error('mesh_wan_ip_timeout')), timeoutMs);
        t.unref?.();
      }),
    ]);
    const raw =
      typeof ip === 'string' ? ip.trim() : `(non-string: ${typeof ip})`;
    if (typeof ip !== 'string' || ip.length === 0) {
      loggerLog(
        `[ReticulumMesh] mesh WAN IP (externalIp): empty or missing raw=${raw}`
      );
      return null;
    }
    if (!isLikelyIpv4String(ip.trim())) {
      loggerLog(
        `[ReticulumMesh] mesh WAN IP (externalIp): not usable IPv4 for mesh gossip raw=${raw.slice(0, 80)}`
      );
      return null;
    }
    const host = ip.trim();
    loggerLog(
      `[ReticulumMesh] mesh WAN IP (externalIp): ok raw=${host} endpoint=tcp://${host}:${listenPort}`
    );
    return { endpoint: `tcp://${host}:${listenPort}`, reachable: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loggerLog(`[ReticulumMesh] mesh WAN IP (externalIp): failed ${msg}`);
    return null;
  }
}

/**
 * Remote-only self gossip: WAN IPv4 from the UPnP client (`externalIp`) when mesh listen is on.
 * No LAN/private address — same-segment hubs are out of scope for this path.
 */
async function gatherMeshSelfGossipEndpoints(
  state: ReticulumMeshState
): Promise<Array<{ endpoint: string; reachable: boolean }>> {
  if (state.meshListenEnabled === false) return [];
  const wan = await tryMeshWanGossipEndpoint(state.listenPort);
  if (!wan) return [];
  const w = parseTcpEndpoint(wan.endpoint);
  return w ? [wan] : [];
}

function upsertPeer(
  state: ReticulumMeshState,
  host: string,
  port: number,
  reachable: boolean
): ReticulumMeshState {
  const k = peerKey(host, port);
  const idx = state.peers.findIndex((p) => peerKey(p.host, p.port) === k);
  const now = Date.now();
  const next: ReticulumMeshPeerEntry =
    idx >= 0
      ? {
          ...state.peers[idx]!,
          lastSeen: now,
          reachable: reachable || state.peers[idx]!.reachable,
        }
      : {
          host,
          port,
          failures: 0,
          lastSeen: now,
          reachable,
          dialAttempts: 0,
          dialSuccesses: 0,
          connectionSuccessRate: 0,
        };
  let peers =
    idx >= 0
      ? state.peers.map((p, i) => (i === idx ? next : p))
      : [...state.peers, next];
  if (peers.length > MAX_MESH_STORED_ENDPOINTS) {
    peers = peers
      .sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(peers.length - MAX_MESH_STORED_ENDPOINTS);
  }
  return { ...state, peers };
}

function pickGossipEndpointsFromPeers(state: ReticulumMeshState): Array<{
  endpoint: string;
  reachable: boolean;
}> {
  const shuffled = [...state.peers].sort(() => Math.random() - 0.5);
  const out: Array<{ endpoint: string; reachable: boolean }> = [];
  for (const p of shuffled) {
    if (out.length >= MAX_SHARED_PEERS_PER_MESSAGE) break;
    out.push({
      endpoint: `tcp://${p.host}:${p.port}`,
      reachable: p.reachable === true,
    });
  }
  return out;
}

/**
 * Full `HUB_MESH_PEER_RESPONSE` payload: our WAN mesh listen (when UPnP yields an IP) plus stored peers.
 * Self entries first so empty peer stores still bootstrap remote hubs.
 */
async function buildMeshResponseEndpoints(
  state: ReticulumMeshState
): Promise<Array<{ endpoint: string; reachable: boolean }>> {
  const self = await gatherMeshSelfGossipEndpoints(state);
  const others = pickGossipEndpointsFromPeers(state);
  const seen = new Set<string>();
  const merged: Array<{ endpoint: string; reachable: boolean }> = [];
  for (const e of [...self, ...others]) {
    const parsed = parseTcpEndpoint(e.endpoint);
    if (!parsed) continue;
    const k = peerKey(parsed.host, parsed.port);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
    if (merged.length >= MAX_SHARED_PEERS_PER_MESSAGE) break;
  }
  return merged;
}

function meshOutboundPeerSetKey(state: ReticulumMeshState): string {
  return selectMeshOutboundHostsForConfig(state)
    .map((p) => peerKey(p.host, p.port))
    .sort()
    .join(',');
}

/** Best-effort reason when managed config fingerprint changes (full hash is source of truth). */
function meshConfigFingerprintDeltaReason(
  before: ReticulumMeshState,
  after: ReticulumMeshState
): string {
  if (
    before.meshListenEnabled !== after.meshListenEnabled ||
    before.listenPort !== after.listenPort
  ) {
    return 'listen_changed';
  }
  if (meshOutboundPeerSetKey(before) !== meshOutboundPeerSetKey(after)) {
    return 'peer_set_changed';
  }
  return 'config_hash_delta';
}

async function flushMeshConfigNow(): Promise<void> {
  const next = buildCurrentManagedReticulumConfig();
  const fp = computeManagedReticulumConfigFingerprint();
  const changed = writeManagedReticulumConfigIfManaged(next);
  pendingChangeCount = 0;
  if (!changed) {
    pendingApplyReason = undefined;
    return;
  }
  const flushReason = pendingApplyReason ?? 'debounce_flush';
  pendingApplyReason = undefined;
  lastMeshRestartAt = Date.now();
  lastAppliedFingerprint = fp;
  loggerLog(
    `[ReticulumMesh] Applying mesh config — restarting rnsd + bridge fp=${fp.slice(0, 8)} reason=${flushReason}`
  );
  stopReticulumMeshCoordinator({ teardownUpnp: false });
  stopReticulumBridge();
  stopBundledReticulumDaemon();
  startBundledReticulumDaemon();
  try {
    await startReticulumBridge();
    startReticulumMeshCoordinator(getReticulumBridge());
    rebindReticulumBridgeConsumers();
  } catch (err) {
    loggerLog('[ReticulumMesh] Bridge restart failed:', err);
  }
}

export function requestMeshConfigApply(opts?: {
  reason?: string;
  fpPrefix?: string;
}): void {
  if (getReticulumInstanceIndex() > 0) return;
  if (opts?.reason) pendingApplyReason = opts.reason;
  pendingChangeCount++;
  if (opts?.fpPrefix !== undefined) {
    loggerLog(
      `[ReticulumMesh] mesh_apply_scheduled fp=${opts.fpPrefix} reason=${opts.reason ?? pendingApplyReason ?? 'pending'} pending=${pendingChangeCount}`
    );
  }
  if (pendingChangeCount >= MAX_PENDING_MESH_CHANGES_BEFORE_RESTART) {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    pendingApplyReason = 'forced_pending_threshold';
    void flushMeshConfigNow();
    return;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const elapsed = Date.now() - lastMeshRestartAt;
  const wait = Math.max(0, MIN_MESH_DAEMON_RESTART_INTERVAL_MS - elapsed);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!pendingApplyReason) pendingApplyReason = 'debounce_flush';
    void flushMeshConfigNow();
  }, wait);
  restartTimer.unref?.();
}

async function setupMeshUpnp(listenPort: number): Promise<void> {
  if (meshUpnpClient) {
    return;
  }
  meshUpnpStopped = false;
  const { readAppSettings } = await import('./setup');
  const settings = await readAppSettings();
  if (settings.reticulumMeshUpnpEnabled === false) {
    loggerLog('[ReticulumMesh] UPnP disabled in app settings');
    return;
  }
  const st = loadReticulumMeshState();
  if (st.meshUpnpEnabled === false) {
    return;
  }
  try {
    const client = await createNatApiClient({ description: 'Qortal Hub Reticulum Mesh' });
    if (meshUpnpStopped) {
      await destroyNatClient(client);
      return;
    }
    const ok = await mapTcpPort(client, {
      publicPort: listenPort,
      privatePort: listenPort,
      description: 'Qortal Hub Reticulum Mesh',
    });
    if (meshUpnpStopped) {
      await unmapTcpPort(client, listenPort, listenPort);
      await destroyNatClient(client);
      return;
    }
    if (!ok) {
      loggerLog(`[ReticulumMesh] UPnP: TCP ${listenPort} map failed`);
      await destroyNatClient(client);
      return;
    }
    meshUpnpClient = client;
    loggerLog(`[ReticulumMesh] UPnP: TCP ${listenPort} mapped`);
  } catch (err) {
    loggerLog('[ReticulumMesh] UPnP error:', err);
  }
}

function teardownMeshUpnp(listenPort: number): void {
  meshUpnpStopped = true;
  const client = meshUpnpClient as {
    unmap?: (x: Record<string, unknown>) => Promise<void>;
    destroy?: () => Promise<void>;
  } | null;
  meshUpnpClient = null;
  if (!client) return;
  void unmapTcpPort(client, listenPort, listenPort).finally(() => {
    void destroyNatClient(client);
  });
}

export type ReticulumMeshPeerInfo = {
  endpoint: string;
  host: string;
  port: number;
  reachable: boolean;
  failures: number;
};

/** Full mesh store entry for UI (includes peers not in sparse outbound set). */
export type ReticulumMeshKnownPeerInfo = {
  endpoint: string;
  host: string;
  port: number;
  reachable: boolean;
  failures: number;
  lastSeen: number;
  dialAttempts: number;
  dialSuccesses: number;
  connectionSuccessRate: number;
  /** In sparse TCPClientInterface set applied to rnsd. */
  isActiveOutbound: boolean;
};

export type ReticulumMeshStatus = {
  enabled: boolean;
  peerCount: number;
  listenPort: number;
  meshListenEnabled: boolean;
  upnpMapped: boolean;
  reachableSelf: boolean;
  /** Outbound TCP mesh peers currently applied to rnsd (sparse set). */
  activeMeshPeers: ReticulumMeshPeerInfo[];
  /** All endpoints in the mesh store, newest gossip/upsert first. */
  knownMeshPeers: ReticulumMeshKnownPeerInfo[];
};

function buildActiveMeshPeers(st: ReticulumMeshState): ReticulumMeshPeerInfo[] {
  const activeHosts = selectMeshOutboundHostsForConfig(st);
  return activeHosts.map((h) => {
    const entry = st.peers.find(
      (p) => p.host.toLowerCase() === h.host.toLowerCase() && p.port === h.port
    );
    return {
      endpoint: `tcp://${h.host}:${h.port}`,
      host: h.host,
      port: h.port,
      reachable: entry?.reachable === true,
      failures: entry?.failures ?? 0,
    };
  });
}

function buildKnownMeshPeers(st: ReticulumMeshState): ReticulumMeshKnownPeerInfo[] {
  const activeHosts = selectMeshOutboundHostsForConfig(st);
  const activeSet = new Set(
    activeHosts.map((h) => peerKey(h.host, h.port))
  );
  return [...st.peers]
    .map((p) => {
      const k = peerKey(p.host, p.port);
      return {
        endpoint: `tcp://${p.host}:${p.port}`,
        host: p.host,
        port: p.port,
        reachable: p.reachable === true,
        failures: p.failures,
        lastSeen: p.lastSeen,
        dialAttempts: p.dialAttempts,
        dialSuccesses: p.dialSuccesses,
        connectionSuccessRate: p.connectionSuccessRate,
        isActiveOutbound: activeSet.has(k),
      };
    })
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * New fanout destination hashes not yet covered by an immediate probe, capped per event.
 * Exported for unit tests.
 */
export function peekFanoutProbeBatch(
  current: string[],
  seen: ReadonlySet<string>,
  maxPerEvent: number
): { batch: string[]; deferredRemaining: number } {
  const fresh = current.filter((h) => !seen.has(h));
  return {
    batch: fresh.slice(0, maxPerEvent),
    deferredRemaining: Math.max(0, fresh.length - maxPerEvent),
  };
}

function getMeshStatus(): ReticulumMeshStatus {
  const st = loadReticulumMeshState();
  return {
    enabled: getReticulumInstanceIndex() === 0,
    peerCount: st.peers.length,
    listenPort: st.listenPort,
    meshListenEnabled: st.meshListenEnabled,
    upnpMapped: meshUpnpClient != null,
    reachableSelf: st.reachableSelf === true,
    activeMeshPeers: buildActiveMeshPeers(st),
    knownMeshPeers: buildKnownMeshPeers(st),
  };
}

export function registerReticulumMeshIpcHandlers(): void {
  ipcMain.handle('reticulum:getMeshStatus', async (): Promise<ReticulumMeshStatus> => {
    return getMeshStatus();
  });
}

class ReticulumMeshCoordinator {
  private bridgeRef: ReturnType<typeof getReticulumBridge>;
  private onMeshBound?: (msg: MeshMsg) => void;
  /** Fanout hashes we already attempted an immediate mesh probe for (until coordinator stop). */
  private immediateProbeSeenHashes = new Set<string>();
  private fanoutPresenceDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly boundOnPresenceUpdated = (): void => {
    this.schedulePresenceFanoutProbe();
  };

  constructor(bridge: ReturnType<typeof getReticulumBridge>) {
    this.bridgeRef = bridge;
  }

  start(): void {
    if (getReticulumInstanceIndex() > 0) {
      return;
    }
    loggerLog('[ReticulumMesh] Coordinator starting');
    lastMeshRestartAt = Date.now() - MIN_MESH_DAEMON_RESTART_INTERVAL_MS;
    lastAppliedFingerprint = computeManagedReticulumConfigFingerprint();
    loggerLog(
      `[ReticulumMesh] mesh fingerprint baseline fp=${lastAppliedFingerprint.slice(0, 8)}`
    );
    const pm0 = getPresenceManager();
    if (pm0) {
      this.immediateProbeSeenHashes = new Set(
        pm0.getReticulumFanoutDestinationHashes()
      );
      pm0.on('presence-updated', this.boundOnPresenceUpdated);
    } else {
      this.immediateProbeSeenHashes = new Set();
    }
    const st = loadReticulumMeshState();
    void setupMeshUpnp(st.listenPort);

    this.onMeshBound = (msg) => {
      void this.handleMeshMessage(msg);
    };
    this.bridgeRef?.on('mesh-peer-message', this.onMeshBound);

    maintenanceTimer = setInterval(() => {
      void this.maintenance();
    }, MESH_MAINTENANCE_INTERVAL_MS);
    maintenanceTimer.unref?.();

    void this.maintenance();
  }

  stop(teardownUpnp = true): void {
    const pm = getPresenceManager();
    pm?.off('presence-updated', this.boundOnPresenceUpdated);
    if (this.fanoutPresenceDebounceTimer) {
      clearTimeout(this.fanoutPresenceDebounceTimer);
      this.fanoutPresenceDebounceTimer = null;
    }
    this.immediateProbeSeenHashes.clear();
    if (this.onMeshBound) {
      this.bridgeRef?.off('mesh-peer-message', this.onMeshBound);
    }
    if (maintenanceTimer) {
      clearInterval(maintenanceTimer);
      maintenanceTimer = null;
    }
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (teardownUpnp) {
      teardownMeshUpnp(loadReticulumMeshState().listenPort);
    }
    loggerLog('[ReticulumMesh] Coordinator stopped');
  }

  private schedulePresenceFanoutProbe(): void {
    if (this.fanoutPresenceDebounceTimer) {
      clearTimeout(this.fanoutPresenceDebounceTimer);
    }
    this.fanoutPresenceDebounceTimer = setTimeout(() => {
      this.fanoutPresenceDebounceTimer = null;
      void this.runImmediateFanoutProbes();
    }, MESH_FANOUT_PRESENCE_DEBOUNCE_MS);
    this.fanoutPresenceDebounceTimer.unref?.();
  }

  private async runImmediateFanoutProbes(): Promise<void> {
    const bridge = getReticulumBridge() ?? this.bridgeRef;
    if (!bridge || bridge.getState() !== 'ready') return;
    const pm = getPresenceManager();
    const hashes = pm?.getReticulumFanoutDestinationHashes() ?? [];
    const { batch, deferredRemaining } = peekFanoutProbeBatch(
      hashes,
      this.immediateProbeSeenHashes,
      MAX_IMMEDIATE_MESH_PROBES_PER_EVENT
    );
    if (deferredRemaining > 0) {
      loggerDebug(
        `[ReticulumMesh] fanout_immediate_deferred n=${deferredRemaining} (cap=${MAX_IMMEDIATE_MESH_PROBES_PER_EVENT})`
      );
    }
    for (const h of batch) {
      const resp = await bridge.meshSendPeerExchange({
        peerPresenceHash: h,
        kind: 'request',
      });
      this.immediateProbeSeenHashes.add(h);
      if (!resp.ok && resp.error !== 'unknown_peer') {
        loggerLog('[ReticulumMesh] mesh request failed:', resp.error);
      }
    }
  }

  private async handleMeshMessage(msg: MeshMsg): Promise<void> {
    const bridge = getReticulumBridge() ?? this.bridgeRef;
    if (!bridge || bridge.getState() !== 'ready') return;

    if (msg.t === 'HUB_MESH_PEER_REQUEST') {
      const endpoints = await buildMeshResponseEndpoints(loadReticulumMeshState());
      const resp = await bridge.meshSendPeerExchange({
        peerPresenceHash: msg.senderHash,
        kind: 'response',
        endpoints,
      });
      if (!resp.ok) {
        loggerLog('[ReticulumMesh] mesh response failed:', resp.error);
      }
      return;
    }

    if (msg.t === 'HUB_MESH_PEER_RESPONSE') {
      const raw = msg.message.peers;
      if (!Array.isArray(raw)) return;
      const stateBefore = loadReticulumMeshState();
      let state = stateBefore;
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const ep =
          typeof o.endpoint === 'string' ? o.endpoint : String(o.endpoint ?? '');
        const reachable = o.reachable === true;
        const parsed = parseTcpEndpoint(ep);
        if (!parsed) continue;
        state = upsertPeer(state, parsed.host, parsed.port, reachable);
      }
      saveReticulumMeshState(state);
      const fp = computeManagedReticulumConfigFingerprint();
      if (lastAppliedFingerprint !== null && fp === lastAppliedFingerprint) {
        loggerDebug(
          `[ReticulumMesh] mesh_apply_skip fp=${fp.slice(0, 8)} reason=no_config_delta`
        );
        return;
      }
      const reason = meshConfigFingerprintDeltaReason(stateBefore, state);
      requestMeshConfigApply({
        reason,
        fpPrefix: fp.slice(0, 8),
      });
    }
  }

  private async maintenance(): Promise<void> {
    const bridge = getReticulumBridge() ?? this.bridgeRef;
    if (!bridge || bridge.getState() !== 'ready') return;
    const pm = getPresenceManager();
    const hashes = pm?.getReticulumFanoutDestinationHashes() ?? [];
    if (hashes.length === 0) return;
    const shuffled = [...hashes].sort(() => Math.random() - 0.5);
    const target = shuffled.slice(0, Math.min(3, shuffled.length));
    for (const h of target) {
      const resp = await bridge.meshSendPeerExchange({
        peerPresenceHash: h,
        kind: 'request',
      });
      if (!resp.ok && resp.error !== 'unknown_peer') {
        loggerLog('[ReticulumMesh] mesh request failed:', resp.error);
      }
    }
  }
}

let meshCoordinator: ReticulumMeshCoordinator | null = null;

export function startReticulumMeshCoordinator(
  bridge: ReturnType<typeof getReticulumBridge>
): void {
  if (getReticulumInstanceIndex() > 0) {
    return;
  }
  if (meshCoordinator) return;
  meshCoordinator = new ReticulumMeshCoordinator(bridge);
  meshCoordinator.start();
}

export function stopReticulumMeshCoordinator(
  options: { teardownUpnp?: boolean } = {}
): void {
  const tu = options.teardownUpnp !== false;
  meshCoordinator?.stop(tu);
  meshCoordinator = null;
}
