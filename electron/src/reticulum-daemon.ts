/**
 * Spawns the Reticulum Network Stack daemon (rnsd).
 *
 * Priority:
 * 1. PyInstaller one-file binary under resources/reticulum/ (packaged apps only; dev skips this)
 * 2. Dev / optional: venv under resources/reticulum-runtime/venv/
 * 3. Dev: system Python on PATH if `rns` is installed (`pip install rns`) — no env var needed
 * 4. Any build: system Python if QORTAL_RETICULUM_SYSTEM=1 (e.g. forced testing)
 * Opt out of (3) and (4) in dev: QORTAL_RETICULUM_NO_SYSTEM=1
 *
 * Config and state: app.getPath('userData')/reticulum (writable; isolated per profile).
 * @see https://reticulum.network/manual/using.html
 */

import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import crypto from 'crypto';
import { app, ipcMain } from 'electron';
import electronIsDev from 'electron-is-dev';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { log as loggerLog, error as loggerError } from './logger';
import type { ReticulumMeshConfigSlice } from './reticulum-mesh-store';
import {
  getBundledMeshNetworkIdentityPath,
  getBundledMeshNetworkPassphrasePath,
  getMeshNetworkIdentityPath,
  getMeshNetworkPassphrasePath,
  loadReticulumMeshState,
  meshConfigSliceFromState,
} from './reticulum-mesh-store';

/**
 * Reticulum hub mesh: listen on the mesh port with optional private-gateway discovery.
 * RNS BackboneInterface is Linux-only; Windows/macOS use TCPServerInterface for the same section.
 * Bootstrap hubs as TCPClient rows; AutoInterface discover/autoconnect (no gossip-driven outbound).
 * On macOS only, `autoconnect_discovered_interfaces` is forced to 0: upstream RNS
 * treats Windows specially for discovered gateways but not Darwin, so autoconnect
 * may synthesize BackboneInterface clients; Backbone is Linux-only (epoll).
 */

/** Mesh listen / private gateway: Backbone on Linux; TCPServer on Windows/macOS (no epoll). */
function meshListenRnsInterfaceType():
  | 'BackboneInterface'
  | 'TCPServerInterface' {
  return process.platform === 'linux'
    ? 'BackboneInterface'
    : 'TCPServerInterface';
}

const RNS_MODULE = 'RNS.Utilities.rnsd';
const FROZEN_DIR_NAME = 'reticulum';
const RUNTIME_DIR_NAME = 'reticulum-runtime';
const NESTED_VENV = 'venv';
const RETICULUM_SHARED_INSTANCE_BASE_PORT = 37428;
const RETICULUM_CONTROL_BASE_PORT = 37429;
const RETICULUM_CONFIG_FILENAME = 'config';
const MANAGED_CONFIG_MARKER = '# Managed by Qortal Hub';
const DEFAULT_CONFIG_SENTINEL = '# This is the default Reticulum config file.';
const RETICULUM_SHARED_INSTANCE_NAME = 'qortal-hub-shared';
const RETICULUM_SHARED_STATE_DIRNAME = 'qortal-shared';
const RETICULUM_APP_INSTANCE_REGISTRY_FILENAME = 'reticulum-app-instances.json';
const RETICULUM_SHARED_DAEMON_STATE_FILENAME = 'reticulum-daemon-state.json';
const RETICULUM_SHARED_TRANSPORT_STATE_FILENAME = 'reticulum-transport-state.json';
const RETICULUM_QORTAL_HUB_NETWORK_NAME = 'qortal-hub';
const RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES = 5;
const RETICULUM_DAEMON_STOP_TIMEOUT_MS = 10_000;
const RETICULUM_SHARED_INSTANCE_READY_TIMEOUT_MS = 10_000;
const RETICULUM_SHARED_INSTANCE_READY_POLL_MS = 150;
const RETICULUM_LOOPBACK_HOST = '127.0.0.1';

export type ReticulumDaemonMode = 'frozen' | 'venv' | 'system' | null;
export type ReticulumAppInstanceRecord = {
  appPid: number;
  instanceIndex: number;
  startedAt: number;
};
export type ReticulumAppQuitPlan = {
  otherActiveInstances: number;
  remainingActiveInstances: number;
  shouldStopSharedDaemon: boolean;
};
export type ReticulumAppLaunchRecovery = {
  activeInstances: number;
  orphanedDaemonFound: boolean;
  orphanedDaemonStopped: boolean;
  daemonStateCleared: boolean;
};
export type ReticulumSharedTransportState = {
  reachability: ReticulumReachability;
  transportEnabled?: boolean;
  configuredHubInterfaces?: number;
  onlineHubInterfaces?: number;
  configuredRemoteHubInterfaces?: number;
  onlineRemoteHubInterfaces?: number;
  hubSummary?: string;
  reason?: string;
  updatedAt: number;
  sourceInstanceIndex: number;
};
export type ReticulumReachability =
  | 'unknown'
  | 'lan-only'
  | 'hub-connected'
  | 'disconnected';
export type ReticulumBridgeState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'degraded';
export type ReticulumHubEndpoint = {
  name: string;
  host: string;
  port: number;
  /**
   * Outbound hub link. `BackboneInterface` remotes use `remote` on Linux.
   * Non-Linux hosts fall back to TCPClientInterface (Backbone stack is Linux-only in RNS).
   */
  interfaceType?: 'TCPClientInterface' | 'BackboneInterface';
  /** Optional Reticulum virtual network segment (see RNS interface `network_name`). */
  networkName?: string;
};

/** RNS: BackboneInterface remotes stay Backbone on Linux; without Linux, use TCP client. */
function effectiveHubInterfaceType(
  hub: ReticulumHubEndpoint
): 'TCPClientInterface' | 'BackboneInterface' {
  const want = hub.interfaceType ?? 'TCPClientInterface';
  if (want === 'BackboneInterface' && process.platform !== 'linux') {
    return 'TCPClientInterface';
  }
  return want;
}

export const DEFAULT_RETICULUM_HUBS: readonly ReticulumHubEndpoint[] =
  Object.freeze([
    {
      name: 'Backbone Client Qortal Hub',
      host: 'phantom.mobilefabrik.com',
      port: 4400,
      interfaceType: 'BackboneInterface',
      networkName: RETICULUM_QORTAL_HUB_NETWORK_NAME,
    },
    {
      name: 'Crowetic Reticulum Hub',
      host: 'reticulum.qortal.link',
      port: 4444,
      interfaceType: 'BackboneInterface',
      networkName: RETICULUM_QORTAL_HUB_NETWORK_NAME,
    },
    {
      name: 'Crowetic Reticulum Hub 2',
      host: 'reticulum2.qortal.link',
      port: 4444,
      interfaceType: 'BackboneInterface',
      networkName: RETICULUM_QORTAL_HUB_NETWORK_NAME,
    },
  ]);

