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
 * Config and daemon state: appData/qortal-hub/reticulum (writable; shared by
 * local app instances so they use one RNS config and bridge identity).
 * @see https://reticulum.network/manual/using.html
 */

import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import crypto from 'crypto';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebContents,
} from 'electron';
import electronIsDev from 'electron-is-dev';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { log as loggerLog, error as loggerError } from './logger';
import type { ReticulumMeshConfigSlice } from './reticulum-mesh-store';
import type { ReticulumBridge } from './reticulum-bridge';
import {
  getBundledMeshNetworkIdentityPath,
  getBundledMeshNetworkPassphrasePath,
  getMeshNetworkIdentityPath,
  getMeshNetworkPassphrasePath,
  loadReticulumMeshState,
  meshConfigSliceFromState,
} from './reticulum-mesh-store';
import { runEd25519VerifySync } from './ed25519-verify-common';

/**
 * Reticulum hub mesh: listen on the mesh port with optional private-gateway discovery.
 * RNS BackboneInterface is Linux-only; Windows/macOS use TCPServerInterface for the same section.
 * Bootstrap hubs as TCPClient rows; AutoInterface discover/autoconnect (no gossip-driven outbound).
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
const APP_SETTINGS_FILENAME = 'app-settings.json';
const RETICULUM_SHARED_INSTANCE_NAME = 'qortal-hub-shared';
const RETICULUM_SHARED_STATE_DIRNAME = 'qortal-shared';
const RETICULUM_APP_INSTANCE_REGISTRY_FILENAME = 'reticulum-app-instances.json';
const RETICULUM_SHARED_DAEMON_STATE_FILENAME = 'reticulum-daemon-state.json';
const RETICULUM_SHARED_TRANSPORT_STATE_FILENAME =
  'reticulum-transport-state.json';
const RETICULUM_DAEMON_LOCK_DIRNAME = 'reticulum-daemon.lock';
const RETICULUM_SHARED_RPC_KEY_FILENAME = 'reticulum-rpc-key.hex';
const RETICULUM_PRESENCE_BRIDGE_IDENTITY_FILENAME = 'presence-bridge.identity';
const QCHAT_FILE_PENDING_SENDS_DIRNAME = 'qchat-file-transfers';
const QCHAT_FILE_PENDING_SENDS_FILENAME = 'pending-sends.json';
const RETICULUM_RPC_KEY_BYTES = 32;
const RETICULUM_QORTAL_HUB_NETWORK_NAME = 'qortal-hub';
const RETICULUM_DISCOVERY_ANNOUNCE_INTERVAL_MINUTES = 5;
const RETICULUM_AUTO_INTERFACE_IGNORED_DEVICES = [
  ...Array.from({ length: 32 }, (_, index) => `utun${index}`),
  ...Array.from({ length: 32 }, (_, index) => `tun${index}`),
  ...Array.from({ length: 32 }, (_, index) => `tap${index}`),
  ...Array.from({ length: 32 }, (_, index) => `wg${index}`),
  'tailscale0',
];
const RETICULUM_DAEMON_STOP_TIMEOUT_MS = 10_000;
const RETICULUM_DAEMON_FORCE_STOP_TIMEOUT_MS = 3_000;
const RETICULUM_SHARED_INSTANCE_READY_TIMEOUT_MS = 10_000;
const RETICULUM_SHARED_INSTANCE_READY_POLL_MS = 150;
const RETICULUM_DAEMON_LOCK_STALE_MS = 120_000;
const RETICULUM_DAEMON_LOCK_WAIT_MS = 2_000;
const RETICULUM_DAEMON_LOCK_POLL_MS = 50;
const RETICULUM_CONFIG_EDITOR_MAX_BYTES = 256 * 1024;
const RETICULUM_LOOPBACK_HOST = '127.0.0.1';
const QCHAT_FILE_OFFER_TTL_MS = 2 * 60 * 60 * 1000;
const QCHAT_FILE_COMPLETED_CACHE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const QCHAT_FILE_SIGNATURE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const QCHAT_FILE_SIGNATURE_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const QCHAT_FILE_BRIDGE_ATTACH_RETRY_MS = 3_000;

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
type ReticulumDaemonLockRecord = {
  appPid: number;
  instanceIndex: number;
  createdAt: number;
  context: string;
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
let qchatFileAttachedBridge: unknown = null;
let qchatFileAttachRetryTimer: ReturnType<typeof setTimeout> | null = null;

type QchatFilePendingSendRecord = {
  transferId: string;
  senderAddress: string;
  allowedRecipientAddress: string;
  filePath: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
};

const qchatFilePendingSends = new Map<string, QchatFilePendingSendRecord>();
let qchatFileHydratedBridge: unknown = null;
const qchatFileCompletedSends = new Map<string, number>();

function parseReticulumPriorityNice(): number | null {
  const raw = String(process.env.QORTAL_RETICULUM_PRIORITY_NICE ?? '').trim();
  if (raw.toLowerCase() === 'off' || raw === '0') return null;
  if (!raw) return null;
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return null;
  return Math.max(-20, Math.min(19, Math.trunc(requested)));
}

function tryRaiseReticulumProcessPriority(pid: number): void {
  const requested = parseReticulumPriorityNice();
  if (requested === null) {
    loggerLog('[ReticulumPriority] rnsd: disabled');
    return;
  }
  try {
    const before = os.getPriority(pid);
    os.setPriority(pid, requested);
    const after = os.getPriority(pid);
    const message = `[ReticulumPriority] rnsd: pid=${pid} before=${before} requested=${requested} after=${after}`;
    loggerLog(message);
    appendReticulumFileLog(message);
  } catch (err) {
    const message = `[ReticulumPriority] rnsd: pid=${pid} requested=${requested} failed=${String(
      err instanceof Error ? err.message : err
    )}`;
    loggerLog(message);
    appendReticulumFileLog(message);
  }
}

type ReticulumSharedDaemonState = {
  pid: number;
  ownerAppPid: number;
  ownerInstanceIndex: number;
  startedAt: number;
  configDir: string;
  mode: ReticulumDaemonMode;
};

function getCanonicalQortalHubDataDir(): string {
  return path.join(app.getPath('appData'), 'qortal-hub');
}

function isManagedReticulumConfigEnabled(): boolean {
  try {
    const filePath = path.join(
      getCanonicalQortalHubDataDir(),
      APP_SETTINGS_FILENAME
    );
    if (!fs.existsSync(filePath)) {
      return true;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      reticulumManagedConfigEnabled?: unknown;
    };
    return parsed.reticulumManagedConfigEnabled !== false;
  } catch {
    return true;
  }
}

export function getReticulumConfigDir(): string {
  return path.join(getCanonicalQortalHubDataDir(), 'reticulum');
}

export function getReticulumBridgeIdentityPath(): string {
  return path.join(
    app.getPath('userData'),
    'reticulum',
    RETICULUM_PRESENCE_BRIDGE_IDENTITY_FILENAME
  );
}

function getQchatFilePendingSendsPath(): string {
  const dir = path.join(
    app.getPath('userData'),
    QCHAT_FILE_PENDING_SENDS_DIRNAME
  );
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, QCHAT_FILE_PENDING_SENDS_FILENAME);
}

function normalizeQchatFilePendingSendRecord(
  value: unknown
): QchatFilePendingSendRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const transferId = String(record.transferId || '').trim();
  const senderAddress = String(record.senderAddress || '').trim();
  const allowedRecipientAddress = String(
    record.allowedRecipientAddress || ''
  ).trim();
  const filePath = String(record.filePath || '').trim();
  const fileName = String(record.fileName || '').trim();
  const size = Number(record.size || 0);
  const sha256 = String(record.sha256 || '')
    .trim()
    .toLowerCase();
  const createdAt = Number(record.createdAt || 0);
  const expiresAt = Number(record.expiresAt || 0);
  if (
    !transferId ||
    !senderAddress ||
    !allowedRecipientAddress ||
    !filePath ||
    !fileName ||
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isFinite(createdAt) ||
    createdAt <= 0 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0
  ) {
    return null;
  }
  return {
    transferId,
    senderAddress,
    allowedRecipientAddress,
    filePath,
    fileName,
    size,
    sha256,
    createdAt,
    expiresAt,
  };
}

function loadQchatFilePendingSendRecords(): QchatFilePendingSendRecord[] {
  const filePath = getQchatFilePendingSendsPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { records?: unknown[] })?.records)
        ? (parsed as { records: unknown[] }).records
        : [];
    return records
      .map(normalizeQchatFilePendingSendRecord)
      .filter(
        (record): record is QchatFilePendingSendRecord => record !== null
      );
  } catch (error) {
    loggerError('[Reticulum] failed to load qchat pending file sends:', error);
    return [];
  }
}

function saveQchatFilePendingSendRecords(
  records: QchatFilePendingSendRecord[]
): void {
  const filePath = getQchatFilePendingSendsPath();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(
    tempPath,
    JSON.stringify(
      {
        version: 1,
        records,
      },
      null,
      2
    )
  );
  fs.renameSync(tempPath, filePath);
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

function getReticulumDaemonLockDir(): string {
  return path.join(getReticulumSharedStateDir(), RETICULUM_DAEMON_LOCK_DIRNAME);
}

function getReticulumDaemonLockOwnerPath(): string {
  return path.join(getReticulumDaemonLockDir(), 'owner.json');
}

export function getReticulumSharedRpcKeyPath(): string {
  return path.join(
    getReticulumSharedStateDir(),
    RETICULUM_SHARED_RPC_KEY_FILENAME
  );
}

function normalizeReticulumRpcKeyHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

function getReticulumSharedRpcKeyHex(): string {
  const filePath = getReticulumSharedRpcKeyPath();
  try {
    const existing = normalizeReticulumRpcKeyHex(
      fs.readFileSync(filePath, 'utf8')
    );
    if (existing) return existing;
  } catch {
    /* create below */
  }

  const generated = crypto.randomBytes(RETICULUM_RPC_KEY_BYTES).toString('hex');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    fs.writeFileSync(filePath, `${generated}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return generated;
  } catch (err) {
    const code =
      typeof err === 'object' && err && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    if (code === 'EEXIST') {
      try {
        const raced = normalizeReticulumRpcKeyHex(
          fs.readFileSync(filePath, 'utf8')
        );
        if (raced) return raced;
      } catch {
        /* overwrite malformed file below */
      }
    }
  }

  try {
    fs.writeFileSync(filePath, `${generated}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (err) {
    loggerError(
      `[Reticulum] Failed to persist shared RPC key ${filePath}:`,
      err
    );
  }
  return generated;
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

function sleepSync(ms: number): void {
  const waitMs = Math.max(0, Math.trunc(ms));
  if (waitMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
}

function readProcText(pid: number, fileName: 'cmdline' | 'environ'): string {
  try {
    return fs
      .readFileSync(path.join('/proc', String(pid), fileName))
      .toString('utf8')
      .replace(/\0/g, '\n');
  } catch {
    return '';
  }
}

function readProcParentPid(pid: number): number | null {
  try {
    const status = fs.readFileSync(
      path.join('/proc', String(pid), 'status'),
      'utf8'
    );
    const match = status.match(/^PPid:\s+(\d+)$/m);
    if (!match) return null;
    const parentPid = Number(match[1]);
    return Number.isInteger(parentPid) ? parentPid : null;
  } catch {
    return null;
  }
}

type ReticulumBridgeProcessInfo = {
  pid: number;
  parentPid: number | null;
  command: string;
};

function commandUsesReticulumConfig(
  command: string,
  configDir: string
): boolean {
  const commandForCompare =
    process.platform === 'win32' ? command.toLowerCase() : command;
  const configDirForCompare =
    process.platform === 'win32' ? configDir.toLowerCase() : configDir;
  return (
    commandForCompare.includes('--config') &&
    commandForCompare.includes(configDirForCompare)
  );
}

function normalizeWindowsBridgeProcessInfo(
  raw: unknown
): ReticulumBridgeProcessInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as {
    ProcessId?: unknown;
    ParentProcessId?: unknown;
    CommandLine?: unknown;
  };
  const pid = Number(record.ProcessId);
  const parentPid = Number(record.ParentProcessId);
  const command =
    typeof record.CommandLine === 'string' ? record.CommandLine : '';
  if (!Number.isInteger(pid) || pid <= 0 || !command) return null;
  return {
    pid,
    parentPid: Number.isInteger(parentPid) ? parentPid : null,
    command,
  };
}

function readWindowsBridgeProcesses(): ReticulumBridgeProcessInfo[] {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('presence_bridge') } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  if (result.error || result.status !== 0) return [];

  const stdout = result.stdout.trim();
  if (!stdout) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records
    .map(normalizeWindowsBridgeProcessInfo)
    .filter((record): record is ReticulumBridgeProcessInfo => record !== null);
}

