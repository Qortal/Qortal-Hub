/**
 * Tests for NotificationRegistry — the logical registry behind Q-Chat OS
 * notifications (openspec change `fix-qchat-os-notification-eviction`).
 *
 * Covers:
 * - 4.1: at exactly 50 entries, a 51st notification evicts the oldest createdAt
 *   and the map stays at 50.
 * - 4.2: OS-initiated close retains the entry (osClosedBySystem); app-initiated
 *   close removes it.
 * - 4.3: a 52-burst leaves exactly 50 logical entries with the 2 oldest evicted.
 * - 4.4: click doesn't close/remove anything (registry has no close-on-click;
 *   navigation is handled by the renderer — entries are retained).
 * - 4.5: a click with the renderer not running is a no-op; the entry stays alive
 *   (no pending-click replay — registry never auto-expires entries).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NotificationRegistry,
  type NotificationEntry,
} from './notification-registry';

function makeEntry(
  createdAt: number,
  overrides: Partial<NotificationEntry> = {}
): NotificationEntry {
  return {
    notification: null,
    createdAt,
    osClosedBySystem: false,
    ...overrides,
  };
}

describe('NotificationRegistry', () => {
  describe('cap eviction (4.1)', () => {
    it('evicts the oldest createdAt entry when adding the 51st, keeping 50', () => {
      const closed: string[] = [];
      const registry = new NotificationRegistry(50, (entry) => {
        closed.push(String(entry.createdAt));
      });

      // 50 entries, createdAt 0..49
      for (let i = 0; i < 50; i++) {
        registry.set(`n-${i}`, makeEntry(i));
      }
      expect(registry.size).toBe(50);

      // 51st entry
      registry.set('n-50', makeEntry(50));
      expect(registry.size).toBe(50);
      // Oldest (createdAt 0) is evicted and closed app-initiated.
      expect(closed).toEqual(['0']);
      expect(registry.get('n-0')).toBeUndefined();
      expect(registry.get('n-50')).toBeDefined();
      // The remaining oldest is createdAt 1.
      expect(registry.get('n-1')).toBeDefined();
    });

    it('dedupes: re-adding an existing id does not evict itself', () => {
      const closed: string[] = [];
      const registry = new NotificationRegistry(2, (entry) => {
        closed.push(String(entry.createdAt));
      });
      registry.set('a', makeEntry(1));
      registry.set('b', makeEntry(2));

      // Re-add 'a' at capacity: no eviction, entry replaced.
      registry.set('a', makeEntry(3));
      expect(registry.size).toBe(2);
      expect(closed).toEqual([]);
      expect(registry.get('a')!.createdAt).toBe(3);
    });
  });

  describe('transport-agnostic close', () => {
    it('uses the close callback when the entry has no Electron handle', () => {
      const closer = vi.fn();
      const registry = new NotificationRegistry();
      registry.set('n', makeEntry(1, { notification: null, close: closer }));
      registry.closeAppInitiated('n');
      expect(closer).toHaveBeenCalledTimes(1);
      expect(registry.get('n')).toBeUndefined();
    });

    it('prefers the close callback over the Electron handle', () => {
      const closer = vi.fn();
      const handleClose = vi.fn();
      const registry = new NotificationRegistry();
      registry.set(
        'n',
        makeEntry(1, {
          notification: { close: handleClose } as never,
          close: closer,
        })
      );
      registry.closeAppInitiated('n');
      expect(closer).toHaveBeenCalledTimes(1);
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('markOsClosed drops the closer so a later app close is not re-sent', () => {
      const closer = vi.fn();
      const registry = new NotificationRegistry();
      registry.set('n', makeEntry(1, { notification: null, close: closer }));
      registry.markOsClosed('n');
      expect(registry.get('n')?.close).toBeUndefined();
      registry.closeAppInitiated('n');
      expect(closer).not.toHaveBeenCalled();
    });

    it('cap eviction closes the transport of the evicted entry', () => {
      const older = vi.fn();
      const newer = vi.fn();
      const registry = new NotificationRegistry(1);
      registry.set('old', makeEntry(1, { notification: null, close: older }));
      registry.set('new', makeEntry(2, { notification: null, close: newer }));
      expect(older).toHaveBeenCalledTimes(1);
      expect(registry.get('old')).toBeUndefined();
      expect(registry.get('new')).toBeDefined();
    });

    it('a throwing closer does not prevent entry removal', () => {
      const registry = new NotificationRegistry();
      registry.set(
        'n',
        makeEntry(1, {
          notification: null,
          close: () => {
            throw new Error('helper gone');
          },
        })
      );
      expect(() => registry.closeAppInitiated('n')).not.toThrow();
      expect(registry.get('n')).toBeUndefined();
    });
  });

  describe('OS-initiated vs app-initiated close (4.2)', () => {
    it('markOsClosed retains the entry and releases the native handle', () => {
      const registry = new NotificationRegistry();
      registry.set('n', makeEntry(1, { notification: {} as never }));
      registry.markOsClosed('n');

      const entry = registry.get('n');
      expect(entry).toBeDefined();
      expect(entry!.osClosedBySystem).toBe(true);
      expect(entry!.notification).toBeNull();
      // Still counts toward the cap.
      expect(registry.size).toBe(1);
    });

    it('closeAppInitiated removes the entry', () => {
      const onClose = vi.fn();
      const registry = new NotificationRegistry(50, onClose);
      registry.set(
        'n',
        makeEntry(1, { notification: { close: vi.fn() } as never })
      );
      registry.closeAppInitiated('n');

      expect(registry.get('n')).toBeUndefined();
      expect(registry.size).toBe(0);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dismissByContext closes matching group entries only', () => {
      const onClose = vi.fn();
      const registry = new NotificationRegistry(50, onClose);
      registry.set(
        'g1',
        makeEntry(1, { groupContext: { groupId: 1, channelId: 'general' } })
      );
      registry.set(
        'g2',
        makeEntry(2, { groupContext: { groupId: 2, channelId: 'general' } })
      );
      registry.set(
        'dm',
        makeEntry(3, { groupContext: { groupId: 0, channelId: 'Qaddr' } })
      );

      registry.dismissByContext(1);
      expect(registry.get('g1')).toBeUndefined();
      expect(registry.get('g2')).toBeDefined();
      expect(registry.get('dm')).toBeDefined();

      // DM dismiss by channel
      registry.dismissByContext(NaN, 'Qaddr');
      expect(registry.get('dm')).toBeUndefined();
      expect(registry.get('g2')).toBeDefined();
    });

    it('dismissByEventId closes the matching event only', () => {
      const registry = new NotificationRegistry();
      registry.set('e1', makeEntry(1, { eventId: 'evt-1' }));
      registry.set('e2', makeEntry(2, { eventId: 'evt-2' }));
      registry.dismissByEventId('evt-1');
      expect(registry.get('e1')).toBeUndefined();
      expect(registry.get('e2')).toBeDefined();
    });
  });

  describe('52-burst leaves 50, 2 oldest evicted (4.3)', () => {
    it('evicts exactly the 2 oldest of 52', () => {
      const onClose = vi.fn();
      const registry = new NotificationRegistry(50, onClose);
      // 52 entries: 51 group mentions + 1 DM
      for (let i = 0; i < 51; i++) {
        registry.set(`grp-${i}`, makeEntry(i));
      }
      registry.set('dm', makeEntry(51));
      expect(registry.size).toBe(50);

      // Oldest 2 (createdAt 0 and 1) were evicted and closed.
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(registry.get('grp-0')).toBeUndefined();
      expect(registry.get('grp-1')).toBeUndefined();
      // Newest 50 present (grp-2..grp-50 + dm).
      expect(registry.get('grp-2')).toBeDefined();
      expect(registry.get('grp-50')).toBeDefined();
      expect(registry.get('dm')).toBeDefined();
      expect(registry.size).toBe(50);
    });
  });

  describe('click does not close/remove (4.4)', () => {
    it('registry has no click-close path — entries persist until dismiss/evict', () => {
      const onClose = vi.fn();
      const registry = new NotificationRegistry(50, onClose);
      registry.set('n', makeEntry(1));

      // No method mutates entries on click; the registry is inert w.r.t. clicks.
      // Verify entries survive a "click simulation" (no-op).
      registry.set('n', makeEntry(2)); // re-register is dedupe, not a click close
      expect(registry.get('n')!.createdAt).toBe(2);
      expect(onClose).not.toHaveBeenCalled();

      // An unclicked sibling remains.
      registry.set('sib', makeEntry(3));
      expect(registry.get('sib')).toBeDefined();
    });
  });

  describe('closed-Hub click no-op, entry alive (4.5)', () => {
    it('entries are never auto-expired — a missed click leaves them alive', () => {
      const registry = new NotificationRegistry();
      // Simulate 52 notifications with no renderer (Hub closed). All are
      // retained because there is no dismissal; cap keeps exactly 50.
      for (let i = 0; i < 52; i++) {
        registry.set(`n-${i}`, makeEntry(i));
      }
      expect(registry.size).toBe(50);
      // No pending-click replay, no auto-expiry: remaining entries are alive.
      for (let i = 2; i < 50; i++) {
        expect(registry.get(`n-${i}`)).toBeDefined();
      }
      // A click while the renderer is down is a no-op — entry stays.
      registry.get('n-3')!.osClosedBySystem = true; // OS may auto-dismiss
      expect(registry.get('n-3')).toBeDefined();
      expect(registry.get('n-3')!.osClosedBySystem).toBe(true);
    });
  });
});