let child: ChildProcessWithoutNullStreams | null = null;
let lastStartMode: ReticulumDaemonMode = null;
let reticulumInstanceIndex = 0;

type ReticulumSharedDaemonState = {
  pid: number;
  ownerAppPid: number;
  ownerInstanceIndex: number;
  startedAt: number;
  configDir: string;
  mode: ReticulumDaemonMode;
};

export function getReticulumConfigDir(): string {
  return path.join(app.getPath('userData'), 'reticulum');
}

function getReticulumSharedStateDir(): string {
  const dir = path.join(app.getPath('appData'), RETICULUM_SHARED_STATE_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getReticulumAppInstanceRegistryPath(): string {
  return path.join(
    getReticulumSharedStateDir(),
    RETICULUM_APP_INSTANCE_REGISTRY_FILENAME
  );
}

export function getReticulumSharedDaemonStatePath(): string {
  return path.join(
    getReticulumSharedStateDir(),
    RETICULUM_SHARED_DAEMON_STATE_FILENAME
  );
}

export function getReticulumSharedTransportStatePath(): string {
  return path.join(
    getReticulumSharedStateDir(),
    RETICULUM_SHARED_TRANSPORT_STATE_FILENAME
  );
}

export function setReticulumInstanceIndex(index: number): void {
  reticulumInstanceIndex = Math.max(0, Math.trunc(index));
}

export function getReticulumInstanceIndex(): number {
  return reticulumInstanceIndex;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code =
      typeof err === 'object' && err && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    return code === 'EPERM';
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeReticulumAppInstanceRecord(
  raw: unknown
): ReticulumAppInstanceRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const appPid = candidate.appPid;
  const instanceIndex = candidate.instanceIndex;
  const startedAt = candidate.startedAt;
  if (
    !Number.isInteger(appPid) ||
    !Number.isInteger(instanceIndex) ||
    typeof startedAt !== 'number' ||
    !Number.isFinite(startedAt)
  ) {
    return null;
  }
  return {
    appPid: Number(appPid),
    instanceIndex: Number(instanceIndex),
    startedAt: Number(startedAt),
  };
}

function readReticulumAppInstanceRegistry(): ReticulumAppInstanceRecord[] {
  const raw = readJsonFile<unknown>(getReticulumAppInstanceRegistryPath());
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => normalizeReticulumAppInstanceRecord(entry))
    .filter((entry): entry is ReticulumAppInstanceRecord => entry !== null);
}

function writeReticulumAppInstanceRegistry(
  entries: ReticulumAppInstanceRecord[]
): void {
  const filePath = getReticulumAppInstanceRegistryPath();
  if (entries.length === 0) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    return;
  }
  writeJsonFile(filePath, entries);
}

function pruneReticulumAppInstances(
  entries: ReticulumAppInstanceRecord[]
): ReticulumAppInstanceRecord[] {
  return entries.filter(
    (entry, index, arr) =>
      isPidAlive(entry.appPid) &&
      arr.findIndex((other) => other.appPid === entry.appPid) === index
  );
}

export function getReticulumActiveAppInstances(): ReticulumAppInstanceRecord[] {
  const pruned = pruneReticulumAppInstances(readReticulumAppInstanceRegistry());
  writeReticulumAppInstanceRegistry(pruned);
  return pruned;
}

export function registerReticulumAppInstance(
  instanceIndex = reticulumInstanceIndex,
  appPid = process.pid
): ReticulumAppInstanceRecord[] {
  const entries = pruneReticulumAppInstances(readReticulumAppInstanceRegistry());
  const next = entries.filter((entry) => entry.appPid !== appPid);
  next.push({
    appPid,
    instanceIndex: Math.max(0, Math.trunc(instanceIndex)),
    startedAt: Date.now(),
  });
  next.sort((a, b) => a.instanceIndex - b.instanceIndex || a.appPid - b.appPid);
  writeReticulumAppInstanceRegistry(next);
  return next;
}

export function unregisterReticulumAppInstance(
  appPid = process.pid
): ReticulumAppInstanceRecord[] {
  const entries = pruneReticulumAppInstances(readReticulumAppInstanceRegistry());
  const next = entries.filter((entry) => entry.appPid !== appPid);
  writeReticulumAppInstanceRegistry(next);
  return next;
}

export function planReticulumAppQuit(appPid = process.pid): ReticulumAppQuitPlan {
  const remaining = unregisterReticulumAppInstance(appPid);
  return {
    otherActiveInstances: remaining.length,
    remainingActiveInstances: remaining.length,
    shouldStopSharedDaemon: remaining.length === 0,
  };
}

function normalizeReticulumSharedDaemonState(
  raw: unknown
): ReticulumSharedDaemonState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const pid = candidate.pid;
  const ownerAppPid = candidate.ownerAppPid;
  const ownerInstanceIndex = candidate.ownerInstanceIndex;
  const startedAt = candidate.startedAt;
  const configDir = candidate.configDir;
  const mode = candidate.mode;
  if (
    !Number.isInteger(pid) ||
    !Number.isInteger(ownerAppPid) ||
    !Number.isInteger(ownerInstanceIndex) ||
    typeof startedAt !== 'number' ||
    !Number.isFinite(startedAt) ||
    typeof configDir !== 'string' ||
    configDir.length === 0 ||
    !(
      mode === 'frozen' ||
      mode === 'venv' ||
      mode === 'system' ||
      mode === null
    )
  ) {
    return null;
  }
  return {
    pid: Number(pid),
    ownerAppPid: Number(ownerAppPid),
    ownerInstanceIndex: Number(ownerInstanceIndex),
    startedAt: Number(startedAt),
    configDir,
    mode: mode as ReticulumDaemonMode,
  };
}

function readReticulumSharedDaemonState(): ReticulumSharedDaemonState | null {
  return normalizeReticulumSharedDaemonState(
    readJsonFile<unknown>(getReticulumSharedDaemonStatePath())
  );
}

