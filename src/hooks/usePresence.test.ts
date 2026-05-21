import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extStateAtom, userInfoAtom } from '../atoms/global';
import { buildPresenceSnapshot } from './usePresence';
import { usePresence } from './usePresence';

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
    let onlineRemoteHubInterfaces = 0;

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
      },
      presence: {
        announce,
        heartbeat,
        offline,
        getStatus: vi.fn(async () => ({ online: false, lastSeen: null, sessions: [] })),
        getOnlineAddresses: vi.fn(async () => []),
        getAllOnline: vi.fn(async () => []),
        onUpdateBatch: vi.fn(() => vi.fn()),
        onCleared: vi.fn(() => vi.fn()),
        onStarted: vi.fn((cb: () => void) => {
          startedHandler = cb;
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

    await act(async () => {
      vi.advanceTimersByTime(25_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmount();
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
  });
});
