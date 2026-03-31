/**
 * Reticulum hub-to-hub mesh coordinator (separate from TLS P2P).
 *
 * Transport uses managed rnsd config (TCPServerInterface + TCPClientInterface).
 * Runtime interface changes require restarting the shared rnsd instance; debouncing
 * avoids restart storms (see MIN_MESH_DAEMON_RESTART_INTERVAL_MS).
 */

import { ipcMain } from 'electron';
import { log as loggerLog } from './logger';
import {
  buildCurrentManagedReticulumConfig,
  getReticulumInstanceIndex,
  startBundledReticulumDaemon,
  stopBundledReticulumDaemon,
  writeManagedReticulumConfigIfManaged,
} from './reticulum-daemon';
import {
  getReticulumBridge,
  startReticulumBridge,
  stopReticulumBridge,
} from './reticulum-bridge';
import {
  MESH_MAINTENANCE_INTERVAL_MS,
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

function pickGossipEndpoints(state: ReticulumMeshState): Array<{
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

async function flushMeshConfigNow(): Promise<void> {
  const next = buildCurrentManagedReticulumConfig();
  const changed = writeManagedReticulumConfigIfManaged(next);
  pendingChangeCount = 0;
  lastMeshRestartAt = Date.now();
  if (!changed) {
    return;
  }
  loggerLog('[ReticulumMesh] Applying mesh config — restarting rnsd + bridge');
  stopReticulumMeshCoordinator({ teardownUpnp: false });
  stopReticulumBridge();
  stopBundledReticulumDaemon();
  startBundledReticulumDaemon();
  try {
    await startReticulumBridge();
    startReticulumMeshCoordinator(getReticulumBridge());
  } catch (err) {
    loggerLog('[ReticulumMesh] Bridge restart failed:', err);
  }
}

export function requestMeshConfigApply(): void {
  if (getReticulumInstanceIndex() > 0) return;
  pendingChangeCount++;
  if (pendingChangeCount >= MAX_PENDING_MESH_CHANGES_BEFORE_RESTART) {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
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

  constructor(bridge: ReturnType<typeof getReticulumBridge>) {
    this.bridgeRef = bridge;
  }

  start(): void {
    if (getReticulumInstanceIndex() > 0) {
      return;
    }
    loggerLog('[ReticulumMesh] Coordinator starting');
    lastMeshRestartAt = Date.now() - MIN_MESH_DAEMON_RESTART_INTERVAL_MS;
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

  private async handleMeshMessage(msg: MeshMsg): Promise<void> {
    const bridge = getReticulumBridge() ?? this.bridgeRef;
    if (!bridge || bridge.getState() !== 'ready') return;

    if (msg.t === 'HUB_MESH_PEER_REQUEST') {
      const endpoints = pickGossipEndpoints(loadReticulumMeshState());
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
      let state = loadReticulumMeshState();
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
      requestMeshConfigApply();
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