function clearReticulumSharedDaemonState(expectedPid?: number): void {
  const filePath = getReticulumSharedDaemonStatePath();
  if (typeof expectedPid === 'number') {
    const current = readReticulumSharedDaemonState();
    if (!current || current.pid !== expectedPid) {
      return;
    }
  }
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

function persistReticulumSharedDaemonState(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  writeJsonFile(getReticulumSharedDaemonStatePath(), {
    pid,
    ownerAppPid: process.pid,
    ownerInstanceIndex: reticulumInstanceIndex,
    startedAt: Date.now(),
    configDir: getReticulumConfigDir(),
    mode: lastStartMode,
  } satisfies ReticulumSharedDaemonState);
}

function normalizeReticulumSharedTransportState(
  raw: unknown
): ReticulumSharedTransportState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const reachability = candidate.reachability;
  const updatedAt = candidate.updatedAt;
  const sourceInstanceIndex = candidate.sourceInstanceIndex;
  if (
    !(
      reachability === 'unknown' ||
      reachability === 'lan-only' ||
      reachability === 'hub-connected' ||
      reachability === 'disconnected'
    ) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt) ||
    !Number.isInteger(sourceInstanceIndex)
  ) {
    return null;
  }
  const out: ReticulumSharedTransportState = {
    reachability,
    updatedAt,
    sourceInstanceIndex: Number(sourceInstanceIndex),
  };
  if (typeof candidate.transportEnabled === 'boolean') {
    out.transportEnabled = candidate.transportEnabled;
  }
  if (typeof candidate.configuredHubInterfaces === 'number') {
    out.configuredHubInterfaces = candidate.configuredHubInterfaces;
  }
  if (typeof candidate.onlineHubInterfaces === 'number') {
    out.onlineHubInterfaces = candidate.onlineHubInterfaces;
  }
  if (typeof candidate.configuredRemoteHubInterfaces === 'number') {
    out.configuredRemoteHubInterfaces = candidate.configuredRemoteHubInterfaces;
  }
  if (typeof candidate.onlineRemoteHubInterfaces === 'number') {
    out.onlineRemoteHubInterfaces = candidate.onlineRemoteHubInterfaces;
  }
  if (typeof candidate.hubSummary === 'string') {
    out.hubSummary = candidate.hubSummary;
  }
  if (typeof candidate.reason === 'string') {
    out.reason = candidate.reason;
  }
  return out;
}

export function readReticulumSharedTransportState():
  | ReticulumSharedTransportState
  | null {
  return normalizeReticulumSharedTransportState(
    readJsonFile<unknown>(getReticulumSharedTransportStatePath())
  );
}

export function persistReticulumSharedTransportState(
  state: Omit<ReticulumSharedTransportState, 'updatedAt' | 'sourceInstanceIndex'>
): void {
  writeJsonFile(getReticulumSharedTransportStatePath(), {
    ...state,
    updatedAt: Date.now(),
    sourceInstanceIndex: reticulumInstanceIndex,
  } satisfies ReticulumSharedTransportState);
}

function shouldFallbackToSharedTransportState(
  bridgeStatus: Partial<ReticulumDaemonStatus> & {
    overlayLinksConnected?: number;
    hubSummary?: string;
    reason?: string;
  }
): boolean {
  if (bridgeStatus.hubSummary === 'Unable to read Reticulum interface stats') {
    return true;
  }
  return (
    bridgeStatus.bridgeState === 'ready' &&
    typeof bridgeStatus.overlayLinksConnected === 'number' &&
    bridgeStatus.overlayLinksConnected > 0 &&
    bridgeStatus.reachability === 'unknown' &&
    bridgeStatus.configuredHubInterfaces === 0 &&
    bridgeStatus.onlineHubInterfaces === 0
  );
}

function signalReticulumPid(
  pid: number,
  signal: NodeJS.Signals | undefined,
  context: string
): boolean {
  try {
    if (process.platform === 'win32') {
      process.kill(pid);
    } else if (signal) {
      process.kill(pid, signal);
    } else {
      process.kill(pid);
    }
    loggerLog(`[Reticulum] Signaled rnsd pid=${pid} context=${context}`);
    return true;
  } catch (err) {
    loggerError(`[Reticulum] Failed to signal rnsd pid=${pid} context=${context}:`, err);
    return false;
  }
}

export function recoverReticulumStateForAppLaunch(
  instanceIndex = reticulumInstanceIndex
): ReticulumAppLaunchRecovery {
  const activeInstances = getReticulumActiveAppInstances();
  const state = readReticulumSharedDaemonState();
  let orphanedDaemonFound = false;
  let orphanedDaemonStopped = false;
  let daemonStateCleared = false;

  if (!state) {
    return {
      activeInstances: activeInstances.length,
      orphanedDaemonFound,
      orphanedDaemonStopped,
      daemonStateCleared,
    };
  }

  if (!isPidAlive(state.pid)) {
    clearReticulumSharedDaemonState(state.pid);
    daemonStateCleared = true;
    loggerLog(
      `[Reticulum] Cleared stale shared daemon state for dead pid=${state.pid}`
    );
    return {
      activeInstances: activeInstances.length,
      orphanedDaemonFound,
      orphanedDaemonStopped,
      daemonStateCleared,
    };
  }

  if (instanceIndex === 0 && activeInstances.length === 0) {
    orphanedDaemonFound = true;
    orphanedDaemonStopped = signalReticulumPid(
      state.pid,
      process.platform === 'win32' ? undefined : 'SIGTERM',
      'startup-recovery'
    );
    clearReticulumSharedDaemonState(state.pid);
    daemonStateCleared = true;
  }

  return {
    activeInstances: activeInstances.length,
    orphanedDaemonFound,
    orphanedDaemonStopped,
    daemonStateCleared,
  };
}

function getReticulumSharedInstancePort(): number {
  return RETICULUM_SHARED_INSTANCE_BASE_PORT;
}

function getReticulumControlPort(): number {
  return RETICULUM_CONTROL_BASE_PORT;
}

function getReticulumInstanceName(): string {
  return RETICULUM_SHARED_INSTANCE_NAME;
}

function getReticulumConfigFilePath(): string {
  return path.join(getReticulumConfigDir(), RETICULUM_CONFIG_FILENAME);
}

function renderManagedHubInterfaces(
  hubs: readonly ReticulumHubEndpoint[]
): string {
  if (hubs.length === 0) return '';
  return hubs
    .map((hub) => {
      const ifaceType = effectiveHubInterfaceType(hub);
      const hostKey =
        ifaceType === 'BackboneInterface' ? 'remote' : 'target_host';
      const networkName =
        typeof hub.networkName === 'string' && hub.networkName.trim().length > 0
          ? `
  network_name = ${hub.networkName.trim()}`
          : '';
      return `  [[${hub.name}]]
  type = ${ifaceType}
  enabled = yes
  ${hostKey} = ${hub.host}
  target_port = ${hub.port}${networkName}`;
    })
    .join('\n\n');
}

/** Keep local link discovery available on LANs; RNS interface discovery is configured in `[reticulum]`. */
function renderDefaultAutoInterface(
  slice: ReticulumMeshConfigSlice | null | undefined
): string {
  void slice;
  return `  [[Default Interface]]
  type = AutoInterface
  enabled = yes
`;
}