function cleanupOrphanedReticulumBridgeProcessesForConfig(): number {
  const configDir = getReticulumConfigDir();
  if (process.platform !== 'linux') {
    if (process.platform === 'win32') {
      let stopped = 0;
      for (const processInfo of readWindowsBridgeProcesses()) {
        const { pid, parentPid, command } = processInfo;
        if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
        if (!commandUsesReticulumConfig(command, configDir)) continue;
        if (parentPid && parentPid > 0 && isPidAlive(parentPid)) continue;
        if (
          signalReticulumPid(pid, undefined, 'startup-recovery-orphan-bridge')
        ) {
          stopped += 1;
        }
      }
      if (stopped > 0) {
        loggerLog(
          `[Reticulum] Stopped ${stopped} orphaned presence bridge process(es) for shared config ${configDir}`
        );
      }
      return stopped;
    }

    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) return 0;

    let stopped = 0;
    const lines = result.stdout.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const parentPid = Number(match[2]);
      const command = match[3] ?? '';
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
      if (parentPid !== 1) continue;
      if (!command.includes('presence_bridge')) continue;
      if (!commandUsesReticulumConfig(command, configDir)) continue;
      if (
        signalReticulumPid(pid, 'SIGTERM', 'startup-recovery-orphan-bridge')
      ) {
        stopped += 1;
      }
    }
    if (stopped > 0) {
      loggerLog(
        `[Reticulum] Stopped ${stopped} orphaned presence bridge process(es) for shared config ${configDir}`
      );
    }
    return stopped;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return 0;
  }

  let stopped = 0;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;

    const cmdline = readProcText(pid, 'cmdline');
    if (!cmdline.includes('presence_bridge.py')) continue;
    const environ = readProcText(pid, 'environ');
    const usesSharedConfig =
      environ.includes(`QORTAL_RETICULUM_CONFIG_DIR=${configDir}`) ||
      cmdline.includes(`--config\n${configDir}`) ||
      cmdline.includes(`--config ${configDir}`);
    if (!usesSharedConfig) continue;

    const parentPid = readProcParentPid(pid);
    if (parentPid && parentPid > 1 && isPidAlive(parentPid)) continue;

    if (signalReticulumPid(pid, 'SIGTERM', 'startup-recovery-orphan-bridge')) {
      stopped += 1;
    }
  }
  if (stopped > 0) {
    loggerLog(
      `[Reticulum] Stopped ${stopped} orphaned presence bridge process(es) for shared config ${configDir}`
    );
  }
  return stopped;
}

