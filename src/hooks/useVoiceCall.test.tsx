import React from 'react';
import { Provider, createStore } from 'jotai';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockedAddressesAtom,
  callAudioDevicesAtom,
  dmFriendsByAddressAtom,
  infoSnackGlobalAtom,
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
    reticulumGetLocalDestinationHash: vi.fn(async () => ({
      destinationHash: 'a'.repeat(32),
    })),
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

  it('does not let an idle hook teardown stop another direct call', async () => {
    const sendCommand = vi.fn(async () => ({ ok: true }));
    Object.assign(window as any, {
      call: {
        onEvent: vi.fn(() => vi.fn()),
        setLocalAddresses: vi.fn(async () => ({ success: true })),
      },
      groupCall: { onEvent: vi.fn(() => vi.fn()) },
      audioSurface: {
        sendCommand,
        onEvent: vi.fn(() => vi.fn()),
      },
      electronAPI: electronApiWithGoodReadiness(),
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { unmount } = renderHook(() => useVoiceCall(), { wrapper });
    sendCommand.mockClear();

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      sendCommand.mock.calls.filter(([command]) =>
        String(command.type).startsWith('stop-direct-voice-')
      )
    ).toHaveLength(0);
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

  it('lets an endpoint-bound custom call API own signaling signatures', async () => {
    const callApi = {
      onEvent: vi.fn(() => vi.fn()),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      initiate: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };
    const rendererSigner = vi.fn(async () => {
      throw new Error('legacy renderer signing should not run');
    });
    Object.assign(window as any, {
      call: callApi,
      groupCall: { onEvent: vi.fn(() => vi.fn()) },
      sendMessage: vi.fn(async () => {
        throw new Error('legacy renderer signing should not run');
      }),
    });
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () =>
        useVoiceCall({
          callApi,
          callApiSignsSignals: true,
          skipSystemReadiness: true,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.initiateCall(
        'Qpeer',
        buildDirectVoiceCallChatId('Qme', 'Qpeer'),
        rendererSigner
      );
    });

    expect(rendererSigner).not.toHaveBeenCalled();
    expect((window as any).sendMessage).not.toHaveBeenCalled();
    expect(callApi.initiate).toHaveBeenCalledWith(
      'Qpeer',
      buildDirectVoiceCallChatId('Qme', 'Qpeer'),
      'Qme',
      '',
      'pub',
      expect.any(String),
      expect.any(Number),
      '',
      'pub',
      expect.any(Number)
    );
    expect(result.current.callState).toBe('calling');
  });

  it('explains an authenticated non-friend rejection to the caller', async () => {
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
      initiate: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };
    const peerAddress = `Q${'b'.repeat(33)}`;
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () =>
        useVoiceCall({
          callApi,
          callApiSignsSignals: true,
          createCallId: () => 'call-non-friend',
          skipSystemReadiness: true,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.initiateCall(
        peerAddress,
        buildDirectVoiceCallChatId('Qme', peerAddress),
        undefined,
        'Qortal Justin'
      );
      await eventHandler?.('call:rejected', {
        callId: 'call-non-friend',
        reason: 'not_friend',
      });
    });

    expect(store.get(infoSnackGlobalAtom)?.message).toBe(
      'Call declined — Qortal Justin does not have you as a friend.'
    );
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

  it('starts native WebRTC only after the peer advertises native-track support', async () => {
    let callEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    let groupCallEventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    let resolveJoin!: (value: {
      success: true;
      callSessionId: string;
      mediaSessionGeneration: number;
    }) => void;
    const join = vi.fn(
      () =>
        new Promise<{
          success: true;
          callSessionId: string;
          mediaSessionGeneration: number;
        }>((resolve) => {
          resolveJoin = resolve;
        })
    );
    const sendRtcSignal = vi.fn(
      async (_input: {
        roomId: string;
        callSessionId: string;
        signalType: string;
        payload: string;
      }) => ({
        success: true,
      })
    );
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
      sendRtcSignal,
    };
    const audioSurfaceSendCommand = vi.fn(async () => ({ ok: true }));
    Object.assign(window as any, {
      call: callApi,
      groupCall: {
        onEvent: vi.fn(
          (cb: (event: string, payload: unknown) => void | Promise<void>) => {
            groupCallEventHandler = cb;
            return vi.fn();
          }
        ),
        join,
        sendRtcSignal,
        setLocalAddresses: vi.fn(async () => {}),
        requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
      },
      audioSurface: {
        sendCommand: audioSurfaceSendCommand,
        onEvent: vi.fn(() => vi.fn()),
      },
      hub: {
        getIceServers: vi.fn(async () => []),
      },
      electronAPI: {
        ...electronApiWithGoodReadiness(),
        reticulumGetLocalIdentityPublicKeyBase64: vi.fn(async () => ({
          publicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
        })),
      },
      sendMessage: vi.fn(async () => ({
        signature: 'sig',
        publicKey: 'pub',
      })),
    });
    const store = createStore();
    store.set(userInfoAtom, { address: 'Qme', publicKey: 'pub' });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () =>
        useVoiceCall({
          callApi,
          callApiSignsSignals: true,
          enableDirectVoiceWebRtc: true,
          createCallId: () => 'native-capability-call',
          skipDirectFriendValidation: true,
          skipSystemReadiness: true,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.initiateCall(
        'Qpeer',
        buildDirectVoiceCallChatId('Qme', 'Qpeer'),
        async () => ({ signature: 'sig', publicKey: 'pub' })
      );
      await callEventHandler?.('call:accepted', {
        callId: 'native-capability-call',
      });
    });

    await waitFor(() => expect(join).toHaveBeenCalledTimes(1));
    const roomId = await buildDmVoiceRoomId(
      buildDirectVoiceCallChatId('Qme', 'Qpeer')
    );
    // The main process can receive verified link-channel signals after it has
    // created the room but before the renderer receives the join response.
    // Both signals must survive that narrow IPC window.
    await act(async () => {
      await groupCallEventHandler?.('gcall:rtc-signal', {
        verified: true,
        roomId,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
        fromAddress: 'Qpeer',
        toAddress: 'Qme',
        signalType: 'offer',
        payload: JSON.stringify({
          kind: 'description',
          generation: 'generation_1234',
          description: { type: 'offer', sdp: 'offer' },
        }),
      });
      await groupCallEventHandler?.('gcall:rtc-signal', {
        verified: true,
        roomId,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
        fromAddress: 'Qpeer',
        toAddress: 'Qme',
        signalType: 'capability',
        payload: JSON.stringify({
          kind: 'capability',
          audio: 'native-track',
          screen: 'video-track',
          screenVersion: 1,
          version: 1,
          capabilityId: 'peer-capability-id',
        }),
      });
    });
    expect(audioSurfaceSendCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'start-direct-voice-rtc' })
    );
    await act(async () => {
      resolveJoin({
        success: true,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
      });
    });

    await waitFor(() =>
      expect(sendRtcSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          signalType: 'capability',
          roomId: expect.stringMatching(/^dmv:/),
          callSessionId: 'dm-media-session',
          connectionId: 'dm-media-session:1:Qme:Qpeer',
          signalId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          ),
        })
      )
    );
    const advertisedCapability = sendRtcSignal.mock.calls.find(
      ([input]) => input.signalType === 'capability'
    )?.[0];
    expect(JSON.parse(advertisedCapability?.payload ?? '{}')).toMatchObject({
      audio: 'native-track',
      screen: 'video-track',
      screenVersion: 1,
    });
    await waitFor(() =>
      expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start-direct-voice-rtc',
          roomId: expect.any(String),
          peerAddress: 'Qpeer',
        })
      )
    );
    expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apply-direct-voice-rtc-signal',
        signal: expect.objectContaining({
          kind: 'description',
          generation: 'generation_1234',
        }),
      })
    );
    const rtcStartCommand = audioSurfaceSendCommand.mock.calls.find(
      ([command]) => command.type === 'start-direct-voice-rtc'
    )?.[0];
    const rtcSignalCommand = audioSurfaceSendCommand.mock.calls.find(
      ([command]) => command.type === 'apply-direct-voice-rtc-signal'
    )?.[0];
    expect(rtcStartCommand?.ownerId).toMatch(/^dvc:[A-Za-z0-9_-]{16}$/);
    expect(rtcSignalCommand?.ownerId).toBe(rtcStartCommand?.ownerId);
    expect(result.current.screenShareSupported).toBe(true);
    await waitFor(() =>
      expect(sendRtcSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          signalType: 'ack',
          roomId,
          callSessionId: 'dm-media-session',
          payload: expect.stringContaining('peer-capability-id'),
        })
      )
    );

    const localCapabilityId = JSON.parse(
      advertisedCapability?.payload ?? '{}'
    ).capabilityId;
    expect(localCapabilityId).toEqual(expect.any(String));
    await act(async () => {
      await groupCallEventHandler?.('gcall:rtc-signal', {
        verified: true,
        roomId,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
        fromAddress: 'Qpeer',
        toAddress: 'Qme',
        signalType: 'ack',
        payload: JSON.stringify({
          kind: 'capability-ack',
          generation: 'native_audio_v1',
          capabilityId: localCapabilityId,
        }),
      });
    });
    await act(async () => {
      await groupCallEventHandler?.('gcall:rtc-signal', {
        verified: true,
        roomId,
        callSessionId: 'dm-media-session',
        mediaSessionGeneration: 1,
        fromAddress: 'Qpeer',
        toAddress: 'Qme',
        signalType: 'reconnect',
        payload: JSON.stringify({
          kind: 'ice-refresh-request',
          generation: 'generation_1234',
        }),
      });
    });
    expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apply-direct-voice-rtc-signal',
        signal: {
          kind: 'ice-refresh-request',
          generation: 'generation_1234',
        },
      })
    );
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
      expect.any(Number),
      'sig'
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
      expect.any(Number),
      'sig'
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

  it('keeps an incoming call actionable when its rejection fails', async () => {
    let eventHandler:
      | ((event: string, payload: unknown) => void | Promise<void>)
      | null = null;
    let settleRejection!: (result: {
      success: boolean;
      error?: string;
    }) => void;
    const pendingRejection = new Promise<{
      success: boolean;
      error?: string;
    }>((resolve) => {
      settleRejection = resolve;
    });
    const callApi = {
      onEvent: vi.fn(
        (cb: (event: string, payload: unknown) => void | Promise<void>) => {
          eventHandler = cb;
          return vi.fn();
        }
      ),
      setLocalAddresses: vi.fn(async () => ({ success: true })),
      reject: vi.fn(() => pendingRejection),
    };

    Object.assign(window as any, {
      call: callApi,
      groupCall: { onEvent: vi.fn(() => vi.fn()) },
      sendMessage: vi.fn(async () => ({ signature: 'sig' })),
    });

    const myAddr = 'Qme';
    const peerAddr = 'Qbuddy';
    const chatId = buildDirectVoiceCallChatId(myAddr, peerAddr);
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
        callId: 'call-reject-fails',
        fromAddress: peerAddr,
        chatId,
      });
    });
    let rejectPromise!: Promise<void>;
    act(() => {
      rejectPromise = result.current.rejectCall();
    });

    await waitFor(() =>
      expect(callApi.reject).toHaveBeenCalledWith(
        'call-reject-fails',
        'rejected',
        'sig',
        'pub',
        expect.any(Number),
        'sig'
      )
    );
    expect(result.current.callState).toBe('ringing');
    expect(result.current.incomingCall?.callId).toBe('call-reject-fails');

    await act(async () => {
      settleRejection({
        success: false,
        error: 'Unknown QortalLand call',
      });
      await rejectPromise;
    });

    expect(result.current.callState).toBe('ringing');
    expect(result.current.incomingCall).toEqual({
      callId: 'call-reject-fails',
      fromAddress: peerAddr,
      chatId,
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
    });

    // acceptCall awaits a chain of readiness, room-id hashing, signing and
    // call.accept before reaching join, so poll for the effect rather than
    // asserting on a fixed tick budget.
    await waitFor(() => expect(join).toHaveBeenCalled());
    await waitFor(() =>
      expect(sendKeyRequest).toHaveBeenCalledWith(
        roomId,
        peerAddr,
        myAddr,
        'sig',
        'pub',
        expect.any(Number),
        'call-session',
        1
      )
    );

    expect(result.current.audioMode).toBe('reticulum');
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

    await waitFor(() =>
      expect(requestPeerMediaRecovery).toHaveBeenCalledWith(
        roomId,
        peerAddr,
        'dm-peer-joined'
      )
    );
  });

  it('does not hang up a connected call when teardown dependencies refresh', async () => {
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
      accept: vi.fn(async () => ({ success: true })),
      hangup: vi.fn(async () => ({ success: true })),
    };
    const join = vi.fn(async () => ({
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    }));
    const leave = vi.fn(async () => ({ success: true }));

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
        leave,
        setLocalAddresses: vi.fn(async () => {}),
        requestPeerMediaRecovery: vi.fn(async () => ({ success: true })),
        sendKeyRequest: vi.fn(async () => ({ success: true })),
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
    const store = createStore();
    store.set(userInfoAtom, { address: myAddr, publicKey: 'pub' });
    store.set(blockedAddressesAtom, {});
    store.set(dmFriendsByAddressAtom, {
      [peerAddr]: { publicKey: 'pk', addedAt: 1 },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result, rerender, unmount } = renderHook(() => useVoiceCall(), {
      wrapper,
    });

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

    await waitFor(() => expect(result.current.callState).toBe('connected'));
    callApi.hangup.mockClear();
    leave.mockClear();

    await act(async () => {
      store.set(userInfoAtom, { address: myAddr, publicKey: 'pub-rotated' });
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.callState).toBe('connected');
    expect(callApi.hangup).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();

    unmount();

    await waitFor(() =>
      expect(callApi.hangup).toHaveBeenCalledWith(
        'call-ok',
        'sig',
        'pub-rotated',
        expect.any(Number)
      )
    );
  });

  // Every step before a key goes out is async (joining the room, the audio
  // surface, the key itself): on a busy CI machine one can take longer than
  // waitFor's default second.
  const CALL_STEP_WAIT = { timeout: 5_000 };

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

    await waitFor(() => expect(sendKey).toHaveBeenCalled(), CALL_STEP_WAIT);
    await waitFor(
      () =>
        expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'start-direct-voice-media',
            roomId,
            peerAddress: peerAddr,
            localAddress: myAddr,
            roomKey: expect.any(ArrayBuffer),
          })
        ),
      CALL_STEP_WAIT
    );
    audioSurfaceSendCommand.mockClear();
    await act(async () => {
      store.set(callAudioDevicesAtom, {
        inputDeviceId: null,
        outputDeviceId: 'audio-surface-speaker-2',
      });
    });
    await waitFor(
      () =>
        expect(audioSurfaceSendCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'update-direct-voice-media',
            outputDeviceId: 'audio-surface-speaker-2',
          })
        ),
      CALL_STEP_WAIT
    );
    expect(store.get(callAudioDevicesAtom).outputDeviceId).toBe(
      'audio-surface-speaker-2'
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

    await waitFor(() => expect(sendKey).toHaveBeenCalled(), CALL_STEP_WAIT);
    expect(sendKey.mock.calls[0]?.[0]).toBe(roomId);
    expect(sendKey.mock.calls[0]?.[1]).toBe(peerAddr);
  }, 30_000);

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
