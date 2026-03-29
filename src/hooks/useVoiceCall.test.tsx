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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useVoiceCall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sets up inbound rtc before accepting and drains a queued offer afterwards', async () => {
    const order: string[] = [];
    const incomingStream = {
      getAudioTracks: () => [{ stop: vi.fn(), enabled: true }],
      getTracks: () => [{ stop: vi.fn(), enabled: true }],
    } as unknown as MediaStream;
    const mediaDeferred = deferred<MediaStream>();

    class MockRTCPeerConnection {
      remoteDescription: RTCSessionDescription | null = null;
      pendingRemoteDescription: RTCSessionDescription | null = null;
      connectionState: RTCPeerConnectionState = 'new';
      iceConnectionState: RTCIceConnectionState = 'new';
      iceGatheringState: RTCIceGatheringState = 'new';
      onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
      onicecandidateerror: ((event: RTCPeerConnectionIceErrorEvent) => void) | null = null;
      oniceconnectionstatechange: (() => void) | null = null;
      onicegatheringstatechange: (() => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

      constructor() {
        order.push('pc-created');
      }

      addTrack() {}

      async createAnswer() {
        order.push('answer-created');
        return { sdp: 'answer-sdp', type: 'answer' } as RTCSessionDescriptionInit;
      }

      async setLocalDescription(desc?: RTCLocalSessionDescriptionInit | null) {
        order.push(`local:${desc?.type ?? 'none'}`);
      }

      async setRemoteDescription(desc: RTCSessionDescriptionInit) {
        this.remoteDescription = desc as RTCSessionDescription;
        order.push(`remote:${desc.type}`);
      }

      async addIceCandidate() {
        order.push('ice-added');
      }

      close() {}
    }

    vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection as unknown as typeof RTCPeerConnection);
    vi.stubGlobal(
      'RTCSessionDescription',
      class MockRTCSessionDescription {
        type: RTCSdpType;
        sdp: string;

        constructor(init: RTCSessionDescriptionInit) {
          this.type = init.type ?? 'offer';
          this.sdp = init.sdp ?? '';
        }
      } as unknown as typeof RTCSessionDescription
    );

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => [] as MediaDeviceInfo[]),
        getUserMedia: vi.fn(async () => {
          order.push('getUserMedia');
          return mediaDeferred.promise;
        }),
      },
    });

    let eventHandler: ((event: string, payload: unknown) => void | Promise<void>) | null = null;
    const callApi = {
      onEvent: vi.fn((cb: (event: string, payload: unknown) => void | Promise<void>) => {
        eventHandler = cb;
        return vi.fn();
      }),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      accept: vi.fn(async () => {
        order.push('accept');
        return { success: true };
      }),
      reject: vi.fn(async () => ({ success: true })),
      sendSignal: vi.fn(async (_callId: string, type: string) => {
        order.push(`signal:${type}`);
        return { success: true };
      }),
      hangup: vi.fn(async () => ({ success: true })),
      initiate: vi.fn(async () => ({ success: true })),
      sendAudio: vi.fn(async () => ({ success: true })),
      whoami: vi.fn(async () => null),
      getPublicIpPeers: vi.fn(async () => []),
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

    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useVoiceCall(), { wrapper });

    await act(async () => {
      await eventHandler?.('call:incoming', {
        callId: 'call-1',
        fromAddress: 'Qpeer',
        chatId: 'chat-1',
      });
    });

    await act(async () => {
      const acceptPromise = result.current.acceptCall();
      await Promise.resolve();

      await eventHandler?.('call:signal', {
        callId: 'call-1',
        type: 'offer',
        data: 'offer-sdp',
      });

      expect(callApi.accept).not.toHaveBeenCalled();
      expect(callApi.sendSignal).not.toHaveBeenCalledWith(
        'call-1',
        'answer',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      mediaDeferred.resolve(incomingStream);
      await acceptPromise;
    });

    expect(order).toEqual([
      'getUserMedia',
      'pc-created',
      'accept',
      'remote:offer',
      'answer-created',
      'local:answer',
      'signal:answer',
    ]);
    expect(result.current.callState).toBe('connected');
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
});
