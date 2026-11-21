import { describe, expect, it } from 'vitest';
import { shouldNotifyForReticulumDm } from './reticulumDmNotifications';

const MY_ADDRESS = 'Qmy-address';
const FRIEND_ADDRESS = 'Qfriend-address';
const NOW = 100_000;

const event = {
  eventId: 'event-1',
  eventType: 'message',
  senderAddress: FRIEND_ADDRESS,
  recipientAddress: MY_ADDRESS,
  timestamp: NOW,
};

const friends = {
  [FRIEND_ADDRESS]: {
    publicKey: 'friend-public-key',
    name: 'Alice',
    addedAt: 1,
  },
};

const shouldNotify = (overrides: Record<string, unknown> = {}) =>
  shouldNotifyForReticulumDm({
    event,
    friendsByAddress: friends,
    listeningSince: NOW,
    myAddress: MY_ADDRESS,
    hubIsBeingViewed: false,
    ...overrides,
  });

describe('Reticulum DM OS notifications', () => {
  it('notifies for a new incoming message from a friend while the Hub is not viewed', () => {
    expect(shouldNotify()).toBe(true);
  });

  it('does not notify while the Hub is being viewed', () => {
    expect(shouldNotify({ hubIsBeingViewed: true })).toBe(false);
  });

  it('does not notify for a sender outside the friends list', () => {
    expect(shouldNotify({ friendsByAddress: {} })).toBe(false);
  });

  it('does not notify for local messages or non-message events', () => {
    expect(
      shouldNotify({
        event: {
          ...event,
          senderAddress: MY_ADDRESS,
          recipientAddress: FRIEND_ADDRESS,
        },
      })
    ).toBe(false);
    expect(
      shouldNotify({ event: { ...event, eventType: 'reaction_add' } })
    ).toBe(false);
  });

  it('does not notify for history imported before this listener session', () => {
    expect(shouldNotify({ event: { ...event, timestamp: NOW - 60_001 } })).toBe(
      false
    );
  });

  it('does not notify for an event already read on another device', () => {
    expect(shouldNotify({ event: { ...event, readByOwner: true } })).toBe(
      false
    );
  });
});
