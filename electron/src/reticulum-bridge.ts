import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import type {
  PresenceEnvelope,
  PresenceRoute,
  PresenceTransport,
  PresenceTransportHandlers,
} from './presence';
import { buildPresenceSignedFields } from './presence';
import {
  getReticulumConfigDir,
  resolveReticulumPythonLaunch,
} from './reticulum-daemon';
import { error as loggerError, log as loggerLog, warn as loggerWarn } from './logger';

type BridgeCmdFrame = {
  type: 'cmd';
  action:
    | 'start'
    | 'publish_presence'
    | 'stop'
    | 'send_call'
    | 'send_group_call'
    | 'open_group_audio_link'
    | 'close_group_audio_link'
    | 'send_group_audio';
  id: string;
  payload?: Record<string, unknown>;
};

type BridgeRespFrame = {
  type: 'resp';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
};

export type ReticulumSendFailureReason =
  | 'bridge-unavailable'
  | 'bridge-not-ready'
  | 'bridge-timeout'
  | 'bridge-exception'
  | 'bridge-not-started'
  | 'unknown-peer-presence-hash'
  | 'wire-too-large'
  | 'packet-send-false'
  | 'unknown-link-id'
  | 'audio-link-not-ready'
  | 'audio-payload-too-large'
  | 'send-command-failed';

export type ReticulumSendResult =
  | { ok: true }
  | {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };

export type ReticulumOpenAudioLinkResult =
  | { ok: true; linkId: string; established: boolean }
  | {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };

type BridgeEventFrame =
  | {
      type: 'event';
      event: 'ready';
      payload?: { destinationHash?: string; callDestinationHash?: string };
    }
  | {
      type: 'event';
      event: 'presence_message';
      payload?: {
        envelope?: PresenceEnvelope;
        route?: { kind: 'reticulum'; destinationHash: string; linkId?: string };
      };
    }
  | {
      type: 'event';
      event: 'call_message';
      payload?: {
        wire?: Record<string, unknown>;
        senderCallHash?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_call_message';
      payload?: {
        wire?: Record<string, unknown>;
        senderCallHash?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_link_established';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        peerCallHash?: string;
        incoming?: boolean;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_link_closed';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        peerCallHash?: string;
        incoming?: boolean;
        reason?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_packet';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        peerCallHash?: string;
        roomId?: string;
        data?: string;
        incoming?: boolean;
      };
    }
  | {
      type: 'event';
      event: 'error';
      payload?: { code?: string; message?: string; detail?: string };
    };

type PendingRequest = {
  resolve: (frame: BridgeRespFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type BridgeState = 'stopped' | 'starting' | 'ready' | 'degraded';

const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_MIN_INTERVAL_MS = 10_000;
const ANNOUNCE_DEDUP_WINDOW_MS = 1_000;
const RESTART_DELAY_MS = 2_000;

function bridgeExeName(): string {
  return process.platform === 'win32' ? 'presence_bridge.exe' : 'presence_bridge';
}

function getFrozenBridgePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'reticulum', bridgeExeName());
  }
  return path.join(__dirname, '..', '..', 'resources', 'reticulum', bridgeExeName());
}

function getBridgeScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'reticulum', 'presence_bridge.py');
  }
  return path.join(__dirname, '..', '..', 'resources', 'reticulum', 'presence_bridge.py');
}

function resolveBridgeLaunch(configDir: string):
  | { cmd: string; args: string[]; cwd: string; mode: 'frozen'; envExtra?: Record<string, string> }
  | ReturnType<typeof resolveReticulumPythonLaunch> {
  const frozenBridge = getFrozenBridgePath();
  if (fs.existsSync(frozenBridge)) {
    return {
      cmd: frozenBridge,
      args: ['--config', configDir],
      cwd: path.dirname(frozenBridge),
      mode: 'frozen',
    };
  }

  return resolveReticulumPythonLaunch(getBridgeScriptPath(), ['--config', configDir]);
}

function toPresenceRoute(raw: unknown): PresenceRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const route = raw as { kind?: unknown; destinationHash?: unknown; linkId?: unknown };
  if (route.kind !== 'reticulum' || typeof route.destinationHash !== 'string') {
    return null;
  }
  return {
    kind: 'reticulum',
    destinationHash: route.destinationHash,
    ...(typeof route.linkId === 'string' ? { linkId: route.linkId } : {}),
  };
}

function semanticPresenceKey(envelope: PresenceEnvelope): string {
  const signed = buildPresenceSignedFields(envelope);
  return JSON.stringify({
    type: envelope.type,
    ...signed,
    timestamp: undefined,
  });
}

