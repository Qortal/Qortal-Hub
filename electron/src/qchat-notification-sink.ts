/**
 * Q-Chat OS notification sink.
 *
 * Owns the decision "should this notification be shown at all", assigns its id,
 * and records the outcome in the {@link NotificationRegistry}. It deliberately
 * imports nothing from `electron` at runtime — the only Electron reference is a
 * type, which is erased at compile time — so a scenario can drive it under plain
 * Node without launching the app.
 *
 * The physical presentation stays in `setup.ts` and is injected through
 * {@link QChatNotificationSink.setPresenter}. That keeps the platform-specific
 * parts (Electron `Notification`, the Linux helper) where they belong while
 * letting the decision, the cap, the dedupe and the show-time suppression be
 * asserted directly.
 *
 * Show-time, not submit-time: the queue that calls this drains with a
 * multi-second delay, so the renderer's state when a notification was submitted
 * can be stale by the time it is presented. See `qchat-view-context.ts`.
 */

import {
  NotificationRegistry,
  type NotificationCloser,
  type NotificationEntry,
} from './notification-registry';
import { QChatViewContextStore } from './qchat-view-context';
import type { Notification } from 'electron';

export interface QChatNotificationContext {
  groupId: number;
  channelId?: string;
}

export interface QChatNotificationSubmission {
  title: string;
  body: string;
  /** Stable id for dedupe and later dismissal. Defaults to the clock reading. */
  notificationId?: string;
  icon?: string;
  data?: Record<string, unknown>;
  groupContext?: QChatNotificationContext;
  eventId?: string;
}

/**
 * What a presenter creates. `notification` is an opaque handle the registry
 * keeps alive so the OS does not garbage-collect it; `close` is the
 * transport-agnostic closer used by app-initiated dismissal.
 */
export interface QChatNotificationPresentation {
  notification?: unknown;
  close?: NotificationCloser;
}

export type QChatNotificationPresenter = (
  submission: QChatNotificationSubmission,
  notificationId: string
) =>
  | QChatNotificationPresentation
  | null
  | void
  | Promise<QChatNotificationPresentation | null | void>;

export type QChatNotificationSubmitResult =
  | { success: true; suppressed: true; notificationId?: never }
  | { success: true; suppressed?: never; notificationId: string }
  | {
      success: false;
      suppressed?: never;
      notificationId?: never;
      error: string;
    };

/**
 * Read-only view of a registered notification. Returned by {@link snapshot} as
 * fresh objects so a caller cannot mutate registry state through it.
 */
export interface QChatNotificationSnapshot {
  notificationId: string;
  groupContext?: QChatNotificationContext;
  eventId?: string;
  createdAt: number;
  osClosedBySystem: boolean;
  appInitiatedClose: boolean;
}

export interface QChatNotificationSinkOptions {
  registry?: NotificationRegistry;
  viewContext?: QChatViewContextStore;
  now?: () => number;
  /** Defaults to 50, matching `MAX_ACTIVE_NOTIFICATIONS`. */
  max?: number;
}

export class QChatNotificationSink {
  private readonly registry: NotificationRegistry;
  private readonly viewContext: QChatViewContextStore;
  private readonly now: () => number;
  private presenter: QChatNotificationPresenter | null = null;
  private lastGeneratedId = 0;

  constructor(options: QChatNotificationSinkOptions = {}) {
    this.registry =
      options.registry ??
      new NotificationRegistry(options.max, (entry) => {
        // App-initiated close: prefer the transport closer, else the handle.
        if (entry.close) {
          entry.close();
          return;
        }
        const handle = entry.notification as
          | { close?: () => void }
          | null
          | undefined;
        handle?.close?.();
      });
    this.viewContext = options.viewContext ?? new QChatViewContextStore();
    this.now = options.now ?? Date.now;
  }

  /** Inject the platform presenter. Without one, entries are logged only. */
  setPresenter(presenter: QChatNotificationPresenter | null): void {
    this.presenter = presenter;
  }

  /**
   * Release a presentation the registry no longer owns. Used when the entry was
   * dismissed, evicted, or replaced while the presenter was awaiting: the
   * registry side is already correct, but the OS-level notification has to be
   * closed or it stays visible with nothing left able to dismiss it.
   */
  private closePresentation(presentation: QChatNotificationPresentation): void {
    try {
      if (presentation.close) {
        presentation.close();
        return;
      }
      const handle = presentation.notification as
        | { close?: () => void }
        | null
        | undefined;
      handle?.close?.();
    } catch {
      // Closing a stale notification is best-effort; the app cannot do more.
    }
  }

