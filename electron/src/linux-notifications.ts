/**
 * Linux desktop notifications via an untracked helper process.
 *
 * Why not `new Notification()` on Linux
 * -------------------------------------
 * Cinnamon's notification daemon destroys an app's notifications when that app
 * gains focus, in `notificationDaemon._onFocusAppChanged`:
 *
 *     if (source.app == tracker.focus_app) source.destroyNonResidentNotifications();
 *
 * `source.app` comes from `Source._getApp()`, which resolves
 * `WindowTracker.get_app_from_pid(sender_pid)` — the PID of the D-Bus sender.
 * Electron sends `Notify` from the process that owns the Hub window, so the
 * daemon matches it and withdraws the notification the instant Hub is focused.
 *
 * The freedesktop `resident` hint would exempt it, but Electron exposes no
 * option for that hint. The only lever left is process identity: a sender with
 * no window resolves to `null`, so the focus loop matches nothing. This module
 * owns that sender.
 *
 * Verified on Cinnamon 6.x: a notification sent this way remains in the tray
 * after the Hub window gains focus, and still auto-hides as a popup after the
 * shell's own `notification-duration`.
 *
 * Fallback
 * --------
 * If python3/PyGObject is missing or the helper fails to start, callers get
 * `null` and must fall back to `new Notification()`. Linux support for
 * notifications is never worse than before this module existed.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import type { Notification } from 'electron';

/** Event reported by the helper on stdout. */
export interface LinuxNotifyEvent {
  event: 'ready' | 'notified' | 'closed' | 'action' | 'error';
  /** Renderer-side notification id, when known. */
  id?: string | null;
  /** D-Bus notification id assigned by the daemon. */
  dbusId?: number;
  /** NotificationClosed reason: 1 expired, 2 dismissed, 3 app closed. */
  reason?: number;
  /** True when the daemon closed an id this helper no longer tracks. */
  unknown?: boolean;
  /** True when the close was requested by this helper. */
  selfClosed?: boolean;
  /** 'default' for a body click. */
  action?: string;
  message?: string;
}

export interface LinuxNotifyHandle {
  /** D-Bus id assigned by the daemon. */
  dbusId: number;
  /** Close the notification. Safe to call more than once. */
  close: () => void;
}

export interface LinuxNotificationManagerOptions {
  /** Absolute path to linux_notify.py. */
  scriptPath: string;
  /** Interpreter to run it with. Defaults to resolving python3. */
  pythonPath?: string;
  /** Called for every helper event. */
  onEvent: (event: LinuxNotifyEvent) => void;
  /** Called when the helper cannot be started or dies unexpectedly. */
  onUnavailable?: (reason: string) => void;
}

interface PendingNotify {
  resolve: (handle: LinuxNotifyHandle) => void;
  reject: (error: Error) => void;
}

const PYTHON_CANDIDATES = ['python3', 'python'];
const START_TIMEOUT_MS = 5_000;
const NOTIFY_TIMEOUT_MS = 5_000;

/**
 * Owns one long-lived helper process. A long-lived process is used rather than
 * one-shot invocations so that `ActionInvoked` (click) and `NotificationClosed`
 * (desktop-initiated close) reach the registry — a short-lived sender exits
 * before those signals arrive.
 */
