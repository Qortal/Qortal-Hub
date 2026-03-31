/**
 * Persistent state for Reticulum hub mesh (TCP hints only — not cryptographic identity).
 */

import * as crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  DEFAULT_RETICULUM_MESH_LISTEN_PORT,
  MAX_MESH_OUTBOUND_PEERS,
  MAX_MESH_STORED_ENDPOINTS,
} from './reticulum-mesh-constants';

export const RETICULUM_MESH_STATE_VERSION = 1 as const;

export type ReticulumMeshPeerEntry = {
  host: string;
  port: number;
  failures: number;
  lastSeen: number;
  /** Gossip / observed — not set from UPnP alone */
  reachable: boolean;
  dialAttempts: number;
  dialSuccesses: number;
  /** Rolling success rate for dial attempts (0–1) */
  connectionSuccessRate: number;
};

export type ReticulumMeshState = {
  version: typeof RETICULUM_MESH_STATE_VERSION;
  listenPort: number;
  /** When true, render TCPServerInterface in managed config */
  meshListenEnabled: boolean;
  meshUpnpEnabled: boolean;
  /** We only gossip reachable=true after inbound observed or external probe — see coordinator */
  reachableSelf: boolean;
  inboundObservedOnMeshPort: boolean;
  externalProbeSucceeded: boolean;
  peers: ReticulumMeshPeerEntry[];
};

export function getReticulumMeshStatePath(): string {
  return path.join(app.getPath('userData'), 'reticulum-mesh-state.json');
}

export function defaultReticulumMeshState(): ReticulumMeshState {
  return {
    version: RETICULUM_MESH_STATE_VERSION,
    listenPort: DEFAULT_RETICULUM_MESH_LISTEN_PORT,
    meshListenEnabled: true,
    meshUpnpEnabled: true,
    reachableSelf: false,
    inboundObservedOnMeshPort: false,
    externalProbeSucceeded: false,
    peers: [],
  };
}

export function loadReticulumMeshState(): ReticulumMeshState {
  try {
    const p = getReticulumMeshStatePath();
    if (!fs.existsSync(p)) return defaultReticulumMeshState();
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ReticulumMeshState>;
    if (parsed.version !== RETICULUM_MESH_STATE_VERSION) {
      return defaultReticulumMeshState();
    }
    const base = defaultReticulumMeshState();
    return {
      ...base,
      ...parsed,
      listenPort:
        typeof parsed.listenPort === 'number' && parsed.listenPort > 0
          ? parsed.listenPort
          : base.listenPort,
      meshListenEnabled: parsed.meshListenEnabled !== false,
      meshUpnpEnabled: parsed.meshUpnpEnabled !== false,
      reachableSelf: parsed.reachableSelf === true,
      inboundObservedOnMeshPort: parsed.inboundObservedOnMeshPort === true,
      externalProbeSucceeded: parsed.externalProbeSucceeded === true,
      peers: Array.isArray(parsed.peers)
        ? parsed.peers
            .map(normalizePeerEntry)
            .filter((x): x is ReticulumMeshPeerEntry => x !== null)
            .slice(0, MAX_MESH_STORED_ENDPOINTS)
        : [],
    };
  } catch {
    return defaultReticulumMeshState();
  }
}

function normalizePeerEntry(
  raw: unknown
): ReticulumMeshPeerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  const port = typeof o.port === 'number' ? o.port : Number(o.port);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  const failures = typeof o.failures === 'number' ? Math.max(0, o.failures) : 0;
  const lastSeen =
    typeof o.lastSeen === 'number' ? o.lastSeen : Date.now();
  const dialAttempts =
    typeof o.dialAttempts === 'number' ? Math.max(0, o.dialAttempts) : 0;
  const dialSuccesses =
    typeof o.dialSuccesses === 'number' ? Math.max(0, o.dialSuccesses) : 0;
  const connectionSuccessRate =
    typeof o.connectionSuccessRate === 'number'
      ? Math.min(1, Math.max(0, o.connectionSuccessRate))
      : dialAttempts > 0
        ? dialSuccesses / dialAttempts
        : 0;
  return {
    host,
    port,
    failures,
    lastSeen,
    reachable: o.reachable === true,
    dialAttempts,
    dialSuccesses,
    connectionSuccessRate,
  };
}

export function saveReticulumMeshState(state: ReticulumMeshState): void {
  const p = getReticulumMeshStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

/** Stable Reticulum config section name for a mesh TCP client */
export function meshTcpSectionName(host: string, port: number): string {
  const h = crypto
    .createHash('sha256')
    .update(`${host.toLowerCase()}:${port}`)
    .digest('hex')
    .slice(0, 12);
  return `Mesh_${h}`;
}

export type ReticulumMeshConfigSlice = {
  listenEnabled: boolean;
  listenPort: number;
  /** One TCPClientInterface per outbound mesh peer */
  outbound: Array<{ sectionName: string; host: string; port: number }>;
};

/**
 * Stable ordering for config emission (not health rank). Keeps rnsd config bytes
 * identical when the selected peer set is unchanged but scores reorder.
 */
export function sortMeshOutboundHostsForEmission(
  hosts: Array<{ host: string; port: number }>
): Array<{ host: string; port: number }> {
  return [...hosts].sort((a, b) => {
    const ha = a.host.toLowerCase();
    const hb = b.host.toLowerCase();
    if (ha !== hb) return ha < hb ? -1 : 1;
    return a.port - b.port;
  });
}

export function meshConfigSliceFromState(
  state: ReticulumMeshState,
  selectedHosts: Array<{ host: string; port: number }>
): ReticulumMeshConfigSlice {
  const sorted = sortMeshOutboundHostsForEmission(selectedHosts);
  return {
    listenEnabled: state.meshListenEnabled === true,
    listenPort: state.listenPort,
    outbound: sorted.map((p) => ({
      sectionName: meshTcpSectionName(p.host, p.port),
      host: p.host,
      port: p.port,
    })),
  };
}

/** Choose outbound mesh TCP clients for rnsd config — sparse mesh, prefer healthier peers. */
export function selectMeshOutboundHostsForConfig(
  state: ReticulumMeshState
): Array<{ host: string; port: number }> {
  const sorted = [...state.peers].sort((a, b) => {
    const dr = b.connectionSuccessRate - a.connectionSuccessRate;
    if (Math.abs(dr) > 1e-9) return dr > 0 ? 1 : -1;
    if (a.failures !== b.failures) return a.failures - b.failures;
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    return 0;
  });
  const seen = new Set<string>();
  const out: Array<{ host: string; port: number }> = [];
  for (const p of sorted) {
    const k = `${p.host.toLowerCase()}:${p.port}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ host: p.host, port: p.port });
    if (out.length >= MAX_MESH_OUTBOUND_PEERS) break;
  }
  return out;
}