function renderMeshInterfaces(
  slice: ReticulumMeshConfigSlice | null | undefined
): string {
  if (!slice) return '';
  let out = '';
  if (slice.listenEnabled) {
    const iface = meshListenRnsInterfaceType();
    const listenKeys =
      iface === 'BackboneInterface'
        ? `  listen_on = 0.0.0.0
  port = ${slice.listenPort}`
        : `  listen_ip = 0.0.0.0
  listen_port = ${slice.listenPort}`;
    if (slice.meshPrivateGateway) {
      if (
        typeof slice.networkPassphrase === 'string' &&
        slice.networkPassphrase.length > 0 &&
        typeof slice.reachableOn === 'string' &&
        slice.reachableOn.length > 0
      ) {
        out += `  [[Qortal Hub Mesh Listen]]
  type = ${iface}
  enabled = yes
${listenKeys}
  network_name = ${RETICULUM_QORTAL_HUB_NETWORK_NAME}
  passphrase = ${slice.networkPassphrase}
  reachable_on = ${slice.reachableOn}
  discovery_name = Qortal Hub Mesh Listen
  discoverable = yes
  announce_interval = ${RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES}
  mode = gateway
  discovery_encrypt = yes
  publish_ifac = yes
`;
      }
    } else {
      out += `  [[Qortal Hub Mesh Listen]]
  type = ${iface}
  enabled = yes
${listenKeys}
`;
    }
  }
  for (const p of slice.outbound) {
    if (out.length > 0) {
      out += '\n\n';
    }
    out += `  [[${p.sectionName}]]
  type = TCPClientInterface
  enabled = yes
  target_host = ${p.host}
  target_port = ${p.port}
`;
  }
  return out;
}

function renderReticulumHeader(
  meshSlice: ReticulumMeshConfigSlice | null | undefined
): string {
  const transport = meshSlice?.enableTransport === true ? 'True' : 'False';
  const hasNetworkIdentity =
    typeof meshSlice?.networkIdentityPath === 'string' &&
    meshSlice.networkIdentityPath.length > 0 &&
    fs.existsSync(meshSlice.networkIdentityPath);
  let block = `${MANAGED_CONFIG_MARKER}
[reticulum]
enable_transport = ${transport}
share_instance = Yes
instance_name = ${getReticulumInstanceName()}
shared_instance_port = ${getReticulumSharedInstancePort()}
instance_control_port = ${getReticulumControlPort()}
`;
  if (meshSlice?.meshDiscoveryClient) {
    const autoconnectDiscoveredMax =
      process.platform === 'darwin' ? 0 : meshSlice.autoconnectDiscoveredMax;
    block += `discover_interfaces = yes
autoconnect_discovered_interfaces = ${autoconnectDiscoveredMax}
`;
  }
  if (hasNetworkIdentity) {
    block += `network_identity = ${meshSlice.networkIdentityPath}
`;
  }
  return block;
}

function logManagedDiscoveryConfig(
  meshSlice: ReticulumMeshConfigSlice | null | undefined,
  configPath: string
): void {
  if (!meshSlice?.listenEnabled) {
    return;
  }
  const iface = meshListenRnsInterfaceType();
  if (meshSlice.meshPrivateGateway) {
    const reachable = meshSlice.reachableOn ?? 'unset';
    loggerLog(
      `[Reticulum] Discovery gateway config path=${configPath} type=${iface} port=${meshSlice.listenPort} network_name=${RETICULUM_QORTAL_HUB_NETWORK_NAME} reachable_on=${reachable} encrypted=yes publish_ifac=yes announce_interval=${RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES}m`
    );
    return;
  }
  loggerLog(
    `[Reticulum] Mesh listen config path=${configPath} type=${iface} port=${meshSlice.listenPort} discoverable=no`
  );
}

export function buildManagedReticulumConfig(
  hubs: readonly ReticulumHubEndpoint[] = DEFAULT_RETICULUM_HUBS,
  meshSlice?: ReticulumMeshConfigSlice | null
): string {
  const slice = meshSlice ?? null;
  const ifaceParts = [
    renderDefaultAutoInterface(slice),
    renderManagedHubInterfaces(hubs),
    renderMeshInterfaces(slice),
  ].filter((s) => s.length > 0);
  const ifaceBody = ifaceParts.join('\n\n');
  return `${renderReticulumHeader(slice)}
[logging]
loglevel = 4

[interfaces]
${ifaceBody}
`;
}

/** Full managed config including mesh slice derived from reticulum-mesh-state.json */
export function buildCurrentManagedReticulumConfig(): string {
  const state = loadReticulumMeshState();
  const slice = meshConfigSliceFromState(state, []);
  return buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, slice);
}

/**
 * SHA-256 hex digest of the exact managed config string that would be written.
 */
export function computeManagedReticulumConfigFingerprint(): string {
  const body = buildCurrentManagedReticulumConfig();
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Writes managed Reticulum config when the hub owns the file (same rules as startup).
 * @returns true if the file was updated
 */
export function writeManagedReticulumConfigIfManaged(
  nextContents: string
): boolean {
  const configPath = getReticulumConfigFilePath();
  const currentContents = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : null;

  if (currentContents === nextContents) {
    return false;
  }

  const isDefaultGeneratedConfig =
    currentContents !== null &&
    currentContents.includes(DEFAULT_CONFIG_SENTINEL) &&
    currentContents.includes('instance_name = default');

  if (
    currentContents !== null &&
    !currentContents.startsWith(MANAGED_CONFIG_MARKER) &&
    !isDefaultGeneratedConfig
  ) {
    loggerLog(
      `[Reticulum] Preserving existing custom config ${configPath}; mesh config not written.`
    );
    return false;
  }

  fs.writeFileSync(configPath, nextContents, 'utf8');
  loggerLog(`[Reticulum] Wrote managed config ${configPath}`);
  return true;
}

function ensureManagedReticulumConfig(): void {
  const id = ensureMeshNetworkIdentityIfNeeded();
  const passphrase = ensureMeshNetworkPassphraseIfNeeded();
  const state = loadReticulumMeshState();
  const meshSlice = meshConfigSliceFromState(state, []);
  if (!id.ok) {
    loggerLog(`[Reticulum] Mesh identity: ${id.error ?? 'failed'}`);
  } else if (id.created) {
    loggerLog(
      '[Reticulum] Community mesh network identity installed; regenerating managed config'
    );
  }
  if (!passphrase.ok) {
    loggerLog(`[Reticulum] Mesh passphrase: ${passphrase.error ?? 'failed'}`);
  } else if (passphrase.created) {
    loggerLog(
      '[Reticulum] Community mesh passphrase installed; regenerating managed config'
    );
  }
  const configPath = getReticulumConfigFilePath();
  const nextContents = buildManagedReticulumConfig(
    DEFAULT_RETICULUM_HUBS,
    meshSlice
  );
  const currentContents = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : null;

  if (currentContents === nextContents) {
    logManagedDiscoveryConfig(meshSlice, configPath);
    loggerLog(
      `[Reticulum] Using managed config ${configPath} instance_name=${getReticulumInstanceName()} shared_port=${getReticulumSharedInstancePort()} control_port=${getReticulumControlPort()}`
    );
    return;
  }

  if (!writeManagedReticulumConfigIfManaged(nextContents)) {
    return;
  }
  logManagedDiscoveryConfig(meshSlice, configPath);
  loggerLog(
    `[Reticulum] instance_name=${getReticulumInstanceName()} shared_port=${getReticulumSharedInstancePort()} control_port=${getReticulumControlPort()}`
  );
}

function appendReticulumFileLog(line: string): void {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'reticulum.log'),
      `[${new Date().toISOString()}] ${line}\n`
    );
  } catch {
    // ignore
  }
}

