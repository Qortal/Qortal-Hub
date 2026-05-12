/**
 * useVoiceCall — direct (1:1) voice over Reticulum only.
 *
 * Signaling (CALL_REQUEST / ACCEPT / REJECT / HANGUP) uses window.call IPC → Reticulum.
 * Media uses the same path as group calls: GC_JOIN → GC_KEY → encrypted packets →
 * window.groupCall.sendAudio → Reticulum (no WebRTC, no legacy CALL_AUDIO relay).
 * Inbound: decode → `gcall-jitter-scheduler` drain → Opus decode → `group-playout-processor`
 * (same as useGroupVoiceCall), not ad-hoc BufferSource playback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  blockedAddressesAtom,
  callAudioDevicesAtom,
  dmFriendsByAddressAtom,
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  userInfoAtom,
} from '../atoms/global';
import { isDirectVoiceCallChatId } from '../lib/call/directVoiceCallChatId';
import {
  buildDmVoiceRoomId,
  fetchLocalReticulumDestinationHash,
  fetchLocalReticulumIdentityPublicKeyBase64,
  GCALL_KEY_MESSAGE_VERSION,
  joinDirectVoiceReticulumRoom,
  leaveDirectVoiceReticulumRoom,
  sendDirectVoiceRoomKey,
  sendDirectVoiceRoomKeyRequest,
  isDmVoiceRoomId,
} from '../lib/call/directVoiceReticulumMedia';
import {
  clearDirectVoiceUiLogs,
  pushDirectVoiceUiLog,
} from '../lib/call/directVoiceUiLog';
import i18n from '../i18n/i18n';
import {
  applyCallAudioOutput,
  getUserAudioStreamForCall,
} from '../lib/call/audioDevices';
import {
  type DecodedAudioPacket,
  decodeAudioPackets,
  encodeAudioPacketV2,
} from '../lib/group-call/audioPacketCodec';
import {
  getGroupCallAudioTuning,
  readGroupCallAudioProfile,
} from '../lib/group-call/groupCallAudioProfile';
import {
  createDmPeerRecoveryState,
  dmMarkPeerStable,
  dmMarkPeerUnstable,
  dmRecomputeAdaptiveNetworkMode,
} from '../lib/group-call/gcallDmPeerRecovery';
import {
  createInitialReticulumAudioTotals,
  ingestDmReticulumSendResultIntoMetrics,
  type GcReticulumAudioSendResult,
  type LastReticulumAudioTotals,
} from '../lib/group-call/gcallDmReticulumSendDiagnostics';
import { buildMediaKeyCommitmentHex } from '../lib/group-call/mediaKeyCommitment';
import {
  buildOpusSendPressureTiers,
  createOpusSendPressureControllerState,
  isReticulumSendPressureSignal,
  OPUS_SEND_PRESSURE_TICK_MS,
  tickOpusSendPressureController,
} from '../lib/group-call/opusSendPressure';
import { GCALL_OPUS_SEND_PRESSURE_MIN_BITRATE } from '../lib/group-call/pendingDecryptLimits';
import { GroupCallPerformanceTracker } from '../lib/group-call/router';
import { GroupCallAudioReceiveEngine } from '../lib/group-call/groupCallAudioReceiveEngine';
import {
  OPUS_CHANNELS,
  OPUS_FRAME_DURATION_MS,
  OPUS_FRAME_SAMPLES,
  OPUS_SAMPLE_RATE,
} from '../lib/group-call/gcallVoiceAudioConstants';
import AudioDecryptWorker from '../workers/audio-decrypt.worker?worker';

const DM_MEDIA_RECOVERY_REQUEST_COOLDOWN_MS = 4_000;
const DM_ROOM_KEY_REPLAY_RETRY_MS = 750;
const DM_ROOM_KEY_REPLAY_MAX_ATTEMPTS = 6;
const DM_ROOM_KEY_REQUEST_RETRY_MS = 1_000;
const DM_ROOM_KEY_REQUEST_MAX_ATTEMPTS = 30;
const CALL_LOCAL_ADDRESS_REASSERT_MS = 2_500;

type DmDecryptWorkerDecoded = {
  sourceAddr: string;
  vad: boolean;
  seq: number;
  timestampMs: number;
  opusFrame: ArrayBuffer;
};

/** Payload from main `gcall:key` (DM voice callee path). */
type GcallKeyEventPayload = {
  roomId?: string;
  recipientAddress?: string;
  encryptedKey?: string;
  verified?: boolean;
  keyMessageVersion?: number;
  callSessionId?: string;
  mediaSessionGeneration?: number;
  keyCommitment?: string;
  fromAddress?: string;
};

type GcallKeyRequestEventPayload = {
  roomId?: string;
  toAddress?: string;
  fromAddress?: string;
  fromPublicKey?: string;
  callSessionId?: string;
  mediaSessionGeneration?: number;
  keyMessageVersion?: number;
  verified?: boolean;
};

/** Float32 PCM → Int16 for WebCodecs AudioData (matches group call). */
function float32ToInt16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i]! * 32767)));
  }
  return i16;
}

