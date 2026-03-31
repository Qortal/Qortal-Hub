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
import { app, ipcMain } from 'electron';
import electronIsDev from 'electron-is-dev';
import fs from 'fs';
import path from 'path';
import { log as loggerLog, error as loggerError } from './logger';
import type { ReticulumMeshConfigSlice } from './reticulum-mesh-store';
import {
  loadReticulumMeshState,
  meshConfigSliceFromState,
  selectMeshOutboundHostsForConfig,
} from './reticulum-mesh-store';

/**
 * Reticulum hub mesh uses a dedicated TCP listen port (see reticulum-mesh-constants DEFAULT_RETICULUM_MESH_LISTEN_PORT)
 * plus optional TCPClientInterface rows for sparse hub-to-hub links. Config is managed here; rnsd restarts are debounced in reticulum-mesh.ts.
 */

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
};

export const DEFAULT_RETICULUM_HUBS: readonly ReticulumHubEndpoint[] =
  Object.freeze([
    {
      name: 'Crowetic Reticulum Hub',
      host: 'reticulum.qortal.link',
      port: 4242,
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
    .map(
      (hub) => `
  [[${hub.name}]]
  type = TCPClientInterface
  enabled = yes
  target_host = ${hub.host}
  target_port = ${hub.port}`
    )
    .join('');
}

function renderMeshInterfaces(slice: ReticulumMeshConfigSlice | null | undefined): string {
  if (!slice) return '';
  let out = '';
  if (slice.listenEnabled) {
    out += `
  [[Qortal Hub Mesh Listen]]
  type = TCPServerInterface
  enabled = yes
  listen_ip = 0.0.0.0
  listen_port = ${slice.listenPort}
`;
  }
  for (const p of slice.outbound) {
    out += `
  [[${p.sectionName}]]
  type = TCPClientInterface
  enabled = yes
  target_host = ${p.host}
  target_port = ${p.port}
`;
  }
  return out;
}

export function buildManagedReticulumConfig(
  hubs: readonly ReticulumHubEndpoint[] = DEFAULT_RETICULUM_HUBS,
  meshSlice?: ReticulumMeshConfigSlice | null
): string {
  return `${MANAGED_CONFIG_MARKER}
[reticulum]
enable_transport = False
share_instance = Yes
instance_name = ${getReticulumInstanceName()}
shared_instance_port = ${getReticulumSharedInstancePort()}
instance_control_port = ${getReticulumControlPort()}

[logging]
loglevel = 4

[interfaces]
  [[Default Interface]]
  type = AutoInterface
  enabled = yes
${renderManagedHubInterfaces(hubs)}${renderMeshInterfaces(meshSlice ?? null)}
`;
}

/** Full managed config including mesh slice derived from reticulum-mesh-state.json */
export function buildCurrentManagedReticulumConfig(): string {
  const state = loadReticulumMeshState();
  const slice = meshConfigSliceFromState(
    state,
    selectMeshOutboundHostsForConfig(state)
  );
  return buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, slice);
}

/**
 * Writes managed Reticulum config when the hub owns the file (same rules as startup).
 * @returns true if the file was updated
 */
export function writeManagedReticulumConfigIfManaged(nextContents: string): boolean {
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
  loggerLog(`[Reticulum] Wrote managed config ${configPath} (mesh-aware)`);
  return true;
}

function ensureManagedReticulumConfig(): void {
  const configPath = getReticulumConfigFilePath();
  const nextContents = buildCurrentManagedReticulumConfig();
  const currentContents = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : null;

  if (currentContents === nextContents) {
    loggerLog(
      `[Reticulum] Using managed config ${configPath} instance_name=${getReticulumInstanceName()} shared_port=${getReticulumSharedInstancePort()} control_port=${getReticulumControlPort()}`
    );
    return;
  }

  if (!writeManagedReticulumConfigIfManaged(nextContents)) {
    return;
  }
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
          require('./reticulum-bridge') as typeof import('./reticulum-bridge');
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
