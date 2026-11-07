import { createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
import {
  effectivePresenceStatusAtomFamily,
  onlineAddressesAtom,
  onlineUserCountAtom,
  statusMapAtom,
  type UserStatus,
} from './presence';

const address = 'Q-test-presence-address';

describe('onlineUserCountAtom', () => {
  it('only notifies subscribers when the number of online users changes', () => {
    const store = createStore();
    const listener = vi.fn();
    const unsubscribe = store.sub(onlineUserCountAtom, listener);

    store.set(onlineAddressesAtom, new Set([address]));
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(onlineAddressesAtom, new Set(['Q-another-online-address']));
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(
      onlineAddressesAtom,
      new Set([address, 'Q-another-online-address'])
    );
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});

describe('effectivePresenceStatusAtomFamily', () => {
  it('uses the homepage online set as the authoritative liveness source', () => {
    const store = createStore();
    store.set(onlineAddressesAtom, new Set([address]));
    store.set(
      statusMapAtom,
      new Map<string, UserStatus>([[address, 'online']])
    );

    expect(store.get(effectivePresenceStatusAtomFamily(address))).toBe(
      'online'
    );
  });

  it('defaults a live peer to online until a detailed status is available', () => {
    const store = createStore();
    store.set(onlineAddressesAtom, new Set([address]));

    expect(store.get(effectivePresenceStatusAtomFamily(address))).toBe(
      'online'
    );
  });

  it('preserves busy and idle refinements for a live peer', () => {
    const store = createStore();
    store.set(onlineAddressesAtom, new Set([address]));
    store.set(statusMapAtom, new Map<string, UserStatus>([[address, 'busy']]));
    expect(store.get(effectivePresenceStatusAtomFamily(address))).toBe('busy');

    store.set(statusMapAtom, new Map<string, UserStatus>([[address, 'idle']]));
    expect(store.get(effectivePresenceStatusAtomFamily(address))).toBe('idle');
  });

  it('does not show a stale detailed status after the peer leaves the online set', () => {
    const store = createStore();
    store.set(
      statusMapAtom,
      new Map<string, UserStatus>([[address, 'online']])
    );

    expect(store.get(effectivePresenceStatusAtomFamily(address))).toBeNull();
  });
});
