/**
 * Persistent state for Reticulum hub mesh (listen port, UPnP — not gossip peer lists).
 */

import * as crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { DEFAULT_RETICULUM_MESH_LISTEN_PORT } from './reticulum-mesh-constants';

export const RETICULUM_MESH_STATE_VERSION = 2 as const;

export type ReticulumMeshState = {
  version: typeof RETICULUM_MESH_STATE_VERSION;
  listenPort: number;
  /** When true, render mesh listen interface in managed config (Backbone on Linux, TCPServer on other OS). */
  meshListenEnabled: boolean;
  meshUpnpEnabled: boolean;
  /** Coordinator: observed inbound on mesh port (diagnostics) */
  reachableSelf: boolean;
  inboundObservedOnMeshPort: boolean;
  externalProbeSucceeded: boolean;
  /**
   * Last WAN IPv4/hostname seen from UPnP after a successful mesh port map (for `reachable_on`).
   * Not written when `meshReachableOnHost` is set (manual wins).
   */
  discoveryReachableHost?: string;
  /**
   * Optional manual `reachable_on` value (IPv4 or hostname, no port). Overrides `discoveryReachableHost`.
   */
  meshReachableOnHost?: string;
};

function getCanonicalQortalHubDataDir(): string {
  return path.join(app.getPath('appData'), 'qortal-hub');
}

export function getReticulumMeshStatePath(): string {
  return path.join(getCanonicalQortalHubDataDir(), 'reticulum-mesh-state.json');
}

/**
 * Writable copy under the canonical qortal-hub profile; `network_identity`
 * points here. Installed from the bundled community file (same identity for
 * all Qortal Hub users — see `getBundledMeshNetworkIdentityPath`).
 */
export function getMeshNetworkIdentityPath(): string {
  return path.join(
    getCanonicalQortalHubDataDir(),
    'reticulum',
    'mesh-network.identity'
  );
}

/**
 * Writable copy under the canonical qortal-hub profile; the mesh listener
 * `passphrase` points here so all installs can join the same authenticated
 * Qortal Hub mesh segment.
 */
export function getMeshNetworkPassphrasePath(): string {
  return path.join(
    getCanonicalQortalHubDataDir(),
    'reticulum',
    'mesh-network.passphrase'
  );
}

/**
 * Canonical Qortal Hub community mesh identity shipped in the app (Reticulum `network_identity`).
 * Same file for every build/install so private gateway discovery stays one logical network.
 */
export function getBundledMeshNetworkIdentityPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'reticulum', 'mesh-network.identity');
  }
  return path.join(__dirname, '..', '..', 'resources', 'mesh-network.identity');
}

/**
 * Canonical passphrase shipped in the app for the shared `qortal-hub` mesh segment.
 */
export function getBundledMeshNetworkPassphrasePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'reticulum', 'mesh-network.passphrase');
  }
  return path.join(__dirname, '..', '..', 'resources', 'mesh-network.passphrase');
}

export function readMeshNetworkPassphrase(
  passphrasePath: string = getMeshNetworkPassphrasePath()
): string | null {
  try {
    const raw = fs.readFileSync(passphrasePath, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
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
    discoveryReachableHost: undefined,
    meshReachableOnHost: undefined,
  };
}

const REACHABLE_ON_MAX = 253;

/** IPv4 or simple FQDN for Reticulum `reachable_on` (no port, no path). */
export function isPlausibleReachableOnHost(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > REACHABLE_ON_MAX) return false;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) {
    const parts = v.split('.').map(Number);
    return parts.length === 4 && parts.every((p) => p >= 0 && p <= 255);
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(v) || !v.includes('.')) return false;
  return true;
}

function sanitizeReachableHostField(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t || t.length > REACHABLE_ON_MAX) return undefined;
  return isPlausibleReachableOnHost(t) ? t : undefined;
}

export function resolveMeshReachableOnHost(state: ReticulumMeshState): string | null {
  const manual = sanitizeReachableHostField(state.meshReachableOnHost);
  if (manual) return manual;
  const auto = sanitizeReachableHostField(state.discoveryReachableHost);
  return auto ?? null;
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
      discoveryReachableHost: sanitizeReachableHostField(
        parsed.discoveryReachableHost
      ),
      meshReachableOnHost: sanitizeReachableHostField(parsed.meshReachableOnHost),
    };
  } catch {
    return defaultReticulumMeshState();
  }
}

export function saveReticulumMeshState(state: ReticulumMeshState): void {
  const p = getReticulumMeshStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

/** Stable Reticulum config section name for a mesh TCP client (unused when outbound is empty). */
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
  /** Always empty — mesh TCP clients come only from bootstrap hubs in managed config, not gossip. */
  outbound: Array<{ sectionName: string; host: string; port: number }>;
  /** Retained for state shape compatibility; managed configs enable remote discovery, but never emit AutoInterface LAN discovery. */
  meshDiscoveryClient: boolean;
  autoconnectDiscoveredMax: number;
  /** Encrypted private gateway when both bundled mesh identity and passphrase exist. Discovery/publishing still requires `reachableOn`. */
  meshPrivateGateway: boolean;
  networkIdentityPath: string;
  /** Shared IFAC/passphrase for the private `qortal-hub` mesh segment. */
  networkPassphrase: string | null;
  /** `[reticulum] enable_transport`: on whenever mesh listen is enabled (hub + RNS transport; bridge shows transport=on when RNS exposes transport_id). */
  enableTransport: boolean;
  /** Public address for mesh gateway discovery (`reachable_on`); null if unknown. */
  reachableOn: string | null;
};

/**
 * Stable ordering for config emission (not health rank).
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
  const identityPath = getMeshNetworkIdentityPath();
  const networkPassphrase = readMeshNetworkPassphrase();
  const hasIdentity = fs.existsSync(identityPath);
  const meshPrivateGateway =
    state.meshListenEnabled === true &&
    hasIdentity &&
    networkPassphrase !== null;
  const reachableOn = meshPrivateGateway ? resolveMeshReachableOnHost(state) : null;
  return {
    listenEnabled: state.meshListenEnabled === true,
    listenPort: state.listenPort,
    outbound: sorted.map((p) => ({
      sectionName: meshTcpSectionName(p.host, p.port),
      host: p.host,
      port: p.port,
    })),
    meshDiscoveryClient: true,
    autoconnectDiscoveredMax: 8,
    meshPrivateGateway,
    networkIdentityPath: identityPath,
    networkPassphrase,
    enableTransport: state.meshListenEnabled === true,
    reachableOn,
  };
}