function normalizeReticulumDaemonLockRecord(
  raw: unknown
): ReticulumDaemonLockRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const appPid = candidate.appPid;
  const instanceIndex = candidate.instanceIndex;
  const createdAt = candidate.createdAt;
  const context = candidate.context;
  if (
    !Number.isInteger(appPid) ||
    !Number.isInteger(instanceIndex) ||
    typeof createdAt !== 'number' ||
    !Number.isFinite(createdAt) ||
    typeof context !== 'string'
  ) {
    return null;
  }
  return {
    appPid: Number(appPid),
    instanceIndex: Number(instanceIndex),
    createdAt: Number(createdAt),
    context,
  };
}

function readReticulumDaemonLockRecord(): ReticulumDaemonLockRecord | null {
  return normalizeReticulumDaemonLockRecord(
    readJsonFile<unknown>(getReticulumDaemonLockOwnerPath())
  );
}

function removeReticulumDaemonLockDir(): void {
  const ownerPath = getReticulumDaemonLockOwnerPath();
  const lockDir = getReticulumDaemonLockDir();
  try {
    fs.unlinkSync(ownerPath);
  } catch {
    /* ignore */
  }
  try {
    fs.rmdirSync(lockDir);
  } catch {
    /* ignore */
  }
}

function releaseReticulumDaemonLockDir(context: string): boolean {
  const lock = readReticulumDaemonLockRecord();
  if (
    !lock ||
    lock.appPid !== process.pid ||
    lock.instanceIndex !== reticulumInstanceIndex ||
    lock.context !== context
  ) {
    loggerLog(
      `[Reticulum] Skipped daemon lock release for non-owned lock context=${context} owner_pid=${lock?.appPid ?? 'unknown'} owner_context=${lock?.context ?? 'unknown'}`
    );
    return false;
  }
  removeReticulumDaemonLockDir();
  return true;
}

function getReticulumDaemonLockDirAgeMs(now = Date.now()): number | null {
  try {
    return now - fs.statSync(getReticulumDaemonLockDir()).mtimeMs;
  } catch {
    return null;
  }
}

function reticulumDaemonLockIsStale(now = Date.now()): boolean {
  const lock = readReticulumDaemonLockRecord();
  if (!lock) {
    const ageMs = getReticulumDaemonLockDirAgeMs(now);
    return ageMs === null || ageMs > RETICULUM_DAEMON_LOCK_STALE_MS;
  }
  if (now - lock.createdAt > RETICULUM_DAEMON_LOCK_STALE_MS) {
    return true;
  }
  return !isPidAlive(lock.appPid);
}

function acquireReticulumDaemonLock(context: string): (() => void) | null {
  const deadline = Date.now() + RETICULUM_DAEMON_LOCK_WAIT_MS;
  const lockDir = getReticulumDaemonLockDir();
  const ownerPath = getReticulumDaemonLockOwnerPath();

  while (Date.now() <= deadline) {
    let createdLockDir = false;
    try {
      fs.mkdirSync(lockDir);
      createdLockDir = true;
      writeJsonFile(ownerPath, {
        appPid: process.pid,
        instanceIndex: reticulumInstanceIndex,
        createdAt: Date.now(),
        context,
      } satisfies ReticulumDaemonLockRecord);
      loggerLog(`[Reticulum] Acquired daemon lock context=${context}`);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (releaseReticulumDaemonLockDir(context)) {
          loggerLog(`[Reticulum] Released daemon lock context=${context}`);
        }
      };
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      if (code !== 'EEXIST') {
        if (createdLockDir) {
          removeReticulumDaemonLockDir();
        }
        loggerError(
          `[Reticulum] Failed to acquire daemon lock context=${context}:`,
          error
        );
        return null;
      }
      if (reticulumDaemonLockIsStale()) {
        const stale = readReticulumDaemonLockRecord();
        loggerLog(
          `[Reticulum] Removing stale daemon lock context=${context} owner_pid=${stale?.appPid ?? 'unknown'} owner_context=${stale?.context ?? 'unknown'}`
        );
        removeReticulumDaemonLockDir();
        continue;
      }
      sleepSync(RETICULUM_DAEMON_LOCK_POLL_MS);
    }
  }

  const owner = readReticulumDaemonLockRecord();
  loggerLog(
    `[Reticulum] Timed out waiting for daemon lock context=${context} owner_pid=${owner?.appPid ?? 'unknown'} owner_context=${owner?.context ?? 'unknown'}`
  );
  return null;
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
  const entries = pruneReticulumAppInstances(
    readReticulumAppInstanceRegistry()
  );
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
  const entries = pruneReticulumAppInstances(
    readReticulumAppInstanceRegistry()
  );
  const next = entries.filter((entry) => entry.appPid !== appPid);
  writeReticulumAppInstanceRegistry(next);
  return next;
}

export function planReticulumAppQuit(
  appPid = process.pid
): ReticulumAppQuitPlan {
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

export function readReticulumSharedTransportState(): ReticulumSharedTransportState | null {
  return normalizeReticulumSharedTransportState(
    readJsonFile<unknown>(getReticulumSharedTransportStatePath())
  );
}

export function persistReticulumSharedTransportState(
  state: Omit<
    ReticulumSharedTransportState,
    'updatedAt' | 'sourceInstanceIndex'
  >
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
    loggerError(
      `[Reticulum] Failed to signal rnsd pid=${pid} context=${context}:`,
      err
    );
    return false;
  }
}

export function recoverReticulumStateForAppLaunch(
  instanceIndex = reticulumInstanceIndex
): ReticulumAppLaunchRecovery {
  const releaseLock = acquireReticulumDaemonLock('startup-recovery');
  if (!releaseLock) {
    loggerLog(
      '[Reticulum] Skipping startup recovery because daemon lock is held.'
    );
    return {
      activeInstances: getReticulumActiveAppInstances().length,
      orphanedDaemonFound: false,
      orphanedDaemonStopped: false,
      daemonStateCleared: false,
    };
  }
  try {
    return recoverReticulumStateForAppLaunchLocked(instanceIndex);
  } finally {
    releaseLock?.();
  }
}

function recoverReticulumStateForAppLaunchLocked(
  instanceIndex = reticulumInstanceIndex
): ReticulumAppLaunchRecovery {
  cleanupOrphanedReticulumBridgeProcessesForConfig();
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

function getReticulumInstanceLabel(): string {
  return reticulumInstanceIndex === 0
    ? 'Instance 1 (primary)'
    : `Instance ${reticulumInstanceIndex + 1}`;
}

function readReticulumConfigEditorInfo(): ReticulumConfigEditorInfo {
  const configPath = getReticulumConfigFilePath();
  let contents = '';
  let updatedAt: number | undefined;
  try {
    const stat = fs.statSync(configPath);
    if (!stat.isFile()) {
      throw new Error('Reticulum config path is not a file');
    }
    if (stat.size > RETICULUM_CONFIG_EDITOR_MAX_BYTES) {
      throw new Error(
        `Reticulum config is too large to edit in-app (${stat.size} bytes)`
      );
    }
    contents = fs.readFileSync(configPath, 'utf8');
    updatedAt = stat.mtimeMs;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      String((error as { code?: unknown }).code ?? '') === 'ENOENT'
    ) {
      contents = '';
    } else {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        contents: '',
        configPath,
        configDir: getReticulumConfigDir(),
        instanceIndex: reticulumInstanceIndex,
        instanceLabel: getReticulumInstanceLabel(),
        managedConfigEnabled: isManagedReticulumConfigEnabled(),
        sharedDaemon: true,
        maxBytes: RETICULUM_CONFIG_EDITOR_MAX_BYTES,
      };
    }
  }
  return {
    ok: true,
    contents,
    configPath,
    configDir: getReticulumConfigDir(),
    instanceIndex: reticulumInstanceIndex,
    instanceLabel: getReticulumInstanceLabel(),
    managedConfigEnabled: isManagedReticulumConfigEnabled(),
    sharedDaemon: true,
    maxBytes: RETICULUM_CONFIG_EDITOR_MAX_BYTES,
    updatedAt,
  };
}