function emitReticulumLog(source: 'stdout' | 'stderr', chunk: Buffer): void {
  const text = chunk.toString().replace(/\r?\n$/, '');
  if (!text) return;
  const prefixed = `[Reticulum/${source}] ${text}`;
  loggerLog(prefixed);
  appendReticulumFileLog(prefixed);
}

/** Directory containing the frozen PyInstaller rnsd binary. */
export function getReticulumFrozenDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, FROZEN_DIR_NAME);
  }
  return path.join(__dirname, '..', '..', 'resources', FROZEN_DIR_NAME);
}

/** Optional dev venv layout (reticulum-runtime/venv). */
export function getReticulumRuntimeSearchDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, RUNTIME_DIR_NAME);
  }
  return path.join(__dirname, '..', '..', 'resources', RUNTIME_DIR_NAME);
}

function rnsdExeName(): string {
  return process.platform === 'win32' ? 'rnsd.exe' : 'rnsd';
}

function resolveFrozenRnsdPath(): string | null {
  const p = path.join(getReticulumFrozenDir(), rnsdExeName());
  return fs.existsSync(p) ? p : null;
}

function resolveVenvRoot(runtimeDir: string): string | null {
  const candidates = [path.join(runtimeDir, NESTED_VENV), runtimeDir];
  for (const root of candidates) {
    if (process.platform === 'win32') {
      const py = path.join(root, 'Scripts', 'python.exe');
      if (fs.existsSync(py)) return root;
    } else {
      const py3 = path.join(root, 'bin', 'python3');
      const py = path.join(root, 'bin', 'python');
      if (fs.existsSync(py3)) return root;
      if (fs.existsSync(py)) return root;
    }
  }
  return null;
}

function resolvePythonExecutable(venvRoot: string): string | null {
  if (process.platform === 'win32') {
    const p = path.join(venvRoot, 'Scripts', 'python.exe');
    return fs.existsSync(p) ? p : null;
  }
  const py3 = path.join(venvRoot, 'bin', 'python3');
  if (fs.existsSync(py3)) return py3;
  const py = path.join(venvRoot, 'bin', 'python');
  return fs.existsSync(py) ? py : null;
}

function resolveRnsdScript(venvRoot: string): string | null {
  if (process.platform === 'win32') {
    const s = path.join(venvRoot, 'Scripts', rnsdExeName());
    return fs.existsSync(s) ? s : null;
  }
  const s = path.join(venvRoot, 'bin', rnsdExeName());
  return fs.existsSync(s) ? s : null;
}

