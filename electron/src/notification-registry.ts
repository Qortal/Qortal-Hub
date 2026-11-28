/**
 * Logical notification registry for the Electron main process.
 *
 * Owns the lifecycle of Q-Chat OS notification entries. The registry is the
 * source of truth for "a notification is alive": an entry lives until user
 * interaction, reading in Q-Chat (dismiss IPC), or 50-cap eviction. A
 * desktop-environment-initiated `close` (auto-dismiss after timeout, or
 * shade collapse when clicking another notification) does NOT terminate the
 * entry's logical life — it is marked OS-closed and retained.
 *
 * Entries close through an abstraction rather than an Electron
 * `Notification` handle, because Linux notifications are delivered by the
 * helper process in `electron/resources/linux_notify.py` and have no handle.
 * `notification` is retained for the Electron path on Windows and macOS.
 *
 * See openspec change `fix-qchat-os-notification-eviction` (D1/E1 decisions).
 */

import type { Notification } from 'electron';

/**
 * Closes the physical notification for an entry, by whatever transport
 * created it. Idempotent and non-throwing: failures are not fatal.
 */
export type NotificationCloser = () => void;

export interface NotificationEntry {
  /** Electron handle, when the notification was created in-process
   *  (Windows/macOS, or Linux if the helper is unavailable). */
  notification: Notification | null;
  /** Transport-agnostic close. When absent, `notification?.close()` is used. */
  close?: NotificationCloser;
  groupContext?: { groupId: number; channelId?: string };
  eventId?: string;
  createdAt: number;
  /** True when the OS (not the app) closed the physical notification. The
   *  entry is retained logically until user interaction, read-in-Q-Chat
   *  dismiss, or 50-cap eviction. */
  osClosedBySystem: boolean;
  /** True when the app requested this close (dismiss IPC or cap eviction). */
  appInitiatedClose?: boolean;
}

export const MAX_ACTIVE_NOTIFICATIONS = 50;

/**
 * Callback signature for when a notification needs to be closed app-initiated.
 * Kept as a callback so the registry stays transport-agnostic (the caller
 * wires the real Electron `Notification.close()`).
 */
export type CloseHandler = (entry: NotificationEntry) => void;

/** Default close: prefer the transport closer, else the Electron handle. */
export function defaultCloseEntry(entry: NotificationEntry): void {
  if (entry.close) {
    entry.close();
    return;
  }
  entry.notification?.close();
}

export class NotificationRegistry {
  private readonly entries = new Map<string, NotificationEntry>();

  constructor(
    private readonly max = MAX_ACTIVE_NOTIFICATIONS,
    private readonly onAppClose: CloseHandler = (entry) =>
      defaultCloseEntry(entry)
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(nid: string): boolean {
    return this.entries.has(nid);
  }

  get(nid: string): NotificationEntry | undefined {
    return this.entries.get(nid);
  }

  entriesList(): NotificationEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Entries paired with their ids, in insertion order. `entriesList()` loses the
   * id, and callers that need to report on a specific notification — the
   * scenario harness, diagnostics — need both.
   */
  entriesWithIds(): Array<[string, NotificationEntry]> {
    return [...this.entries];
  }

  /**
   * Register a new entry under `nid`. If the id already exists, the entry is
   * replaced (dedupe) and no eviction happens — the incoming id is never
   * evicted to make room for itself. When at the cap (and the id is new), the
   * OLDEST logical entry (smallest createdAt) is app-closed and removed first,
   * keeping the registry at exactly `max`.
   */
  set(nid: string, entry: NotificationEntry): NotificationEntry | null {
    const evicted = this.makeRoomIfNeeded(nid);
    this.entries.set(nid, entry);
    return evicted;
  }

  /**
   * DE-initiated close: retain the entry, release the native handle, mark
   * osClosedBySystem. No-op if the id is unknown (already app-closed).
   *
   * The transport closer is also dropped: the notification is gone, so a later
   * app-initiated close must not try to close it again.
   */
  markOsClosed(nid: string): void {
    const entry = this.entries.get(nid);
    if (!entry) return;
    entry.osClosedBySystem = true;
    entry.notification = null;
    entry.close = undefined;
  }

  /**
   * App-initiated close: close the native notification and remove the entry.
   */
  closeAppInitiated(nid: string): void {
    const entry = this.entries.get(nid);
    if (!entry) return;
    entry.appInitiatedClose = true;
    try {
      this.onAppClose(entry);
    } catch {
      // Notification close failures are non-fatal.
    }
    this.entries.delete(nid);
  }

  /**
   * Find and app-close every entry matching a group context (groupId alone,
   * groupId+channelId, or channelId alone for DMs).
   */
  dismissByContext(groupId: number, channelId?: string): void {
    for (const [nid, entry] of this.entries) {
      if (!entry.groupContext) continue;
      if (Number.isFinite(groupId)) {
        if (entry.groupContext.groupId !== groupId) continue;
        if (
          channelId !== undefined &&
          entry.groupContext.channelId !== channelId
        )
          continue;
      } else if (channelId) {
        if (entry.groupContext.channelId !== channelId) continue;
      } else {
        continue;
      }
      this.closeAppInitiated(nid);
    }
  }

  /**
   * Find and app-close the first entry matching an eventId.
   */
  dismissByEventId(eventId: string): void {
    for (const [nid, entry] of this.entries) {
      if (entry.eventId === eventId) {
        this.closeAppInitiated(nid);
        break;
      }
    }
  }

  /** Clear all entries (used on shutdown / tests). */
  clear(): void {
    this.entries.clear();
  }

  private makeRoomIfNeeded(newNid: string): NotificationEntry | null {
    if (this.entries.has(newNid)) return null; // dedupe: never evict our own id
    let evicted: NotificationEntry | null = null;
    while (this.entries.size >= this.max && this.entries.size > 0) {
      let oldestNid: string | null = null;
      let oldestCreatedAt = Number.POSITIVE_INFINITY;
      for (const [candidateNid, candidate] of this.entries) {
        if (
          candidate.createdAt < oldestCreatedAt ||
          (candidate.createdAt === oldestCreatedAt && oldestNid === null)
        ) {
          oldestCreatedAt = candidate.createdAt;
          oldestNid = candidateNid;
        }
      }
      if (!oldestNid) break;
      evicted = this.entries.get(oldestNid) ?? null;
      this.closeAppInitiated(oldestNid);
    }
    return evicted;
  }
}