function uint8ToBase64Local(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';

/** Reticulum/group-call media only (legacy UI read `audioMode`). */
export type AudioMode = 'reticulum' | null;

export interface IncomingCall {
  callId: string;
  fromAddress: string;
  chatId: string;
}

export interface DirectVoiceCallStartupStatus {
  stage: 'idle' | 'calling' | 'starting-audio' | 'connected';
  headline: string;
  detail: string | null;
  tone: 'neutral' | 'info' | 'warning';
  showProgress: boolean;
  delayed: boolean;
}

export interface UseVoiceCallReturn {
  callState: CallState;
  audioMode: AudioMode;
  startupStatus: DirectVoiceCallStartupStatus;
  isMuted: boolean;
  hearCall: boolean;
  callDuration: number;
  incomingCall: IncomingCall | null;
  activeCallChatId: string | null;
  initiateCall: (
    targetAddress: string,
    chatId: string,
    sign: (fields: Record<string, unknown>) => Promise<{ signature: string; publicKey: string }>
  ) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  setHearCall: (hear: boolean) => void;
  toggleHearCall: () => void;
}

async function signPresenceFields(
  fields: Record<string, unknown>,
  publicKey: string
): Promise<{ signature: string; publicKey: string }> {
  try {
    const res = await (window as any).sendMessage('signPresenceMessage', fields, 10_000);
    return {
      signature: (res?.signature as string) ?? '',
      publicKey,
    };
  } catch {
    return { signature: '', publicKey };
  }
}

export function useVoiceCall(): UseVoiceCallReturn {
  const userInfo = useAtomValue(userInfoAtom);
  const blockedAddresses = useAtomValue(blockedAddressesAtom);
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);

  const [callState, setCallState] = useState<CallState>('idle');
  const [audioMode, setAudioMode] = useState<AudioMode>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hearCall, setHearCallState] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCallChatId, setActiveCallChatId] = useState<string | null>(null);
  const [callAudioWireNonce, setCallAudioWireNonce] = useState(0);
  const [startupClock, setStartupClock] = useState(0);

  const callAudioDevices = useAtomValue(callAudioDevicesAtom);
  const setCallAudioDevices = useSetAtom(callAudioDevicesAtom);
  const callAudioPrefsRef = useRef(callAudioDevices);
  callAudioPrefsRef.current = callAudioDevices;
  const setCallAudioDevicesRef = useRef(setCallAudioDevices);
  setCallAudioDevicesRef.current = setCallAudioDevices;

  const callIdRef = useRef<string | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const blockedAddressesRef = useRef(blockedAddresses);
  blockedAddressesRef.current = blockedAddresses;
  const dmFriendsByAddressRef = useRef(dmFriendsByAddress);
  dmFriendsByAddressRef.current = dmFriendsByAddress;

  const publicKeyRef = useRef(userInfo?.publicKey ?? '');
  useEffect(() => {
    publicKeyRef.current = userInfo?.publicKey ?? '';
  }, [userInfo?.publicKey]);

  const isOutboundCallRef = useRef(false);
  const registeredCallLocalAddressRef = useRef<string | null>(null);
  const dmRoomIdRef = useRef<string | null>(null);
  /** If `gcall:key` arrives before `dmRoomIdRef` is set (should be rare after room precompute). */
  const pendingDmVoiceGcallKeyRef = useRef<GcallKeyEventPayload | null>(null);
  const peerAddressRef = useRef<string | null>(null);
  const callSessionIdRef = useRef<string | null>(null);
  const mediaGenRef = useRef(1);
  const roomKeyRef = useRef<Uint8Array | null>(null);
  const audioSeqRef = useRef(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startupStageSinceRef = useRef(Date.now());

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const encoderRef = useRef<AudioEncoder | null>(null);
  const captureWorkletRef = useRef<AudioWorkletNode | null>(null);
  const keepAliveGainRef = useRef<GainNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dmReceiveEngineRef = useRef<GroupCallAudioReceiveEngine | null>(null);
  if (!dmReceiveEngineRef.current) {
    dmReceiveEngineRef.current = new GroupCallAudioReceiveEngine(() => {});
  }

  const metricsRef = useRef(new GroupCallPerformanceTracker());
  const lastReticulumAudioTotalsRef = useRef<LastReticulumAudioTotals>(
    createInitialReticulumAudioTotals()
  );
  const dmPeerRecoveryStateRef = useRef(createDmPeerRecoveryState());
  const opusSendPressureStateRef = useRef(createOpusSendPressureControllerState());
  const opusEncoderApplyBitrateRef = useRef<(bps: number) => void>(() => {});
  const opusEncoderLastConfiguredBitrateRef = useRef<number | null>(null);
  const lastGcallEscalationTickAtMsRef = useRef(0);

  const reticulumSessionActiveRef = useRef(false);
  /** Serialized so a late `leaveRoom` cannot run after the next `joinRoom` for the same `dmv:` room. */
  const reticulumTeardownChainRef = useRef<Promise<void>>(Promise.resolve());

  /** DM voice UI log: throttled gcall:audio + one-shot warnings */
  const dmVoiceAudioPacketCountRef = useRef(0);
  const dmVoiceLastAudioUiLogAtRef = useRef(0);
  const dmVoiceNoFromAddressLoggedRef = useRef(false);
  const dmVoicePeerMismatchLoggedRef = useRef(false);
  const dmVoiceFirstOutboundAudioLoggedRef = useRef(false);
  const isSpeakingRef = useRef(false);

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const hearCallRef = useRef(hearCall);
  hearCallRef.current = hearCall;

  const inputSwapSeededRef = useRef(false);
  const prevInputPrefRef = useRef<string | null | undefined>(undefined);

  const activeCallChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeCallChatIdRef.current = activeCallChatId;
  }, [activeCallChatId]);

  const handleIncomingAudioPacketRef = useRef<
    (data: ArrayBuffer, fromAddress: string) => void
  >(() => {});
  const pushDecodedDmAudioPacketsRef = useRef<
    (packets: DecodedAudioPacket[], fromAddress: string) => Promise<void>
  >(async () => {});
  /** Stable IPC subscriptions: avoid unsubscribe/resubscribe gaps when callbacks change. */
  const groupCallDmIpcHandlerRef = useRef<
    (event: string, payload: unknown) => Promise<void>
  >(async () => {});
  const callIpcHandlerRef = useRef<
    (event: string, payload: unknown) => Promise<void>
  >(async () => {});
  const applyDecryptedRoomKeyRef = useRef<
    (
      payload: {
        callSessionId: string;
        mediaSessionGeneration: number;
        keyCommitment: string;
        fromAddress: string;
      },
      decryptedKeyB64: string
    ) => Promise<void>
  >(async () => {});
  const startReticulumCaptureRef = useRef<() => Promise<void>>(async () => {});
  const decryptWorkerRef = useRef<Worker | null>(null);
  const decryptWorkerKeyVersionRef = useRef(0);
  const decryptWorkerAppliedKeyVersionRef = useRef(0);
  const lastWorkerRoomKeyRef = useRef<Uint8Array | null>(null);
  const decryptIdRef = useRef(0);
  const encryptIdRef = useRef(0);
  const pendingDecryptByIdRef = useRef(
    new Map<number, { fromAddress: string; keyVersion: number }>()
  );
  const pendingEncryptByIdRef = useRef(
    new Map<number, { roomId: string; peer: string; keyVersion: number }>()
  );
  const lastDmPeerMediaRecoveryRequestAtRef = useRef(0);
  const dmRoomKeyReplayTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );
  const dmRoomKeyRequestTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  const updateCallState = useCallback((nextState: CallState) => {
    callStateRef.current = nextState;
    setCallState(nextState);
  }, []);

  const updateIncomingCall = useCallback((nextIncomingCall: IncomingCall | null) => {
    incomingCallRef.current = nextIncomingCall;
    setIncomingCall(nextIncomingCall);
  }, []);

  const clearPendingWorkerJobs = useCallback(() => {
    pendingDecryptByIdRef.current.clear();
    pendingEncryptByIdRef.current.clear();
  }, []);

  const sendEncryptedDmAudioPacket = useCallback(
    (roomId: string, peer: string, packet: Uint8Array) => {
      const gc = (window as any).groupCall;
      if (!gc?.sendAudio) return;
      metricsRef.current.recordRelaySent();
      void gc
        .sendAudio(roomId, peer, packet)
        .then((res: GcReticulumAudioSendResult) => {
          ingestDmReticulumSendResultIntoMetrics(
            metricsRef.current,
            lastReticulumAudioTotalsRef,
            peer,
            res ?? {}
          );
        })
        .catch(() => {
          metricsRef.current.recordRelayIpcFailure(1);
        });
    },
    []
  );

  const syncDecryptWorkerRoomKey = useCallback(
    (roomKey: Uint8Array | null) => {
      if (!roomKey) {
        lastWorkerRoomKeyRef.current = null;
        clearPendingWorkerJobs();
        if (decryptWorkerRef.current) {
          const keyVersion = ++decryptWorkerKeyVersionRef.current;
          decryptWorkerAppliedKeyVersionRef.current = 0;
          decryptWorkerRef.current.postMessage({
            type: 'clearRoomKey',
            keyVersion,
          });
        }
        return;
      }
      const prev = lastWorkerRoomKeyRef.current;
      if (
        prev &&
        prev.length === roomKey.length &&
        prev.every((b, i) => b === roomKey[i])
      ) {
        return;
      }
      lastWorkerRoomKeyRef.current = new Uint8Array(roomKey);
      clearPendingWorkerJobs();
      if (!decryptWorkerRef.current) return;
      const keyVersion = ++decryptWorkerKeyVersionRef.current;
      decryptWorkerAppliedKeyVersionRef.current = 0;
      const roomKeyCopy = roomKey.slice().buffer;
      decryptWorkerRef.current.postMessage(
        { type: 'setRoomKey', roomKey: roomKeyCopy, keyVersion },
        [roomKeyCopy]
      );
    },
    [clearPendingWorkerJobs]
  );

  const resetDmVoiceMediaSession = useCallback(() => {
    metricsRef.current = new GroupCallPerformanceTracker();
    lastReticulumAudioTotalsRef.current = createInitialReticulumAudioTotals();
    dmPeerRecoveryStateRef.current = createDmPeerRecoveryState();
    opusSendPressureStateRef.current = createOpusSendPressureControllerState();
    opusEncoderLastConfiguredBitrateRef.current = null;
    lastGcallEscalationTickAtMsRef.current = 0;
    lastDmPeerMediaRecoveryRequestAtRef.current = 0;
  }, []);

  const requestDmPeerMediaWarmup = useCallback(
    (roomId: string, reason: string, opts?: { ignoreCooldown?: boolean }) => {
      const gc = (window as any).groupCall;
      const peer = peerAddressRef.current;
      if (
        !roomId ||
        !peer ||
        typeof gc?.requestPeerMediaRecovery !== 'function'
      ) {
        return;
      }
      const now = Date.now();
      if (
        !opts?.ignoreCooldown &&
        now - lastDmPeerMediaRecoveryRequestAtRef.current <
          DM_MEDIA_RECOVERY_REQUEST_COOLDOWN_MS
      ) {
        return;
      }
      lastDmPeerMediaRecoveryRequestAtRef.current = now;
      pushDirectVoiceUiLog('log', 'requestPeerMediaRecovery', {
        roomTrunc: roomId.slice(0, 24),
        peerTrunc: peer.slice(0, 8),
        reason,
      });
      void gc.requestPeerMediaRecovery(roomId, peer, reason).catch(() => {});
    },
    []
  );

  const clearDmRoomKeyReplayTimers = useCallback(() => {
    for (const timer of dmRoomKeyReplayTimersRef.current) {
      clearTimeout(timer);
    }
    dmRoomKeyReplayTimersRef.current.clear();
  }, []);

  const clearDmRoomKeyRequestTimers = useCallback(() => {
    for (const timer of dmRoomKeyRequestTimersRef.current) {
      clearTimeout(timer);
    }
    dmRoomKeyRequestTimersRef.current.clear();
  }, []);

  const sendCurrentDmRoomKey = useCallback(
    async (reason: string): Promise<boolean> => {
      if (!isOutboundCallRef.current || !reticulumSessionActiveRef.current) {
        return false;
      }
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      const roomKey = roomKeyRef.current;
      const callSessionId = callSessionIdRef.current;
      const myAddr = userInfo?.address;
      const myPk = userInfo?.publicKey ?? '';
      if (!roomId || !peer || !roomKey || !callSessionId || !myAddr) {
        return false;
      }
      const friendPk = dmFriendsByAddressRef.current[peer]?.publicKey ?? '';
      if (!friendPk) {
        pushDirectVoiceUiLog('warn', 'no friend publicKey for peer (cannot send GC_KEY)', {
          peerTrunc: peer.slice(0, 8),
          reason,
        });
        return false;
      }
      const ok = await sendDirectVoiceRoomKey({
        roomId,
        toAddress: peer,
        fromAddress: myAddr,
        fromPublicKey: myPk,
        roomKey,
        callSessionId,
        mediaSessionGeneration: mediaGenRef.current,
        recipientPublicKey: friendPk,
      });
      pushDirectVoiceUiLog(ok ? 'log' : 'warn', ok ? 'GC_KEY sent to peer' : 'GC_KEY send failed', {
        peerTrunc: peer.slice(0, 8),
        reason,
      });
      return ok;
    },
    [userInfo?.address, userInfo?.publicKey]
  );

  const scheduleDmRoomKeyReplays = useCallback(
    (reason: string) => {
      clearDmRoomKeyReplayTimers();
      for (let attempt = 1; attempt <= DM_ROOM_KEY_REPLAY_MAX_ATTEMPTS; attempt++) {
        const timer = setTimeout(() => {
          dmRoomKeyReplayTimersRef.current.delete(timer);
          void sendCurrentDmRoomKey(`${reason}:retry-${attempt}`).catch(() => {});
        }, attempt * DM_ROOM_KEY_REPLAY_RETRY_MS);
        dmRoomKeyReplayTimersRef.current.add(timer);
      }
    },
    [clearDmRoomKeyReplayTimers, sendCurrentDmRoomKey]
  );

  const sendCurrentDmRoomKeyRequest = useCallback(
    async (reason: string): Promise<boolean> => {
      if (isOutboundCallRef.current || !reticulumSessionActiveRef.current) {
        return false;
      }
      if (roomKeyRef.current) return true;
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      const callSessionId = callSessionIdRef.current;
      const myAddr = userInfo?.address;
      const myPk = userInfo?.publicKey ?? '';
      if (!roomId || !peer || !callSessionId || !myAddr || !myPk) {
        return false;
      }
      const ok = await sendDirectVoiceRoomKeyRequest({
        roomId,
        toAddress: peer,
        fromAddress: myAddr,
        fromPublicKey: myPk,
        callSessionId,
        mediaSessionGeneration: mediaGenRef.current,
      });
      pushDirectVoiceUiLog(
        ok ? 'log' : 'warn',
        ok ? 'GC_KEY_REQUEST sent to peer' : 'GC_KEY_REQUEST send failed',
        {
          peerTrunc: peer.slice(0, 8),
          reason,
        }
      );
      return ok;
    },
    [userInfo?.address, userInfo?.publicKey]
  );

  const scheduleDmRoomKeyRequests = useCallback(
    (reason: string) => {
      clearDmRoomKeyRequestTimers();
      void sendCurrentDmRoomKeyRequest(reason).catch(() => {});
      for (
        let attempt = 1;
        attempt <= DM_ROOM_KEY_REQUEST_MAX_ATTEMPTS;
        attempt++
      ) {
        const timer = setTimeout(() => {
          dmRoomKeyRequestTimersRef.current.delete(timer);
          if (roomKeyRef.current || callStateRef.current !== 'connected') return;
          void sendCurrentDmRoomKeyRequest(`${reason}:retry-${attempt}`).catch(
            () => {}
          );
        }, attempt * DM_ROOM_KEY_REQUEST_RETRY_MS);
        dmRoomKeyRequestTimersRef.current.add(timer);
      }
    },
    [clearDmRoomKeyRequestTimers, sendCurrentDmRoomKeyRequest]
  );

  const clearDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const stopCapturePipeline = useCallback(() => {
    try {
      micSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    micSourceRef.current = null;
    try {
      captureWorkletRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    captureWorkletRef.current = null;
    try {
      keepAliveGainRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    keepAliveGainRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    const enc = encoderRef.current;
    if (enc && enc.state !== 'closed') {
      try {
        enc.close();
      } catch {
        /* ignore */
      }
    }
    encoderRef.current = null;
    opusEncoderApplyBitrateRef.current = () => {};
    opusEncoderLastConfiguredBitrateRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const teardownReticulumMediaInner = useCallback(async () => {
    clearDmRoomKeyReplayTimers();
    clearDmRoomKeyRequestTimers();
    await dmReceiveEngineRef.current?.dispose();
    dmReceiveEngineRef.current = new GroupCallAudioReceiveEngine(() => {});
    stopCapturePipeline();

    const roomId = dmRoomIdRef.current;
    const addr = userInfo?.address;
    const pk = userInfo?.publicKey ?? '';
    const gc = (window as any).groupCall;
    if (roomId && typeof gc?.reportTransportHealth === 'function') {
      await gc.reportTransportHealth(roomId, []).catch(() => {});
    }
    if (roomId && addr && isDmVoiceRoomId(roomId)) {
      reticulumSessionActiveRef.current = false;
      await leaveDirectVoiceReticulumRoom({
        roomId,
        address: addr,
        publicKey: pk,
      }).catch(() => {});
    }

    dmRoomIdRef.current = null;
    pendingDmVoiceGcallKeyRef.current = null;
    peerAddressRef.current = null;
    callSessionIdRef.current = null;
    syncDecryptWorkerRoomKey(null);
    if (decryptWorkerRef.current) {
      try {
        decryptWorkerRef.current.terminate();
      } catch {
        /* ignore */
      }
      decryptWorkerRef.current = null;
    }
    decryptIdRef.current = 0;
    encryptIdRef.current = 0;
    decryptWorkerKeyVersionRef.current = 0;
    decryptWorkerAppliedKeyVersionRef.current = 0;
    clearPendingWorkerJobs();
    roomKeyRef.current = null;
    mediaGenRef.current = 1;
    audioSeqRef.current = 0;
    isSpeakingRef.current = false;
    resetDmVoiceMediaSession();
    setAudioMode(null);
  }, [
    clearPendingWorkerJobs,
    clearDmRoomKeyReplayTimers,
    clearDmRoomKeyRequestTimers,
    resetDmVoiceMediaSession,
    stopCapturePipeline,
    syncDecryptWorkerRoomKey,
    userInfo?.address,
    userInfo?.publicKey,
  ]);

  const enqueueTeardownReticulumMedia = useCallback(() => {
    reticulumTeardownChainRef.current = reticulumTeardownChainRef.current
      .then(() => teardownReticulumMediaInner())
      .catch(() => {});
    return reticulumTeardownChainRef.current;
  }, [teardownReticulumMediaInner]);

  const endCall = useCallback(
    (sendHangup = false) => {
      const id = callIdRef.current;
      clearDurationTimer();

      const applyLocalCallEnd = () => {
        callIdRef.current = null;
        isOutboundCallRef.current = false;
        activeCallChatIdRef.current = null;
        setActiveCallChatId(null);
        updateCallState('ended');
        setCallDuration(0);
        setIsMuted(false);
        setHearCallState(true);
        hearCallRef.current = true;
        updateIncomingCall(null);
        inputSwapSeededRef.current = false;
        prevInputPrefRef.current = undefined;
        setTimeout(() => updateCallState('idle'), 1_500);
      };

      /**
       * Send CALL_HANGUP before GC_LEAVE / DM room teardown. Starting teardown first races the
       * Reticulum bridge: main `call.ts` drops outbound envelopes when the bridge is not `ready`,
       * which is easier to hit after leaving a group call (bursty GC) then hanging up DM — the
       * peer may never receive hangup.
       */
      if (sendHangup && id) {
        const timestamp = Date.now();
        applyLocalCallEnd();
        void signPresenceFields(
          { type: 'CALL_HANGUP', callId: id, timestamp },
          publicKeyRef.current
        )
          .then(({ signature, publicKey }) =>
            (window as any).call?.hangup(id, signature, publicKey, timestamp)
          )
          .catch(() => {})
          .finally(() => {
            enqueueTeardownReticulumMedia();
          });
        return;
      }

      enqueueTeardownReticulumMedia();
      applyLocalCallEnd();
    },
    [clearDurationTimer, enqueueTeardownReticulumMedia, updateCallState, updateIncomingCall]
  );

  const prepareCallAudioContext = useCallback(async (): Promise<AudioContext | null> => {
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate: OPUS_SAMPLE_RATE });
      audioCtxRef.current = ctx;
    }

    const outApply = await applyCallAudioOutput(callAudioPrefsRef.current.outputDeviceId, {
      audioContext: ctx,
    });
    if (outApply.clearPersistedOutput) {
      setCallAudioDevices((prev) => ({ ...prev, outputDeviceId: null }));
    }

    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (e) {
        pushDirectVoiceUiLog('warn', 'AudioContext resume failed', {
          err: String(e),
          state: ctx.state,
        });
      }
      const stateAfterResume = ctx.state as AudioContextState;
      if (stateAfterResume !== 'running') {
        pushDirectVoiceUiLog('warn', 'AudioContext not running after resume', {
          state: stateAfterResume,
        });
      }
    }

    return ctx;
  }, [setCallAudioDevices]);

  const pushDecodedDmAudioPackets = useCallback(
    async (packets: DecodedAudioPacket[], fromAddress: string) => {
      const peer = peerAddressRef.current;
      const expectedSource = peer || fromAddress;
      const accepted = packets.filter(
        (packet) => packet.sourceAddr === expectedSource
      );
      if (accepted.length === 0) {
        dmReceiveEngineRef.current?.recordDecodeFailure();
        return;
      }
      await dmReceiveEngineRef.current?.handleDecodedPackets(accepted);
    },
    []
  );
  pushDecodedDmAudioPacketsRef.current = pushDecodedDmAudioPackets;

  const handleIncomingAudioPacketCb = useCallback(
    (data: ArrayBuffer, fromAddress: string) => {
      if (!roomKeyRef.current) return;
      const my = userInfo?.address ?? '';
      if (!fromAddress || fromAddress === my) {
        if (!fromAddress && !dmVoiceNoFromAddressLoggedRef.current) {
          dmVoiceNoFromAddressLoggedRef.current = true;
          pushDirectVoiceUiLog('warn', 'drop inbound audio: empty fromAddress');
        }
        return;
      }
      const peer = peerAddressRef.current;
      if (peer && fromAddress !== peer) {
        if (!dmVoicePeerMismatchLoggedRef.current) {
          dmVoicePeerMismatchLoggedRef.current = true;
          pushDirectVoiceUiLog('warn', 'drop inbound audio: fromAddress !== peer', {
            fromTrunc: fromAddress.slice(0, 8),
            peerTrunc: peer.slice(0, 8),
          });
        }
        return;
      }

      metricsRef.current.recordPacketReceived();
      dmReceiveEngineRef.current?.noteIncomingAudio();

      const workerReady =
        decryptWorkerAppliedKeyVersionRef.current ===
        decryptWorkerKeyVersionRef.current;
      if (decryptWorkerRef.current && workerReady) {
        const id = decryptIdRef.current++;
        pendingDecryptByIdRef.current.set(id, {
          fromAddress,
          keyVersion: decryptWorkerKeyVersionRef.current,
        });
        const workerBuffer = data.slice(0);
        decryptWorkerRef.current.postMessage(
          { type: 'decrypt', id, buffer: workerBuffer },
          [workerBuffer]
        );
        return;
      }

      const list = decodeAudioPackets(new Uint8Array(data), roomKeyRef.current);
      void pushDecodedDmAudioPacketsRef.current(list, fromAddress);
    },
    [userInfo?.address]
  );
  handleIncomingAudioPacketRef.current = handleIncomingAudioPacketCb;

  const setupDecryptWorker = useCallback(() => {
    if (decryptWorkerRef.current) return;
    lastWorkerRoomKeyRef.current = null;
    let worker: Worker;
    try {
      worker = new AudioDecryptWorker();
    } catch (e) {
      pushDirectVoiceUiLog('warn', 'AudioDecryptWorker unavailable; using inline audio crypto', {
        err: String(e),
      });
      return;
    }
    decryptWorkerRef.current = worker;
    decryptIdRef.current = 0;
    encryptIdRef.current = 0;

    worker.onmessage = (
      e: MessageEvent<{
        type: 'result' | 'encryptResult' | 'roomKeyApplied' | 'roomKeyCleared';
        id?: number;
        keyVersion?: number;
        decoded?: DmDecryptWorkerDecoded | null;
        decodedMulti?: DmDecryptWorkerDecoded[];
        packet?: ArrayBuffer | null;
        error?: string;
      }>
    ) => {
      if (e.data.type === 'roomKeyApplied') {
        decryptWorkerAppliedKeyVersionRef.current = Math.max(
          decryptWorkerAppliedKeyVersionRef.current,
          e.data.keyVersion ?? 0
        );
        return;
      }
      if (e.data.type === 'roomKeyCleared') {
        decryptWorkerAppliedKeyVersionRef.current = 0;
        return;
      }
      if (e.data.type === 'encryptResult') {
        const id = e.data.id;
        if (typeof id !== 'number') return;
        const pending = pendingEncryptByIdRef.current.get(id);
        pendingEncryptByIdRef.current.delete(id);
        if (!pending) return;
        if (pending.keyVersion !== decryptWorkerKeyVersionRef.current) return;
        if (!e.data.packet) {
          if (e.data.error === 'missing-room-key' && roomKeyRef.current) {
            syncDecryptWorkerRoomKey(roomKeyRef.current);
          }
          pushDirectVoiceUiLog('warn', 'encrypt worker returned empty packet', {
            err: e.data.error ?? 'unknown',
          });
          return;
        }
        if (!dmVoiceFirstOutboundAudioLoggedRef.current) {
          dmVoiceFirstOutboundAudioLoggedRef.current = true;
          pushDirectVoiceUiLog('log', 'first outbound audio packet', {
            roomTrunc: pending.roomId.slice(0, 24),
            peerTrunc: pending.peer.slice(0, 8),
            bytes: e.data.packet.byteLength,
          });
        }
        sendEncryptedDmAudioPacket(
          pending.roomId,
          pending.peer,
          new Uint8Array(e.data.packet)
        );
        return;
      }
      if (e.data.type !== 'result') return;
      const id = e.data.id;
      if (typeof id !== 'number') return;
      const pending = pendingDecryptByIdRef.current.get(id);
      pendingDecryptByIdRef.current.delete(id);
      if (!pending) return;
      if (pending.keyVersion !== decryptWorkerKeyVersionRef.current) return;
      const multi = e.data.decodedMulti;
      if (multi && multi.length > 0) {
        const decodedList: DecodedAudioPacket[] = multi
          .filter((item) => item.sourceAddr === pending.fromAddress)
          .map((item) => ({
            sourceAddr: item.sourceAddr,
            vad: item.vad,
            seq: item.seq,
            timestampMs: item.timestampMs,
            opusFrame: new Uint8Array(item.opusFrame),
        }));
        if (decodedList.length > 0) {
          void pushDecodedDmAudioPacketsRef.current(decodedList, pending.fromAddress);
        }
        return;
      }
      const decoded = e.data.decoded;
      if (!decoded || decoded.sourceAddr !== pending.fromAddress) return;
      void pushDecodedDmAudioPacketsRef.current(
        [
          {
            sourceAddr: decoded.sourceAddr,
            vad: decoded.vad,
            seq: decoded.seq,
            timestampMs: decoded.timestampMs,
            opusFrame: new Uint8Array(decoded.opusFrame),
          },
        ],
        pending.fromAddress
      );
    };

    worker.onerror = (err) => {
      console.error('[DM voice] AudioDecryptWorker error:', err);
    };
    syncDecryptWorkerRoomKey(roomKeyRef.current);
  }, [sendEncryptedDmAudioPacket, syncDecryptWorkerRoomKey]);

  /** Install room key from caller (callee) after decryptBoxWithMyKey. */
  const applyDecryptedRoomKey = useCallback(
    async (payload: {
      callSessionId: string;
      mediaSessionGeneration: number;
      keyCommitment: string;
      fromAddress: string;
    }, decryptedKeyB64: string) => {
      const raw = atob(decryptedKeyB64);
      const keyBytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) keyBytes[i] = raw.charCodeAt(i);
      if (keyBytes.length !== 32) {
        pushDirectVoiceUiLog('warn', 'room key wrong length after decrypt', {
          len: keyBytes.length,
        });
        return;
      }
      const expected = await buildMediaKeyCommitmentHex(
        keyBytes,
        payload.callSessionId,
        payload.mediaSessionGeneration >>> 0
      );
      if (expected !== payload.keyCommitment) {
        pushDirectVoiceUiLog('warn', 'room key commitment mismatch', {
          expectedTrunc: expected.slice(0, 12),
          gotTrunc: String(payload.keyCommitment).slice(0, 12),
        });
        return;
      }
      const peer = peerAddressRef.current;
      if (peer && payload.fromAddress !== peer) {
        pushDirectVoiceUiLog('warn', 'room key fromAddress !== peer', {
          fromTrunc: payload.fromAddress.slice(0, 8),
          peerTrunc: peer.slice(0, 8),
        });
        return;
      }

      resetDmVoiceMediaSession();
      roomKeyRef.current = keyBytes;
      callSessionIdRef.current = payload.callSessionId;
      mediaGenRef.current = payload.mediaSessionGeneration >>> 0;
      syncDecryptWorkerRoomKey(keyBytes);
      setAudioMode('reticulum');
      clearDmRoomKeyRequestTimers();
      setCallAudioWireNonce((n) => n + 1);
      pushDirectVoiceUiLog('log', 'room key applied', {
        sessionTrunc: String(payload.callSessionId).slice(0, 8),
        mediaGen: payload.mediaSessionGeneration ?? 1,
      });
    },
    [clearDmRoomKeyRequestTimers, resetDmVoiceMediaSession, syncDecryptWorkerRoomKey]
  );
  applyDecryptedRoomKeyRef.current = applyDecryptedRoomKey;

  const sendEncodedFrame = useCallback(
    (opusFrame: Uint8Array) => {
      const rk = roomKeyRef.current;
      const my = userInfo?.address;
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      const gc = (window as any).groupCall;
      if (!rk || !my || !roomId || !peer || !gc?.sendAudio) return;
      if (isMutedRef.current) return;

      const seq = (++audioSeqRef.current) & 0xffff;
      const ts = Date.now() & 0xffffffff;
      const workerReady =
        decryptWorkerAppliedKeyVersionRef.current ===
        decryptWorkerKeyVersionRef.current;
      if (decryptWorkerRef.current && workerReady) {
        const frameBuffer =
          opusFrame.byteOffset === 0 &&
          opusFrame.byteLength === opusFrame.buffer.byteLength
            ? opusFrame.buffer
            : opusFrame.slice().buffer;
        const id = encryptIdRef.current++;
        pendingEncryptByIdRef.current.set(id, {
          roomId,
          peer,
          keyVersion: decryptWorkerKeyVersionRef.current,
        });
        decryptWorkerRef.current.postMessage(
          {
            type: 'encrypt',
            id,
            sourceAddr: my,
            vad: isSpeakingRef.current,
            seq,
            timestampMs: ts,
            opusFrame: frameBuffer,
          },
          [frameBuffer]
        );
        return;
      }
      let packet: Uint8Array;
      try {
        packet = encodeAudioPacketV2(
          my,
          isSpeakingRef.current,
          seq,
          ts,
          opusFrame,
          rk
        );
      } catch (e) {
        pushDirectVoiceUiLog('warn', 'encodeAudioPacketV2 failed', { err: String(e) });
        return;
      }
      if (!dmVoiceFirstOutboundAudioLoggedRef.current) {
        dmVoiceFirstOutboundAudioLoggedRef.current = true;
        pushDirectVoiceUiLog('log', 'first outbound audio packet', {
          roomTrunc: roomId.slice(0, 24),
          peerTrunc: peer.slice(0, 8),
          bytes: packet.byteLength,
        });
      }
      sendEncryptedDmAudioPacket(roomId, peer, packet);
    },
    [sendEncryptedDmAudioPacket, userInfo?.address]
  );

  const startReticulumCapture = useCallback(async () => {
    if (!userInfo?.address || !roomKeyRef.current) return;
    if (encoderRef.current && encoderRef.current.state !== 'closed') return;

    const gum = await getUserAudioStreamForCall(callAudioPrefsRef.current.inputDeviceId);
    if (gum.clearedStaleInputDevice) {
      setCallAudioDevices((prev) => ({ ...prev, inputDeviceId: null }));
    }
    const stream = gum.stream;
    if (!stream) {
      console.error('[DM voice] getUserMedia failed');
      pushDirectVoiceUiLog('warn', 'getUserMedia returned no stream');
      return;
    }
    micStreamRef.current = stream;

    const ctx = await prepareCallAudioContext();
    if (!ctx || ctx.state === 'closed') {
      pushDirectVoiceUiLog('warn', 'AudioContext unavailable for capture');
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      return;
    }

    const encoder = new (window as any).AudioEncoder({
      output: (chunk: { copyTo: (b: Uint8Array) => void; byteLength: number }) => {
        const frame = new Uint8Array(chunk.byteLength);
        chunk.copyTo(frame);
        sendEncodedFrame(frame);
      },
      error: (e: unknown) => {
        console.error('[DM voice] AudioEncoder error:', e);
        pushDirectVoiceUiLog('warn', 'AudioEncoder error', { err: String(e) });
      },
    });
    const encTuning = getGroupCallAudioTuning(readGroupCallAudioProfile());
    const baseEncoderConfig = {
      codec: 'opus',
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
      bitrate: encTuning.opusBitrate,
    };
    const fecEncoderConfig = {
      ...baseEncoderConfig,
      opus: {
        application: 'voip',
        signal: 'voice',
        frameDuration: OPUS_FRAME_DURATION_MS * 1000,
        packetlossperc: encTuning.opusExpectedPacketLossPercent,
        useinbandfec: true,
        usedtx: false,
      },
    };
    let encoderConfig: Record<string, unknown> = baseEncoderConfig;
    try {
      const AudioEncoderCtor = (window as any).AudioEncoder;
      const supportResult = await AudioEncoderCtor?.isConfigSupported?.(fecEncoderConfig);
      if (supportResult?.supported) {
        encoderConfig =
          (supportResult.config as Record<string, unknown> | undefined) ??
          (fecEncoderConfig as Record<string, unknown>);
      } else {
        encoderConfig = baseEncoderConfig;
      }
    } catch {
      encoderConfig = baseEncoderConfig;
    }
    encoder.configure(encoderConfig as any);
    encoderRef.current = encoder;
    opusEncoderLastConfiguredBitrateRef.current = encTuning.opusBitrate;
    opusSendPressureStateRef.current = createOpusSendPressureControllerState();
    const fecOpusStatic =
      typeof encoderConfig.opus === 'object' && encoderConfig.opus !== null
        ? (encoderConfig.opus as Record<string, unknown>)
        : null;
    opusEncoderApplyBitrateRef.current = (bps: number) => {
      const enc = encoderRef.current;
      if (!enc || enc.state === 'closed') return;
      const base = {
        codec: 'opus',
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfChannels: OPUS_CHANNELS,
        bitrate: bps,
      };
      const next = fecOpusStatic ? { ...base, opus: fecOpusStatic } : base;
      try {
        enc.configure(next as any);
      } catch {
        /* ignore */
      }
    };

    await ctx.audioWorklet.addModule('/worklets/capture-processor.js');
    const captureNode = new AudioWorkletNode(ctx, 'capture-processor');
    captureWorkletRef.current = captureNode;

    const keepAlive = ctx.createGain();
    keepAlive.gain.value = 0.0001;
    keepAliveGainRef.current = keepAlive;

    captureNode.port.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { frame?: Float32Array; vad?: boolean };
      const frame = d?.frame;
      const enc = encoderRef.current;
      if (!frame || !enc || enc.state === 'closed') return;
      isSpeakingRef.current = d?.vad === true;
      const f32 = frame instanceof Float32Array ? frame : new Float32Array(frame);
      const i16 = float32ToInt16(f32);
      const audioData = new (window as any).AudioData({
        format: 's16',
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfFrames: OPUS_FRAME_SAMPLES,
        numberOfChannels: OPUS_CHANNELS,
        timestamp: performance.now() * 1000,
        data: i16,
      });
      try {
        enc.encode(audioData);
        audioData.close();
      } catch {
        audioData.close();
      }
    };

    const source = ctx.createMediaStreamSource(stream);
    micSourceRef.current = source;
    source.connect(captureNode);
    source.connect(keepAlive);
    keepAlive.connect(ctx.destination);
    captureNode.port.postMessage({ type: 'mute', muted: isMutedRef.current });

    await dmReceiveEngineRef.current?.configure({
      outputDeviceId: callAudioPrefsRef.current.outputDeviceId ?? null,
      hearCall: hearCallRef.current,
      profile: readGroupCallAudioProfile(),
    });
  }, [
    prepareCallAudioContext,
    sendEncodedFrame,
    userInfo?.address,
  ]);
  startReticulumCaptureRef.current = startReticulumCapture;

  /** Decrypt + apply room key (shared by live `gcall:key` and queued pending). */
  const handleDmVoiceGcallKeyPayload = useCallback(
    async (p: GcallKeyEventPayload) => {
      const myAddr = userInfo?.address;
      if (!myAddr) {
        pushDirectVoiceUiLog('warn', 'gcall:key ignored (no local address)');
        return;
      }
      if (p.recipientAddress !== myAddr) {
        pushDirectVoiceUiLog('warn', 'gcall:key ignored (recipient mismatch)', {
          expectedTrunc: myAddr.slice(0, 8),
          gotTrunc: String(p.recipientAddress ?? '').slice(0, 8),
        });
        return;
      }
      if (p.verified !== true || p.keyMessageVersion !== GCALL_KEY_MESSAGE_VERSION) {
        pushDirectVoiceUiLog('warn', 'gcall:key rejected (verify/version)', {
          verified: p.verified,
          ver: p.keyMessageVersion,
        });
        return;
      }
      if (!p.encryptedKey || !p.callSessionId || !p.keyCommitment) {
        pushDirectVoiceUiLog('warn', 'gcall:key missing fields', {
          hasEnc: !!p.encryptedKey,
          hasSession: !!p.callSessionId,
          hasCommit: !!p.keyCommitment,
        });
        return;
      }

      pushDirectVoiceUiLog('log', 'gcall:key decrypt…', {
        fromTrunc: (p.fromAddress ?? '').slice(0, 8),
        sessionTrunc: String(p.callSessionId).slice(0, 8),
      });

      const combined = atob(p.encryptedKey);
      const u8 = new Uint8Array(combined.length);
      for (let i = 0; i < combined.length; i++) u8[i] = combined.charCodeAt(i);
      const ephemeralPKb64 = uint8ToBase64Local(u8.slice(0, 32));
      const nonceb64 = uint8ToBase64Local(u8.slice(32, 56));
      const ciphertextb64 = uint8ToBase64Local(u8.slice(56));

      try {
        const result = await (window as any).sendMessage(
          'decryptBoxWithMyKey',
          {
            ephemeralPublicKey: ephemeralPKb64,
            nonce: nonceb64,
            ciphertext: ciphertextb64,
          },
          10_000
        );
        if (result?.decryptedKey) {
          await applyDecryptedRoomKeyRef.current(
            {
              callSessionId: p.callSessionId,
              mediaSessionGeneration: p.mediaSessionGeneration ?? 1,
              keyCommitment: p.keyCommitment,
              fromAddress: p.fromAddress ?? '',
            },
            result.decryptedKey as string
          );
          if (callStateRef.current === 'connected' && roomKeyRef.current) {
            pushDirectVoiceUiLog('log', 'starting capture after key');
            await startReticulumCaptureRef.current();
          }
        } else {
          pushDirectVoiceUiLog('warn', 'decryptBoxWithMyKey returned no decryptedKey');
        }
      } catch (e) {
        console.error('[DM voice] key decrypt failed', e);
        pushDirectVoiceUiLog('warn', 'decryptBoxWithMyKey failed', { err: String(e) });
      }
    },
    [userInfo?.address]
  );

  const flushPendingDmVoiceGcallKey = useCallback(
    (roomId: string) => {
      const pending = pendingDmVoiceGcallKeyRef.current;
      if (!pending) return;
      if (pending.roomId !== roomId) {
        pushDirectVoiceUiLog('warn', 'discarding pending gcall:key (roomId != session)', {
          pendingTrunc: String(pending.roomId ?? '').slice(0, 24),
          sessionTrunc: roomId.slice(0, 24),
        });
        pendingDmVoiceGcallKeyRef.current = null;
        return;
      }
      pendingDmVoiceGcallKeyRef.current = null;
      pushDirectVoiceUiLog('log', 'gcall:key applying queued pending');
      void handleDmVoiceGcallKeyPayload(pending);
    },
    [handleDmVoiceGcallKeyPayload]
  );

  /** After CALL_ACCEPT / call:accepted: join GC room, exchange key, start capture. */
  const startReticulumMediaSession = useCallback(async () => {
    await reticulumTeardownChainRef.current.catch(() => {});
    clearDirectVoiceUiLogs();
    dmVoiceAudioPacketCountRef.current = 0;
    dmVoiceLastAudioUiLogAtRef.current = 0;
    dmVoiceNoFromAddressLoggedRef.current = false;
    dmVoicePeerMismatchLoggedRef.current = false;
    dmVoiceFirstOutboundAudioLoggedRef.current = false;

    const chatId = activeCallChatIdRef.current;
    const myAddr = userInfo?.address;
    const myPk = userInfo?.publicKey ?? '';
    const peer = peerAddressRef.current;
    if (!chatId || !myAddr || !peer || !isDirectVoiceCallChatId(chatId)) {
      pushDirectVoiceUiLog('warn', 'startReticulumMediaSession aborted: bad inputs', {
        hasChat: !!chatId,
        hasAddr: !!myAddr,
        hasPeer: !!peer,
      });
      endCall(false);
      return;
    }

    const roomId = await buildDmVoiceRoomId(chatId);
    if (dmRoomIdRef.current && dmRoomIdRef.current !== roomId) {
      pushDirectVoiceUiLog('warn', 'DM room id mismatch (precomputed vs build)', {
        preTrunc: dmRoomIdRef.current.slice(0, 24),
        builtTrunc: roomId.slice(0, 24),
      });
    }
    dmRoomIdRef.current = roomId;
    flushPendingDmVoiceGcallKey(roomId);

    pushDirectVoiceUiLog('log', 'media session start', {
      outbound: isOutboundCallRef.current,
      roomTrunc: roomId.slice(0, 32),
      peerTrunc: peer.slice(0, 8),
    });

    const retHash = await fetchLocalReticulumDestinationHash();
    if (!retHash) {
      pushDirectVoiceUiLog('warn', 'Reticulum destination hash unavailable');
      setInfoSnackGlobal({
        type: 'info',
        message: i18n.t('core:voice_call.failed') ?? 'Voice call failed (Reticulum not ready)',
      });
      setOpenSnackGlobal(true);
      endCall(true);
      return;
    }
    pushDirectVoiceUiLog('log', 'Reticulum hash ok', { hashTrunc: retHash.slice(0, 8) });

    const reticulumIdentityPublicKeyBase64 =
      await fetchLocalReticulumIdentityPublicKeyBase64();
    if (reticulumIdentityPublicKeyBase64) {
      pushDirectVoiceUiLog('log', 'Reticulum identity key ok');
    } else {
      pushDirectVoiceUiLog('log', 'Reticulum identity key unavailable; using join-only GC_JOIN');
    }

    const joinRes = await joinDirectVoiceReticulumRoom({
      roomId,
      chatId,
      address: myAddr,
      publicKey: myPk,
      reticulumDestinationHash: retHash,
      reticulumIdentityPublicKeyBase64,
    });

    if (!joinRes.success || !joinRes.callSessionId) {
      pushDirectVoiceUiLog('warn', 'GC_JOIN failed', {
        error: joinRes.error ?? 'unknown',
        success: joinRes.success,
      });
      setInfoSnackGlobal({
        type: 'info',
        message: i18n.t('core:voice_call.failed') ?? 'Voice call failed (could not join media room)',
      });
      setOpenSnackGlobal(true);
      endCall(true);
      return;
    }

    pushDirectVoiceUiLog('log', 'GC_JOIN ok', {
      sessionTrunc: joinRes.callSessionId.slice(0, 8),
      mediaGen: joinRes.mediaSessionGeneration ?? 1,
    });

    callSessionIdRef.current = joinRes.callSessionId;
    mediaGenRef.current = (joinRes.mediaSessionGeneration ?? 1) >>> 0;
    reticulumSessionActiveRef.current = true;
    setAudioMode('reticulum');
    requestDmPeerMediaWarmup(roomId, 'dm-call-start', {
      ignoreCooldown: true,
    });
    setupDecryptWorker();

    if (isOutboundCallRef.current) {
      const roomKey = new Uint8Array(32);
      crypto.getRandomValues(roomKey);
      roomKeyRef.current = roomKey;
      syncDecryptWorkerRoomKey(roomKey);

      const ok = await sendCurrentDmRoomKey('dm-call-start');
      if (!ok) {
        pushDirectVoiceUiLog('warn', 'sendDirectVoiceRoomKey failed');
        endCall(true);
        return;
      }
      scheduleDmRoomKeyReplays('dm-call-start');
      await startReticulumCapture();
    } else {
      /* Callee: request the room key until caller/link timing delivers it. */
      pushDirectVoiceUiLog('log', 'callee: requesting gcall:key (or capture if key ready)');
      if (roomKeyRef.current) {
        await startReticulumCapture();
      } else {
        scheduleDmRoomKeyRequests('dm-call-start');
      }
    }
  }, [
    endCall,
    flushPendingDmVoiceGcallKey,
    requestDmPeerMediaWarmup,
    scheduleDmRoomKeyReplays,
    scheduleDmRoomKeyRequests,
    sendCurrentDmRoomKey,
    setInfoSnackGlobal,
    setOpenSnackGlobal,
    startReticulumCapture,
    setupDecryptWorker,
    syncDecryptWorkerRoomKey,
    userInfo?.address,
    userInfo?.publicKey,
  ]);

  groupCallDmIpcHandlerRef.current = async (event: string, payload: unknown) => {
    if (event === 'gcall:participant-joined') {
      const p = payload as {
        roomId?: string;
        address?: string;
      };
      const curRoom = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      if (
        isDmVoiceRoomId(p.roomId) &&
        curRoom &&
        p.roomId === curRoom &&
        typeof p.address === 'string' &&
        peer &&
        p.address === peer
      ) {
        requestDmPeerMediaWarmup(curRoom, 'dm-peer-joined', {
          ignoreCooldown: true,
        });
        if (isOutboundCallRef.current) {
          void sendCurrentDmRoomKey('dm-peer-joined').catch(() => {});
          scheduleDmRoomKeyReplays('dm-peer-joined');
        } else if (!roomKeyRef.current) {
          scheduleDmRoomKeyRequests('dm-peer-joined');
        }
      }
      return;
    }

    if (event === 'gcall:key-request') {
      const p = payload as GcallKeyRequestEventPayload;
      const curRoom = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      if (
        !isDmVoiceRoomId(p.roomId) ||
        !curRoom ||
        p.roomId !== curRoom ||
        p.toAddress !== userInfo?.address ||
        p.fromAddress !== peer ||
        p.verified !== true ||
        p.keyMessageVersion !== GCALL_KEY_MESSAGE_VERSION
      ) {
        return;
      }
      pushDirectVoiceUiLog('log', 'gcall:key-request rx', {
        fromTrunc: String(p.fromAddress ?? '').slice(0, 8),
        sessionTrunc: String(p.callSessionId ?? '').slice(0, 8),
      });
      if (isOutboundCallRef.current) {
        void sendCurrentDmRoomKey('dm-key-request').catch(() => {});
        scheduleDmRoomKeyReplays('dm-key-request');
      }
      return;
    }

    if (event === 'gcall:key') {
      const p = payload as GcallKeyEventPayload;
      pushDirectVoiceUiLog('log', 'gcall:key rx', {
        roomTrunc: String(p.roomId ?? '').slice(0, 24),
        toTrunc: String(p.recipientAddress ?? '').slice(0, 8),
        verified: p.verified,
        ver: p.keyMessageVersion,
      });
      if (!isDmVoiceRoomId(p.roomId)) {
        pushDirectVoiceUiLog('warn', 'gcall:key ignored (not a DM voice room id)', {
          roomId: p.roomId,
        });
        return;
      }
      const curRoom = dmRoomIdRef.current;
      if (!curRoom) {
        pendingDmVoiceGcallKeyRef.current = p;
        pushDirectVoiceUiLog(
          'log',
          'gcall:key queued (dm room id not set yet — will match after join)'
        );
        return;
      }
      if (p.roomId !== curRoom) {
        pushDirectVoiceUiLog('warn', 'gcall:key ignored (roomId mismatch)', {
          eventTrunc: String(p.roomId).slice(0, 24),
          expectedTrunc: curRoom.slice(0, 24),
        });
        return;
      }
      void handleDmVoiceGcallKeyPayload(p);
      return;
    }

    if (event === 'gcall:audio') {
      const p = payload as {
        roomId?: string;
        data?: ArrayBuffer | { buffer: ArrayBuffer };
        fromAddress?: string;
      };
      if (!isDmVoiceRoomId(p.roomId) || p.roomId !== dmRoomIdRef.current) return;
      let buf: ArrayBuffer | null = null;
      const raw = p.data;
      if (raw instanceof ArrayBuffer) buf = raw;
      else if (raw && typeof raw === 'object' && 'buffer' in raw) {
        const b = raw as { buffer: ArrayBuffer; byteOffset?: number; byteLength?: number };
        buf = b.buffer.slice(b.byteOffset ?? 0, (b.byteOffset ?? 0) + (b.byteLength ?? 0));
      }
      if (!buf) return;

      const fromAddr = p.fromAddress ?? '';
      if (!fromAddr && !dmVoiceNoFromAddressLoggedRef.current) {
        dmVoiceNoFromAddressLoggedRef.current = true;
        pushDirectVoiceUiLog(
          'warn',
          'gcall:audio missing fromAddress (inbound handler may drop)'
        );
      }

      dmVoiceAudioPacketCountRef.current += 1;
      const now = Date.now();
      if (now - dmVoiceLastAudioUiLogAtRef.current >= 2500) {
        dmVoiceLastAudioUiLogAtRef.current = now;
        pushDirectVoiceUiLog(
          'log',
          'gcall:audio rx (throttled)',
          {
            packets: dmVoiceAudioPacketCountRef.current,
            bytes: buf.byteLength,
            hasFrom: fromAddr.length > 0,
          },
          'debug'
        );
      }

      handleIncomingAudioPacketRef.current(buf, fromAddr);
    }
  };

  useEffect(() => {
    const gc = (window as any).groupCall;
    if (!gc?.onEvent) return;
    return gc.onEvent((event: string, payload: unknown) => {
      void groupCallDmIpcHandlerRef.current(event, payload);
    });
  }, []);

  const startDurationTimer = useCallback(() => {
    setCallDuration(0);
    durationTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1_000);
  }, []);

  callIpcHandlerRef.current = async (event: string, payload: unknown) => {
    const p = payload as Record<string, unknown>;

    switch (event) {
      case 'call:incoming': {
        const incCallId = p.callId as string;
        const incFrom = p.fromAddress as string;
        const incChatId = p.chatId as string;

        const rejectIncoming = async (reason: string) => {
          const rejectTs = Date.now();
          const { signature, publicKey } = await signPresenceFields(
            { type: 'CALL_REJECT', callId: incCallId, timestamp: rejectTs },
            publicKeyRef.current
          );
          await (window as any).call?.reject(
            incCallId,
            reason,
            signature,
            publicKey,
            rejectTs
          );
        };

        if (isDirectVoiceCallChatId(incChatId)) {
          if (blockedAddressesRef.current[incFrom]) {
            await rejectIncoming('blocked');
            break;
          }
          if (!dmFriendsByAddressRef.current[incFrom]) {
            await rejectIncoming('not_friend');
            break;
          }
        }

        if (callStateRef.current !== 'idle') break;
        updateIncomingCall({
          callId: incCallId,
          fromAddress: incFrom,
          chatId: incChatId,
        });
        updateCallState('ringing');
        break;
      }

      case 'call:accepted': {
        if (
          callIdRef.current !== p.callId ||
          callStateRef.current !== 'calling'
        ) {
          pushDirectVoiceUiLog('warn', 'call:accepted ignored (wrong callId or state)', {
            expectedCallId: callIdRef.current,
            gotCallId: p.callId,
            state: callStateRef.current,
          });
          break;
        }
        await reticulumTeardownChainRef.current.catch(() => {});
        const chatIdForRoom = activeCallChatIdRef.current;
        if (chatIdForRoom && isDirectVoiceCallChatId(chatIdForRoom)) {
          try {
            const roomId = await buildDmVoiceRoomId(chatIdForRoom);
            dmRoomIdRef.current = roomId;
            flushPendingDmVoiceGcallKey(roomId);
            pushDirectVoiceUiLog('log', 'DM voice room id ready (caller)', {
              roomTrunc: roomId.slice(0, 32),
            });
          } catch (e) {
            pushDirectVoiceUiLog('warn', 'buildDmVoiceRoomId failed (caller)', {
              err: String(e),
            });
            endCall(false);
            break;
          }
        }
        pushDirectVoiceUiLog('log', 'call:accepted — starting Reticulum media session');
        updateCallState('connected');
        startDurationTimer();
        void startReticulumMediaSession().catch((e) => {
          pushDirectVoiceUiLog('warn', 'startReticulumMediaSession rejected', {
            err: String(e),
          });
        });
        break;
      }

      case 'call:rejected': {
        if (callIdRef.current !== p.callId) break;
        const rejectReason =
          typeof p.reason === 'string' ? p.reason.trim() : '';
        const message =
          rejectReason === 'media unavailable'
            ? i18n.t('core:voice_call.rejected_media')
            : i18n.t('core:voice_call.rejected_declined');
        setInfoSnackGlobal({ type: 'info', message });
        setOpenSnackGlobal(true);
        endCall(false);
        break;
      }

      case 'call:hangup': {
        const hid = p.callId as string;
        const matchesOutboundOrActive = callIdRef.current === hid;
        const matchesRingingIncoming =
          callStateRef.current === 'ringing' &&
          incomingCallRef.current?.callId === hid;
        if (!matchesOutboundOrActive && !matchesRingingIncoming) break;
        endCall(false);
        break;
      }
    }
  };

  useEffect(() => {
    const callAPI = (window as any).call;
    if (!callAPI?.onEvent) {
      console.warn('[DM voice] window.call is undefined — call IPC unavailable');
      return;
    }
    return callAPI.onEvent((event: string, payload: unknown) => {
      void callIpcHandlerRef.current(event, payload);
    });
  }, []);

  useEffect(() => {
    const w = window as Window & {
      call?: { onEvent?: unknown };
      groupCall?: { onEvent?: unknown };
    };
    if (!w.call?.onEvent) {
      console.warn(
        '[DM voice] window.call.onEvent is missing — call signaling will not work (not running in Electron shell?)'
      );
    }
    if (!w.groupCall?.onEvent) {
      console.warn(
        '[DM voice] window.groupCall.onEvent is missing — Reticulum DM media will not work'
      );
    }
  }, []);

  const reassertCallLocalAddress = useCallback(
    async (reason: string, opts?: { requireReticulumReady?: boolean }) => {
      const addr = userInfo?.address;
      const callApi = (window as any).call;
      if (!addr) {
        if (registeredCallLocalAddressRef.current && callApi?.setLocalAddresses) {
          registeredCallLocalAddressRef.current = null;
          await callApi.setLocalAddresses([]).catch(() => {});
        }
        return;
      }
      if (!callApi?.setLocalAddresses) return;

      if (opts?.requireReticulumReady) {
        const getStatus = (window as any).electronAPI?.reticulumGetStatus;
        if (typeof getStatus === 'function') {
          try {
            const status = await getStatus();
            if (status?.bridgeState !== 'ready') return;
          } catch {
            return;
          }
        }
      }

      await callApi.setLocalAddresses([addr]).catch(() => {});
      registeredCallLocalAddressRef.current = addr;
      if (reason !== 'periodic-ready') {
        pushDirectVoiceUiLog('log', 'call local address registered', {
          reason,
          addrTrunc: addr.slice(0, 8),
        });
      }
    },
    [userInfo?.address]
  );

  useEffect(() => {
    void reassertCallLocalAddress('auth').catch(() => {});
  }, [reassertCallLocalAddress]);

  useEffect(() => {
    const addr = userInfo?.address;
    if (!addr) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void reassertCallLocalAddress('periodic-ready', {
        requireReticulumReady: true,
      }).catch(() => {});
    };
    tick();
    const timer = window.setInterval(tick, CALL_LOCAL_ADDRESS_REASSERT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reassertCallLocalAddress, userInfo?.address]);

  const initiateCall = useCallback(
    async (
      targetAddress: string,
      chatId: string,
      sign: (
        fields: Record<string, unknown>
      ) => Promise<{ signature: string; publicKey: string }>
    ) => {
      if (callStateRef.current !== 'idle') return;
      const localAddress = userInfo?.address;
      if (!localAddress) return;

      const callId = crypto.randomUUID();
      const timestamp = Date.now();
      const myPublicKey = userInfo?.publicKey ?? '';

      const { signature, publicKey } = await sign({
        type: 'CALL_REQUEST',
        callId,
        chatId,
        fromAddress: localAddress,
        fromPublicKey: myPublicKey,
        timestamp,
      });

      await prepareCallAudioContext();

      isOutboundCallRef.current = true;
      peerAddressRef.current = targetAddress;
      callIdRef.current = callId;
      activeCallChatIdRef.current = chatId;
      setActiveCallChatId(chatId);
      updateCallState('calling');

      const result = await (window as any).call?.initiate(
        targetAddress,
        chatId,
        localAddress,
        signature,
        publicKey,
        callId,
        timestamp
      );

      if (!result?.success) {
        pushDirectVoiceUiLog('warn', 'call.initiate failed', {
          result: result ?? null,
        });
        isOutboundCallRef.current = false;
        peerAddressRef.current = null;
        callIdRef.current = null;
        activeCallChatIdRef.current = null;
        setActiveCallChatId(null);
        updateCallState('idle');
      } else {
        pushDirectVoiceUiLog('log', 'call.initiate ok (waiting for peer)', {
          callIdTrunc: callId.slice(0, 8),
          chatIdTrunc: chatId.slice(0, 24),
        });
      }
    },
    [prepareCallAudioContext, updateCallState, userInfo?.address, userInfo?.publicKey]
  );

  const acceptCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming || callStateRef.current !== 'ringing') return;

    await reticulumTeardownChainRef.current.catch(() => {});
    await prepareCallAudioContext();

    isOutboundCallRef.current = false;
    peerAddressRef.current = incoming.fromAddress;
    callIdRef.current = incoming.callId;
    const acceptedChatId = incoming.chatId;
    updateIncomingCall(null);

    activeCallChatIdRef.current = acceptedChatId;
    setActiveCallChatId(acceptedChatId);

    if (isDirectVoiceCallChatId(acceptedChatId)) {
      try {
        const roomId = await buildDmVoiceRoomId(acceptedChatId);
        dmRoomIdRef.current = roomId;
        flushPendingDmVoiceGcallKey(roomId);
        pushDirectVoiceUiLog('log', 'DM voice room id ready (callee)', {
          roomTrunc: roomId.slice(0, 32),
        });
      } catch (e) {
        pushDirectVoiceUiLog('warn', 'buildDmVoiceRoomId failed (callee)', {
          err: String(e),
        });
        endCall(false);
        return;
      }
    }

    updateCallState('connected');
    startDurationTimer();

    const acceptTs = Date.now();
    const { signature, publicKey } = await signPresenceFields(
      { type: 'CALL_ACCEPT', callId: incoming.callId, timestamp: acceptTs },
      publicKeyRef.current
    );
    await (window as any).call?.accept(incoming.callId, signature, publicKey, acceptTs);

    pushDirectVoiceUiLog('log', 'incoming call accepted — starting Reticulum media session');
    void startReticulumMediaSession().catch((e) => {
      pushDirectVoiceUiLog('warn', 'startReticulumMediaSession rejected', {
        err: String(e),
      });
    });
  }, [
    endCall,
    flushPendingDmVoiceGcallKey,
    startDurationTimer,
    startReticulumMediaSession,
    prepareCallAudioContext,
    updateCallState,
    updateIncomingCall,
  ]);

  const rejectCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;
    updateIncomingCall(null);
    updateCallState('idle');

    const rejectTs = Date.now();
    const { signature, publicKey } = await signPresenceFields(
      { type: 'CALL_REJECT', callId: incoming.callId, timestamp: rejectTs },
      publicKeyRef.current
    );
    await (window as any).call?.reject(
      incoming.callId,
      'rejected',
      signature,
      publicKey,
      rejectTs
    );
  }, [updateCallState, updateIncomingCall]);

  const hangUp = useCallback(() => {
    endCall(true);
  }, [endCall]);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    micStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    captureWorkletRef.current?.port.postMessage({ type: 'mute', muted: next });
    setIsMuted(next);
  }, []);

  const setHearCall = useCallback((hear: boolean) => {
    hearCallRef.current = hear;
    setHearCallState(hear);
    void dmReceiveEngineRef.current?.configure({ hearCall: hear });
  }, []);

  const toggleHearCall = useCallback(() => {
    setHearCall(!hearCallRef.current);
  }, [setHearCall]);

  const swapVoiceCallInput = useCallback(
    async (deviceId: string | null) => {
      if (callStateRef.current !== 'connected') return;
      if (!micStreamRef.current || !roomKeyRef.current) return;

      const curTrack = micStreamRef.current.getAudioTracks()[0];
      const curId = curTrack?.getSettings?.().deviceId;
      if (deviceId != null && curId === deviceId) return;

      const { stream, clearedStaleInputDevice } = await getUserAudioStreamForCall(deviceId);
      if (clearedStaleInputDevice) {
        setCallAudioDevices((prev) => ({ ...prev, inputDeviceId: null }));
      }
      if (!stream) return;

      const newTrack = stream.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = !isMutedRef.current;

      try {
        micSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = stream;

      const ctx = audioCtxRef.current;
      const captureNode = captureWorkletRef.current;
      const keepAlive = keepAliveGainRef.current;
      if (ctx && captureNode && keepAlive) {
        const newSource = ctx.createMediaStreamSource(stream);
        micSourceRef.current = newSource;
        newSource.connect(captureNode);
        newSource.connect(keepAlive);
        captureNode.port.postMessage({ type: 'mute', muted: isMutedRef.current });
      }
    },
    [setCallAudioDevices]
  );

  useEffect(() => {
    if (callState !== 'connected') {
      inputSwapSeededRef.current = false;
      prevInputPrefRef.current = undefined;
      return;
    }
    if (!micStreamRef.current) return;
    const want = callAudioDevices.inputDeviceId;
    if (!inputSwapSeededRef.current) {
      inputSwapSeededRef.current = true;
      prevInputPrefRef.current = want;
      return;
    }
    if (prevInputPrefRef.current === want) return;
    prevInputPrefRef.current = want;
    void swapVoiceCallInput(want);
  }, [callState, callAudioDevices.inputDeviceId, callAudioWireNonce, swapVoiceCallInput]);

  useEffect(() => {
    if (callState !== 'connected') return;
    void (async () => {
      const out = callAudioDevices.outputDeviceId;
      const r = await applyCallAudioOutput(out, {
        audioContext: audioCtxRef.current,
      });
      if (r.clearPersistedOutput) {
        setCallAudioDevices((p) => ({ ...p, outputDeviceId: null }));
      }
      await dmReceiveEngineRef.current?.configure({
        outputDeviceId: r.clearPersistedOutput ? null : out,
        hearCall: hearCallRef.current,
        profile: readGroupCallAudioProfile(),
      });
    })();
  }, [callState, callAudioDevices.outputDeviceId, callAudioWireNonce, setCallAudioDevices]);

  useEffect(() => {
    const id = setInterval(() => {
      const peer = peerAddressRef.current;
      const roomId = dmRoomIdRef.current;
      if (!peer || !roomKeyRef.current || !roomId) return;
      const wallNow = Date.now();
      const snap = metricsRef.current.getSnapshot();
      const pressureSnap = {
        bridgeWaitingForDrain: snap.reticulumAudioBridgeWaitingForDrain,
        bridgeQueuedFrames: snap.reticulumAudioBridgeQueuedFrames,
        decodedQueueDepth: snap.reticulumAudioDecodedQueueDepth,
        queuePressureDropsLast5s: snap.reticulumAudioQueuePressureDropsLast5s,
        pendingFrames: snap.reticulumAudioPendingFrames,
      };
      const pressured = isReticulumSendPressureSignal(pressureSnap);
      const gc = (window as any).groupCall;
      if (typeof gc?.reportTransportHealth === 'function') {
        void gc
          .reportTransportHealth(roomId, pressured ? [] : [peer])
          .catch(() => {});
      }
      const encTuning = getGroupCallAudioTuning(readGroupCallAudioProfile());
      const nominalBitrate = Math.round(encTuning.opusBitrate);
      const tiers = buildOpusSendPressureTiers(nominalBitrate);
      const result = tickOpusSendPressureController(
        opusSendPressureStateRef.current,
        tiers,
        OPUS_SEND_PRESSURE_TICK_MS,
        wallNow,
        pressured,
        undefined
      );
      opusSendPressureStateRef.current = result.state;
      const appliedBitrate = Math.max(
        GCALL_OPUS_SEND_PRESSURE_MIN_BITRATE,
        result.targetBitrate
      );
      if (appliedBitrate !== opusEncoderLastConfiguredBitrateRef.current) {
        opusEncoderApplyBitrateRef.current(appliedBitrate);
        opusEncoderLastConfiguredBitrateRef.current = appliedBitrate;
      }
      if (pressured) {
        dmMarkPeerUnstable(dmPeerRecoveryStateRef.current, peer, 1);
        if (
          typeof gc?.requestPeerMediaRecovery === 'function' &&
          wallNow - lastDmPeerMediaRecoveryRequestAtRef.current >=
            DM_MEDIA_RECOVERY_REQUEST_COOLDOWN_MS
        ) {
          lastDmPeerMediaRecoveryRequestAtRef.current = wallNow;
          void gc
            .requestPeerMediaRecovery(roomId, peer, 'dm-send-pressure')
            .catch(() => {});
        }
      } else {
        dmMarkPeerStable(dmPeerRecoveryStateRef.current, peer);
      }
      dmRecomputeAdaptiveNetworkMode(dmPeerRecoveryStateRef.current, (m) =>
        metricsRef.current.setAdaptiveNetworkMode(m)
      );
      const lastTick = lastGcallEscalationTickAtMsRef.current;
      const stageDelta =
        lastTick > 0
          ? Math.min(2000, Math.max(0, wallNow - lastTick))
          : OPUS_SEND_PRESSURE_TICK_MS;
      lastGcallEscalationTickAtMsRef.current = wallNow;
      metricsRef.current.tickGcallAudioStageMetrics(stageDelta, {
        burstWindow: false,
        overload: false,
        ingressPacing: result.state.tierIndex > 0,
        stage5Boost: false,
        failSafe: false,
      });
    }, OPUS_SEND_PRESSURE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      clearDurationTimer();
      const id = callIdRef.current;
      const state = callStateRef.current;
      const needsHangup =
        Boolean(id) &&
        (state === 'connected' || state === 'calling' || state === 'ringing');
      if (needsHangup && id) {
        const timestamp = Date.now();
        void signPresenceFields(
          { type: 'CALL_HANGUP', callId: id, timestamp },
          publicKeyRef.current
        )
          .then(({ signature, publicKey }) =>
            (window as any).call?.hangup(id, signature, publicKey, timestamp)
          )
          .catch(() => {})
          .finally(() => {
            enqueueTeardownReticulumMedia();
          });
        return;
      }
      enqueueTeardownReticulumMedia();
    };
  }, [clearDurationTimer, enqueueTeardownReticulumMedia]);

  const startupStageKey =
    callState === 'connected'
      ? `${callState}:${audioMode ?? 'none'}:${callDuration > 0 ? 'live' : 'startup'}`
      : `${callState}:${audioMode ?? 'none'}`;

  useEffect(() => {
    startupStageSinceRef.current = Date.now();
    setStartupClock((tick) => tick + 1);
  }, [startupStageKey]);

  useEffect(() => {
    if (
      callState !== 'calling' &&
      !(callState === 'connected' && callDuration === 0)
    ) {
      return;
    }
    const id = window.setInterval(() => {
      setStartupClock((tick) => tick + 1);
    }, 1_000);
    return () => window.clearInterval(id);
  }, [callDuration, callState]);

  void startupClock;

  const startupStatus: DirectVoiceCallStartupStatus = (() => {
    const delayed = Date.now() - startupStageSinceRef.current >= 4_000;
    if (callState === 'calling') {
      return {
        stage: 'calling',
        headline: 'Calling...',
        detail: delayed
          ? 'Still waiting for the other side to answer.'
          : 'Waiting for the other side to answer.',
        tone: delayed ? 'warning' : 'info',
        showProgress: true,
        delayed,
      };
    }
    if (callState === 'connected' && callDuration === 0) {
      return {
        stage: 'starting-audio',
        headline: 'Starting secure audio...',
        detail: delayed
          ? 'This call is taking longer than usual to start.'
          : 'Finalizing secure audio so you can hear each other.',
        tone: delayed ? 'warning' : 'info',
        showProgress: true,
        delayed,
      };
    }
    if (callState === 'connected') {
      return {
        stage: 'connected',
        headline: 'Connected',
        detail: null,
        tone: 'neutral',
        showProgress: false,
        delayed: false,
      };
    }
    return {
      stage: 'idle',
      headline: '',
      detail: null,
      tone: 'neutral',
      showProgress: false,
      delayed: false,
    };
  })();

  return {
    callState,
    audioMode,
    startupStatus,
    isMuted,
    hearCall,
    callDuration,
    incomingCall,
    activeCallChatId,
    initiateCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    setHearCall,
    toggleHearCall,
  };
}