function writeReticulumConfigFromEditor(
  contents: string
): ReticulumConfigEditorInfo {
  if (isManagedReticulumConfigEnabled()) {
    return {
      ...readReticulumConfigEditorInfo(),
      ok: false,
      error: 'Disable managed Reticulum config before editing this file.',
    };
  }
  if (typeof contents !== 'string') {
    return {
      ...readReticulumConfigEditorInfo(),
      ok: false,
      error: 'Invalid Reticulum config contents.',
    };
  }
  const byteLength = Buffer.byteLength(contents, 'utf8');
  if (byteLength > RETICULUM_CONFIG_EDITOR_MAX_BYTES) {
    return {
      ...readReticulumConfigEditorInfo(),
      ok: false,
      error: `Reticulum config is too large (${byteLength} bytes).`,
    };
  }
  const configPath = getReticulumConfigFilePath();
  const tempPath = `${configPath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(tempPath, contents, 'utf8');
    fs.renameSync(tempPath, configPath);
    loggerLog(`[Reticulum] User saved Reticulum config ${configPath}`);
    return readReticulumConfigEditorInfo();
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    return {
      ...readReticulumConfigEditorInfo(),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function revealReticulumConfigInFileExplorer(): Promise<{
  ok: boolean;
  error?: string;
  configPath: string;
  configDir: string;
}> {
  const configPath = getReticulumConfigFilePath();
  const configDir = getReticulumConfigDir();
  try {
    fs.mkdirSync(configDir, { recursive: true });
    if (fs.existsSync(configPath)) {
      shell.showItemInFolder(configPath);
      return { ok: true, configPath, configDir };
    }
    const openError = await shell.openPath(configDir);
    return {
      ok: openError.length === 0,
      error: openError || undefined,
      configPath,
      configDir,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      configPath,
      configDir,
    };
  }
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
  const ignoredDevices = RETICULUM_AUTO_INTERFACE_IGNORED_DEVICES.join(',');
  return `  [[Default Interface]]
  type = AutoInterface
  enabled = yes
  ignored_devices = ${ignoredDevices}
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
  const rpcKeyHex = getReticulumSharedRpcKeyHex();
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
rpc_key = ${rpcKeyHex}
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
  if (!isManagedReticulumConfigEnabled()) {
    loggerLog(
      '[Reticulum] Managed config writes disabled by app settings; preserving existing config.'
    );
    return false;
  }

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
  if (!isManagedReticulumConfigEnabled()) {
    loggerLog(
      '[Reticulum] Managed config writes disabled by app settings; skipping startup config generation.'
    );
    return;
  }

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

const RETICULUM_LOG_FILENAME = 'reticulum.log';
const RETICULUM_LOG_MAX_BYTES = 10 * 1024 * 1024;

const reticulumLogPendingLines: string[] = [];
let reticulumLogFlushScheduled = false;
let reticulumLogFilePath: string | null = null;
let reticulumLogUserDataPath: string | null = null;
/** UTF-8 byte length of current reticulum.log on disk; best-effort. */
let reticulumLogCurrentFileBytes = 0;
let reticulumLogIoChain: Promise<void> = Promise.resolve();

function resolveReticulumLogFilePath(): string | null {
  try {
    const userDataPath = app.getPath('userData');
    if (
      reticulumLogFilePath !== null &&
      reticulumLogUserDataPath === userDataPath
    ) {
      return reticulumLogFilePath;
    }
    const dir = path.join(userDataPath, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    reticulumLogFilePath = path.join(dir, RETICULUM_LOG_FILENAME);
    reticulumLogUserDataPath = userDataPath;
    if (fs.existsSync(reticulumLogFilePath)) {
      reticulumLogCurrentFileBytes = fs.statSync(reticulumLogFilePath).size;
    } else {
      reticulumLogCurrentFileBytes = 0;
    }
    return reticulumLogFilePath;
  } catch {
    reticulumLogFilePath = null;
    reticulumLogUserDataPath = null;
    return null;
  }
}

function rotateReticulumLogFileSync(): void {
  if (!reticulumLogFilePath) return;
  const rotated = `${reticulumLogFilePath}.1`;
  try {
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(reticulumLogFilePath)) {
      fs.renameSync(reticulumLogFilePath, rotated);
    }
  } catch {
    /* ignore */
  }
  reticulumLogCurrentFileBytes = 0;
}

function scheduleReticulumLogFlush(): void {
  if (reticulumLogFlushScheduled) return;
  reticulumLogFlushScheduled = true;
  setImmediate(() => {
    reticulumLogFlushScheduled = false;
    const chunk = reticulumLogPendingLines
      .splice(0, reticulumLogPendingLines.length)
      .join('');
    if (!chunk || !reticulumLogFilePath) return;
    reticulumLogIoChain = reticulumLogIoChain
      .then(async () => {
        const byteLen = Buffer.byteLength(chunk, 'utf8');
        try {
          if (
            reticulumLogCurrentFileBytes + byteLen >
            RETICULUM_LOG_MAX_BYTES
          ) {
            rotateReticulumLogFileSync();
          }
          await fs.promises.appendFile(reticulumLogFilePath!, chunk, 'utf8');
          reticulumLogCurrentFileBytes += byteLen;
        } catch {
          /* disk full / permissions — avoid throwing into unhandledRejection */
        }
      })
      .catch(() => {});
  });
}

function queueReticulumFileLine(line: string): void {
  if (!resolveReticulumLogFilePath()) return;
  reticulumLogPendingLines.push(`[${new Date().toISOString()}] ${line}\n`);
  scheduleReticulumLogFlush();
}

function appendReticulumFileLog(line: string): void {
  try {
    queueReticulumFileLine(line);
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
  const frozenDir = getReticulumFrozenDir();
  const archSpecific =
    process.platform === 'darwin'
      ? path.join(frozenDir, `darwin-${process.arch}`, rnsdExeName())
      : null;
  if (archSpecific && fs.existsSync(archSpecific)) return archSpecific;
  const p = path.join(frozenDir, rnsdExeName());
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
  /** Distinct peers with an established overlay link (deduped). */
  p2pActiveOverlayPeers?: number;
  /** Identity-verified Reticulum overlay peers (signed presence). */
  verifiedOverlayPeerCount?: number;
};

export type ReticulumOverlayPeerStatus = {
  linkId: string;
  peerPresenceHash: string;
  /** True if the remote peer initiated this overlay link. */
  incoming?: boolean;
  address?: string;
  connectedAt: number;
};

export type ReticulumConfigEditorInfo = {
  ok: boolean;
  error?: string;
  contents: string;
  configPath: string;
  configDir: string;
  instanceIndex: number;
  instanceLabel: string;
  managedConfigEnabled: boolean;
  sharedDaemon: boolean;
  maxBytes: number;
  updatedAt?: number;
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
    const env = {
      ...process.env,
      ...(plan.envExtra ?? {}),
      QORTAL_RNS_LINK_TRACE: app.isPackaged
        ? (process.env.QORTAL_RNS_LINK_TRACE ?? '0')
        : '1',
    };
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

const RETICULUM_STATUS_CHANNEL = 'reticulum:status';
const RETICULUM_STATUS_BROADCAST_DEBOUNCE_MS = 75;

const reticulumStatusSubscribers = new Set<WebContents>();
let reticulumStatusBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
let reticulumStatusAttachedBridge: ReticulumBridge | null = null;

export async function collectReticulumStatusSnapshot(): Promise<ReticulumDaemonStatus> {
  const base = getReticulumDaemonStatus();
  if (!base.running && !lastStartMode) {
    const plan = resolveLaunchPlan();
    if ('error' in plan) {
      return { ...base, running: false, reason: plan.error };
    }
  }
  try {
    const [{ getReticulumBridge }, { getPresenceManager }] = (await Promise.all(
      [import('./reticulum-bridge'), import('./presence')]
    )) as [typeof import('./reticulum-bridge'), typeof import('./presence')];
    const bridge = getReticulumBridge();
    attachReticulumStatusBridgeEvents(bridge);
    const bridgeStatus = bridge?.getConnectivitySnapshot();
    if (!bridgeStatus) return base;
    const verifiedOverlayPeerCount =
      getPresenceManager()?.getReticulumVerifiedPeers().length ?? 0;
    const localHash =
      bridge.getLocalDestinationHash()?.trim().toLowerCase() ?? '';
    const activePeerHashes = new Set<string>();
    for (const peer of bridge.getOverlayLinkSnapshots()) {
      const peerKey = peer.peerPresenceHash.trim().toLowerCase();
      if (!peerKey) continue;
      if (localHash && peerKey === localHash) continue;
      activePeerHashes.add(peerKey);
    }
    const p2pActiveOverlayPeers = activePeerHashes.size;
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
      p2pActiveOverlayPeers,
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

async function broadcastReticulumStatusSnapshot(): Promise<void> {
  if (reticulumStatusSubscribers.size === 0) return;
  const status = await collectReticulumStatusSnapshot();
  for (const wc of reticulumStatusSubscribers) {
    if (wc.isDestroyed()) {
      reticulumStatusSubscribers.delete(wc);
      continue;
    }
    wc.send(RETICULUM_STATUS_CHANNEL, status);
  }
}

function scheduleReticulumStatusBroadcast(): void {
  if (reticulumStatusSubscribers.size === 0) return;
  if (reticulumStatusBroadcastTimer) return;
  reticulumStatusBroadcastTimer = setTimeout(() => {
    reticulumStatusBroadcastTimer = null;
    void broadcastReticulumStatusSnapshot().catch((error) => {
      loggerError('[Reticulum] Failed to broadcast status snapshot:', error);
    });
  }, RETICULUM_STATUS_BROADCAST_DEBOUNCE_MS);
  reticulumStatusBroadcastTimer.unref?.();
}

export function attachReticulumStatusBridgeEvents(
  bridge: ReticulumBridge | null | undefined
): void {
  const nextBridge = bridge ?? null;
  if (reticulumStatusAttachedBridge === nextBridge) return;
  if (reticulumStatusAttachedBridge) {
    reticulumStatusAttachedBridge.off(
      'overlay-link-state',
      scheduleReticulumStatusBroadcast
    );
    reticulumStatusAttachedBridge.off(
      'overlay-link-closed',
      scheduleReticulumStatusBroadcast
    );
    reticulumStatusAttachedBridge.off(
      'transport-state',
      scheduleReticulumStatusBroadcast
    );
    reticulumStatusAttachedBridge.off(
      'ready',
      scheduleReticulumStatusBroadcast
    );
    reticulumStatusAttachedBridge.off(
      'degraded',
      scheduleReticulumStatusBroadcast
    );
  }
  reticulumStatusAttachedBridge = nextBridge;
  if (!nextBridge) return;
  nextBridge.on('overlay-link-state', scheduleReticulumStatusBroadcast);
  nextBridge.on('overlay-link-closed', scheduleReticulumStatusBroadcast);
  nextBridge.on('transport-state', scheduleReticulumStatusBroadcast);
  nextBridge.on('ready', scheduleReticulumStatusBroadcast);
  nextBridge.on('degraded', scheduleReticulumStatusBroadcast);
}

export function resolveReticulumDaemonStartupAction():
  | 'reuse-local'
  | 'reuse-shared'
  | 'spawn' {
  if (child && child.exitCode === null) {
    return 'reuse-local';
  }

  const sharedState = readReticulumSharedDaemonState();
  if (sharedState) {
    if (isPidAlive(sharedState.pid)) {
      return 'reuse-shared';
    }
    clearReticulumSharedDaemonState(sharedState.pid);
  }

  return 'spawn';
}

export function stopBundledReticulumDaemon(): void {
  const releaseLock = acquireReticulumDaemonLock('stop-local');
  if (!releaseLock) {
    loggerLog(
      '[Reticulum] Skipping local rnsd stop because daemon lock is held.'
    );
    return;
  }
  try {
    stopBundledReticulumDaemonLocked();
  } finally {
    releaseLock?.();
  }
}

function stopBundledReticulumDaemonLocked(): void {
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
  const releaseLock = acquireReticulumDaemonLock('stop-shared');
  if (!releaseLock) {
    loggerLog(
      '[Reticulum] Skipping shared rnsd stop because daemon lock is held.'
    );
    return;
  }
  try {
    if (child && child.exitCode === null && !child.killed) {
      stopBundledReticulumDaemonLocked();
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
  } finally {
    releaseLock?.();
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

async function waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isPidAlive(pid)) {
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(RETICULUM_DAEMON_LOCK_POLL_MS, remainingMs));
  }
  throw new Error(
    `Timed out waiting for Reticulum daemon pid=${pid} to exit after ${timeoutMs}ms`
  );
}

async function forceStopReticulumPidAndWait(
  pid: number | undefined,
  context: string
): Promise<void> {
  if (!Number.isInteger(pid) || Number(pid) <= 0) {
    return;
  }
  const targetPid = Number(pid);
  if (!isPidAlive(targetPid)) {
    clearReticulumSharedDaemonState(targetPid);
    return;
  }
  signalReticulumPid(
    targetPid,
    process.platform === 'win32' ? undefined : 'SIGKILL',
    context
  );
  await waitForPidExit(targetPid, RETICULUM_DAEMON_FORCE_STOP_TIMEOUT_MS);
  clearReticulumSharedDaemonState(targetPid);
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
  const releaseLock = acquireReticulumDaemonLock('stop-local-wait');
  if (!releaseLock) {
    loggerLog(
      '[Reticulum] Skipping local rnsd stop-and-wait because daemon lock is held.'
    );
    return;
  }
  try {
    const subprocess = child;
    stopBundledReticulumDaemonLocked();
    if (!subprocess || subprocess.exitCode !== null) {
      return;
    }
    await waitForChildExit(subprocess, timeoutMs);
  } finally {
    releaseLock();
  }
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
  timeoutMs = RETICULUM_SHARED_INSTANCE_READY_TIMEOUT_MS,
  options?: { forceKillOnStopTimeout?: boolean }
): Promise<void> {
  const releaseLock = acquireReticulumDaemonLock('restart');
  if (!releaseLock) {
    throw new Error('Timed out waiting for Reticulum daemon restart lock');
  }
  try {
    const subprocess = child;
    const sharedState = readReticulumSharedDaemonState();
    stopBundledReticulumDaemonLocked();
    if (subprocess && subprocess.exitCode === null) {
      try {
        await waitForChildExit(subprocess, RETICULUM_DAEMON_STOP_TIMEOUT_MS);
      } catch (error) {
        if (!options?.forceKillOnStopTimeout) {
          throw error;
        }
        loggerError(
          '[Reticulum] Daemon did not exit after SIGTERM; forcing stop before restart:',
          error
        );
        await forceStopReticulumPidAndWait(
          subprocess.pid,
          'restart-force-stop-local'
        );
      }
    } else if (sharedState && isPidAlive(sharedState.pid)) {
      signalReticulumPid(
        sharedState.pid,
        process.platform === 'win32' ? undefined : 'SIGTERM',
        'restart-shared-state'
      );
      try {
        await waitForPidExit(sharedState.pid, RETICULUM_DAEMON_STOP_TIMEOUT_MS);
        clearReticulumSharedDaemonState(sharedState.pid);
      } catch (error) {
        if (!options?.forceKillOnStopTimeout) {
          throw error;
        }
        loggerError(
          '[Reticulum] Shared daemon state pid did not exit after SIGTERM; forcing stop before restart:',
          error
        );
        await forceStopReticulumPidAndWait(
          sharedState.pid,
          'restart-force-stop-shared-state'
        );
      }
    }
    fs.mkdirSync(getReticulumConfigDir(), { recursive: true });
    ensureManagedReticulumConfig();
    startBundledReticulumDaemonLocked();
    if (reticulumInstanceIndex === 0 && (!child || child.exitCode !== null)) {
      throw new Error('Reticulum daemon did not start');
    }
    await waitForReticulumSharedInstanceReady(timeoutMs);
  } finally {
    releaseLock?.();
  }
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

  const releaseLock = acquireReticulumDaemonLock('start');
  if (!releaseLock) {
    const fallbackAction = resolveReticulumDaemonStartupAction();
    if (fallbackAction !== 'spawn') {
      loggerLog(
        `[Reticulum] Rechecked startup action after lock timeout: ${fallbackAction}`
      );
      return;
    }
    loggerLog(
      '[Reticulum] Skipping rnsd spawn because another app instance holds the daemon lock.'
    );
    return;
  }

  try {
    startBundledReticulumDaemonLocked();
  } finally {
    releaseLock();
  }
}

function startBundledReticulumDaemonLocked(): void {
  const startupAction = resolveReticulumDaemonStartupAction();
  if (startupAction === 'reuse-local') {
    return;
  }
  if (startupAction === 'reuse-shared') {
    const sharedState = readReticulumSharedDaemonState();
    if (reticulumInstanceIndex > 0 && sharedState) {
      loggerLog(
        `[Reticulum] Secondary instance detected (index=${reticulumInstanceIndex}); reusing shared daemon pid=${sharedState.pid} instead of spawning a second rnsd.`
      );
    }
    return;
  }

  if (reticulumInstanceIndex > 0) {
    loggerLog(
      `[Reticulum] Secondary instance detected (index=${reticulumInstanceIndex}); no shared daemon is running, so this instance will start rnsd.`
    );
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
    const env = {
      ...process.env,
      ...(plan.envExtra ?? {}),
      QORTAL_RNS_LINK_TRACE: app.isPackaged
        ? (process.env.QORTAL_RNS_LINK_TRACE ?? '0')
        : '1',
    };
    loggerLog(
      `[Reticulum] Launch env QORTAL_RNS_LINK_TRACE=${env.QORTAL_RNS_LINK_TRACE}`
    );
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
      tryRaiseReticulumProcessPriority(subprocess.pid);
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
  const pruneAndPersistQchatFilePendingSends = (): void => {
    const now = Date.now();
    for (const [transferId, record] of qchatFilePendingSends.entries()) {
      if (record.expiresAt <= now || !fs.existsSync(record.filePath)) {
        qchatFilePendingSends.delete(transferId);
      }
    }
    saveQchatFilePendingSendRecords([...qchatFilePendingSends.values()]);
  };

  const persistQchatFilePendingSend = (
    record: QchatFilePendingSendRecord
  ): void => {
    qchatFilePendingSends.set(record.transferId, record);
    pruneAndPersistQchatFilePendingSends();
  };

  const deleteQchatFilePendingSend = (transferId: string): void => {
    qchatFilePendingSends.delete(transferId);
    pruneAndPersistQchatFilePendingSends();
  };

  const pruneQchatFileCompletedSends = (): void => {
    const now = Date.now();
    for (const [transferId, expiresAt] of qchatFileCompletedSends.entries()) {
      if (expiresAt <= now) {
        qchatFileCompletedSends.delete(transferId);
      }
    }
  };

  const markQchatFileSendCompleted = (transferId: string): void => {
    pruneQchatFileCompletedSends();
    qchatFileCompletedSends.set(
      transferId,
      Date.now() + QCHAT_FILE_COMPLETED_CACHE_GRACE_MS
    );
    deleteQchatFilePendingSend(transferId);
  };

  const hydrateQchatFilePendingSends = async (bridge: {
    sendQchatFileResource: (payload: {
      allowedRecipientAddress: string;
      transferId: string;
      filePath: string;
      fileName: string;
      size: number;
      sha256?: string;
      expiresAt?: number;
    }) => Promise<{ ok: boolean; error?: string; reason?: string }>;
  }): Promise<void> => {
    if (qchatFileHydratedBridge === bridge) return;
    const now = Date.now();
    let changed = false;
    let hadError = false;
    for (const record of loadQchatFilePendingSendRecords()) {
      if (record.expiresAt <= now || !fs.existsSync(record.filePath)) {
        changed = true;
        continue;
      }
      qchatFilePendingSends.set(record.transferId, record);
      try {
        const result = await bridge.sendQchatFileResource({
          allowedRecipientAddress: record.allowedRecipientAddress,
          transferId: record.transferId,
          filePath: record.filePath,
          fileName: record.fileName,
          size: record.size,
          sha256: record.sha256,
          expiresAt: record.expiresAt,
        });
        if (!result.ok) {
          loggerError(
            `[Reticulum] failed to hydrate qchat file send ${record.transferId}: ${
              result.error || result.reason || 'unknown error'
            }`
          );
          hadError = true;
        }
      } catch (error) {
        hadError = true;
        loggerError(
          `[Reticulum] failed to hydrate qchat file send ${record.transferId}:`,
          error
        );
      }
    }
    if (changed) {
      pruneAndPersistQchatFilePendingSends();
    }
    if (hadError) {
      throw new Error('qchat file send hydration failed');
    }
    qchatFileHydratedBridge = bridge;
  };

  const verifyQchatFileAuthTimestamp = (timestamp: number): string | null => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return 'Missing Reticulum link auth timestamp';
    }
    const skew = Date.now() - timestamp;
    if (skew > QCHAT_FILE_SIGNATURE_MAX_AGE_MS) {
      return 'Reticulum link auth expired';
    }
    if (skew < -QCHAT_FILE_SIGNATURE_MAX_FUTURE_SKEW_MS) {
      return 'Reticulum link auth timestamp is in the future';
    }
    return null;
  };

  const buildQchatFileLinkAuthSignedFields = (payload: {
    transferId: string;
    senderAddress: string;
    downloaderAddress: string;
    downloaderPublicKey: string;
    downloaderReticulumDestinationHash: string;
    downloaderReticulumIdentityPublicKeyBase64: string;
    timestamp: number;
  }): Record<string, unknown> => ({
    type: 'QCHAT_FILE_LINK_AUTH',
    transferId: payload.transferId,
    senderAddress: payload.senderAddress,
    downloaderAddress: payload.downloaderAddress,
    downloaderPublicKey: payload.downloaderPublicKey,
    downloaderReticulumDestinationHash:
      payload.downloaderReticulumDestinationHash,
    downloaderReticulumIdentityPublicKeyBase64:
      payload.downloaderReticulumIdentityPublicKeyBase64,
    timestamp: payload.timestamp,
  });

  const verifyQchatFileLinkAuth = (
    auth: Record<string, unknown>,
    pending: {
      allowedRecipientAddress: string;
      senderAddress: string;
    }
  ): string | null => {
    const transferId = String(auth.transferId || '').trim();
    const senderAddress = String(auth.senderAddress || '').trim();
    const downloaderAddress = String(auth.downloaderAddress || '').trim();
    const downloaderPublicKey = String(auth.downloaderPublicKey || '').trim();
    const downloaderReticulumDestinationHash = String(
      auth.downloaderReticulumDestinationHash || ''
    )
      .trim()
      .toLowerCase();
    const downloaderReticulumIdentityPublicKeyBase64 = String(
      auth.downloaderReticulumIdentityPublicKeyBase64 || ''
    ).trim();
    const timestamp = Number(auth.timestamp || 0);
    const signature = String(auth.signature || '').trim();
    if (
      !transferId ||
      !senderAddress ||
      !downloaderAddress ||
      !downloaderPublicKey
    ) {
      return 'Missing Reticulum link auth identity fields';
    }
    if (downloaderAddress !== pending.allowedRecipientAddress) {
      return 'Reticulum link auth is not from the allowed downloader';
    }
    if (senderAddress !== pending.senderAddress) {
      return 'Reticulum link auth sender mismatch';
    }
    if (
      !downloaderReticulumDestinationHash ||
      !downloaderReticulumIdentityPublicKeyBase64 ||
      !signature
    ) {
      return 'Missing Reticulum link auth signature fields';
    }
    const timestampError = verifyQchatFileAuthTimestamp(timestamp);
    if (timestampError) return timestampError;
    const ok = runEd25519VerifySync({
      kind: 'gc',
      fields: buildQchatFileLinkAuthSignedFields({
        transferId,
        senderAddress,
        downloaderAddress,
        downloaderPublicKey,
        downloaderReticulumDestinationHash,
        downloaderReticulumIdentityPublicKeyBase64,
        timestamp,
      }),
      signature,
      fromPublicKey: downloaderPublicKey,
      fromAddress: downloaderAddress,
    });
    return ok ? null : 'Invalid Reticulum link auth signature';
  };

  const sha256File = async (filePath: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });

  const attachQchatFileBridgeEvents = async (): Promise<void> => {
    const { getReticulumBridge } =
      (await import('./reticulum-bridge')) as typeof import('./reticulum-bridge');
    const bridge = getReticulumBridge();
    if (!bridge) {
      scheduleQchatFileBridgeAttachRetry();
      return;
    }
    await hydrateQchatFilePendingSends(bridge);
    if (qchatFileAttachedBridge === bridge) return;
    bridge.on('qchat-file-transfer', (payload: any) => {
      const broadcastQchatFileTransfer = (eventPayload: any): void => {
        for (const wc of BrowserWindow.getAllWindows().map(
          (w) => w.webContents
        )) {
          if (!wc.isDestroyed()) {
            wc.send('reticulum:qchatFileTransferEvent', eventPayload);
          }
        }
      };
      if (payload?.status === 'auth' && payload?.auth && payload?.linkId) {
        const transferId = String(payload.transferId || '').trim();
        const rejectAuth = (reason: string): void => {
          loggerError(`[Reticulum] qchat file auth rejected: ${reason}`);
          broadcastQchatFileTransfer({
            status: 'failed',
            transferId,
            reason,
          });
          void bridge
            .rejectQchatFileResource({
              linkId: String(payload.linkId),
              transferId,
              reason,
            })
            .then((res) => {
              if (!res.ok) {
                const failure = res as { error?: string; reason?: string };
                loggerError(
                  `[Reticulum] qchat file reject failed: ${failure.error || failure.reason}`
                );
              }
            })
            .catch((err) =>
              loggerError('[Reticulum] qchat file reject failed:', err)
            );
        };
        const pending = qchatFilePendingSends.get(transferId);
        if (!pending) {
          pruneQchatFileCompletedSends();
          if (qchatFileCompletedSends.has(transferId)) {
            loggerLog(
              `[Reticulum] ignoring duplicate qchat file auth for completed transfer ${transferId}`
            );
            return;
          }
          rejectAuth('no_pending_transfer');
          return;
        }
        if (pending.expiresAt <= Date.now()) {
          deleteQchatFilePendingSend(transferId);
          rejectAuth('transfer_expired');
          return;
        }
        if (!fs.existsSync(pending.filePath)) {
          deleteQchatFilePendingSend(transferId);
          rejectAuth('file_missing');
          return;
        }
        const failure = verifyQchatFileLinkAuth(payload.auth, pending);
        if (failure) {
          rejectAuth(failure);
          return;
        }
        void bridge
          .authorizeQchatFileResource({
            linkId: String(payload.linkId),
            transferId,
          })
          .then((res) => {
            if (!res.ok) {
              const failure = res as { error?: string; reason?: string };
              loggerError(
                `[Reticulum] qchat file authorize failed: ${failure.error || failure.reason}`
              );
              return;
            }
          })
          .catch((err) =>
            loggerError('[Reticulum] qchat file authorize failed:', err)
          );
      } else if (payload?.status === 'sent' && payload?.transferId) {
        markQchatFileSendCompleted(String(payload.transferId));
      }
      broadcastQchatFileTransfer(payload);
    });
    qchatFileAttachedBridge = bridge;
  };

  const scheduleQchatFileBridgeAttachRetry = (): void => {
    if (qchatFileAttachRetryTimer) return;
    qchatFileAttachRetryTimer = setTimeout(() => {
      qchatFileAttachRetryTimer = null;
      void attachQchatFileBridgeEvents().catch((error) => {
        loggerError(
          '[Reticulum] qchat file bridge event attach retry failed:',
          error
        );
        scheduleQchatFileBridgeAttachRetry();
      });
    }, QCHAT_FILE_BRIDGE_ATTACH_RETRY_MS);
    qchatFileAttachRetryTimer.unref?.();
  };

  void attachQchatFileBridgeEvents().catch((error) => {
    loggerError('[Reticulum] qchat file bridge event attach failed:', error);
    scheduleQchatFileBridgeAttachRetry();
  });

  ipcMain.handle(
    'reticulum:getStatus',
    async (): Promise<ReticulumDaemonStatus> => {
      return collectReticulumStatusSnapshot();
    }
  );

  ipcMain.handle(
    'reticulum:getConfigEditorInfo',
    async (): Promise<ReticulumConfigEditorInfo> => {
      return readReticulumConfigEditorInfo();
    }
  );

  ipcMain.handle(
    'reticulum:saveConfigEditorContents',
    async (_event, contents: string): Promise<ReticulumConfigEditorInfo> => {
      return writeReticulumConfigFromEditor(contents);
    }
  );

  ipcMain.handle(
    'reticulum:getGeneratedDefaultConfig',
    async (): Promise<{
      ok: boolean;
      contents: string;
      error?: string;
    }> => {
      try {
        return {
          ok: true,
          contents: buildCurrentManagedReticulumConfig(),
        };
      } catch (error) {
        return {
          ok: false,
          contents: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  ipcMain.handle(
    'reticulum:revealConfigInFileExplorer',
    async (): Promise<{
      ok: boolean;
      error?: string;
      configPath: string;
      configDir: string;
    }> => {
      return revealReticulumConfigInFileExplorer();
    }
  );

  ipcMain.on('reticulum:status:subscribe', (event) => {
    reticulumStatusSubscribers.add(event.sender);
    void collectReticulumStatusSnapshot()
      .then((status) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(RETICULUM_STATUS_CHANNEL, status);
        }
      })
      .catch((error) => {
        loggerError(
          '[Reticulum] Failed to send initial status snapshot:',
          error
        );
      });
  });

  ipcMain.on('reticulum:status:unsubscribe', (event) => {
    reticulumStatusSubscribers.delete(event.sender);
  });

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
        const localHash =
          bridge.getLocalDestinationHash()?.trim().toLowerCase() ?? '';
        const peersByHash = new Map(
          (getPresenceManager()?.getReticulumVerifiedPeers() ?? []).map(
            (peer) => [peer.destinationHash.toLowerCase(), peer.address]
          )
        );
        const uniqueByHash = new Map<string, ReticulumOverlayPeerStatus>();
        for (const peer of bridge.getOverlayLinkSnapshots()) {
          const peerHash = peer.peerPresenceHash.trim();
          if (!peerHash) continue;
          const peerKey = peerHash.toLowerCase();
          if (localHash && peerKey === localHash) continue;
          const current = uniqueByHash.get(peerKey);
          if (current && current.connectedAt <= peer.connectedAt) continue;
          uniqueByHash.set(peerKey, {
            linkId: peer.linkId,
            peerPresenceHash: peer.peerPresenceHash,
            incoming: peer.incoming,
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
    'reticulum:qchatFileSelect',
    async (): Promise<{
      ok: boolean;
      canceled?: boolean;
      error?: string;
      file?: { path: string; name: string; size: number; sha256: string };
    }> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, canceled: true };
        }
        const filePath = result.filePaths[0]!;
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile())
          return { ok: false, error: 'Selected path is not a file' };
        const sha256 = await sha256File(filePath);
        return {
          ok: true,
          file: {
            path: filePath,
            name: path.basename(filePath),
            size: stat.size,
            sha256,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggerError('[Reticulum] qchatFileSelect failed:', error);
        return { ok: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'reticulum:qchatFileChooseSavePath',
    async (
      _event,
      fileName: string
    ): Promise<{
      ok: boolean;
      canceled?: boolean;
      error?: string;
      path?: string;
    }> => {
      try {
        const safeName = path.basename(String(fileName || 'received-file'));
        const result = await dialog.showSaveDialog({
          defaultPath: safeName,
        });
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }
        return { ok: true, path: result.filePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggerError('[Reticulum] qchatFileChooseSavePath failed:', error);
        return { ok: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'reticulum:qchatFileAccept',
    async (
      _event,
      payload: {
        transferId?: string;
        senderAddress?: string;
        recipientAddress?: string;
        authMessage?: Record<string, unknown>;
        savePath?: string;
        fileName?: string;
        size?: number;
        sha256?: string;
        senderReticulumDestinationHash?: string;
        senderReticulumIdentityPublicKeyBase64?: string;
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const peerPresenceHash = String(
          payload?.senderReticulumDestinationHash || ''
        )
          .trim()
          .toLowerCase();
        const reticulumIdentityPublicKeyBase64 = String(
          payload?.senderReticulumIdentityPublicKeyBase64 || ''
        ).trim();
        if (!peerPresenceHash) {
          return {
            ok: false,
            error: 'Missing sender Reticulum destination hash in offer',
          };
        }
        if (!/^[0-9a-f]{32}$/i.test(peerPresenceHash)) {
          return {
            ok: false,
            error: 'Invalid sender Reticulum destination hash in offer',
          };
        }
        if (!reticulumIdentityPublicKeyBase64) {
          return {
            ok: false,
            error: 'Missing sender Reticulum public key in offer',
          };
        }
        if (!payload?.authMessage || typeof payload.authMessage !== 'object') {
          return { ok: false, error: 'Missing Reticulum link auth message' };
        }
        await attachQchatFileBridgeEvents();
        const { getReticulumBridge, startReticulumBridge } =
          (await import('./reticulum-bridge')) as typeof import('./reticulum-bridge');
        const bridge = getReticulumBridge() ?? (await startReticulumBridge());
        const result = await bridge.acceptQchatFileResource({
          peerPresenceHash,
          reticulumIdentityPublicKeyBase64,
          authMessage: payload.authMessage,
          transferId: String(payload?.transferId || ''),
          savePath: String(payload?.savePath || ''),
          fileName: String(payload?.fileName || ''),
          size: Number(payload?.size || 0),
          sha256:
            typeof payload?.sha256 === 'string' ? payload.sha256 : undefined,
        });
        if (result.ok) return { ok: true };
        return {
          ok: false,
          error:
            'reason' in result
              ? result.error || result.reason
              : 'Reticulum transfer accept failed',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggerError('[Reticulum] qchatFileAccept failed:', error);
        return { ok: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'reticulum:qchatFileSend',
    async (
      _event,
      payload: {
        transferId?: string;
        allowedRecipientAddress?: string;
        senderAddress?: string;
        recipientAddress?: string;
        filePath?: string;
        fileName?: string;
        size?: number;
        sha256?: string;
        expiresAt?: number;
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const allowedRecipientAddress = String(
          payload?.allowedRecipientAddress || payload?.recipientAddress || ''
        ).trim();
        const senderAddress = String(payload?.senderAddress || '').trim();
        if (!allowedRecipientAddress) {
          return {
            ok: false,
            error: 'Missing allowed recipient address for file transfer',
          };
        }
        if (!senderAddress) {
          return {
            ok: false,
            error: 'Missing sender address for file transfer',
          };
        }
        await attachQchatFileBridgeEvents();
        const { getReticulumBridge, startReticulumBridge } =
          (await import('./reticulum-bridge')) as typeof import('./reticulum-bridge');
        const bridge = getReticulumBridge() ?? (await startReticulumBridge());
        const transferId = String(payload?.transferId || '');
        const filePath = String(payload?.filePath || '');
        const fileName = String(payload?.fileName || '');
        const size = Number(payload?.size || 0);
        const sha256 =
          typeof payload?.sha256 === 'string'
            ? payload.sha256.trim().toLowerCase()
            : '';
        const requestedExpiresAt = Number(payload?.expiresAt || 0);
        const createdAt = Date.now();
        const expiresAt =
          Number.isFinite(requestedExpiresAt) && requestedExpiresAt > createdAt
            ? requestedExpiresAt
            : createdAt + QCHAT_FILE_OFFER_TTL_MS;
        if (!transferId) {
          return { ok: false, error: 'Missing transfer id' };
        }
        if (!filePath || !fs.existsSync(filePath)) {
          return { ok: false, error: 'File does not exist' };
        }
        const pendingRecord: QchatFilePendingSendRecord = {
          transferId,
          senderAddress,
          allowedRecipientAddress,
          filePath,
          fileName,
          size,
          sha256,
          createdAt,
          expiresAt,
        };
        const result = await bridge.sendQchatFileResource({
          allowedRecipientAddress,
          transferId,
          filePath,
          fileName,
          size,
          sha256,
          expiresAt,
        });
        if (result.ok) {
          persistQchatFilePendingSend(pendingRecord);
          return { ok: true };
        }
        return {
          ok: false,
          error:
            'reason' in result
              ? result.error || result.reason
              : 'Reticulum transfer send failed',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loggerError('[Reticulum] qchatFileSend failed:', error);
        return { ok: false, error: message };
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