  getViewContextStore(): QChatViewContextStore {
    return this.viewContext;
  }

  setViewContext(payload: unknown): void {
    this.viewContext.set(payload);
  }

  clearViewContext(): void {
    this.viewContext.clear();
  }

  /**
   * Is the user currently looking at the channel this notification targets?
   * Exposed so a caller can distinguish "suppressed" from "never submitted".
   */
  wouldSuppress(groupId?: number, channelId?: string): boolean {
    return this.viewContext.shouldSuppress(groupId, channelId);
  }

  /**
   * Decide, register, and present. Suppression is checked before registration so
   * a notification that is never shown cannot consume a cap slot or survive as
   * an orphan entry.
   */
  async submit(
    submission: QChatNotificationSubmission
  ): Promise<QChatNotificationSubmitResult> {
    try {
      if (
        this.viewContext.shouldSuppress(
          submission.groupContext?.groupId,
          submission.groupContext?.channelId
        )
      ) {
        return { success: true, suppressed: true };
      }

      const notificationId =
        submission.notificationId || this.generateNotificationId();
      const createdAt = this.now();

      // Register first, without a handle, so the registry's cap and dedupe rules
      // apply before any OS work happens. The presenter fills in the handle.
      // Keep the registered object so the awaited result can be checked against
      // the *same* submission rather than just the id: a replacement that reuses
      // the id must not inherit this presentation.
      const registeredEntry: NotificationEntry = {
        notification: null,
        groupContext: submission.groupContext
          ? { ...submission.groupContext }
          : undefined,
        eventId: submission.eventId,
        createdAt,
        osClosedBySystem: false,
      };
      this.registry.set(notificationId, registeredEntry);

      if (!this.presenter) {
        return { success: true, notificationId };
      }

      let presentation: QChatNotificationPresentation | null | void;
      try {
        presentation = await this.presenter(submission, notificationId);
      } catch (error) {
        // Nothing was shown, so the placeholder must not linger as an entry
        // that can never be closed through the app.
        if (this.registry.get(notificationId) === registeredEntry) {
          this.registry.closeAppInitiated(notificationId);
        }
        throw error;
      }
      if (!presentation) {
        return { success: true, notificationId };
      }

      const entry = this.registry.get(notificationId);
      if (entry === registeredEntry && !registeredEntry.appInitiatedClose) {
        this.registry.set(notificationId, {
          ...registeredEntry,
          notification: (presentation.notification as Notification) ?? null,
          close: presentation.close,
        });
      } else {
        // The submission was dismissed, evicted, or replaced while the
        // presenter was awaiting. The entry is correctly gone, but the
        // presentation still exists in the OS — most visibly on Linux, where
        // the presenter awaits and the notification has no timeout. Close it
        // here instead of dropping the handle.
        this.closePresentation(presentation);
      }
      return { success: true, notificationId };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * The OS or user closed the physical notification. The entry is retained
   * logically until an app-initiated dismissal or cap eviction.
   */
  markOsClosed(notificationId: string): void {
    this.registry.markOsClosed(notificationId);
  }

  dismissByContext(groupId: number, channelId?: string): void {
    this.registry.dismissByContext(groupId, channelId);
  }

  dismissByEventId(eventId: string): void {
    this.registry.dismissByEventId(eventId);
  }

  /** Registered notifications, in insertion order. */
  snapshot(): QChatNotificationSnapshot[] {
    return this.registry.entriesWithIds().map(([notificationId, entry]) => ({
      notificationId,
      groupContext: entry.groupContext ? { ...entry.groupContext } : undefined,
      eventId: entry.eventId,
      createdAt: entry.createdAt,
      osClosedBySystem: entry.osClosedBySystem === true,
      appInitiatedClose: entry.appInitiatedClose === true,
    }));
  }

  /** Number of registered notifications, including OS-closed ones. */
  get size(): number {
    return this.registry.size;
  }

  /** Remove every entry without closing anything (shutdown / tests). */
  clear(): void {
    this.registry.clear();
  }

  private generateNotificationId(): string {
    const candidate = this.now();
    this.lastGeneratedId =
      candidate > this.lastGeneratedId ? candidate : this.lastGeneratedId + 1;
    return String(this.lastGeneratedId);
  }
}