function canImportRNS(pythonPath: string, cwd: string): boolean {
  const r = spawnSync(pythonPath, ['-c', 'import RNS'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0;
}

export type ReticulumDaemonStatus = {
  running: boolean;
  pid: number | undefined;
  mode: ReticulumDaemonMode;
  configDir: string;
  reason?: string;
  bridgeState?: ReticulumBridgeState;
  reachability: ReticulumReachability;
  transportEnabled?: boolean;
  configuredHubInterfaces?: number;
  onlineHubInterfaces?: number;
  configuredRemoteHubInterfaces?: number;
  onlineRemoteHubInterfaces?: number;
  hubSummary?: string;
  /** Established overlay (presence/signaling) RNS.Link count from the Python bridge. */
  overlayLinksConnected?: number;
  /** Established overlay links we initiated (outbound). */
  p2pOutboundPeers?: number;
  /** Established overlay links accepted inbound (incoming). */
  p2pInboundPeers?: number;
  /** Identity-verified Reticulum overlay peers (signed presence). */
  verifiedOverlayPeerCount?: number;
};

export type ReticulumOverlayPeerStatus = {
  linkId: string;
  peerPresenceHash: string;
  address?: string;
  connectedAt: number;
};

export type ReticulumPythonLaunchPlan =
  | {
      cmd: string;
      args: string[];
      cwd: string;
      mode: Exclude<ReticulumDaemonMode, 'frozen' | null>;
      envExtra?: Record<string, string>;
    }
  | { error: string };

type LaunchPlan =
  | {
      cmd: string;
      args: string[];
      cwd: string;
      mode: ReticulumDaemonMode;
      /** Extra env vars (merged over process.env). */
      envExtra?: Record<string, string>;
    }
  | { error: string };

function probeReticulumVersion(
  plan: Extract<LaunchPlan, { cmd: string }>
): string | null {
  try {
    const env = { ...process.env, ...(plan.envExtra ?? {}) };
    if (plan.mode === 'frozen') {
      const result = spawnSync(plan.cmd, ['--version'], {
        cwd: plan.cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
      });
      const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
      return text.length > 0 ? text.replace(/\s+/g, ' ') : null;
    }

    const result = spawnSync(
      plan.cmd,
      ['-c', 'import RNS; print(getattr(RNS, "__version__", "unknown"))'],
      {
        cwd: plan.cwd,
        env,
        encoding: 'utf8',
        windowsHide: true,
        shell: process.platform === 'win32',
      }
    );
    if (result.status !== 0) {
      return null;
    }
    const text = `${result.stdout ?? ''}`.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function resolveLaunchPlan(): LaunchPlan {
  const configDir = getReticulumConfigDir();
  const extraArgs = ['--config', configDir];

  // Dev (`npm run electron:start`): use venv or system `rnsd`, not PyInstaller `rnsd` in resources/reticulum/.
  const frozen = app.isPackaged ? resolveFrozenRnsdPath() : null;
  if (frozen) {
    const cwd = path.dirname(frozen);
    return {
      cmd: frozen,
      args: [...extraArgs],
      cwd,
      mode: 'frozen',
    };
  }

  const runtimeDir = getReticulumRuntimeSearchDir();
  const venvRoot = resolveVenvRoot(runtimeDir);

  if (venvRoot) {
    const rnsd = resolveRnsdScript(venvRoot);
    const py = resolvePythonExecutable(venvRoot);
    if (rnsd) {
      return {
        cmd: rnsd,
        args: [...extraArgs],
        cwd: venvRoot,
        mode: 'venv',
        envExtra: { PYTHONNOUSERSITE: '1' },
      };
    }
    if (py && canImportRNS(py, venvRoot)) {
      return {
        cmd: py,
        args: ['-m', RNS_MODULE, ...extraArgs],
        cwd: venvRoot,
        mode: 'venv',
        envExtra: { PYTHONNOUSERSITE: '1' },
      };
    }
    loggerLog(
      `[Reticulum] Dev venv at ${venvRoot} has no working rnsd/RNS — using system Python if available (remove the venv folder or run npm run bundle:reticulum-venv to fix it).`
    );
  }

  const allowSystem =
    process.env.QORTAL_RETICULUM_NO_SYSTEM !== '1' &&
    (electronIsDev || process.env.QORTAL_RETICULUM_SYSTEM === '1');

  if (!allowSystem) {
    const frozenDir = getReticulumFrozenDir();
    return {
      error: `No frozen rnsd in ${frozenDir}. Run npm run bundle:reticulum before packaging.`,
    };
  }

  const tryNames =
    process.platform === 'win32'
      ? ['python', 'python3']
      : ['python3', 'python'];
  for (const name of tryNames) {
    const probe = spawnSync(name, ['-c', 'import RNS'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (probe.status !== 0) continue;
    // Do not set PYTHONNOUSERSITE — dev installs use `pip install --user rns` (user site).
    return {
      cmd: name,
      args: ['-m', RNS_MODULE, ...extraArgs],
      cwd: process.cwd(),
      mode: 'system',
    };
  }

  const hint = electronIsDev
    ? 'Dev: install Reticulum once — pip install rns (or npm run bundle:reticulum-venv / npm run bundle:reticulum).'
    : 'Set QORTAL_RETICULUM_SYSTEM=1 with pip install rns, or ship a frozen rnsd.';
  return {
    error: `No Python on PATH with RNS installed. ${hint}`,
  };
}

export function resolveReticulumPythonLaunch(
  scriptPath: string,
  scriptArgs: string[] = []
): ReticulumPythonLaunchPlan {
  const runtimeDir = getReticulumRuntimeSearchDir();
  const venvRoot = resolveVenvRoot(runtimeDir);

  if (venvRoot) {
    const py = resolvePythonExecutable(venvRoot);
    if (py && canImportRNS(py, venvRoot)) {
      return {
        cmd: py,
        args: [scriptPath, ...scriptArgs],
        cwd: venvRoot,
        mode: 'venv',
        envExtra: { PYTHONNOUSERSITE: '1' },
      };
    }
  }

  const allowSystem =
    process.env.QORTAL_RETICULUM_NO_SYSTEM !== '1' &&
    (electronIsDev || process.env.QORTAL_RETICULUM_SYSTEM === '1');

  if (!allowSystem) {
    return {
      error:
        'No Reticulum Python runtime available for the bridge. Bundle reticulum-runtime or enable system Python.',
    };
  }

  const tryNames =
    process.platform === 'win32'
      ? ['python', 'python3']
      : ['python3', 'python'];
  for (const name of tryNames) {
    const probe = spawnSync(name, ['-c', 'import RNS'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (probe.status !== 0) continue;
    return {
      cmd: name,
      args: [scriptPath, ...scriptArgs],
      cwd: process.cwd(),
      mode: 'system',
    };
  }

  return {
    error:
      'No Python on PATH with RNS installed for the Reticulum bridge. Install rns or bundle reticulum-runtime.',
  };
}

export type EnsureMeshNetworkIdentityResult = {
  ok: boolean;
  error?: string;
  /** True if the bundled community identity was copied into userData. */
  created?: boolean;
};

function ensureBundledMeshResourceIfNeeded(options: {
  dest: string;
  source: string;
  missingMessage: string;
  installErrorPrefix: string;
  installedMessage: string;
}): EnsureMeshNetworkIdentityResult {
  const { dest, source, missingMessage, installErrorPrefix, installedMessage } =
    options;
  if (fs.existsSync(dest)) {
    return { ok: true, created: false };
  }
  if (!fs.existsSync(source)) {
    loggerLog(`[Reticulum] ${missingMessage}`);
    return { ok: false, error: missingMessage };
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  } catch (err) {
    const msg = `${installErrorPrefix}: ${String(err)}`;
    loggerError(`[Reticulum] ${msg}`);
    return { ok: false, error: msg };
  }
  loggerLog(`[Reticulum] ${installedMessage} ${dest}`);
  return { ok: true, created: true };
}

/**
 * Installs the bundled Qortal community `mesh-network.identity` into userData so
 * encrypted discovery and private gateway publishing can share one RNS network identity.
 * Idempotent. Call before rendering managed config.
 */
export function ensureMeshNetworkIdentityIfNeeded(): EnsureMeshNetworkIdentityResult {
  return ensureBundledMeshResourceIfNeeded({
    dest: getMeshNetworkIdentityPath(),
    source: getBundledMeshNetworkIdentityPath(),
    missingMessage: `Bundled community mesh identity missing: ${getBundledMeshNetworkIdentityPath()}`,
    installErrorPrefix: 'Failed to install mesh network identity',
    installedMessage:
      'Installed community mesh network identity (bundle -> userData)',
  });
}

/**
 * Installs the bundled Qortal community mesh passphrase into userData so
 * private gateway discovery can publish the shared IFAC credentials.
 * Idempotent. Call before rendering managed config.
 */
export function ensureMeshNetworkPassphraseIfNeeded(): EnsureMeshNetworkIdentityResult {
  return ensureBundledMeshResourceIfNeeded({
    dest: getMeshNetworkPassphrasePath(),
    source: getBundledMeshNetworkPassphrasePath(),
    missingMessage: `Bundled community mesh passphrase missing: ${getBundledMeshNetworkPassphrasePath()}`,
    installErrorPrefix: 'Failed to install mesh network passphrase',
    installedMessage:
      'Installed community mesh passphrase (bundle -> userData)',
  });
}

export function getReticulumDaemonStatus(): ReticulumDaemonStatus {
  const running = child !== null && child.exitCode === null && !child.killed;
  if (running) {
    return {
      running: true,
      pid: child?.pid,
      mode: lastStartMode,
      configDir: getReticulumConfigDir(),
      reachability: 'unknown',
    };
  }
  const sharedState = readReticulumSharedDaemonState();
  if (sharedState) {
    if (isPidAlive(sharedState.pid)) {
      return {
        running: true,
        pid: sharedState.pid,
        mode: sharedState.mode,
        configDir: sharedState.configDir,
        reachability: 'unknown',
      };
    }
    clearReticulumSharedDaemonState(sharedState.pid);
  }
  return {
    running: false,
    pid: undefined,
    mode: lastStartMode,
    configDir: getReticulumConfigDir(),
    reachability: 'disconnected',
  };
}

export function stopBundledReticulumDaemon(): void {
  if (!child) return;
  if (child.exitCode !== null || child.killed) {
    clearReticulumSharedDaemonState(child.pid);
    child = null;
    lastStartMode = null;
    return;
  }
  const childPid = child.pid;
  try {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {
    loggerError('[Reticulum] Failed to signal child:', e);
  }
  clearReticulumSharedDaemonState(childPid);
  child = null;
  lastStartMode = null;
}

export function stopSharedReticulumDaemon(): void {
  if (child && child.exitCode === null && !child.killed) {
    stopBundledReticulumDaemon();
    return;
  }
  const state = readReticulumSharedDaemonState();
  if (!state) {
    return;
  }
  if (!isPidAlive(state.pid)) {
    clearReticulumSharedDaemonState(state.pid);
    return;
  }
  if (
    signalReticulumPid(
      state.pid,
      process.platform === 'win32' ? undefined : 'SIGTERM',
      'last-app-instance-exit'
    )
  ) {
    clearReticulumSharedDaemonState(state.pid);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForChildExit(
  subprocess: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<void> {
  if (subprocess.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      subprocess.off('exit', onExit);
      subprocess.off('error', onError);
    };
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };
    const onExit = () => finish();
    const onError = (err: Error) => finish(err);
    const timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for Reticulum daemon to exit after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
    subprocess.once('exit', onExit);
    subprocess.once('error', onError);
  });
}

function canConnectToSharedInstance(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: RETICULUM_LOOPBACK_HOST,
      port,
    });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function stopBundledReticulumDaemonAndWait(
  timeoutMs = RETICULUM_DAEMON_STOP_TIMEOUT_MS
): Promise<void> {
  const subprocess = child;
  stopBundledReticulumDaemon();
  if (!subprocess || subprocess.exitCode !== null) {
    return;
  }
  await waitForChildExit(subprocess, timeoutMs);
}

export async function waitForReticulumSharedInstanceReady(
  timeoutMs = RETICULUM_SHARED_INSTANCE_READY_TIMEOUT_MS
): Promise<void> {
  const port = getReticulumSharedInstancePort();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await canConnectToSharedInstance(port)) {
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(RETICULUM_SHARED_INSTANCE_READY_POLL_MS, remainingMs));
  }
  throw new Error(
    `Timed out waiting for Reticulum shared instance on ${RETICULUM_LOOPBACK_HOST}:${port}`
  );
}

export async function restartBundledReticulumDaemonAndWaitReady(
  timeoutMs = RETICULUM_SHARED_INSTANCE_READY_TIMEOUT_MS
): Promise<void> {
  await stopBundledReticulumDaemonAndWait();
  startBundledReticulumDaemon();
  if (reticulumInstanceIndex === 0 && (!child || child.exitCode !== null)) {
    throw new Error('Reticulum daemon did not start');
  }
  await waitForReticulumSharedInstanceReady(timeoutMs);
}

/**
 * Starts rnsd (frozen binary preferred). Disabled if QORTAL_RETICULUM_DISABLE=1.
 */
export function startBundledReticulumDaemon(): void {
  if (process.env.QORTAL_RETICULUM_DISABLE === '1') {
    loggerLog('[Reticulum] Skipped (QORTAL_RETICULUM_DISABLE=1).');
    return;
  }
  fs.mkdirSync(getReticulumConfigDir(), { recursive: true });
  ensureManagedReticulumConfig();

  if (reticulumInstanceIndex > 0) {
    loggerLog(
      `[Reticulum] Secondary instance detected (index=${reticulumInstanceIndex}); reusing shared daemon instead of spawning a second rnsd.`
    );
    return;
  }
  if (child && child.exitCode === null) {
    return;
  }
  child = null;

  const plan = resolveLaunchPlan();
  if ('error' in plan) {
    loggerLog(`[Reticulum] Not starting: ${plan.error}`);
    appendReticulumFileLog(`Not starting: ${plan.error}`);
    return;
  }
  const version = probeReticulumVersion(plan);
  if (version) {
    loggerLog(`[Reticulum] Using RNS ${version} (${plan.mode})`);
    appendReticulumFileLog(`Using RNS ${version} (${plan.mode})`);
  }

  try {
    const env = { ...process.env, ...(plan.envExtra ?? {}) };
    const subprocess = spawn(plan.cmd, plan.args, {
      cwd: plan.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child = subprocess;
    lastStartMode = plan.mode;
    if (typeof subprocess.pid === 'number') {
      persistReticulumSharedDaemonState(subprocess.pid);
    }

    subprocess.stdout.on('data', (d) => emitReticulumLog('stdout', d));
    subprocess.stderr.on('data', (d) => emitReticulumLog('stderr', d));
    subprocess.on('error', (err) => {
      loggerError('[Reticulum] Process error:', err);
      appendReticulumFileLog(`Process error: ${String(err)}`);
      clearReticulumSharedDaemonState(subprocess.pid);
      if (child === subprocess) child = null;
      lastStartMode = null;
    });
    subprocess.on('exit', (code, signal) => {
      const msg = `[Reticulum] exited code=${code} signal=${signal ?? ''}`;
      loggerLog(msg);
      appendReticulumFileLog(msg);
      clearReticulumSharedDaemonState(subprocess.pid);
      if (child === subprocess) child = null;
      lastStartMode = null;
    });

    loggerLog(
      `[Reticulum] Started rnsd (${plan.mode}) pid=${subprocess.pid} config=${getReticulumConfigDir()}`
    );
    appendReticulumFileLog(
      `Started rnsd (${plan.mode}) pid=${subprocess.pid} config=${getReticulumConfigDir()}`
    );
  } catch (e) {
    loggerError('[Reticulum] spawn failed:', e);
    appendReticulumFileLog(`spawn failed: ${String(e)}`);
    child = null;
    lastStartMode = null;
  }
}

export function registerReticulumIpcHandlers(): void {
  ipcMain.handle(
    'reticulum:getStatus',
    async (): Promise<ReticulumDaemonStatus> => {
      const base = getReticulumDaemonStatus();
      if (!base.running && !lastStartMode) {
        const plan = resolveLaunchPlan();
        if ('error' in plan) {
          return { ...base, running: false, reason: plan.error };
        }
      }
      try {
        const [{ getReticulumBridge }, { getPresenceManager }] =
          (await Promise.all([
            import('./reticulum-bridge'),
            import('./presence'),
          ])) as [
            typeof import('./reticulum-bridge'),
            typeof import('./presence'),
          ];
        const bridge = getReticulumBridge();
        const bridgeStatus = bridge?.getConnectivitySnapshot();
        if (!bridgeStatus) return base;
        const verifiedOverlayPeerCount =
          getPresenceManager()?.getReticulumVerifiedPeers().length ?? 0;
        let p2pOutboundPeers = 0;
        let p2pInboundPeers = 0;
        if (bridge) {
          for (const snap of bridge.getOverlayLinkSnapshots()) {
            if (snap.incoming) p2pInboundPeers += 1;
            else p2pOutboundPeers += 1;
          }
        }
        const transportFallback =
          getReticulumInstanceIndex() > 0 &&
          shouldFallbackToSharedTransportState({
            bridgeState: bridgeStatus.bridgeState,
            reachability: bridgeStatus.reachability,
            configuredHubInterfaces: bridgeStatus.configuredHubInterfaces,
            onlineHubInterfaces: bridgeStatus.onlineHubInterfaces,
            overlayLinksConnected: bridgeStatus.overlayLinksConnected,
            hubSummary: bridgeStatus.hubSummary,
            reason: bridgeStatus.reason,
          })
            ? readReticulumSharedTransportState()
            : null;
        const resolvedReachability =
          transportFallback?.reachability ?? bridgeStatus.reachability;
        return {
          ...base,
          bridgeState: bridgeStatus.bridgeState,
          reachability: resolvedReachability,
          transportEnabled:
            transportFallback?.transportEnabled ?? bridgeStatus.transportEnabled,
          configuredHubInterfaces:
            transportFallback?.configuredHubInterfaces ??
            bridgeStatus.configuredHubInterfaces,
          onlineHubInterfaces:
            transportFallback?.onlineHubInterfaces ??
            bridgeStatus.onlineHubInterfaces,
          configuredRemoteHubInterfaces:
            transportFallback?.configuredRemoteHubInterfaces ??
            bridgeStatus.configuredRemoteHubInterfaces,
          onlineRemoteHubInterfaces:
            transportFallback?.onlineRemoteHubInterfaces ??
            bridgeStatus.onlineRemoteHubInterfaces,
          hubSummary: transportFallback?.hubSummary ?? bridgeStatus.hubSummary,
          verifiedOverlayPeerCount,
          p2pOutboundPeers,
          p2pInboundPeers,
          ...(typeof bridgeStatus.overlayLinksConnected === 'number'
            ? { overlayLinksConnected: bridgeStatus.overlayLinksConnected }
            : {}),
          ...((transportFallback?.reason ?? bridgeStatus.reason)
            ? { reason: transportFallback?.reason ?? bridgeStatus.reason }
            : {}),
        };
      } catch (error) {
        loggerError('[Reticulum] Failed to collect bridge status:', error);
        return {
          ...base,
          reason: base.reason ?? 'Unable to read Reticulum bridge status',
        };
      }
    }
  );

  ipcMain.handle(
    'reticulum:getOverlayPeers',
    async (): Promise<ReticulumOverlayPeerStatus[]> => {
      try {
        const [{ getReticulumBridge }, { getPresenceManager }] =
          (await Promise.all([
            import('./reticulum-bridge'),
            import('./presence'),
          ])) as [
            typeof import('./reticulum-bridge'),
            typeof import('./presence'),
          ];
        const bridge = getReticulumBridge();
        if (!bridge) return [];
        const localHash = bridge.getLocalDestinationHash()?.trim().toLowerCase() ?? '';
        const peersByHash = new Map(
          (getPresenceManager()?.getReticulumVerifiedPeers() ?? []).map(
            (peer) => [peer.destinationHash.toLowerCase(), peer.address]
          )
        );
        const uniqueByHash = new Map<string, ReticulumOverlayPeerStatus>();
        for (const peer of bridge.getOverlayLinkSnapshots()) {
          if (peer.incoming === true) continue;
          const peerHash = peer.peerPresenceHash.trim();
          if (!peerHash) continue;
          const peerKey = peerHash.toLowerCase();
          if (localHash && peerKey === localHash) continue;
          const current = uniqueByHash.get(peerKey);
          if (current && current.connectedAt <= peer.connectedAt) continue;
          uniqueByHash.set(peerKey, {
            linkId: peer.linkId,
            peerPresenceHash: peer.peerPresenceHash,
            ...(peersByHash.get(peerKey)
              ? {
                  address: peersByHash.get(peerKey),
                }
              : {}),
            connectedAt: peer.connectedAt,
          });
        }
        return [...uniqueByHash.values()].sort(
          (a, b) => a.connectedAt - b.connectedAt
        );
      } catch (error) {
        loggerError(
          '[Reticulum] Failed to collect overlay peer status:',
          error
        );
        return [];
      }
    }
  );

  ipcMain.handle(
    'reticulum:getLocalDestinationHash',
    async (): Promise<{
      destinationHash: string | null;
    }> => {
      try {
        const { getReticulumBridge, startReticulumBridge } =
          (await import('./reticulum-bridge')) as typeof import('./reticulum-bridge');
        let bridge = getReticulumBridge();
        if (!bridge) {
          try {
            bridge = await startReticulumBridge();
          } catch (error) {
            loggerError(
              '[Reticulum] Failed to start bridge for local destination hash:',
              error
            );
            bridge = null;
          }
        }
        const h = bridge
          ? await bridge.waitForLocalDestinationHash(5_000)
          : undefined;
        return {
          destinationHash:
            typeof h === 'string' && h.length > 0
              ? h.trim().toLowerCase()
              : null,
        };
      } catch (error) {
        loggerError('[Reticulum] getLocalDestinationHash failed:', error);
        return { destinationHash: null };
      }
    }
  );

  ipcMain.handle(
    'reticulum:getLocalIdentityPublicKeyBase64',
    async (): Promise<{
      publicKeyBase64: string | null;
    }> => {
      try {
        const { getReticulumBridge, startReticulumBridge } =
          (await import('./reticulum-bridge')) as typeof import('./reticulum-bridge');
        let bridge = getReticulumBridge();
        if (!bridge) {
          try {
            bridge = await startReticulumBridge();
          } catch (error) {
            loggerError(
              '[Reticulum] Failed to start bridge for local identity public key:',
              error
            );
            bridge = null;
          }
        }
        const pk = bridge
          ? await bridge.getLocalIdentityPublicKeyBase64()
          : null;
        return {
          publicKeyBase64: typeof pk === 'string' && pk.length > 0 ? pk : null,
        };
      } catch (error) {
        loggerError(
          '[Reticulum] getLocalIdentityPublicKeyBase64 failed:',
          error
        );
        return { publicKeyBase64: null };
      }
    }
  );
}
