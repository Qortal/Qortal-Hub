import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extStateAtom, userInfoAtom } from '../atoms/global';
import { appLockedAtom, isIdleAtom, myStatusAtom } from '../atoms/presence';
import {
  applyOnlineAddressPresenceUpdates,
  applyStatusPresenceUpdates,
  buildPresenceSnapshot,
  usePresence,
} from './usePresence';

describe('presence state updates', () => {
  it('preserves collection identity for unchanged heartbeats', () => {
    const onlineAddresses = new Set(['Q123']);
    const statuses = new Map([['Q123', 'online'] as const]);
    const updates = [
      { address: 'Q123', online: true, status: 'online' as const },
    ];

    expect(applyOnlineAddressPresenceUpdates(onlineAddresses, updates)).toBe(
      onlineAddresses
    );
    expect(applyStatusPresenceUpdates(statuses, updates)).toBe(statuses);
  });

  it('publishes new collections for real membership and status changes', () => {
    const onlineAddresses = new Set(['Q123']);
    const statuses = new Map([['Q123', 'online'] as const]);

    const nextOnlineAddresses = applyOnlineAddressPresenceUpdates(
      onlineAddresses,
      [{ address: 'Q456', online: true, status: 'busy' }]
    );
    const nextStatuses = applyStatusPresenceUpdates(statuses, [
      { address: 'Q123', online: true, status: 'idle' },
      { address: 'Q456', online: true, status: 'busy' },
    ]);

    expect(nextOnlineAddresses).not.toBe(onlineAddresses);
    expect(nextOnlineAddresses).toEqual(new Set(['Q123', 'Q456']));
    expect(nextStatuses).not.toBe(statuses);
    expect(nextStatuses).toEqual(
      new Map([
        ['Q123', 'idle'],
        ['Q456', 'busy'],
      ])
    );
  });

  it('does not publish membership when only a status changes', () => {
    const onlineAddresses = new Set(['Q123']);
    const statuses = new Map([['Q123', 'online'] as const]);
    const updates = [
      { address: 'Q123', online: true, status: 'busy' as const },
    ];

    expect(applyOnlineAddressPresenceUpdates(onlineAddresses, updates)).toBe(
      onlineAddresses
    );
    expect(applyStatusPresenceUpdates(statuses, updates)).toEqual(
      new Map([['Q123', 'busy']])
    );
  });

  it('removes offline addresses and statuses', () => {
    const onlineAddresses = new Set(['Q123']);
    const statuses = new Map([['Q123', 'online'] as const]);
    const updates = [{ address: 'Q123', online: false, status: null }];

    expect(applyOnlineAddressPresenceUpdates(onlineAddresses, updates)).toEqual(
      new Set()
    );
    expect(applyStatusPresenceUpdates(statuses, updates)).toEqual(new Map());
  });
});

describe('usePresence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the newest session status when an address has multiple live sessions', () => {
    const snapshot = buildPresenceSnapshot([
      {
        address: 'Q123',
        publicKey: 'pub-1',
        sessionId: 'session-busy',
        lastSeen: 1_000,
        firstSeen: 900,
        originNodeId: 'node-a',
        viaPeerId: 'node-a',
        status: 'busy',
        signatureValid: true,
      },
      {
        address: 'Q123',
        publicKey: 'pub-2',
        sessionId: 'session-online',
        lastSeen: 2_000,
        firstSeen: 1_900,
        originNodeId: 'node-b',
        viaPeerId: 'node-b',
        status: 'online',
        signatureValid: true,
      },
      {
        address: 'Q456',
        publicKey: 'pub-3',
        sessionId: 'session-idle',
        lastSeen: 1_500,
        firstSeen: 1_400,
        originNodeId: 'node-c',
        viaPeerId: 'node-c',
        status: 'idle',
        signatureValid: true,
      },
    ]);

    expect(snapshot.onlineAddresses).toEqual(new Set(['Q123', 'Q456']));
    expect(snapshot.statusMap).toEqual(
      new Map([
        ['Q123', 'online'],
        ['Q456', 'idle'],
      ])
    );
  });

  it('waits for 2 remote hubs before announcing after transport start and only bootstraps once', async () => {
    vi.useFakeTimers();

    let startedHandler: (() => void) | undefined;
    const announce = vi.fn(async () => ({ success: true }));
    const heartbeat = vi.fn(async () => ({ success: true }));
    const offline = vi.fn(async () => ({ success: true }));
    const startHeartbeatScheduler = vi.fn(async () => ({ success: true }));
    let onlineRemoteHubInterfaces = 0;
    let heartbeatRequestedHandler: (() => void) | undefined;

    Object.assign(window as any, {
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
      appStorage: {
        get: vi.fn(async () => null),
        set: vi.fn(),
        delete: vi.fn(),
      },
      electronAPI: {
        reticulumGetStatus: vi.fn(async () => ({
          onlineRemoteHubInterfaces,
        })),
        reticulumGetLocalDestinationHash: vi.fn(async () => ({
          destinationHash: 'a'.repeat(32),
        })),
      },
      presence: {
        announce,
        heartbeat,
        offline,
        startHeartbeatScheduler,
        getStatus: vi.fn(async () => ({
          online: false,
          lastSeen: null,
          sessions: [],
        })),
        getOnlineAddresses: vi.fn(async () => []),
        getAllOnline: vi.fn(async () => []),
        onUpdateBatch: vi.fn(() => vi.fn()),
        onCleared: vi.fn(() => vi.fn()),
        onStarted: vi.fn((cb: () => void) => {
          startedHandler = cb;
          return vi.fn();
        }),
        onHeartbeatRequested: vi.fn((cb: () => void) => {
          heartbeatRequestedHandler = cb;
          return vi.fn();
        }),
      },
    });

    const store = createStore();
    store.set(extStateAtom, 'authenticated');
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(Provider, { store }, children);

    const { unmount } = renderHook(() => usePresence(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(announce).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(typeof startedHandler).toBe('function');

    await act(async () => {
      startedHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(announce).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();

    onlineRemoteHubInterfaces = 2;

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect((announce.mock.lastCall?.[0] as any)?.id).toMatch(
      /^[A-Za-z0-9_-]{16}$/
    );
    expect((announce.mock.lastCall?.[0] as any)?.payload?.sessionId).toMatch(
      /^P[A-Za-z0-9_-]{35}$/
    );
    expect(startHeartbeatScheduler).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();

    await act(async () => {
      heartbeatRequestedHandler?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      store.set(appLockedAtom, true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.get(isIdleAtom)).toBe(true);
    expect((heartbeat.mock.lastCall?.[0] as any)?.payload?.status).toBe('idle');

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(store.get(isIdleAtom)).toBe(true);

    await act(async () => {
      store.set(appLockedAtom, false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.get(isIdleAtom)).toBe(false);
    expect((heartbeat.mock.lastCall?.[0] as any)?.payload?.status).toBe(
      'online'
    );

    await act(async () => {
      store.set(myStatusAtom, 'offline');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(offline).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(offline).toHaveBeenCalledTimes(2);

    await act(async () => {
      store.set(myStatusAtom, 'online');
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(70_000);
      await Promise.resolve();
    });

    expect(offline).toHaveBeenCalledTimes(2);

    await act(async () => {
      unmount();
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
  });
});
