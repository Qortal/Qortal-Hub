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
import path from 'path';
import { log as loggerLog, error as loggerError } from './logger';
import type { ReticulumMeshConfigSlice } from './reticulum-mesh-store';
import {
  getBundledMeshNetworkIdentityPath,
  getMeshNetworkIdentityPath,
  loadReticulumMeshState,
  meshConfigSliceFromState,
} from './reticulum-mesh-store';

/**
 * Reticulum hub mesh: listen on the mesh port with optional private-gateway discovery.
 * Public/discoverable mesh listen uses TCPServerInterface for cross-platform autoconnect.
 * Linux also exposes a supplemental BackboneInterface listener on an adjacent port.
 * Bootstrap hubs stay as managed outbound clients; AutoInterface discover/autoconnect has no gossip-driven outbound.
 */

function meshDiscoveryListenRnsInterfaceType(): 'TCPServerInterface' {
  return 'TCPServerInterface';
}

function hasSupplementalBackboneMeshListen(): boolean {
  return process.platform === 'linux';
}

function getSupplementalBackboneMeshListenPort(listenPort: number): number {
  return listenPort + 1;
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
const RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES = 5;

export type ReticulumDaemonMode = 'frozen' | 'venv' | 'system' | null;
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
      networkName: 'qortal-hub',
    },
    {
      name: 'Crowetic Reticulum Hub',
      host: 'reticulum.qortal.link',
      port: 4444,
      interfaceType: 'BackboneInterface',
    },
  ]);

let child: ChildProcessWithoutNullStreams | null = null;
let lastStartMode: ReticulumDaemonMode = null;
let reticulumInstanceIndex = 0;

export function getReticulumConfigDir(): string {
  return path.join(app.getPath('userData'), 'reticulum');
}

export function setReticulumInstanceIndex(index: number): void {
  reticulumInstanceIndex = Math.max(0, Math.trunc(index));
}

