import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockedAddressesAtom,
  dmFriendsByAddressAtom,
  userInfoAtom,
} from '../atoms/global';
import { buildDirectVoiceCallChatId } from '../lib/call/directVoiceCallChatId';
import { useVoiceCall } from './useVoiceCall';

describe('useVoiceCall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prepares and resumes the audio context when initiating a direct call', async () => {
    const resume = vi.fn(async () => {});
    class MockAudioContext {
      state: AudioContextState = 'suspended';
      sampleRate = 48_000;
      baseLatency = 0;
      constructor(_: AudioContextOptions) {}
      resume = vi.fn(async () => {
        this.state = 'running';
        await resume();
      });
      close = vi.fn(async () => {
        this.state = 'closed';
      });
    }

    Object.assign(window as any, {
      AudioContext: MockAudioContext,
      call: {
        onEvent: vi.fn(() => vi.fn()),
        setLocalAddresses: vi.fn(async () => ({ success: true })),
        initiate: vi.fn(async () => ({ success: true })),
        hangup: vi.fn(async () => ({ success: true })),
      },
      groupCall: { onEvent: vi.fn(() => vi.fn()) },
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qpeer';
    const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useVoiceCall(), { wrapper });

    await act(async () => {
      await result.current.initiateCall(peerAddr, chatId, async () => ({
        signature: 'sig',
        publicKey: 'pub',
      }));
    });

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('starts in idle state', () => {
    Object.assign(window as any, {
      call: { onEvent: vi.fn(() => vi.fn()), setLocalAddresses: vi.fn() },
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => useVoiceCall(), { wrapper });
    expect(result.current.callState).toBe('idle');
    expect(result.current.audioMode).toBeNull();
  });

  it('auto-rejects direct call:incoming when caller is on blocked address list', async () => {
    let eventHandler: ((event: string, payload: unknown) => void | Promise<void>) | null = null;
    const callApi = {
      onEvent: vi.fn((cb: (event: string, payload: unknown) => void | Promise<void>) => {
        eventHandler = cb;
        return vi.fn();
      }),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      reject: vi.fn(async () => ({ success: true })),
    };

    Object.assign(window as any, {
      hub: {
        getBootstrapIceServers: () => [{ urls: 'stun:mock:3478' }],
        getIceServers: vi.fn(async () => [{ urls: 'stun:mock:3478' }]),
        reportStunCallOutcome: vi.fn(async () => ({})),
      },
      call: callApi,
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qblocked';
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, { [peerAddr]: true });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useVoiceCall(), { wrapper });

    await act(async () => {
      await eventHandler?.('call:incoming', {
        callId: 'call-blocked',
        fromAddress: peerAddr,
        chatId: buildDirectVoiceCallChatId(myAddr, peerAddr),
      });
    });

    expect(callApi.reject).toHaveBeenCalledWith(
      'call-blocked',
      'blocked',
      'sig',
      'pub',
      expect.any(Number)
    );
    expect(result.current.callState).toBe('idle');
    expect(result.current.incomingCall).toBeNull();
  });

  it('auto-rejects direct call:incoming when caller is not in persisted DM friends', async () => {
    let eventHandler: ((event: string, payload: unknown) => void | Promise<void>) | null = null;
    const callApi = {
      onEvent: vi.fn((cb: (event: string, payload: unknown) => void | Promise<void>) => {
        eventHandler = cb;
        return vi.fn();
      }),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      reject: vi.fn(async () => ({ success: true })),
    };

    Object.assign(window as any, {
      hub: {
        getBootstrapIceServers: () => [{ urls: 'stun:mock:3478' }],
        getIceServers: vi.fn(async () => [{ urls: 'stun:mock:3478' }]),
        reportStunCallOutcome: vi.fn(async () => ({})),
      },
      call: callApi,
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qstranger';
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, {});
    store.set(dmFriendsByAddressAtom, {});
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useVoiceCall(), { wrapper });

    await act(async () => {
      await eventHandler?.('call:incoming', {
        callId: 'call-nf',
        fromAddress: peerAddr,
        chatId: buildDirectVoiceCallChatId(myAddr, peerAddr),
      });
    });

    expect(callApi.reject).toHaveBeenCalledWith(
      'call-nf',
      'not_friend',
      'sig',
      'pub',
      expect.any(Number)
    );
    expect(result.current.callState).toBe('idle');
    expect(result.current.incomingCall).toBeNull();
  });

  it('allows direct call:incoming when caller is in persisted DM friends', async () => {
    let eventHandler: ((event: string, payload: unknown) => void | Promise<void>) | null = null;
    const callApi = {
      onEvent: vi.fn((cb: (event: string, payload: unknown) => void | Promise<void>) => {
        eventHandler = cb;
        return vi.fn();
      }),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      reject: vi.fn(async () => ({ success: true })),
    };

    Object.assign(window as any, {
      hub: {
        getBootstrapIceServers: () => [{ urls: 'stun:mock:3478' }],
        getIceServers: vi.fn(async () => [{ urls: 'stun:mock:3478' }]),
        reportStunCallOutcome: vi.fn(async () => ({})),
      },
      call: callApi,
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qbuddy';
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, {});
    store.set(dmFriendsByAddressAtom, {
      [peerAddr]: { publicKey: 'pk', addedAt: 1 },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useVoiceCall(), { wrapper });

    await act(async () => {
      await eventHandler?.('call:incoming', {
        callId: 'call-ok',
        fromAddress: peerAddr,
        chatId: buildDirectVoiceCallChatId(myAddr, peerAddr),
      });
    });

    expect(callApi.reject).not.toHaveBeenCalled();
    expect(result.current.callState).toBe('ringing');
    expect(result.current.incomingCall).toEqual({
      callId: 'call-ok',
      fromAddress: peerAddr,
      chatId: buildDirectVoiceCallChatId(myAddr, peerAddr),
    });
  });

  it('prepares and resumes the audio context when accepting a direct call', async () => {
    let eventHandler: ((event: string, payload: unknown) => void | Promise<void>) | null = null;
    const resume = vi.fn(async () => {});
    class MockAudioContext {
      state: AudioContextState = 'suspended';
      sampleRate = 48_000;
      baseLatency = 0;
      constructor(_: AudioContextOptions) {}
      resume = vi.fn(async () => {
        this.state = 'running';
        await resume();
      });
      close = vi.fn(async () => {
        this.state = 'closed';
      });
    }

    const callApi = {
      onEvent: vi.fn((cb: (event: string, payload: unknown) => void | Promise<void>) => {
        eventHandler = cb;
        return vi.fn();
      }),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      accept: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };

    Object.assign(window as any, {
      AudioContext: MockAudioContext,
      call: callApi,
      groupCall: {
        onEvent: vi.fn(() => vi.fn()),
        join: vi.fn(async () => ({ success: false, error: 'test-stop' })),
        setLocalAddresses: vi.fn(async () => {}),
      },
      sendMessage: vi.fn(async (type: string) => {
        if (type === 'signPresenceMessage') {
          return { signature: 'sig' };
        }
        return { signature: 'sig' };
      }),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qbuddy';
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, {});
    store.set(dmFriendsByAddressAtom, {
      [peerAddr]: { publicKey: 'pk', addedAt: 1 },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useVoiceCall(), { wrapper });

    await act(async () => {
      await eventHandler?.('call:incoming', {
        callId: 'call-ok',
        fromAddress: peerAddr,
        chatId: buildDirectVoiceCallChatId(myAddr, peerAddr),
      });
    });

    await act(async () => {
      await result.current.acceptCall();
    });

    expect(resume).toHaveBeenCalledTimes(1);
  });
});