export class LinuxNotificationManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private started = false;
  private unavailableReason: string | null = null;
  private readonly pendingNotifies = new Map<string, PendingNotify>();
  private readonly dbusIdByRendererId = new Map<string, number>();
  private readonly rendererIdByDbusId = new Map<number, string>();
  private readonly selfClosed = new Set<number>();

  constructor(private readonly options: LinuxNotificationManagerOptions) {}

  /** True when notifications can be sent through the helper. */
  get available(): boolean {
    return this.unavailableReason === null;
  }

  get unavailableDetail(): string | null {
    return this.unavailableReason;
  }

  /**
   * Send a notification. Resolves with a handle, or `null` when the helper is
   * unavailable — callers must then fall back to `new Notification()`.
   */
  async notify(params: {
    /** Renderer notification id; used to correlate close and click events. */
    id: string;
    summary: string;
    body: string;
    icon?: string;
  }): Promise<LinuxNotifyHandle | null> {
    if (!this.ensureStarted()) return null;

    const requestId = params.id;
    return new Promise<LinuxNotifyHandle | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingNotifies.delete(requestId);
        resolve(null);
      }, NOTIFY_TIMEOUT_MS);

      this.pendingNotifies.set(requestId, {
        resolve: (handle) => {
          clearTimeout(timer);
          resolve(handle);
        },
        reject: () => {
          clearTimeout(timer);
          resolve(null);
        },
      });

      this.write({
        cmd: 'notify',
        id: requestId,
        summary: params.summary,
        body: params.body,
        icon: params.icon ?? '',
        // 0 = never expire, so the entry persists in the notification tray.
        // The popup still auto-hides via the shell's notification-duration.
        timeoutMs: 0,
      });
    });
  }

  /** Close a notification by its D-Bus id. */
  close(dbusId: number): void {
    if (!this.child || this.child.killed) return;
    this.selfClosed.add(dbusId);
    this.write({ cmd: 'close', dbusId });
  }

  /** True when the given renderer id was registered by this manager. */
  ownsRendererId(id: string): boolean {
    return this.dbusIdByRendererId.has(id);
  }

  /** Renderer id for a D-Bus id, when still tracked. */
  rendererIdFor(dbusId: number): string | undefined {
    return this.rendererIdByDbusId.get(dbusId);
  }

  /** Stop the helper. */
  dispose(): void {
    if (!this.child) return;
    try {
      this.write({ cmd: 'quit' });
    } catch {
      // The child may already be gone.
    }
    const child = this.child;
    this.child = null;
    this.started = false;
    for (const pending of this.pendingNotifies.values())
      pending.reject(new Error('linux notification helper stopped'));
    this.pendingNotifies.clear();
    setTimeout(() => {
      if (!child.killed) child.kill();
    }, 1_000).unref?.();
  }

  private resolvePython(): string | null {
    if (this.options.pythonPath) return this.options.pythonPath;
    const pathEnv = process.env.PATH ?? '';
    for (const candidate of PYTHON_CANDIDATES) {
      for (const dir of pathEnv.split(':')) {
        if (!dir) continue;
        const full = join(dir, candidate);
        if (existsSync(full)) return full;
      }
    }
    return null;
  }

  private markUnavailable(reason: string): void {
    if (this.unavailableReason) return;
    this.unavailableReason = reason;
    for (const pending of this.pendingNotifies.values()) {
      pending.reject(new Error(reason));
    }
    this.pendingNotifies.clear();
    this.options.onUnavailable?.(reason);
  }

  /**
   * Start the helper on first use. Returns false when it cannot be started,
   * after recording why, so the caller falls back to the Electron path.
   */
  private ensureStarted(): boolean {
    if (this.unavailableReason) return false;
    if (this.child && this.started) return true;
    if (!existsSync(this.options.scriptPath)) {
      this.markUnavailable(`helper script missing: ${this.options.scriptPath}`);
      return false;
    }

    const python = this.resolvePython();
    if (!python) {
      this.markUnavailable('python3 not found on PATH');
      return false;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(python, [this.options.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
    } catch (error) {
      this.markUnavailable(`spawn failed: ${String(error)}`);
      return false;
    }

    this.child = child;
    this.started = true;

    const startTimer = setTimeout(() => {
      if (!this.started || this.child !== child) return;
      // No 'ready' yet: treat as unavailable and fall back.
      this.markUnavailable('helper did not report ready');
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, START_TIMEOUT_MS);
    startTimer.unref?.();

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (line.trim().length === 0) return;
      let event: LinuxNotifyEvent;
      try {
        event = JSON.parse(line) as LinuxNotifyEvent;
      } catch {
        return;
      }
      if (event.event === 'ready') clearTimeout(startTimer);
      this.handleEvent(event);
    });

    // Anything the helper prints on stderr is diagnostic only; keep it out of
    // the renderer console but visible for support.
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text.length > 0) console.error('[linux-notify]', text);
    });

    child.on('error', (error) => {
      clearTimeout(startTimer);
      this.markUnavailable(`helper error: ${String(error)}`);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(startTimer);
      const wasReady = this.started;
      this.child = null;
      this.started = false;
      if (this.unavailableReason) return;
      if (code === 3 || /gi|PyGObject/i.test(String(this.lastError))) {
        this.markUnavailable(
          'python3 PyGObject (gi) unavailable; cannot send Linux notifications'
        );
        return;
      }
      if (wasReady) {
        this.markUnavailable(
          `helper exited (code=${String(code)}, signal=${String(signal)})`
        );
      }
    });

    return true;
  }

  private lastError = '';

  private handleEvent(event: LinuxNotifyEvent): void {
    if (event.event === 'error') {
      this.lastError = String(event.message ?? '');
      const id = event.id;
      if (id) {
        const pending = this.pendingNotifies.get(id);
        if (pending) {
          this.pendingNotifies.delete(id);
          pending.reject(new Error(this.lastError));
        }
      }
      this.options.onEvent(event);
      return;
    }

    if (event.event === 'notified') {
      const rendererId = String(event.id ?? '');
      const dbusId = Number(event.dbusId ?? 0);
      if (rendererId && dbusId > 0) {
        this.dbusIdByRendererId.set(rendererId, dbusId);
        this.rendererIdByDbusId.set(dbusId, rendererId);
      }
      const pending = this.pendingNotifies.get(rendererId);
      if (pending) {
        this.pendingNotifies.delete(rendererId);
        pending.resolve(
          dbusId > 0
            ? {
                dbusId,
                close: () => this.close(dbusId),
              }
            : null
        );
      }
      this.options.onEvent(event);
      return;
    }

    if (event.event === 'closed') {
      const dbusId = Number(event.dbusId ?? 0);
      const wasSelfClosed = this.selfClosed.delete(dbusId);
      const rendererId =
        this.rendererIdByDbusId.get(dbusId) ?? String(event.id ?? '');
      if (dbusId > 0) this.rendererIdByDbusId.delete(dbusId);
      if (rendererId) this.dbusIdByRendererId.delete(rendererId);
      this.options.onEvent({
        ...event,
        id: rendererId || event.id,
        selfClosed: wasSelfClosed || event.selfClosed === true,
      });
      return;
    }

    this.options.onEvent(event);
  }

  private write(payload: Record<string, unknown>): void {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) return;
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // A broken pipe is reported by the exit handler.
    }
  }
}

/**
 * Wraps a `LinuxNotifyHandle` as a registry `close` callback. Kept separate so
 * the registry never imports the helper.
 */
export function handleToCloser(handle: LinuxNotifyHandle): () => void {
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    handle.close();
  };
}

/** Type guard used by callers that hold both notification kinds. */
export function isElectronNotification(
  value: Notification | null | undefined
): value is Notification {
  return Boolean(value);
}

/** Resolves the helper script next to the packaged resources. */
export function defaultHelperScriptPath(resourcesPath: string): string {
  return join(resourcesPath, 'linux_notify.py');
}

/** Directory helper for callers that need it. */
export function helperDir(filePath: string): string {
  return dirname(filePath);
}