export class ReticulumBridge
  extends EventEmitter
  implements PresenceTransport
{
  readonly kind = 'reticulum' as const;

  private child: ChildProcessWithoutNullStreams | null = null;
  private desiredRunning = false;
  private state: BridgeState = 'stopped';
  private stdoutBuffer = '';
  private writeQueue: string[] = [];
  private waitingForDrain = false;
  private pending = new Map<string, PendingRequest>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private statePromise: Promise<void> | null = null;
  private lastHeartbeatSentAt = 0;
  private lastSemanticPresence = new Map<string, number>();

  subscribe(handlers: PresenceTransportHandlers): () => void {
    const onReady = () => handlers.onReady?.();
    const onDegraded = (reason?: string) => handlers.onDegraded?.(reason);
    const onEnvelope = (
      envelope: PresenceEnvelope,
      route: PresenceRoute
    ) => handlers.onEnvelope(envelope, route);

    this.on('ready', onReady);
    this.on('degraded', onDegraded);
    this.on('presence-envelope', onEnvelope);

    return () => {
      this.off('ready', onReady);
      this.off('degraded', onDegraded);
      this.off('presence-envelope', onEnvelope);
    };
  }

  async start(): Promise<void> {
    this.desiredRunning = true;
    if (this.state === 'ready') return;
    if (this.statePromise) return this.statePromise;

    loggerLog(
      `[ReticulumBridge] Starting bridge for config=${getReticulumConfigDir()}`
    );
    this.state = 'starting';
    this.statePromise = this.spawnAndHandshake().finally(() => {
      this.statePromise = null;
    });
    return this.statePromise;
  }

  stop(): void {
    this.desiredRunning = false;
    loggerLog('[ReticulumBridge] Stopping bridge');
    this.state = 'stopped';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Reticulum bridge stopped'));
    }
    this.pending.clear();
    this.writeQueue = [];
    this.waitingForDrain = false;
    this.stdoutBuffer = '';
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) {
      child.kill();
    }
  }

  /**
   * Send one compact call-signaling frame to a peer (presence destination hash).
   * Python injects `r` (local call destination hash) before transmit.
   */
  async sendCall(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.sendCallDetailed(peerPresenceHash, message);
    return result.ok;
  }

  async sendCallDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_call', {
      peerPresenceHash,
      message,
    });
  }

  async sendGroupCall(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.sendGroupCallDetailed(peerPresenceHash, message);
    return result.ok;
  }

  async sendGroupCallDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_group_call', {
      peerPresenceHash,
      message,
    });
  }

  async openGroupAudioLink(
    peerPresenceHash: string
  ): Promise<ReticulumOpenAudioLinkResult> {
    try {
      await this.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: 'bridge-exception',
        error: message,
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('open_group_audio_link', {
        peerPresenceHash,
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        };
      }
      const linkId = resp.payload?.linkId;
      if (typeof linkId !== 'string' || linkId.length === 0) {
        return {
          ok: false,
          reason: 'send-command-failed',
          error: 'Bridge open_group_audio_link response missing linkId',
        };
      }
      return {
        ok: true,
        linkId,
        established: resp.payload?.established === true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: message,
      };
    }
  }

  async closeGroupAudioLink(linkId: string): Promise<ReticulumSendResult> {
    return this.sendDetailed('close_group_audio_link', { linkId });
  }

  async sendGroupAudio(
    linkId: string,
    roomId: string,
    dataBase64: string
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_group_audio', {
      linkId,
      roomId,
      data: dataBase64,
    });
  }

  async publish(envelope: PresenceEnvelope): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;

    if (envelope.type === 'PRESENCE_HEARTBEAT') {
      const now = Date.now();
      if (now - this.lastHeartbeatSentAt < HEARTBEAT_MIN_INTERVAL_MS) {
        loggerLog('[ReticulumBridge] Suppressed heartbeat due to minimum interval');
        return true;
      }
      this.lastHeartbeatSentAt = now;
    } else {
      const semanticKey = semanticPresenceKey(envelope);
      const lastSentAt = this.lastSemanticPresence.get(semanticKey) ?? 0;
      const now = Date.now();
      if (now - lastSentAt < ANNOUNCE_DEDUP_WINDOW_MS) {
        loggerLog(
          `[ReticulumBridge] Suppressed duplicate ${envelope.type} for ${(envelope.payload as { address?: string }).address ?? 'unknown'}`
        );
        return true;
      }
      this.lastSemanticPresence.set(semanticKey, now);
    }

    loggerLog(
      `[ReticulumBridge] Publishing ${envelope.type} for ${(envelope.payload as { address?: string }).address ?? 'unknown'}`
    );
    const resp = await this.sendCommand('publish_presence', { envelope });
    return resp.ok;
  }

  getState(): BridgeState {
    return this.state;
  }

  private async spawnAndHandshake(): Promise<void> {
    const configDir = getReticulumConfigDir();
    const launch = resolveBridgeLaunch(configDir);
    if ('error' in launch) {
      this.transitionToDegraded(launch.error);
      throw new Error(launch.error);
    }

    loggerLog(
      `[ReticulumBridge] Launching bridge mode=${launch.mode} cmd=${launch.cmd}`
    );
    const env = {
      ...process.env,
      ...(launch.envExtra ?? {}),
      PYTHONUNBUFFERED: '1',
      QORTAL_RETICULUM_CONFIG_DIR: configDir,
    };

    const child = spawn(launch.cmd, launch.args, {
      cwd: launch.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    loggerLog(
      `[ReticulumBridge] Spawned child pid=${child.pid ?? 'unknown'} cmd=${launch.cmd}`
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) loggerLog(`[ReticulumBridge/stderr] ${text}`);
    });
    child.stdin.on('drain', () => {
      this.waitingForDrain = false;
      this.flushWriteQueue();
    });
    child.on('error', (err) => {
      loggerError('[ReticulumBridge] Child process error:', err);
      this.transitionToDegraded(String(err));
    });
    child.on('exit', (code, signal) => {
      loggerWarn(
        `[ReticulumBridge] Child exited code=${code} signal=${signal ?? ''}`
      );
      this.child = null;
      if (this.desiredRunning) {
        this.transitionToDegraded(`bridge-exit:${code ?? 'null'}:${signal ?? ''}`);
        this.scheduleRestart();
      } else {
        this.state = 'stopped';
      }
    });

    const resp = await this.sendCommand('start', {
      configDir,
    });
    if (!resp.ok) {
      const reason = resp.error ?? 'Reticulum bridge start failed';
      this.transitionToDegraded(reason);
      throw new Error(reason);
    }
    loggerLog('[ReticulumBridge] Start handshake completed');
  }

  private sendCommand(
    action: BridgeCmdFrame['action'],
    payload?: Record<string, unknown>
  ): Promise<BridgeRespFrame> {
    if (!this.child || this.child.exitCode !== null) {
      return Promise.resolve({
        type: 'resp',
        id: 'unavailable',
        ok: false,
        error: 'Reticulum bridge is not running',
      });
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const frame: BridgeCmdFrame = { type: 'cmd', action, id, payload };
    const wire = JSON.stringify(frame) + '\n';

    return new Promise<BridgeRespFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Reticulum bridge request timed out: ${action}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.writeQueue.push(wire);
      this.flushWriteQueue();
    });
  }

  private flushWriteQueue(): void {
    if (!this.child || this.waitingForDrain) return;
    while (this.writeQueue.length > 0) {
      const frame = this.writeQueue[0];
      const ok = this.child.stdin.write(frame);
      if (!ok) {
        this.waitingForDrain = true;
        return;
      }
      this.writeQueue.shift();
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const nlIndex = this.stdoutBuffer.indexOf('\n');
      if (nlIndex === -1) return;
      const line = this.stdoutBuffer.slice(0, nlIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nlIndex + 1);
      if (!line) continue;

      let frame: BridgeRespFrame | BridgeEventFrame;
      try {
        frame = JSON.parse(line) as BridgeRespFrame | BridgeEventFrame;
      } catch (err) {
        loggerError('[ReticulumBridge] Invalid JSON frame:', err);
        loggerError(`[ReticulumBridge] Invalid line: ${line}`);
        continue;
      }
      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: BridgeRespFrame | BridgeEventFrame): void {
    if (frame.type === 'resp') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      pending.resolve(frame);
      return;
    }

    switch (frame.event) {
      case 'ready':
        this.state = 'ready';
        loggerLog(
          `[ReticulumBridge] Ready destination=${frame.payload?.destinationHash ?? 'unknown'}`
        );
        this.emit('ready');
        return;
      case 'presence_message': {
        const envelope = frame.payload?.envelope;
        const route = toPresenceRoute(frame.payload?.route);
        if (!envelope || !route || route.kind !== 'reticulum') return;
        loggerLog(
          `[ReticulumBridge] Inbound ${envelope.type} from ${(envelope.payload as { address?: string }).address ?? 'unknown'} via ${route.destinationHash}`
        );
        this.emit('presence-envelope', envelope, route);
        return;
      }
      case 'call_message': {
        const wire = frame.payload?.wire;
        const senderCallHash = frame.payload?.senderCallHash;
        if (!wire || typeof wire !== 'object') return;
        this.emit(
          'call-message',
          wire as Record<string, unknown>,
          typeof senderCallHash === 'string' ? senderCallHash : ''
        );
        return;
      }
      case 'group_call_message': {
        const wire = frame.payload?.wire;
        const senderCallHash = frame.payload?.senderCallHash;
        if (!wire || typeof wire !== 'object') return;
        this.emit(
          'group-call-message',
          wire as Record<string, unknown>,
          typeof senderCallHash === 'string' ? senderCallHash : ''
        );
        return;
      }
      case 'group_audio_link_established': {
        const linkId = frame.payload?.linkId;
        if (typeof linkId !== 'string' || !linkId) return;
        this.emit('group-audio-link-established', {
          linkId,
          peerPresenceHash:
            typeof frame.payload?.peerPresenceHash === 'string'
              ? frame.payload.peerPresenceHash
              : '',
          peerCallHash:
            typeof frame.payload?.peerCallHash === 'string'
              ? frame.payload.peerCallHash
              : '',
          incoming: frame.payload?.incoming === true,
        });
        return;
      }
      case 'group_audio_link_closed': {
        const linkId = frame.payload?.linkId;
        if (typeof linkId !== 'string' || !linkId) return;
        this.emit('group-audio-link-closed', {
          linkId,
          peerPresenceHash:
            typeof frame.payload?.peerPresenceHash === 'string'
              ? frame.payload.peerPresenceHash
              : '',
          peerCallHash:
            typeof frame.payload?.peerCallHash === 'string'
              ? frame.payload.peerCallHash
              : '',
          incoming: frame.payload?.incoming === true,
          reason:
            typeof frame.payload?.reason === 'string'
              ? frame.payload.reason
              : '',
        });
        return;
      }
      case 'group_audio_packet': {
        const linkId = frame.payload?.linkId;
        const roomId = frame.payload?.roomId;
        const data = frame.payload?.data;
        if (
          typeof linkId !== 'string' ||
          !linkId ||
          typeof roomId !== 'string' ||
          !roomId ||
          typeof data !== 'string' ||
          !data
        ) {
          return;
        }
        this.emit('group-audio-packet', {
          linkId,
          roomId,
          data,
          peerPresenceHash:
            typeof frame.payload?.peerPresenceHash === 'string'
              ? frame.payload.peerPresenceHash
              : '',
          peerCallHash:
            typeof frame.payload?.peerCallHash === 'string'
              ? frame.payload.peerCallHash
              : '',
          incoming: frame.payload?.incoming === true,
        });
        return;
      }
      case 'error': {
        const message =
          frame.payload?.message ??
          frame.payload?.detail ??
          'Reticulum bridge reported an error';
        loggerError('[ReticulumBridge] Python error event:', message);
        return;
      }
    }
  }

  private transitionToDegraded(reason?: string): void {
    if (this.state === 'degraded' && !reason) return;
    this.state = 'degraded';
    loggerWarn(`[ReticulumBridge] Degraded: ${reason ?? 'unknown reason'}`);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason ?? 'Reticulum bridge degraded'));
    }
    this.pending.clear();
    this.writeQueue = [];
    this.waitingForDrain = false;
    this.emit('degraded', reason);
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    loggerLog(`[ReticulumBridge] Scheduling restart in ${RESTART_DELAY_MS}ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start().catch((err) => {
        loggerError('[ReticulumBridge] Restart failed:', err);
        this.scheduleRestart();
      });
    }, RESTART_DELAY_MS);
    this.restartTimer.unref?.();
  }

  private async sendDetailed(
    action:
      | 'send_call'
      | 'send_group_call'
      | 'close_group_audio_link'
      | 'send_group_audio',
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    try {
      await this.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: 'bridge-exception',
        error: message,
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand(action, payload);
      if (resp.ok) {
        return { ok: true };
      }
      const reason = this.mapSendFailureReason(resp);
      return {
        ok: false,
        reason,
        ...(resp.error ? { error: resp.error } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: message,
      };
    }
  }

  private mapSendFailureReason(frame: BridgeRespFrame): ReticulumSendFailureReason {
    const code = frame.payload?.code;
    if (code === 'bridge_not_started') return 'bridge-not-started';
    if (code === 'unknown_peer_presence_hash')
      return 'unknown-peer-presence-hash';
    if (code === 'wire_too_large') return 'wire-too-large';
    if (code === 'packet_send_false') return 'packet-send-false';
    if (code === 'unknown_link_id') return 'unknown-link-id';
    if (code === 'audio_link_not_ready') return 'audio-link-not-ready';
    if (code === 'audio_payload_too_large') return 'audio-payload-too-large';
    if (frame.error === 'Reticulum bridge is not running') {
      return 'bridge-unavailable';
    }
    return 'send-command-failed';
  }
}

let bridgeInstance: ReticulumBridge | null = null;

export function getReticulumBridge(): ReticulumBridge | null {
  return bridgeInstance;
}

export async function startReticulumBridge(): Promise<ReticulumBridge> {
  if (!bridgeInstance) {
    bridgeInstance = new ReticulumBridge();
  }
  await bridgeInstance.start();
  return bridgeInstance;
}

export function stopReticulumBridge(): void {
  bridgeInstance?.stop();
  bridgeInstance = null;
}