export function getReticulumInstanceIndex(): number {
  return reticulumInstanceIndex;
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
  const sections: string[] = [];
  if (slice.listenEnabled) {
    const iface = meshDiscoveryListenRnsInterfaceType();
    const listenKeys = `  listen_ip = 0.0.0.0
  listen_port = ${slice.listenPort}`;
    if (slice.meshPrivateGateway) {
      if (
        typeof slice.reachableOn === 'string' &&
        slice.reachableOn.length > 0
      ) {
        sections.push(`  [[Qortal Hub Mesh Listen]]
  type = ${iface}
  enabled = yes
${listenKeys}
  reachable_on = ${slice.reachableOn}
  discovery_name = Qortal Hub Mesh Listen
  discoverable = yes
  announce_interval = ${RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES}
  mode = gateway
  discovery_encrypt = yes
`);
      }
    } else {
      sections.push(`  [[Qortal Hub Mesh Listen]]
  type = ${iface}
  enabled = yes
${listenKeys}
`);
    }
    if (hasSupplementalBackboneMeshListen()) {
      sections.push(`  [[Qortal Hub Mesh Backbone Listen]]
  type = BackboneInterface
  enabled = yes
  listen_on = 0.0.0.0
  port = ${getSupplementalBackboneMeshListenPort(slice.listenPort)}
`);
    }
  }
  for (const p of slice.outbound) {
    sections.push(`  [[${p.sectionName}]]
  type = TCPClientInterface
  enabled = yes
  target_host = ${p.host}
  target_port = ${p.port}
`);
  }
  return sections.join('\n\n');
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
    block += `discover_interfaces = yes
autoconnect_discovered_interfaces = ${meshSlice.autoconnectDiscoveredMax}
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
  if (hasSupplementalBackboneMeshListen()) {
    loggerLog(
      `[Reticulum] Supplemental backbone mesh listen path=${configPath} type=BackboneInterface port=${getSupplementalBackboneMeshListenPort(meshSlice.listenPort)} discoverable=no`
    );
  }
  if (meshSlice.meshPrivateGateway) {
    if (meshSlice.reachableOn) {
      loggerLog(
        `[Reticulum] Discovery gateway config path=${configPath} type=TCPServerInterface port=${meshSlice.listenPort} reachable_on=${meshSlice.reachableOn} encrypted=yes announce_interval=${RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES}m`
      );
    } else {
      loggerLog(
        `[Reticulum] Mesh listen config path=${configPath} type=TCPServerInterface port=${meshSlice.listenPort} discoverable=no reachable_on=unset`
      );
    }
    return;
  }
  loggerLog(
    `[Reticulum] Mesh listen config path=${configPath} type=TCPServerInterface port=${meshSlice.listenPort} discoverable=no`
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
loglevel = 5

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
  const state = loadReticulumMeshState();
  const meshSlice = meshConfigSliceFromState(state, []);
  if (!id.ok) {
    loggerLog(`[Reticulum] Mesh identity: ${id.error ?? 'failed'}`);
  } else if (id.created) {
    loggerLog(
      '[Reticulum] Community mesh network identity installed; regenerating managed config'
    );
  }
  const configPath = getReticulumConfigFilePath();
  const nextContents = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
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
  hubSummary?: string;
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

/**
 * Installs the bundled Qortal community `mesh-network.identity` into userData so
 * encrypted discovery and private gateway publishing can share one RNS network identity.
 * Idempotent. Call before rendering managed config.
 */
export function ensureMeshNetworkIdentityIfNeeded(): EnsureMeshNetworkIdentityResult {
  const dest = getMeshNetworkIdentityPath();
  if (fs.existsSync(dest)) {
    return { ok: true, created: false };
  }
  const source = getBundledMeshNetworkIdentityPath();
  if (!fs.existsSync(source)) {
    const msg = `Bundled community mesh identity missing: ${source}`;
    loggerLog(`[Reticulum] ${msg}`);
    return { ok: false, error: msg };
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  } catch (err) {
    const msg = `Failed to install mesh network identity: ${String(err)}`;
    loggerError(`[Reticulum] ${msg}`);
    return { ok: false, error: msg };
  }
  loggerLog(
    `[Reticulum] Installed community mesh network identity (bundle → userData) ${dest}`
  );
  return { ok: true, created: true };
}

export function getReticulumDaemonStatus(): ReticulumDaemonStatus {
  const running = child !== null && child.exitCode === null && !child.killed;
  return {
    running,
    pid: child?.pid,
    mode: lastStartMode,
    configDir: getReticulumConfigDir(),
    reachability: running ? 'unknown' : 'disconnected',
  };
}

export function stopBundledReticulumDaemon(): void {
  if (!child) return;
  if (child.exitCode !== null || child.killed) {
    child = null;
    lastStartMode = null;
    return;
  }
  try {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {
    loggerError('[Reticulum] Failed to signal child:', e);
  }
  child = null;
  lastStartMode = null;
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

    subprocess.stdout.on('data', (d) => emitReticulumLog('stdout', d));
    subprocess.stderr.on('data', (d) => emitReticulumLog('stderr', d));
    subprocess.on('error', (err) => {
      loggerError('[Reticulum] Process error:', err);
      appendReticulumFileLog(`Process error: ${String(err)}`);
      if (child === subprocess) child = null;
      lastStartMode = null;
    });
    subprocess.on('exit', (code, signal) => {
      const msg = `[Reticulum] exited code=${code} signal=${signal ?? ''}`;
      loggerLog(msg);
      appendReticulumFileLog(msg);
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
        const { getReticulumBridge } =
          (await import('./reticulum-bridge')) as typeof import('./reticulum-bridge');
        const bridge = getReticulumBridge();
        const bridgeStatus = bridge?.getConnectivitySnapshot();
        if (!bridgeStatus) return base;
        return {
          ...base,
          bridgeState: bridgeStatus.bridgeState,
          reachability: bridgeStatus.reachability,
          transportEnabled: bridgeStatus.transportEnabled,
          configuredHubInterfaces: bridgeStatus.configuredHubInterfaces,
          onlineHubInterfaces: bridgeStatus.onlineHubInterfaces,
          hubSummary: bridgeStatus.hubSummary,
          ...(bridgeStatus.reason ? { reason: bridgeStatus.reason } : {}),
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
}
