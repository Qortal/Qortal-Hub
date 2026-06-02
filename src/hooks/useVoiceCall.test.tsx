import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockedAddressesAtom,
  dmFriendsByAddressAtom,
  userInfoAtom,
} from '../atoms/global';
import { buildDmVoiceRoomId } from '../lib/call/directVoiceReticulumMedia';
import { buildDirectVoiceCallChatId } from '../lib/call/directVoiceCallChatId';
import nacl from '../encryption/nacl-fast';
import { useVoiceCall } from './useVoiceCall';

function goodSystemReadiness() {
  return {
    status: 'good',
    reasons: [],
    cpuLoad: 0.1,
    memoryPressure: 'normal',
    eventLoopLagMs: 0,
  };
}

function electronApiWithGoodReadiness(extra: Record<string, unknown> = {}) {
  return {
    getSystemCallReadiness: vi.fn(async () => goodSystemReadiness()),
    refreshSystemCallReadiness: vi.fn(async () => goodSystemReadiness()),
    ...extra,
  };
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(0);
  for (const byte of bytes) {
    value = value * BigInt(256) + BigInt(byte);
  }
  let encoded = '';
  while (value > 0) {
    const mod = Number(value % BigInt(58));
    encoded = alphabet[mod] + encoded;
    value = value / BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = alphabet[0] + encoded;
  }
  return encoded || alphabet[0];
}

