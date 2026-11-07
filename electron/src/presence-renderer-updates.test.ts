import { describe, expect, it } from 'vitest';
import { PresenceRendererUpdateDeduplicator } from './presence-renderer-updates';

describe('PresenceRendererUpdateDeduplicator', () => {
  it('forwards the first state for each address', () => {
    const deduplicator = new PresenceRendererUpdateDeduplicator();

    expect(
      deduplicator.shouldForward({
        address: 'Q-one',
        online: true,
        status: 'online',
      })
    ).toBe(true);
    expect(
      deduplicator.shouldForward({
        address: 'Q-two',
        online: true,
        status: 'idle',
      })
    ).toBe(true);
  });

  it('suppresses an unchanged renderer-visible state', () => {
    const deduplicator = new PresenceRendererUpdateDeduplicator();
    const update = {
      address: 'Q-one',
      online: true,
      status: 'busy' as const,
    };

    expect(deduplicator.shouldForward(update)).toBe(true);
    expect(deduplicator.shouldForward({ ...update })).toBe(false);
  });

  it('forwards online and status changes', () => {
    const deduplicator = new PresenceRendererUpdateDeduplicator();

    expect(
      deduplicator.shouldForward({
        address: 'Q-one',
        online: true,
        status: 'online',
      })
    ).toBe(true);
    expect(
      deduplicator.shouldForward({
        address: 'Q-one',
        online: true,
        status: 'idle',
      })
    ).toBe(true);
    expect(
      deduplicator.shouldForward({
        address: 'Q-one',
        online: false,
        status: null,
      })
    ).toBe(true);
  });

  it('forwards the current state again after a reset', () => {
    const deduplicator = new PresenceRendererUpdateDeduplicator();
    const update = {
      address: 'Q-one',
      online: true,
      status: 'online' as const,
    };

    expect(deduplicator.shouldForward(update)).toBe(true);
    expect(deduplicator.shouldForward(update)).toBe(false);

    deduplicator.reset();

    expect(deduplicator.shouldForward(update)).toBe(true);
  });

  it('passes malformed payloads through without poisoning valid state', () => {
    const deduplicator = new PresenceRendererUpdateDeduplicator();

    expect(deduplicator.shouldForward({ address: 'Q-one' })).toBe(true);
    expect(
      deduplicator.shouldForward({
        address: 'Q-one',
        online: true,
        status: 'online',
      })
    ).toBe(true);
  });
});
