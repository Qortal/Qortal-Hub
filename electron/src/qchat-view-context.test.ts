import { describe, expect, it } from 'vitest';
import { NotificationRegistry } from './notification-registry';
import {
  NOT_VIEWING_GROUP_ID,
  QChatViewContextStore,
  normalizeViewContext,
  shouldSuppressForViewedChannel,
} from './qchat-view-context';

const viewing = (overrides = {}) => ({
  groupId: 7,
  channelId: 'general',
  visible: true,
  ...overrides,
});

describe('shouldSuppressForViewedChannel', () => {
  it('suppresses an exact match while visible', () => {
    expect(shouldSuppressForViewedChannel(viewing(), 7, 'general')).toBe(true);
  });

  it('does not suppress a different group', () => {
    expect(shouldSuppressForViewedChannel(viewing(), 8, 'general')).toBe(false);
  });

  it('does not suppress a different channel in the same group', () => {
    expect(shouldSuppressForViewedChannel(viewing(), 7, 'announcements')).toBe(
      false
    );
  });

  it('does not suppress when the window is not visible', () => {
    expect(
      shouldSuppressForViewedChannel(viewing({ visible: false }), 7, 'general')
    ).toBe(false);
  });

  it('does not suppress with no context', () => {
    expect(shouldSuppressForViewedChannel(null, 7, 'general')).toBe(false);
    expect(shouldSuppressForViewedChannel(undefined, 7, 'general')).toBe(false);
  });

  it('does not suppress with the not-viewing sentinel', () => {
    expect(
      shouldSuppressForViewedChannel(
        viewing({ groupId: NOT_VIEWING_GROUP_ID }),
        NOT_VIEWING_GROUP_ID,
        'general'
      )
    ).toBe(false);
  });

  it('does not suppress when the notification has no group context', () => {
    expect(
      shouldSuppressForViewedChannel(viewing(), undefined, undefined)
    ).toBe(false);
    expect(shouldSuppressForViewedChannel(viewing(), 7, '')).toBe(false);
  });

  it('is independent of scroll position', () => {
    for (const extra of [{ isAtBottom: true }, { isAtBottom: false }]) {
      expect(
        shouldSuppressForViewedChannel(
          { ...viewing(), ...extra } as any,
          7,
          'general'
        )
      ).toBe(true);
    }
  });
});

describe('normalizeViewContext', () => {
  it('accepts a well-formed payload', () => {
    expect(normalizeViewContext(viewing())).toEqual(viewing());
  });

  it('coerces a numeric string group id', () => {
    expect(
      normalizeViewContext({ ...viewing(), groupId: '7' as any })?.groupId
    ).toBe(7);
  });

  it('returns null for a non-finite group id', () => {
    expect(normalizeViewContext({ groupId: NaN })).toBeNull();
    expect(normalizeViewContext({ groupId: 'abc' })).toBeNull();
    expect(normalizeViewContext({})).toBeNull();
    expect(normalizeViewContext(null)).toBeNull();
    expect(normalizeViewContext('nope')).toBeNull();
  });

  it('defaults a non-string channel id to empty and visible to false', () => {
    expect(normalizeViewContext({ groupId: 7, channelId: 5 })).toEqual({
      groupId: 7,
      channelId: '',
      visible: false,
    });
  });
});

describe('QChatViewContextStore', () => {
  it('starts empty and suppresses nothing', () => {
    const store = new QChatViewContextStore();
    expect(store.get()).toBeNull();
    expect(store.shouldSuppress(7, 'general')).toBe(false);
  });

  it('suppresses after a matching context is set', () => {
    const store = new QChatViewContextStore();
    store.set(viewing());
    expect(store.shouldSuppress(7, 'general')).toBe(true);
  });

  it('clears to suppress-nothing', () => {
    const store = new QChatViewContextStore();
    store.set(viewing());
    store.clear();
    expect(store.get()).toBeNull();
    expect(store.shouldSuppress(7, 'general')).toBe(false);
  });

  it('treats a malformed payload as no context', () => {
    const store = new QChatViewContextStore();
    store.set(viewing());
    store.set({ groupId: NaN });
    expect(store.get()).toBeNull();
  });
});

/**
 * The show-time gate's registry consequences. The IPC handler in setup.ts
 * returns before `activeNotifications.set(...)` when the gate trips, so no
 * entry is created and no eviction can occur. These exercise that contract
 * against a real registry.
 */
describe('suppressed notification and the notification registry', () => {
  const makeEntry = (
    groupId: number,
    channelId: string,
    createdAt: number
  ) => ({
    notification: null,
    groupContext: { groupId, channelId },
    createdAt,
    osClosedBySystem: false,
  });

  it('leaves the registry unchanged when the gate trips', () => {
    const store = new QChatViewContextStore();
    store.set(viewing());
    const registry = new NotificationRegistry();
    registry.set('a', makeEntry(1, 'general', 1));

    const suppressed = store.shouldSuppress(7, 'general');
    expect(suppressed).toBe(true);
    // Mirrors the handler: return before registering.
    if (!suppressed) registry.set('b', makeEntry(7, 'general', 2));

    expect(registry.size).toBe(1);
    expect(registry.has('b')).toBe(false);
  });

  it('does not evict at the cap when suppressed', () => {
    const store = new QChatViewContextStore();
    store.set(viewing());
    const registry = new NotificationRegistry(2);
    registry.set('oldest', makeEntry(1, 'general', 1));
    registry.set('newer', makeEntry(2, 'general', 2));

    const suppressed = store.shouldSuppress(7, 'general');
    expect(suppressed).toBe(true);
    if (!suppressed) registry.set('new', makeEntry(7, 'general', 3));

    expect(registry.size).toBe(2);
    expect(registry.has('oldest')).toBe(true);
    expect(registry.has('new')).toBe(false);
  });

  it('registers normally when the channel differs', () => {
    const store = new QChatViewContextStore();
    store.set(viewing());
    const registry = new NotificationRegistry(2);
    registry.set('a', makeEntry(7, 'general', 1));

    const suppressed = store.shouldSuppress(7, 'announcements');
    expect(suppressed).toBe(false);
    if (!suppressed) registry.set('b', makeEntry(7, 'announcements', 2));

    expect(registry.size).toBe(2);
    expect(registry.has('b')).toBe(true);
  });

  it('registers normally when no context has been published', () => {
    const store = new QChatViewContextStore();
    const registry = new NotificationRegistry();
    const suppressed = store.shouldSuppress(7, 'general');
    expect(suppressed).toBe(false);
    if (!suppressed) registry.set('a', makeEntry(7, 'general', 1));
    expect(registry.has('a')).toBe(true);
  });
});