const mockAudioGain = () => ({
  gain: {
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    value: 0,
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const mockAudioOscillator = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  frequency: { setValueAtTime: vi.fn(), value: 0 },
  start: vi.fn(),
  stop: vi.fn(),
  type: 'sine',
});

describe('useVoiceCall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initiates a direct call and starts outgoing ringtone audio', async () => {
    const resume = vi.fn(async () => {});
    class MockAudioContext {
      state: AudioContextState = 'suspended';
      sampleRate = 48_000;
      baseLatency = 0;
      currentTime = 0;
      destination = {};
      constructor(_: AudioContextOptions) {}
      createGain = vi.fn(mockAudioGain);
      createOscillator = vi.fn(mockAudioOscillator);
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
      electronAPI: electronApiWithGoodReadiness(),
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

    expect((window as any).call.initiate).toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
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
    let eventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          eventHandler = cb;
          return vi.fn();
        }
      ),
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
    let eventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          eventHandler = cb;
          return vi.fn();
        }
      ),
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
    let eventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          eventHandler = cb;
          return vi.fn();
        }
      ),
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

  it('accepts a direct call without prewarming the main renderer audio context', async () => {
    let eventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    const resume = vi.fn(async () => {});
    class MockAudioContext {
      state: AudioContextState = 'suspended';
      sampleRate = 48_000;
      baseLatency = 0;
      currentTime = 0;
      destination = {};
      constructor(_: AudioContextOptions) {}
      createGain = vi.fn(mockAudioGain);
      createOscillator = vi.fn(mockAudioOscillator);
      resume = vi.fn(async () => {
        this.state = 'running';
        await resume();
      });
      close = vi.fn(async () => {
        this.state = 'closed';
      });
    }

    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          eventHandler = cb;
          return vi.fn();
        }
      ),
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
        leave: vi.fn(async () => ({ success: true })),
        setLocalAddresses: vi.fn(async () => {}),
      },
      electronAPI: electronApiWithGoodReadiness(),
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

    const roomId = await buildDmVoiceRoomId(
      buildDirectVoiceCallChatId(myAddr, peerAddr)
    );
    expect(callApi.accept).toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((window as any).groupCall.leave).toHaveBeenCalledWith(
        roomId,
        myAddr,
        'sig',
        'pub',
        expect.any(Number)
      )
    );
  });

  it('requests shared group-call media recovery warm-up for the DM peer on join and peer-joined', async () => {
    let callEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    let gcallEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;

    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          callEventHandler = cb;
          return vi.fn();
        }
      ),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      accept: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };
    const requestPeerMediaRecovery = vi.fn(async () => ({ success: true }));
    const sendKeyRequest = vi.fn(async () => ({ success: true }));
    const join = vi.fn(async () => ({
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    }));

    Object.assign(window as any, {
      AudioContext: class MockAudioContext {
        state: AudioContextState = 'running';
        sampleRate = 48_000;
        baseLatency = 0;
        currentTime = 0;
        destination = {};
        constructor(_: AudioContextOptions) {}
        createGain = vi.fn(mockAudioGain);
        createOscillator = vi.fn(mockAudioOscillator);
        resume = vi.fn(async () => {});
        close = vi.fn(async () => {
          this.state = 'closed';
        });
      },
      call: callApi,
      groupCall: {
        onEvent: vi.fn(
          (cb: (event: string, payload: unknown) => void | Promise<void>) => {
            gcallEventHandler = cb;
            return vi.fn();
          }
        ),
        join,
        setLocalAddresses: vi.fn(async () => {}),
        requestPeerMediaRecovery,
        sendKeyRequest,
      },
      electronAPI: {
        ...electronApiWithGoodReadiness(),
        reticulumGetLocalDestinationHash: vi.fn(async () => ({
          destinationHash: 'a'.repeat(32),
        })),
        reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
          publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
        })),
      },
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qbuddy';
    const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
    const roomId = await buildDmVoiceRoomId(chatId);
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
      await callEventHandler?.('call:incoming', {
        callId: 'call-ok',
        fromAddress: peerAddr,
        chatId,
      });
    });

    await act(async () => {
      await result.current.acceptCall();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(join).toHaveBeenCalled();
    expect(result.current.audioMode).toBe('reticulum');
    expect(sendKeyRequest).toHaveBeenCalledWith(
      roomId,
      peerAddr,
      myAddr,
      'sig',
      'pub',
      expect.any(Number),
      'call-session',
      1
    );
    expect(requestPeerMediaRecovery).toHaveBeenCalledWith(
      roomId,
      peerAddr,
      'dm-call-start'
    );

    await act(async () => {
      await gcallEventHandler?.('gcall:participant-joined', {
        roomId,
        address: peerAddr,
      });
    });

    expect(requestPeerMediaRecovery).toHaveBeenCalledWith(
      roomId,
      peerAddr,
      'dm-peer-joined'
    );
  });

  it('resends the DM room key when the outbound peer requests it', async () => {
    let callEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    let gcallEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;

    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          callEventHandler = cb;
          return vi.fn();
        }
      ),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      initiate: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };
    const join = vi.fn(async () => ({
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    }));
    const sendKey = vi.fn(async () => ({ success: true }));
    const audioSurfaceSendCommand = vi.fn(async () => ({ ok: true }));
    const peerPublicKey = base58Encode(nacl.sign.keyPair().publicKey);

    Object.assign(window as any, {
      AudioContext: class MockAudioContext {
        state: AudioContextState = 'running';
        sampleRate = 48_000;
        baseLatency = 0;
        currentTime = 0;
        constructor(_: AudioContextOptions) {}
        resume = vi.fn(async () => {});
        close = vi.fn(async () => {
          this.state = 'closed';
        });
        audioWorklet = { addModule: vi.fn(async () => {}) };
        createGain = vi.fn(() => ({
          gain: {
            cancelScheduledValues: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            setValueAtTime: vi.fn(),
            value: 0,
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }));
        createOscillator = vi.fn(mockAudioOscillator);
        createMediaStreamSource = vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        }));
        destination = {};
      },
      call: callApi,
      groupCall: {
        onEvent: vi.fn(
          (cb: (event: string, payload: unknown) => void | Promise<void>) => {
            gcallEventHandler = cb;
            return vi.fn();
          }
        ),
        join,
        setLocalAddresses: vi.fn(async () => {}),
        requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
        getRoomParticipants: vi.fn(async () => [
          { address: myAddr },
          { address: peerAddr },
        ]),
        getLinkStats: vi.fn(async () => ({
          success: true,
          stats: { establishedLinks: 1, participants: 2 },
        })),
        sendKey,
        sendAudio: vi.fn(async () => ({ success: true })),
      },
      audioSurface: {
        sendCommand: audioSurfaceSendCommand,
      },
      electronAPI: {
        ...electronApiWithGoodReadiness(),
        reticulumGetLocalDestinationHash: vi.fn(async () => ({
          destinationHash: 'b'.repeat(32),
        })),
        reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
          publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
        })),
      },
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qbuddy';
    const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
    const roomId = await buildDmVoiceRoomId(chatId);
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, {});
    store.set(dmFriendsByAddressAtom, {
      [peerAddr]: { publicKey: peerPublicKey, addedAt: 1 },
    });
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
    const callId = callApi.initiate.mock.calls[0]?.[5] as string;

    await act(async () => {
      await callEventHandler?.('call:accepted', { callId });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(sendKey).toHaveBeenCalled());
    await waitFor(() =>
      expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start-direct-voice-media',
          roomId,
          peerAddress: peerAddr,
          localAddress: myAddr,
          roomKey: expect.any(ArrayBuffer),
        })
      )
    );
    sendKey.mockClear();

    await act(async () => {
      await gcallEventHandler?.('gcall:key-request', {
        roomId,
        toAddress: myAddr,
        fromAddress: peerAddr,
        fromPublicKey: peerPublicKey,
        callSessionId: 'call-session',
        mediaSessionGeneration: 1,
        keyMessageVersion: 3,
        verified: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(sendKey).toHaveBeenCalled());
    expect(sendKey.mock.calls[0]?.[0]).toBe(roomId);
    expect(sendKey.mock.calls[0]?.[1]).toBe(peerAddr);
  });

  it('stops after audio-surface DM media start fails', async () => {
    let callEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;

    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          callEventHandler = cb;
          return vi.fn();
        }
      ),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      initiate: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };
    const join = vi.fn(async () => ({
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    }));
    const audioSurfaceSendCommand = vi.fn(
      async (command: { type?: string }) => {
        if (command.type === 'start-direct-voice-media') {
          return { ok: false, error: 'surface-start-failed' };
        }
        return { ok: true };
      }
    );
    const peerPublicKey = base58Encode(nacl.sign.keyPair().publicKey);

    Object.assign(window as any, {
      AudioContext: class MockAudioContext {
        state: AudioContextState = 'running';
        sampleRate = 48_000;
        baseLatency = 0;
        currentTime = 0;
        destination = {};
        constructor(_: AudioContextOptions) {}
        createGain = vi.fn(mockAudioGain);
        createOscillator = vi.fn(mockAudioOscillator);
        resume = vi.fn(async () => {});
        close = vi.fn(async () => {
          this.state = 'closed';
        });
      },
      call: callApi,
      groupCall: {
        onEvent: vi.fn(() => vi.fn()),
        join,
        setLocalAddresses: vi.fn(async () => {}),
        requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
        getRoomParticipants: vi.fn(async () => [
          { address: myAddr },
          { address: peerAddr },
        ]),
        getLinkStats: vi.fn(async () => ({
          success: true,
          stats: { establishedLinks: 1, participants: 2 },
        })),
        sendKey: vi.fn(async () => ({ success: true })),
        sendAudio: vi.fn(async () => ({ success: true })),
      },
      audioSurface: {
        sendCommand: audioSurfaceSendCommand,
      },
      electronAPI: {
        ...electronApiWithGoodReadiness(),
        reticulumGetLocalDestinationHash: vi.fn(async () => ({
          destinationHash: 'c'.repeat(32),
        })),
        reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
          publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
        })),
      },
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qbuddy';
    const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
    const roomId = await buildDmVoiceRoomId(chatId);
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, {});
    store.set(dmFriendsByAddressAtom, {
      [peerAddr]: { publicKey: peerPublicKey, addedAt: 1 },
    });
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
    const callId = callApi.initiate.mock.calls[0]?.[5] as string;

    await act(async () => {
      await callEventHandler?.('call:accepted', { callId });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() =>
      expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start-direct-voice-media',
          roomId,
          peerAddress: peerAddr,
          localAddress: myAddr,
        })
      )
    );
    expect(audioSurfaceSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start-direct-voice-receive',
      })
    );
  });
});
