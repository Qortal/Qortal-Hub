/**
 * Direct (1:1) voice call lifecycle. Control, key exchange, and WebRTC
 * negotiation use authenticated Reticulum links. The audio surface prefers an
 * encrypted native WebRTC audio track and retains the existing application-
 * encrypted Reticulum media path as the automatic fallback.
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
import { signGroupCallFields } from '../lib/group-call/groupCallJoinSigning';
import {
  clearDirectVoiceUiLogs,
  pushDirectVoiceUiLog,
} from '../lib/call/directVoiceUiLog';
import { startDirectOutboundRingtone } from '../lib/call/directIncomingRingtone';
import i18n from '../i18n/i18n';
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
  GroupCallAudioSenderEngine,
  type GroupCallAudioSenderFrame,
} from '../lib/group-call/groupCallAudioSenderEngine';
import AudioDecryptWorker from '../workers/audio-decrypt.worker?worker';
import { createRouteBoundId } from '../lib/reticulum/routeBoundId';
import { isReticulumCallEnabled } from '../lib/call/directVoiceCallTransport';
import type { DirectVoiceRtcSignal } from '../lib/call/directVoiceWebRtcTransport';
import {
  DirectScreenShareWebRtcTransport,
  type DirectScreenShareRtcSignal,
} from '../lib/call/directScreenShareWebRtcTransport';

const DM_MEDIA_RECOVERY_REQUEST_COOLDOWN_MS = 4_000;
const DM_ROOM_KEY_REPLAY_RETRY_MS = 750;
const DM_ROOM_KEY_REPLAY_MAX_ATTEMPTS = 6;
const DM_ROOM_KEY_REQUEST_RETRY_MS = 1_000;
const DM_ROOM_KEY_REQUEST_MAX_ATTEMPTS = 30;
// The callee-owned Reticulum link can use four 12-second establish attempts
// plus retry backoff. Do not let the renderer abandon the call first.
const DM_MEDIA_READINESS_TIMEOUT_MS = 60_000;
const DM_MEDIA_READINESS_POLL_MS = 500;
const DM_MEDIA_READINESS_WARMUP_MS = 1_000;
const CALL_LOCAL_ADDRESS_REASSERT_MS = 2_500;

function shortenCallPeerAddress(address: string | null): string {
  const normalized = address?.trim() ?? '';
  if (normalized.length <= 16) return normalized || 'The other person';
  return `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
}

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

type GcallDirectRtcEventPayload = {
  roomId?: string;
  callSessionId?: string;
  mediaSessionGeneration?: number;
  fromAddress?: string;
  toAddress?: string;
  signalType?:
    | 'capability'
    | 'offer'
    | 'answer'
    | 'candidate'
    | 'ack'
    | 'reconnect';
  payload?: string;
  verified?: boolean;
};

function uint8ToBase64Local(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function createDirectVoiceRtcSignalId(): string {
  return uint8ToBase64Local(crypto.getRandomValues(new Uint8Array(12)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION = 'native_audio_v1';
const DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY = {
  kind: 'capability',
  audio: 'native-track',
  screen: 'video-track',
  screenVersion: 1,
  version: 1,
} as const;

type DirectVoiceCapabilityPayload = {
  kind: 'capability';
  audio: 'native-track';
  screen: 'video-track';
  screenVersion: 1;
  version: 1;
  capabilityId: string;
};

type DirectVoiceCapabilityAckPayload = {
  kind: 'capability-ack';
  generation: typeof DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION;
  capabilityId: string;
};

function isDirectScreenShareRtcSignal(
  value: unknown
): value is DirectScreenShareRtcSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Record<string, unknown>;
  if (
    typeof signal.generation !== 'string' ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(signal.generation)
  ) {
    return false;
  }
  if (signal.kind === 'screen-stop') return true;
  if (signal.kind === 'screen-ice') {
    if (!signal.candidate || typeof signal.candidate !== 'object') return false;
    const candidate = signal.candidate as RTCIceCandidateInit;
    return (
      typeof candidate.candidate === 'string' &&
      candidate.candidate.length <= 8 * 1024 &&
      (candidate.sdpMid === undefined ||
        candidate.sdpMid === null ||
        typeof candidate.sdpMid === 'string') &&
      (candidate.sdpMLineIndex === undefined ||
        candidate.sdpMLineIndex === null ||
        (Number.isInteger(candidate.sdpMLineIndex) &&
          Number(candidate.sdpMLineIndex) >= 0))
    );
  }
  if (signal.kind !== 'screen-description') return false;
  if (!signal.description || typeof signal.description !== 'object') {
    return false;
  }
  const type = (signal.description as RTCSessionDescriptionInit).type;
  const sdp = (signal.description as RTCSessionDescriptionInit).sdp;
  return (
    (type === 'offer' || type === 'answer') &&
    typeof sdp === 'string' &&
    sdp.length > 0 &&
    sdp.length <= 64 * 1024
  );
}

async function sha256HexUtf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';

/** Active DM audio data plane reported to the existing call UI. */
export type AudioMode = 'reticulum' | 'webrtc' | null;

export type DirectScreenShareState =
  | 'idle'
  | 'choosing'
  | 'starting'
  | 'sharing'
  | 'viewing';

export interface DirectScreenShareSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string;
}

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
  callMediaReady: boolean;
  isMuted: boolean;
  hearCall: boolean;
  callDuration: number;
  incomingCall: IncomingCall | null;
  activeCallChatId: string | null;
  screenShareState: DirectScreenShareState;
  screenShareSupported: boolean;
  screenShareSources: DirectScreenShareSource[];
  screenShareStream: MediaStream | null;
  screenShareViewerOpen: boolean;
  screenShareIsLocal: boolean;
  initiateCall: (
    targetAddress: string,
    chatId: string,
    sign?: (
      fields: Record<string, unknown>
    ) => Promise<{ signature: string; publicKey: string }>,
    targetDisplayName?: string
  ) => void;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  setHearCall: (hear: boolean) => void;
  toggleHearCall: () => void;
  openScreenSharePicker: () => Promise<void>;
  cancelScreenSharePicker: () => void;
  startScreenShare: (sourceId: string) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  setScreenShareViewerOpen: (open: boolean) => void;
}

export type VoiceCallApi = {
  initiate?: (
    targetAddress: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    callId: string,
    timestamp: number,
    cancellationSignature?: string,
    cancellationPublicKey?: string,
    cancellationTimestamp?: number
  ) => Promise<{ success: boolean; callId?: string; error?: string }>;
  accept?: (
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ) => Promise<{ success: boolean; error?: string }>;
  reject?: (
    callId: string,
    reason?: string,
    signature?: string,
    publicKey?: string,
    timestamp?: number,
    reasonSignature?: string
  ) => Promise<{ success: boolean; error?: string }>;
  hangup?: (
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ) => Promise<{ success: boolean; error?: string }>;
  sendRtcSignal?: (input: {
    callId: string;
    generation: string;
    signalId: string;
    signalType: 'capability' | 'offer' | 'answer' | 'candidate';
    payload: string;
    payloadHash: string;
    timestamp: number;
    signature: string;
    publicKey: string;
  }) => Promise<{ success: boolean; error?: string }>;
  setLocalAddresses?: (
    addresses: string[]
  ) => Promise<{ success: boolean; error?: string }>;
  onEvent?: (cb: (event: string, payload: unknown) => void) => () => void;
};

export interface UseVoiceCallOptions {
  callApi?: VoiceCallApi;
  /**
   * The custom API signs the complete transport envelope itself. This is used
   * by QortalLand V2, whose main-process signature binds both Land sessions
   * and both Reticulum destinations. Legacy renderer signatures are neither
   * authoritative nor consumed by that protocol.
   */
  callApiSignsSignals?: boolean;
  /**
   * Permit this custom call-control API to use the shared, session-bound DM
   * media WebRTC path. The RTC envelope is still signed by the renderer and
   * is carried only over the authenticated Reticulum audio-link channel.
   */
  enableDirectVoiceWebRtc?: boolean;
  skipSystemReadiness?: boolean;
  skipDirectFriendValidation?: boolean;
  getPeerPublicKey?: (address: string) => string | undefined;
  getPeerDestinationHash?: (address: string) => string | undefined;
  createCallId?: () => string;
  suppressGlobalSnackbars?: boolean;
}

async function signPresenceFields(
  fields: Record<string, unknown>,
  publicKey: string
): Promise<{ signature: string; publicKey: string }> {
  try {
    const res = await (window as any).sendMessage(
      'signPresenceMessage',
      fields,
      10_000
    );
    return {
      signature: (res?.signature as string) ?? '',
      publicKey,
    };
  } catch {
    return { signature: '', publicKey };
  }
}

async function createDirectCallId(): Promise<string | null> {
  const getLocalDestinationHash =
    window.electronAPI?.reticulumGetLocalDestinationHash;
  if (typeof getLocalDestinationHash !== 'function') return null;
  try {
    const result = await getLocalDestinationHash();
    const destinationHash = result?.destinationHash?.trim().toLowerCase();
    return destinationHash ? createRouteBoundId('call', destinationHash) : null;
  } catch {
    return null;
  }
}

async function isSystemReadyForCall(
  showError: (message: string) => void
): Promise<boolean> {
  const readiness = await window.electronAPI?.getSystemCallReadiness?.();
  if (!readiness || readiness.status !== 'good') {
    showError(
      'Your system is too busy for calls right now. Close other apps and try again.'
    );
    pushDirectVoiceUiLog('warn', 'system call readiness blocked call', {
      status: readiness?.status ?? 'unavailable',
      reasons: readiness?.reasons ?? [],
      cpuLoad: readiness?.cpuLoad ?? null,
      memoryPressure: readiness?.memoryPressure ?? null,
      eventLoopLagMs: readiness?.eventLoopLagMs ?? null,
    });
    return false;
  }
  return true;
}

export function useVoiceCall(
  options: UseVoiceCallOptions = {}
): UseVoiceCallReturn {
  const userInfo = useAtomValue(userInfoAtom);
  const blockedAddresses = useAtomValue(blockedAddressesAtom);
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const callApiRef = useRef<VoiceCallApi | null>(null);
  callApiRef.current =
    options.callApi ??
    ((window as any).call as VoiceCallApi | undefined) ??
    null;
  const prefersDirectVoiceWebRtc =
    !isReticulumCallEnabled &&
    (options.callApiSignsSignals !== true ||
      options.enableDirectVoiceWebRtc === true) &&
    typeof window.groupCall?.sendRtcSignal === 'function';

  const [callState, setCallState] = useState<CallState>('idle');
  const [audioMode, setAudioMode] = useState<AudioMode>(null);
  const [callMediaReady, setCallMediaReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hearCall, setHearCallState] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCallChatId, setActiveCallChatId] = useState<string | null>(null);
  const [screenShareState, setScreenShareState] =
    useState<DirectScreenShareState>('idle');
  const [screenShareSupported, setScreenShareSupported] = useState(false);
  const screenShareSupportedRef = useRef(false);
  const [screenShareSources, setScreenShareSources] = useState<
    DirectScreenShareSource[]
  >([]);
  const [screenShareStream, setScreenShareStream] =
    useState<MediaStream | null>(null);
  const [screenShareViewerOpen, setScreenShareViewerOpen] = useState(false);
  const [screenShareIsLocal, setScreenShareIsLocal] = useState(false);
  const [callAudioWireNonce, setCallAudioWireNonce] = useState(0);
  const [startupClock, setStartupClock] = useState(0);
  const audioModeRef = useRef<AudioMode>(null);
  audioModeRef.current = audioMode;

  const callAudioDevices = useAtomValue(callAudioDevicesAtom);
  const callAudioPrefsRef = useRef(callAudioDevices);
  callAudioPrefsRef.current = callAudioDevices;

  const showGlobalCallSnack = useCallback(
    (type: 'error' | 'info', message: string) => {
      if (optionsRef.current.suppressGlobalSnackbars === true) return;
      setInfoSnackGlobal({ type, message });
      setOpenSnackGlobal(true);
    },
    [setInfoSnackGlobal, setOpenSnackGlobal]
  );

  const showSystemNotReadyForCall = useCallback(
    (message: string) => {
      showGlobalCallSnack('error', message);
    },
    [showGlobalCallSnack]
  );

  const callIdRef = useRef<string | null>(null);
  const directVoiceOwnerCallIdRef = useRef<string | null>(null);
  const directVoiceOwnerIdRef = useRef<string | null>(null);
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
  const authorizeCallSignal = useCallback(
    (fields: Record<string, unknown>) =>
      optionsRef.current.callApiSignsSignals === true
        ? Promise.resolve({
            signature: '',
            publicKey: publicKeyRef.current,
          })
        : signPresenceFields(fields, publicKeyRef.current),
    []
  );

  const isOutboundCallRef = useRef(false);
  const registeredCallLocalAddressRef = useRef<string | null>(null);
  const dmRoomIdRef = useRef<string | null>(null);
  /** If `gcall:key` arrives before `dmRoomIdRef` is set (should be rare after room precompute). */
  const pendingDmVoiceGcallKeyRef = useRef<GcallKeyEventPayload | null>(null);
  const peerAddressRef = useRef<string | null>(null);
  const peerDisplayNameRef = useRef<string>('');
  const callSessionIdRef = useRef<string | null>(null);
  const mediaGenRef = useRef(1);
  const roomKeyRef = useRef<Uint8Array | null>(null);
  const audioSeqRef = useRef(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startupStageSinceRef = useRef(Date.now());
  const stopOutboundRingtoneRef = useRef<(() => void) | null>(null);

  const dmSenderEngineRef = useRef<GroupCallAudioSenderEngine | null>(null);
  if (!dmSenderEngineRef.current) {
    dmSenderEngineRef.current = new GroupCallAudioSenderEngine();
  }
  const dmReceiveEngineRef = useRef<GroupCallAudioReceiveEngine | null>(null);
  if (!dmReceiveEngineRef.current) {
    dmReceiveEngineRef.current = new GroupCallAudioReceiveEngine(() => {});
  }

  const metricsRef = useRef(new GroupCallPerformanceTracker());
  const lastReticulumAudioTotalsRef = useRef<LastReticulumAudioTotals>(
    createInitialReticulumAudioTotals()
  );
  const dmPeerRecoveryStateRef = useRef(createDmPeerRecoveryState());
  const opusSendPressureStateRef = useRef(
    createOpusSendPressureControllerState()
  );
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
  const unmountVoiceCallCleanupRef = useRef<() => void>(() => {});
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
  const dmMediaOnAudioSurfaceRef = useRef(false);
  const dmReceiveOnAudioSurfaceRef = useRef(false);
  const dmRtcOnAudioSurfaceRef = useRef(false);
  const dmRtcOpenRef = useRef(false);
  const dmRtcOpenWaitersRef = useRef(new Set<(ready: boolean) => void>());
  const dmRtcLifecycleGenerationRef = useRef(0);
  const dmRtcStartPromiseRef = useRef<Promise<boolean> | null>(null);
  const dmRtcPeerNativeCapabilityCallIdRef = useRef<string | null>(null);
  const dmRtcLocalCapabilityRef = useRef<{
    callId: string;
    capabilityId: string;
    acknowledged: boolean;
  } | null>(null);
  const dmRtcSignalSendChainRef = useRef<Promise<void>>(Promise.resolve());
  const screenShareTransportRef =
    useRef<DirectScreenShareWebRtcTransport | null>(null);
  const screenShareStateRef = useRef<DirectScreenShareState>('idle');
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const screenShareCaptureAttemptRef = useRef(0);
  const screenSharePendingIceRef = useRef(
    new Map<string, DirectScreenShareRtcSignal[]>()
  );
  const screenShareTerminalGenerationsRef = useRef(new Set<string>());
  const screenShareSignalHandlerRef = useRef<
    (signal: DirectScreenShareRtcSignal) => Promise<void>
  >(async () => {});
  const stopScreenShareRef = useRef<(notifyPeer: boolean) => Promise<void>>(
    async () => {}
  );
  const pendingDirectVoiceRtcSignalsRef = useRef<DirectVoiceRtcSignal[]>([]);
  const pendingDirectVoiceLinkSignalsRef = useRef<GcallDirectRtcEventPayload[]>(
    []
  );
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

  const ensureDirectVoiceOwnerId = useCallback((): string | null => {
    const callId = callIdRef.current;
    if (!callId) return null;
    if (
      directVoiceOwnerCallIdRef.current !== callId ||
      !directVoiceOwnerIdRef.current
    ) {
      directVoiceOwnerCallIdRef.current = callId;
      directVoiceOwnerIdRef.current = `dvc:${createDirectVoiceRtcSignalId()}`;
    }
    return directVoiceOwnerIdRef.current;
  }, []);

  const updateCallState = useCallback((nextState: CallState) => {
    callStateRef.current = nextState;
    setCallState(nextState);
  }, []);

  const updateScreenShareState = useCallback(
    (nextState: DirectScreenShareState) => {
      screenShareStateRef.current = nextState;
      setScreenShareState(nextState);
    },
    []
  );

  const updateIncomingCall = useCallback(
    (nextIncomingCall: IncomingCall | null) => {
      incomingCallRef.current = nextIncomingCall;
      setIncomingCall(nextIncomingCall);
    },
    []
  );

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

  const startDirectVoiceReceiveOnAudioSurface = useCallback(async () => {
    const ownerId = ensureDirectVoiceOwnerId();
    const roomId = dmRoomIdRef.current;
    const peer = peerAddressRef.current;
    const roomKey = roomKeyRef.current;
    if (!window.audioSurface || !ownerId || !roomId || !peer || !roomKey) {
      dmReceiveOnAudioSurfaceRef.current = false;
      return false;
    }
    const keyBuffer = roomKey.slice().buffer as ArrayBuffer;
    const response = await window.audioSurface.sendCommand({
      type: 'start-direct-voice-receive',
      ownerId,
      roomId,
      peerAddress: peer,
      roomKey: keyBuffer,
      outputDeviceId: callAudioPrefsRef.current.outputDeviceId ?? null,
      hearCall: hearCallRef.current,
      profile: readGroupCallAudioProfile(),
    });
    dmReceiveOnAudioSurfaceRef.current = response.ok === true;
    if (!response.ok) {
      pushDirectVoiceUiLog('warn', 'audio-surface DM receive unavailable', {
        err: response.error ?? 'unknown',
      });
    }
    return response.ok === true;
  }, [ensureDirectVoiceOwnerId]);

  const applyDirectVoiceRtcSignalOnAudioSurface = useCallback(
    async (signal: DirectVoiceRtcSignal): Promise<boolean> => {
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      const ownerId = directVoiceOwnerIdRef.current;
      if (
        !window.audioSurface ||
        !ownerId ||
        !roomId ||
        !peer ||
        !dmRtcOnAudioSurfaceRef.current
      ) {
        if (callStateRef.current === 'connected') {
          const pending = pendingDirectVoiceRtcSignalsRef.current;
          const candidateCount = (entry: DirectVoiceRtcSignal): number =>
            entry.kind === 'ice-candidates'
              ? entry.candidates.length
              : entry.kind === 'ice'
                ? 1
                : 0;
          if (signal.kind === 'description') {
            const duplicate = pending.some(
              (entry) =>
                entry.kind === 'description' &&
                entry.generation === signal.generation &&
                entry.description.type === signal.description.type
            );
            if (!duplicate) {
              if (pending.length >= 128) {
                const candidateIndex = pending.findIndex(
                  (entry) => candidateCount(entry) > 0
                );
                const refreshIndex = pending.findIndex(
                  (entry) => entry.kind === 'ice-refresh-request'
                );
                pending.splice(
                  candidateIndex >= 0
                    ? candidateIndex
                    : refreshIndex >= 0
                      ? refreshIndex
                      : 0,
                  1
                );
              }
              pending.push(signal);
            }
          } else {
            const incomingCount = candidateCount(signal);
            let queuedCount = pending.reduce(
              (total, entry) => total + candidateCount(entry),
              0
            );
            while (
              queuedCount + incomingCount > 128 &&
              pending.some((entry) => candidateCount(entry) > 0)
            ) {
              const candidateIndex = pending.findIndex(
                (entry) => candidateCount(entry) > 0
              );
              const [removed] = pending.splice(candidateIndex, 1);
              queuedCount -= candidateCount(removed);
            }
            if (
              incomingCount <= 128 &&
              (incomingCount > 0 || pending.length < 128)
            ) {
              pending.push(signal);
            }
          }
        }
        return false;
      }
      const response = await window.audioSurface.sendCommand({
        type: 'apply-direct-voice-rtc-signal',
        ownerId,
        roomId,
        peerAddress: peer,
        signal,
      });
      return response.ok === true;
    },
    []
  );

  const startDirectVoiceRtcOnAudioSurface = useCallback(async () => {
    if (!prefersDirectVoiceWebRtc) return false;
    const callId = callIdRef.current;
    if (!callId || dmRtcPeerNativeCapabilityCallIdRef.current !== callId) {
      return false;
    }
    if (dmRtcOnAudioSurfaceRef.current) return true;
    const existingStart = dmRtcStartPromiseRef.current;
    if (existingStart) return existingStart;
    const startAttempt = (async (): Promise<boolean> => {
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      const ownerId = ensureDirectVoiceOwnerId();
      if (!window.audioSurface || !ownerId || !roomId || !peer) return false;
      const lifecycleGeneration = dmRtcLifecycleGenerationRef.current;
      dmRtcOpenRef.current = false;
      let iceServers: RTCIceServer[] = [];
      try {
        const discovered = await (window as any).hub?.getIceServers?.();
        if (Array.isArray(discovered)) iceServers = discovered;
      } catch {
        // Host candidates can still work; Reticulum remains the media fallback.
      }
      if (
        lifecycleGeneration !== dmRtcLifecycleGenerationRef.current ||
        roomId !== dmRoomIdRef.current ||
        peer !== peerAddressRef.current
      ) {
        return false;
      }
      const response = await window.audioSurface.sendCommand({
        type: 'start-direct-voice-rtc',
        ownerId,
        roomId,
        peerAddress: peer,
        initiator: isOutboundCallRef.current,
        inputDeviceId: callAudioPrefsRef.current.inputDeviceId ?? null,
        outputDeviceId: callAudioPrefsRef.current.outputDeviceId ?? null,
        muted: isMutedRef.current,
        hearCall: hearCallRef.current,
        iceServers,
      });
      if (
        lifecycleGeneration !== dmRtcLifecycleGenerationRef.current ||
        roomId !== dmRoomIdRef.current ||
        peer !== peerAddressRef.current
      ) {
        if (response.ok) {
          await window.audioSurface
            .sendCommand({ type: 'stop-direct-voice-rtc', ownerId })
            .catch(() => {});
        }
        return false;
      }
      dmRtcOnAudioSurfaceRef.current = response.ok === true;
      if (!response.ok) return false;
      const pending = pendingDirectVoiceRtcSignalsRef.current.splice(0);
      for (const signal of pending) {
        if (lifecycleGeneration !== dmRtcLifecycleGenerationRef.current) break;
        await applyDirectVoiceRtcSignalOnAudioSurface(signal);
      }
      return true;
    })();
    dmRtcStartPromiseRef.current = startAttempt;
    try {
      return await startAttempt;
    } finally {
      if (dmRtcStartPromiseRef.current === startAttempt) {
        dmRtcStartPromiseRef.current = null;
      }
    }
  }, [
    applyDirectVoiceRtcSignalOnAudioSurface,
    ensureDirectVoiceOwnerId,
    prefersDirectVoiceWebRtc,
  ]);

  const stopDirectVoiceRtcOnAudioSurface = useCallback(
    async (ownerId = directVoiceOwnerIdRef.current) => {
      dmRtcLifecycleGenerationRef.current += 1;
      dmRtcSignalSendChainRef.current = Promise.resolve();
      pendingDirectVoiceRtcSignalsRef.current = [];
      pendingDirectVoiceLinkSignalsRef.current = [];
      dmRtcStartPromiseRef.current = null;
      dmRtcPeerNativeCapabilityCallIdRef.current = null;
      dmRtcLocalCapabilityRef.current = null;
      dmRtcOnAudioSurfaceRef.current = false;
      dmRtcOpenRef.current = false;
      for (const resolve of dmRtcOpenWaitersRef.current) resolve(false);
      dmRtcOpenWaitersRef.current.clear();
      if (!window.audioSurface || !ownerId) return;
      await window.audioSurface
        .sendCommand({ type: 'stop-direct-voice-rtc', ownerId })
        .catch(() => {});
    },
    []
  );

  const sendAuthenticatedDirectVoiceRtcPayload = useCallback(
    async (input: {
      generation: string;
      signalType:
        | 'capability'
        | 'offer'
        | 'answer'
        | 'candidate'
        | 'ack'
        | 'reconnect';
      payload: string;
    }): Promise<boolean> => {
      const callId = callIdRef.current;
      const roomId = dmRoomIdRef.current;
      const callSessionId = callSessionIdRef.current;
      const mediaSessionGeneration = mediaGenRef.current >>> 0;
      const fromAddress = userInfo?.address?.trim() ?? '';
      const toAddress = peerAddressRef.current?.trim() ?? '';
      const api = window.groupCall;
      if (
        !callId ||
        !roomId ||
        !callSessionId ||
        !fromAddress ||
        !toAddress ||
        !api?.sendRtcSignal ||
        isReticulumCallEnabled
      ) {
        return false;
      }
      const payloadHash = await sha256HexUtf8(input.payload);
      const signalId = crypto.randomUUID();
      const timestamp = Date.now();
      // This must match the canonical, session-bound connection identifier
      // enforced by the wallet signing policy and used by group-call WebRTC.
      // The native RTC generation remains inside the authenticated payload;
      // it must not replace the media-session identity here.
      const connectionId = `${callSessionId}:${mediaSessionGeneration}:${[
        fromAddress,
        toAddress,
      ]
        .sort()
        .join(':')}`;
      const fields = {
        type: 'GC_RTC_SIGNAL',
        roomId,
        callSessionId,
        mediaSessionGeneration,
        fromAddress,
        toAddress,
        connectionId,
        signalId,
        signalType: input.signalType,
        payloadHash,
        fromPublicKey: userInfo?.publicKey ?? '',
        timestamp,
      };
      let signature = '';
      try {
        signature = await signGroupCallFields(fields);
      } catch (error) {
        pushDirectVoiceUiLog('warn', 'WebRTC signal signing failed', {
          signalType: input.signalType,
          callTrunc: callId.slice(0, 8),
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      const publicKey = userInfo?.publicKey ?? '';
      if (
        callIdRef.current !== callId ||
        dmRoomIdRef.current !== roomId ||
        callSessionIdRef.current !== callSessionId ||
        mediaGenRef.current >>> 0 !== mediaSessionGeneration ||
        peerAddressRef.current?.trim() !== toAddress
      ) {
        return false;
      }
      if (!signature || !publicKey) {
        pushDirectVoiceUiLog('warn', 'WebRTC signal signing failed', {
          signalType: input.signalType,
          callTrunc: callId.slice(0, 8),
          error: !signature ? 'missing-signature' : 'missing-public-key',
        });
        return false;
      }
      let result: { success: boolean; error?: string };
      try {
        result = await api.sendRtcSignal({
          roomId,
          callSessionId,
          mediaSessionGeneration,
          fromAddress,
          toAddress,
          connectionId,
          signalId,
          signalType: input.signalType,
          payload: input.payload,
          payloadHash,
          timestamp,
          signature,
          publicKey,
        });
      } catch (error) {
        pushDirectVoiceUiLog('warn', 'WebRTC signal transport failed', {
          signalType: input.signalType,
          callTrunc: callId.slice(0, 8),
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      if (!result.success) {
        pushDirectVoiceUiLog('warn', 'WebRTC signal send rejected', {
          signalType: input.signalType,
          callTrunc: callId.slice(0, 8),
          error: result.error ?? 'unknown',
        });
        return false;
      }
      if (input.signalType !== 'candidate') {
        pushDirectVoiceUiLog('log', 'WebRTC signal queued', {
          signalType: input.signalType,
          callTrunc: callId.slice(0, 8),
        });
      }
      return true;
    },
    [userInfo?.address, userInfo?.publicKey]
  );

  const announceDirectVoiceNativeAudioCapability = useCallback(async () => {
    const expectedCallId = callIdRef.current;
    if (!expectedCallId) return false;
    const existing = dmRtcLocalCapabilityRef.current;
    const capability =
      existing?.callId === expectedCallId
        ? existing
        : {
            callId: expectedCallId,
            capabilityId: crypto.randomUUID(),
            acknowledged: false,
          };
    dmRtcLocalCapabilityRef.current = capability;
    const payload: DirectVoiceCapabilityPayload = {
      ...DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY,
      capabilityId: capability.capabilityId,
    };
    // A successful enqueue only proves that the local bridge accepted the
    // bundle. Retry until the remote application confirms that it accepted
    // this exact, session-bound capability. The bounded backoff avoids control
    // churn while recovering room/link initialization races.
    const retryDelaysMs = [1_000, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000];
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      if (
        callIdRef.current !== expectedCallId ||
        callStateRef.current !== 'connected'
      ) {
        return false;
      }
      if (capability.acknowledged || dmRtcOpenRef.current) return true;
      const queued = await sendAuthenticatedDirectVoiceRtcPayload({
        generation: DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION,
        signalType: 'capability',
        payload: JSON.stringify(payload),
      });
      if (queued) {
        pushDirectVoiceUiLog('log', 'WebRTC capability awaiting peer ack', {
          callTrunc: expectedCallId.slice(0, 8),
          attempt: attempt + 1,
        });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelaysMs[attempt])
      );
    }
    if (capability.acknowledged || dmRtcOpenRef.current) return true;
    pushDirectVoiceUiLog(
      'warn',
      'WebRTC capability was not acknowledged before the retry deadline',
      { callTrunc: expectedCallId.slice(0, 8) }
    );
    return false;
  }, [sendAuthenticatedDirectVoiceRtcPayload]);

  const sendDirectScreenShareSignal = useCallback(
    async (signal: DirectScreenShareRtcSignal): Promise<boolean> => {
      const signalType =
        signal.kind === 'screen-ice'
          ? 'candidate'
          : signal.kind === 'screen-description'
            ? signal.description.type === 'offer'
              ? 'offer'
              : 'answer'
            : 'reconnect';
      return sendAuthenticatedDirectVoiceRtcPayload({
        generation: signal.generation,
        signalType,
        payload: JSON.stringify(signal),
      });
    },
    [sendAuthenticatedDirectVoiceRtcPayload]
  );

  const markScreenShareGenerationTerminal = useCallback(
    (generation: string) => {
      const generations = screenShareTerminalGenerationsRef.current;
      generations.delete(generation);
      generations.add(generation);
      while (generations.size > 32) {
        const oldest = generations.values().next().value;
        if (typeof oldest !== 'string') break;
        generations.delete(oldest);
      }
      screenSharePendingIceRef.current.delete(generation);
    },
    []
  );

  const resetScreenShare = useCallback(
    async (notifyPeer: boolean): Promise<void> => {
      screenShareCaptureAttemptRef.current += 1;
      const transport = screenShareTransportRef.current;
      const generation = transport?.getGeneration() ?? '';
      if (generation) markScreenShareGenerationTerminal(generation);
      screenShareTransportRef.current = null;
      transport?.close();
      const stream = screenShareStreamRef.current;
      screenShareStreamRef.current = null;
      stream?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Already stopped by the operating system.
        }
      });
      screenSharePendingIceRef.current.clear();
      setScreenShareStream(null);
      setScreenShareSources([]);
      setScreenShareViewerOpen(false);
      setScreenShareIsLocal(false);
      updateScreenShareState('idle');
      if (notifyPeer && generation && callStateRef.current === 'connected') {
        await sendDirectScreenShareSignal({
          kind: 'screen-stop',
          generation,
        }).catch(() => false);
      }
    },
    [
      markScreenShareGenerationTerminal,
      sendDirectScreenShareSignal,
      updateScreenShareState,
    ]
  );
  stopScreenShareRef.current = resetScreenShare;

  const createScreenShareTransport = useCallback(
    (
      sender: boolean,
      generation: string,
      localStream?: MediaStream
    ): DirectScreenShareWebRtcTransport => {
      const transport = new DirectScreenShareWebRtcTransport({
        generation,
        sender,
        localStream,
        getIceServers: async () => {
          const servers = await window.hub?.getIceServers?.();
          return Array.isArray(servers) ? servers : [];
        },
        onSignal: (signal) => sendDirectScreenShareSignal(signal),
        onRemoteStream: (stream) => {
          if (screenShareTransportRef.current !== transport) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          screenShareStreamRef.current = stream;
          setScreenShareStream(stream);
          setScreenShareViewerOpen(true);
          for (const track of stream.getVideoTracks()) {
            track.onended = () => {
              if (screenShareTransportRef.current === transport) {
                void resetScreenShare(false);
              }
            };
          }
        },
        onState: (state) => {
          if (screenShareTransportRef.current !== transport) return;
          pushDirectVoiceUiLog(
            state === 'failed' ? 'warn' : 'log',
            'Screen share WebRTC state',
            {
              state,
              role: sender ? 'sender' : 'receiver',
              generation: generation.slice(0, 8),
            }
          );
          if (state === 'open') {
            updateScreenShareState(sender ? 'sharing' : 'viewing');
            setScreenShareViewerOpen(true);
            return;
          }
          if (state === 'failed') {
            showGlobalCallSnack(
              'info',
              'Screen sharing stopped because the direct connection was lost.'
            );
            void resetScreenShare(true);
          }
        },
      });
      return transport;
    },
    [
      resetScreenShare,
      sendDirectScreenShareSignal,
      showGlobalCallSnack,
      updateScreenShareState,
    ]
  );

  const handleDirectScreenShareSignal = useCallback(
    async (signal: DirectScreenShareRtcSignal): Promise<void> => {
      if (
        callStateRef.current !== 'connected' ||
        audioModeRef.current !== 'webrtc'
      ) {
        return;
      }
      if (
        signal.kind !== 'screen-stop' &&
        screenShareTerminalGenerationsRef.current.has(signal.generation)
      ) {
        return;
      }
      if (signal.kind === 'screen-stop') {
        markScreenShareGenerationTerminal(signal.generation);
        if (
          screenShareTransportRef.current?.getGeneration() === signal.generation
        ) {
          await resetScreenShare(false);
        }
        return;
      }
      let transport = screenShareTransportRef.current;
      if (
        signal.kind === 'screen-description' &&
        signal.description.type === 'offer'
      ) {
        // Candidates can overtake an offer while its wallet signature is
        // being verified. Capture them before any simultaneous-share cleanup.
        const pendingForOffer =
          screenSharePendingIceRef.current.get(signal.generation) ?? [];
        if (transport?.isSender()) {
          const localAddress = userInfo?.address?.trim() ?? '';
          const peerAddress = peerAddressRef.current?.trim() ?? '';
          // Deterministically resolve the rare case where both users press
          // Share at once. The lexicographically smaller address keeps its
          // share; both clients independently reach the same decision.
          const keepLocalShare =
            localAddress && peerAddress
              ? localAddress < peerAddress
              : transport.getGeneration() < signal.generation;
          if (keepLocalShare) return;
          await resetScreenShare(false);
          transport = null;
        }
        if (!transport || transport.getGeneration() !== signal.generation) {
          const previousGeneration = transport?.getGeneration();
          if (previousGeneration) {
            markScreenShareGenerationTerminal(previousGeneration);
          }
          await resetScreenShare(false);
          if (pendingForOffer.length > 0) {
            screenSharePendingIceRef.current.set(
              signal.generation,
              pendingForOffer
            );
          }
          transport = createScreenShareTransport(false, signal.generation);
          screenShareTransportRef.current = transport;
          updateScreenShareState('starting');
        }
      }
      if (!transport || transport.getGeneration() !== signal.generation) {
        if (signal.kind === 'screen-ice') {
          const pending =
            screenSharePendingIceRef.current.get(signal.generation) ?? [];
          if (pending.length < 128) pending.push(signal);
          screenSharePendingIceRef.current.set(signal.generation, pending);
          while (screenSharePendingIceRef.current.size > 4) {
            const oldest = screenSharePendingIceRef.current.keys().next().value;
            if (typeof oldest !== 'string') break;
            screenSharePendingIceRef.current.delete(oldest);
          }
        }
        return;
      }
      await transport.handleSignal(signal);
      const pending =
        screenSharePendingIceRef.current.get(signal.generation) ?? [];
      screenSharePendingIceRef.current.delete(signal.generation);
      for (const candidate of pending) {
        await transport.handleSignal(candidate);
      }
    },
    [
      createScreenShareTransport,
      markScreenShareGenerationTerminal,
      resetScreenShare,
      updateScreenShareState,
      userInfo?.address,
    ]
  );
  screenShareSignalHandlerRef.current = handleDirectScreenShareSignal;

  const openScreenSharePicker = useCallback(async (): Promise<void> => {
    if (
      callStateRef.current !== 'connected' ||
      audioModeRef.current !== 'webrtc' ||
      !screenShareSupportedRef.current
    ) {
      return;
    }
    if (screenShareStateRef.current === 'sharing') {
      setScreenShareViewerOpen(true);
      return;
    }
    const listSources = window.electronAPI?.listScreenShareSources;
    if (!listSources) {
      showGlobalCallSnack('error', 'Screen sharing is unavailable.');
      return;
    }
    updateScreenShareState('choosing');
    setScreenShareViewerOpen(true);
    const result = await listSources().catch(() => ({
      success: false,
      error: 'Unable to access screens and windows',
      sources: [],
    }));
    if (
      callStateRef.current !== 'connected' ||
      screenShareStateRef.current !== 'choosing'
    ) {
      return;
    }
    if (!result.success || result.sources.length === 0) {
      await resetScreenShare(false);
      showGlobalCallSnack(
        'error',
        result.error || 'No screens or windows are available to share.'
      );
      return;
    }
    setScreenShareSources(result.sources);
  }, [resetScreenShare, showGlobalCallSnack, updateScreenShareState]);

  const cancelScreenSharePicker = useCallback(() => {
    if (screenShareStateRef.current === 'choosing') {
      void resetScreenShare(false);
    } else {
      setScreenShareViewerOpen(false);
    }
  }, [resetScreenShare]);

  const startScreenShare = useCallback(
    async (sourceId: string): Promise<void> => {
      if (
        callStateRef.current !== 'connected' ||
        audioModeRef.current !== 'webrtc' ||
        !screenShareSupportedRef.current ||
        screenShareStateRef.current !== 'choosing' ||
        !screenShareSources.some((source) => source.id === sourceId)
      ) {
        return;
      }
      updateScreenShareState('starting');
      setScreenShareIsLocal(true);
      setScreenShareSources([]);
      const captureAttempt = ++screenShareCaptureAttemptRef.current;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 30,
            },
          } as unknown as MediaTrackConstraints,
        });
      } catch (error) {
        await resetScreenShare(false);
        showGlobalCallSnack(
          'error',
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Screen sharing permission was not granted.'
            : 'Unable to start screen sharing.'
        );
        return;
      }
      if (screenShareCaptureAttemptRef.current !== captureAttempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (
        screenShareStateRef.current !== 'starting' ||
        callStateRef.current !== 'connected' ||
        audioModeRef.current !== 'webrtc'
      ) {
        stream.getTracks().forEach((track) => track.stop());
        await resetScreenShare(false);
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((entry) => entry.stop());
        await resetScreenShare(false);
        showGlobalCallSnack('error', 'No screen video was captured.');
        return;
      }
      track.contentHint = 'detail';
      const generation = createDirectVoiceRtcSignalId();
      pushDirectVoiceUiLog('log', 'Starting screen share', {
        generation: generation.slice(0, 8),
      });
      const transport = createScreenShareTransport(true, generation, stream);
      screenShareTransportRef.current = transport;
      screenShareStreamRef.current = stream;
      setScreenShareStream(stream);
      setScreenShareViewerOpen(true);
      track.onended = () => {
        if (screenShareTransportRef.current === transport) {
          void resetScreenShare(true);
        }
      };
      try {
        await transport.startSender();
      } catch {
        if (screenShareTransportRef.current === transport) {
          await resetScreenShare(true);
          showGlobalCallSnack('error', 'Unable to establish screen sharing.');
        }
      }
    },
    [
      createScreenShareTransport,
      resetScreenShare,
      screenShareSources,
      showGlobalCallSnack,
      updateScreenShareState,
    ]
  );

  const stopScreenShare = useCallback(
    () => resetScreenShare(true),
    [resetScreenShare]
  );

  const startDirectVoiceMediaOnAudioSurface = useCallback(async () => {
    const ownerId = ensureDirectVoiceOwnerId();
    const roomId = dmRoomIdRef.current;
    const peer = peerAddressRef.current;
    const roomKey = roomKeyRef.current;
    const localAddress = userInfo?.address ?? '';
    if (
      !window.audioSurface ||
      !ownerId ||
      !roomId ||
      !peer ||
      !roomKey ||
      !localAddress
    ) {
      dmMediaOnAudioSurfaceRef.current = false;
      return false;
    }
    const keyBuffer = roomKey.slice().buffer as ArrayBuffer;
    const response = await window.audioSurface
      .sendCommand({
        type: 'start-direct-voice-media',
        ownerId,
        roomId,
        peerAddress: peer,
        localAddress,
        roomKey: keyBuffer,
        inputDeviceId: callAudioPrefsRef.current.inputDeviceId ?? null,
        outputDeviceId: callAudioPrefsRef.current.outputDeviceId ?? null,
        muted: isMutedRef.current,
        hearCall: hearCallRef.current,
        profile: readGroupCallAudioProfile(),
      })
      .catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }));
    dmMediaOnAudioSurfaceRef.current = response.ok === true;
    dmReceiveOnAudioSurfaceRef.current = response.ok === true;
    if (!response.ok) {
      pushDirectVoiceUiLog('warn', 'audio-surface DM media unavailable', {
        err: response.error ?? 'unknown',
      });
    }
    return response.ok === true;
  }, [ensureDirectVoiceOwnerId, userInfo?.address]);

  const updateDirectVoiceMediaOnAudioSurface = useCallback(async () => {
    if (
      (!dmMediaOnAudioSurfaceRef.current && !dmRtcOnAudioSurfaceRef.current) ||
      !window.audioSurface ||
      !directVoiceOwnerIdRef.current
    ) {
      return;
    }
    await window.audioSurface
      .sendCommand({
        type: 'update-direct-voice-media',
        ownerId: directVoiceOwnerIdRef.current,
        inputDeviceId: callAudioPrefsRef.current.inputDeviceId ?? null,
        outputDeviceId: callAudioPrefsRef.current.outputDeviceId ?? null,
        muted: isMutedRef.current,
        hearCall: hearCallRef.current,
        profile: readGroupCallAudioProfile(),
      })
      .catch(() => {});
  }, []);

  const stopDirectVoiceMediaOnAudioSurface = useCallback(
    async (ownerId = directVoiceOwnerIdRef.current) => {
      if (!dmMediaOnAudioSurfaceRef.current || !window.audioSurface) {
        dmMediaOnAudioSurfaceRef.current = false;
        return;
      }
      dmMediaOnAudioSurfaceRef.current = false;
      dmReceiveOnAudioSurfaceRef.current = false;
      if (!ownerId) return;
      await window.audioSurface
        .sendCommand({ type: 'stop-direct-voice-media', ownerId })
        .catch(() => {});
    },
    []
  );

  const updateDirectVoiceReceiveOnAudioSurface = useCallback(async () => {
    const ownerId = directVoiceOwnerIdRef.current;
    if (!dmReceiveOnAudioSurfaceRef.current || !window.audioSurface || !ownerId)
      return;
    await window.audioSurface
      .sendCommand({
        type: 'update-direct-voice-receive',
        ownerId,
        outputDeviceId: callAudioPrefsRef.current.outputDeviceId ?? null,
        hearCall: hearCallRef.current,
        profile: readGroupCallAudioProfile(),
      })
      .catch(() => {});
  }, []);

  const stopDirectVoiceReceiveOnAudioSurface = useCallback(
    async (ownerId = directVoiceOwnerIdRef.current) => {
      if (dmMediaOnAudioSurfaceRef.current) {
        return;
      }
      if (!dmReceiveOnAudioSurfaceRef.current || !window.audioSurface) {
        dmReceiveOnAudioSurfaceRef.current = false;
        return;
      }
      dmReceiveOnAudioSurfaceRef.current = false;
      if (!ownerId) return;
      await window.audioSurface
        .sendCommand({ type: 'stop-direct-voice-receive', ownerId })
        .catch(() => {});
    },
    []
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

  const waitForDmPeerMediaReadiness = useCallback(
    async (
      roomId: string,
      peer: string,
      reason: string,
      options?: { cancelled?: () => boolean }
    ): Promise<boolean> => {
      const gc = (window as any).groupCall;
      if (!roomId || !peer) {
        pushDirectVoiceUiLog('warn', 'DM media readiness skipped: bad inputs', {
          reason,
          hasRoom: !!roomId,
          hasPeer: !!peer,
        });
        return false;
      }
      const deadline = Date.now() + DM_MEDIA_READINESS_TIMEOUT_MS;
      let lastWarmupAt = 0;
      let lastLogAt = 0;

      let deadlineReached = false;
      do {
        if (options?.cancelled?.()) return false;
        if (
          callStateRef.current !== 'connected' ||
          !reticulumSessionActiveRef.current ||
          dmRoomIdRef.current !== roomId ||
          peerAddressRef.current !== peer
        ) {
          pushDirectVoiceUiLog('log', 'DM media readiness cancelled', {
            reason,
            peerTrunc: peer.slice(0, 8),
          });
          return false;
        }

        const now = Date.now();
        deadlineReached = now >= deadline;
        if (
          !deadlineReached &&
          now - lastWarmupAt >= DM_MEDIA_READINESS_WARMUP_MS
        ) {
          lastWarmupAt = now;
          if (typeof gc?.requestPeerMediaRecovery === 'function') {
            void gc
              .requestPeerMediaRecovery(roomId, peer, `dm-readiness:${reason}`)
              .catch(() => {});
          }
        }

        let peerInRoom = false;
        let participantCount = 0;
        if (typeof gc?.getRoomParticipants === 'function') {
          try {
            const participants = await gc.getRoomParticipants(roomId);
            if (Array.isArray(participants)) {
              participantCount = participants.length;
              peerInRoom = participants.some(
                (participant: { address?: string }) =>
                  participant?.address === peer
              );
            }
          } catch {
            /* keep polling */
          }
        }

        let establishedLinks = 0;
        if (typeof gc?.getLinkStats === 'function') {
          try {
            const response = await gc.getLinkStats(roomId);
            establishedLinks =
              response?.success === true &&
              typeof response.stats?.establishedLinks === 'number'
                ? response.stats.establishedLinks
                : 0;
            participantCount = Math.max(
              participantCount,
              typeof response?.stats?.participants === 'number'
                ? response.stats.participants
                : 0
            );
          } catch {
            /* keep polling */
          }
        }

        const routeReady = establishedLinks > 0;
        const peerKnown = peerInRoom || participantCount >= 2;
        if (peerKnown && routeReady) {
          pushDirectVoiceUiLog('log', 'DM media readiness ok', {
            reason,
            peerTrunc: peer.slice(0, 8),
            participantCount,
            establishedLinks,
          });
          return true;
        }

        // The query above is the final readiness check at the deadline. This
        // avoids rejecting a link that became active during the last poll.
        if (!deadlineReached && now - lastLogAt >= 2_000) {
          lastLogAt = now;
          pushDirectVoiceUiLog('log', 'waiting for DM media readiness', {
            reason,
            peerTrunc: peer.slice(0, 8),
            peerKnown,
            participantCount,
            establishedLinks,
          });
        }

        if (!deadlineReached) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.max(
                0,
                Math.min(DM_MEDIA_READINESS_POLL_MS, deadline - Date.now())
              )
            )
          );
        }
      } while (!deadlineReached);

      pushDirectVoiceUiLog('warn', 'DM media readiness timed out', {
        reason,
        peerTrunc: peer.slice(0, 8),
      });
      return false;
    },
    []
  );

  /**
   * Start capture as soon as either transport is genuinely usable. This keeps
   * the WebRTC fast path fast without weakening the proven Reticulum fallback
   * for older clients, failed ICE negotiation, or restrictive NATs.
   */
  const waitForDmMediaTransportReadiness = useCallback(
    async (roomId: string, peer: string, reason: string): Promise<boolean> => {
      if (!prefersDirectVoiceWebRtc) {
        return waitForDmPeerMediaReadiness(roomId, peer, reason);
      }
      if (dmRtcOpenRef.current) return true;

      let settled = false;
      let resolveRtc!: (ready: boolean) => void;
      const rtcReady = new Promise<boolean>((resolve) => {
        resolveRtc = resolve;
        dmRtcOpenWaitersRef.current.add(resolve);
        if (dmRtcOpenRef.current) resolve(true);
      });
      const reticulumReady = waitForDmPeerMediaReadiness(roomId, peer, reason, {
        cancelled: () => settled,
      });
      const ready = await Promise.race([rtcReady, reticulumReady]);
      settled = true;
      dmRtcOpenWaitersRef.current.delete(resolveRtc);
      return ready;
    },
    [prefersDirectVoiceWebRtc, waitForDmPeerMediaReadiness]
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
      const friendPk =
        dmFriendsByAddressRef.current[peer]?.publicKey ??
        optionsRef.current.getPeerPublicKey?.(peer) ??
        '';
      if (!friendPk) {
        pushDirectVoiceUiLog(
          'warn',
          'no friend publicKey for peer (cannot send GC_KEY)',
          {
            peerTrunc: peer.slice(0, 8),
            reason,
          }
        );
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
      pushDirectVoiceUiLog(
        ok ? 'log' : 'warn',
        ok ? 'GC_KEY sent to peer' : 'GC_KEY send failed',
        {
          peerTrunc: peer.slice(0, 8),
          reason,
        }
      );
      return ok;
    },
    [userInfo?.address, userInfo?.publicKey]
  );

  const scheduleDmRoomKeyReplays = useCallback(
    (reason: string) => {
      clearDmRoomKeyReplayTimers();
      for (
        let attempt = 1;
        attempt <= DM_ROOM_KEY_REPLAY_MAX_ATTEMPTS;
        attempt++
      ) {
        const timer = setTimeout(() => {
          dmRoomKeyReplayTimersRef.current.delete(timer);
          void sendCurrentDmRoomKey(`${reason}:retry-${attempt}`).catch(
            () => {}
          );
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
          if (roomKeyRef.current || callStateRef.current !== 'connected')
            return;
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

  const stopOutboundRingtone = useCallback(() => {
    stopOutboundRingtoneRef.current?.();
    stopOutboundRingtoneRef.current = null;
  }, []);

  const stopCapturePipeline = useCallback(async () => {
    await dmSenderEngineRef.current?.stop().catch(() => {});
    opusEncoderApplyBitrateRef.current = () => {};
    opusEncoderLastConfiguredBitrateRef.current = null;
  }, []);

  const teardownReticulumMediaInner = useCallback(async () => {
    const ownerId = directVoiceOwnerIdRef.current;
    clearDmRoomKeyReplayTimers();
    clearDmRoomKeyRequestTimers();
    await resetScreenShare(false);
    screenShareSupportedRef.current = false;
    setScreenShareSupported(false);
    await stopDirectVoiceRtcOnAudioSurface(ownerId);
    await stopDirectVoiceMediaOnAudioSurface(ownerId);
    await stopDirectVoiceReceiveOnAudioSurface(ownerId);
    await dmReceiveEngineRef.current?.dispose();
    dmReceiveEngineRef.current = new GroupCallAudioReceiveEngine(() => {});
    await stopCapturePipeline();

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
    audioModeRef.current = null;
    setAudioMode(null);
    if (directVoiceOwnerIdRef.current === ownerId) {
      directVoiceOwnerIdRef.current = null;
      directVoiceOwnerCallIdRef.current = null;
    }
  }, [
    clearPendingWorkerJobs,
    clearDmRoomKeyReplayTimers,
    clearDmRoomKeyRequestTimers,
    resetDmVoiceMediaSession,
    resetScreenShare,
    stopCapturePipeline,
    stopDirectVoiceRtcOnAudioSurface,
    stopDirectVoiceMediaOnAudioSurface,
    stopDirectVoiceReceiveOnAudioSurface,
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

  useEffect(() => {
    unmountVoiceCallCleanupRef.current = () => {
      clearDurationTimer();
      const id = callIdRef.current;
      const state = callStateRef.current;
      const needsHangup =
        Boolean(id) &&
        (state === 'connected' || state === 'calling' || state === 'ringing');
      if (needsHangup && id) {
        const timestamp = Date.now();
        void authorizeCallSignal({ type: 'CALL_HANGUP', callId: id, timestamp })
          .then(({ signature, publicKey }) =>
            callApiRef.current?.hangup?.(id, signature, publicKey, timestamp)
          )
          .catch(() => {})
          .finally(() => {
            enqueueTeardownReticulumMedia();
          });
        return;
      }
      enqueueTeardownReticulumMedia();
    };
  }, [authorizeCallSignal, clearDurationTimer, enqueueTeardownReticulumMedia]);

  const endCall = useCallback(
    async (sendHangup = false) => {
      const id = callIdRef.current;
      clearDurationTimer();

      const applyLocalCallEnd = () => {
        callIdRef.current = null;
        isOutboundCallRef.current = false;
        activeCallChatIdRef.current = null;
        setActiveCallChatId(null);
        updateCallState('ended');
        setCallMediaReady(false);
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
        try {
          const { signature, publicKey } = await authorizeCallSignal({
            type: 'CALL_HANGUP',
            callId: id,
            timestamp,
          });
          await callApiRef.current?.hangup?.(
            id,
            signature,
            publicKey,
            timestamp
          );
        } catch {
          // Local teardown must still complete before switching to another call.
        }
        await enqueueTeardownReticulumMedia();
        return;
      }

      await enqueueTeardownReticulumMedia();
      applyLocalCallEnd();
    },
    [
      clearDurationTimer,
      enqueueTeardownReticulumMedia,
      authorizeCallSignal,
      updateCallState,
      updateIncomingCall,
    ]
  );

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
          pushDirectVoiceUiLog(
            'warn',
            'drop inbound audio: fromAddress !== peer',
            {
              fromTrunc: fromAddress.slice(0, 8),
              peerTrunc: peer.slice(0, 8),
            }
          );
        }
        return;
      }
      if (dmReceiveOnAudioSurfaceRef.current) {
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
      pushDirectVoiceUiLog(
        'warn',
        'AudioDecryptWorker unavailable; using inline audio crypto',
        {
          err: String(e),
        }
      );
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
          void pushDecodedDmAudioPacketsRef.current(
            decodedList,
            pending.fromAddress
          );
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
    async (
      payload: {
        callSessionId: string;
        mediaSessionGeneration: number;
        keyCommitment: string;
        fromAddress: string;
      },
      decryptedKeyB64: string
    ) => {
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
      const ready = await waitForDmMediaTransportReadiness(
        dmRoomIdRef.current ?? '',
        peerAddressRef.current ?? '',
        'key-applied'
      );
      if (!ready) {
        showGlobalCallSnack(
          'info',
          i18n.t('core:voice_call.failed') ??
            'Voice call failed (Reticulum route not ready)'
        );
        endCall(true);
        return;
      }
      const mediaStarted = await startDirectVoiceMediaOnAudioSurface();
      if (!mediaStarted) {
        showGlobalCallSnack(
          'info',
          i18n.t('core:voice_call.failed') ??
            'Voice call failed (audio surface unavailable)'
        );
        endCall(true);
        return;
      }
      if (audioModeRef.current !== 'webrtc') {
        audioModeRef.current = 'reticulum';
        setAudioMode('reticulum');
      }
      clearDmRoomKeyRequestTimers();
      setCallAudioWireNonce((n) => n + 1);
      pushDirectVoiceUiLog('log', 'room key applied', {
        sessionTrunc: String(payload.callSessionId).slice(0, 8),
        mediaGen: payload.mediaSessionGeneration ?? 1,
      });
    },
    [
      clearDmRoomKeyRequestTimers,
      endCall,
      resetDmVoiceMediaSession,
      showGlobalCallSnack,
      startDirectVoiceMediaOnAudioSurface,
      waitForDmMediaTransportReadiness,
    ]
  );
  applyDecryptedRoomKeyRef.current = applyDecryptedRoomKey;

  const sendEncodedFrame = useCallback(
    (frame: GroupCallAudioSenderFrame) => {
      const {
        opusFrame,
        vad,
        capturePerfMs,
        encoderInputPerfMs,
        encodeOutPerfMs,
      } = frame;
      const rk = roomKeyRef.current;
      const my = userInfo?.address;
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      const gc = (window as any).groupCall;
      if (!rk || !my || !roomId || !peer || !gc?.sendAudio) return;
      if (isMutedRef.current) return;

      const seq = ++audioSeqRef.current & 0xffff;
      const ts = Date.now() & 0xffffffff;
      metricsRef.current.recordGcallSenderPreEncodePipeline({
        workletToMainThreadMs: Math.max(0, encoderInputPerfMs - capturePerfMs),
        mainThreadToEncoderOutputMs: Math.max(
          0,
          encodeOutPerfMs - encoderInputPerfMs
        ),
        workletToEncoderOutputMs: Math.max(0, encodeOutPerfMs - capturePerfMs),
      });
      metricsRef.current.recordGcallSenderEncoderToPacketTimestampGap(
        Math.max(0, performance.now() - encodeOutPerfMs)
      );
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
            vad,
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
        packet = encodeAudioPacketV2(my, vad, seq, ts, opusFrame, rk);
      } catch (e) {
        pushDirectVoiceUiLog('warn', 'encodeAudioPacketV2 failed', {
          err: String(e),
        });
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
    if (!dmMediaOnAudioSurfaceRef.current) {
      pushDirectVoiceUiLog(
        'warn',
        'DM media capture blocked: audio-surface is required'
      );
    }
  }, [userInfo?.address]);
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
      if (
        p.verified !== true ||
        p.keyMessageVersion !== GCALL_KEY_MESSAGE_VERSION
      ) {
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
          pushDirectVoiceUiLog(
            'warn',
            'decryptBoxWithMyKey returned no decryptedKey'
          );
        }
      } catch (e) {
        console.error('[DM voice] key decrypt failed', e);
        pushDirectVoiceUiLog('warn', 'decryptBoxWithMyKey failed', {
          err: String(e),
        });
      }
    },
    [userInfo?.address]
  );

  const flushPendingDmVoiceGcallKey = useCallback(
    (roomId: string) => {
      const pending = pendingDmVoiceGcallKeyRef.current;
      if (!pending) return;
      if (pending.roomId !== roomId) {
        pushDirectVoiceUiLog(
          'warn',
          'discarding pending gcall:key (roomId != session)',
          {
            pendingTrunc: String(pending.roomId ?? '').slice(0, 24),
            sessionTrunc: roomId.slice(0, 24),
          }
        );
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
      pushDirectVoiceUiLog(
        'warn',
        'startReticulumMediaSession aborted: bad inputs',
        {
          hasChat: !!chatId,
          hasAddr: !!myAddr,
          hasPeer: !!peer,
        }
      );
      endCall(false);
      return;
    }

    const roomId = await buildDmVoiceRoomId(chatId);
    if (dmRoomIdRef.current && dmRoomIdRef.current !== roomId) {
      pushDirectVoiceUiLog(
        'warn',
        'DM room id mismatch (precomputed vs build)',
        {
          preTrunc: dmRoomIdRef.current.slice(0, 24),
          builtTrunc: roomId.slice(0, 24),
        }
      );
    }
    dmRoomIdRef.current = roomId;
    pushDirectVoiceUiLog('log', 'media session start', {
      outbound: isOutboundCallRef.current,
      roomTrunc: roomId.slice(0, 32),
      peerTrunc: peer.slice(0, 8),
    });

    const retHash = await fetchLocalReticulumDestinationHash();
    if (!retHash) {
      pushDirectVoiceUiLog('warn', 'Reticulum destination hash unavailable');
      showGlobalCallSnack(
        'info',
        i18n.t('core:voice_call.failed') ??
          'Voice call failed (Reticulum not ready)'
      );
      endCall(true);
      return;
    }
    pushDirectVoiceUiLog('log', 'Reticulum hash ok', {
      hashTrunc: retHash.slice(0, 8),
    });

    const reticulumIdentityPublicKeyBase64 =
      await fetchLocalReticulumIdentityPublicKeyBase64();
    if (reticulumIdentityPublicKeyBase64) {
      pushDirectVoiceUiLog('log', 'Reticulum identity key ok');
    } else {
      pushDirectVoiceUiLog(
        'log',
        'Reticulum identity key unavailable; using join-only GC_JOIN'
      );
    }

    const joinRes = await joinDirectVoiceReticulumRoom({
      roomId,
      chatId,
      address: myAddr,
      publicKey: myPk,
      reticulumDestinationHash: retHash,
      reticulumIdentityPublicKeyBase64,
      dmVoiceAudioLinkRole: isOutboundCallRef.current ? 'waiter' : 'opener',
      peerDestinationHash: optionsRef.current.getPeerDestinationHash?.(peer),
      callId: callIdRef.current ?? undefined,
    });

    if (!joinRes.success || !joinRes.callSessionId) {
      pushDirectVoiceUiLog('warn', 'GC_JOIN failed', {
        error: joinRes.error ?? 'unknown',
        success: joinRes.success,
      });
      showGlobalCallSnack(
        'info',
        i18n.t('core:voice_call.failed') ??
          'Voice call failed (could not join media room)'
      );
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
    const pendingLinkSignals =
      pendingDirectVoiceLinkSignalsRef.current.splice(0);
    for (const pendingSignal of pendingLinkSignals) {
      await groupCallDmIpcHandlerRef.current('gcall:rtc-signal', pendingSignal);
    }
    // WebRTC setup uses the authenticated audio link's reliable control
    // channel, so it cannot be advertised until this DM media room exists.
    if (prefersDirectVoiceWebRtc) {
      void announceDirectVoiceNativeAudioCapability().catch(() => {});
      if (dmRtcPeerNativeCapabilityCallIdRef.current === callIdRef.current) {
        void startDirectVoiceRtcOnAudioSurface().catch(() => {});
      }
    }
    // A key can arrive immediately after CALL_ACCEPT, before GC_JOIN finishes.
    // Applying it earlier makes readiness see an inactive session and can end a
    // valid call. Replay it only after this exact media session is active.
    flushPendingDmVoiceGcallKey(roomId);
    if (audioModeRef.current !== 'webrtc') {
      audioModeRef.current = 'reticulum';
      setAudioMode('reticulum');
    }
    requestDmPeerMediaWarmup(roomId, 'dm-call-start', {
      ignoreCooldown: true,
    });
    if (isOutboundCallRef.current) {
      const roomKey = new Uint8Array(32);
      crypto.getRandomValues(roomKey);
      roomKeyRef.current = roomKey;
      void sendCurrentDmRoomKey('dm-call-start').catch(() => {});
      scheduleDmRoomKeyReplays('dm-call-start');
      const ready = await waitForDmMediaTransportReadiness(
        roomId,
        peer,
        'caller-start'
      );
      if (
        callStateRef.current !== 'connected' ||
        !reticulumSessionActiveRef.current ||
        dmRoomIdRef.current !== roomId ||
        peerAddressRef.current !== peer
      ) {
        return;
      }
      if (!ready) {
        showGlobalCallSnack(
          'info',
          i18n.t('core:voice_call.failed') ??
            'Voice call failed (Reticulum route not ready)'
        );
        endCall(true);
        return;
      }
      const mediaStarted = await startDirectVoiceMediaOnAudioSurface();
      if (!mediaStarted) {
        showGlobalCallSnack(
          'info',
          i18n.t('core:voice_call.failed') ??
            'Voice call failed (audio surface unavailable)'
        );
        endCall(true);
        return;
      }
      await startReticulumCapture();
    } else {
      /* Callee: request the room key until caller/link timing delivers it. */
      pushDirectVoiceUiLog(
        'log',
        'callee: requesting gcall:key (or capture if key ready)'
      );
      if (roomKeyRef.current) {
        await startReticulumCapture();
      } else {
        scheduleDmRoomKeyRequests('dm-call-start');
      }
    }
  }, [
    announceDirectVoiceNativeAudioCapability,
    endCall,
    flushPendingDmVoiceGcallKey,
    requestDmPeerMediaWarmup,
    scheduleDmRoomKeyReplays,
    scheduleDmRoomKeyRequests,
    sendCurrentDmRoomKey,
    showGlobalCallSnack,
    startDirectVoiceMediaOnAudioSurface,
    startDirectVoiceRtcOnAudioSurface,
    startReticulumCapture,
    waitForDmMediaTransportReadiness,
    userInfo?.address,
    userInfo?.publicKey,
  ]);

  groupCallDmIpcHandlerRef.current = async (
    event: string,
    payload: unknown
  ) => {
    if (event === 'gcall:rtc-signal') {
      const p = payload as GcallDirectRtcEventPayload;
      const callId = callIdRef.current;
      const isDirectSignalType =
        p.signalType === 'capability' ||
        p.signalType === 'offer' ||
        p.signalType === 'answer' ||
        p.signalType === 'candidate' ||
        p.signalType === 'ack' ||
        p.signalType === 'reconnect';
      const invalidActiveCallRoute =
        p.verified !== true ||
        !isDirectSignalType ||
        !callId ||
        p.roomId !== dmRoomIdRef.current ||
        p.fromAddress !== peerAddressRef.current ||
        p.toAddress !== userInfo?.address ||
        typeof p.payload !== 'string';
      if (invalidActiveCallRoute) {
        return;
      }
      if (!callSessionIdRef.current) {
        const pending = pendingDirectVoiceLinkSignalsRef.current;
        if (pending.length >= 16) pending.shift();
        pending.push({ ...p });
        return;
      }
      if (
        p.callSessionId !== callSessionIdRef.current ||
        (p.mediaSessionGeneration ?? -1) >>> 0 !== mediaGenRef.current >>> 0
      ) {
        return;
      }
      let signalGeneration = '';
      let decodedPayload: Record<string, unknown>;
      try {
        const decoded = JSON.parse(p.payload) as {
          kind?: unknown;
          audio?: unknown;
          version?: unknown;
          generation?: unknown;
        };
        decodedPayload = decoded;
        signalGeneration =
          typeof decoded.generation === 'string'
            ? decoded.generation
            : decoded.kind === 'capability' &&
                decoded.audio === 'native-track' &&
                decoded.version === 1
              ? DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION
              : '';
      } catch {
        return;
      }
      if (!signalGeneration) return;
      if (p.signalType === 'ack') {
        const localCapability = dmRtcLocalCapabilityRef.current;
        if (
          decodedPayload.kind !== 'capability-ack' ||
          signalGeneration !==
            DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION ||
          typeof decodedPayload.capabilityId !== 'string' ||
          localCapability?.callId !== callId ||
          decodedPayload.capabilityId !== localCapability.capabilityId
        ) {
          return;
        }
        localCapability.acknowledged = true;
        pushDirectVoiceUiLog('log', 'WebRTC capability acknowledged', {
          callTrunc: callId.slice(0, 8),
        });
        return;
      }
      await callIpcHandlerRef.current('call:rtc-signal', {
        callId,
        generation: signalGeneration,
        signalType: p.signalType!,
        payload: p.payload,
      });
      if (
        p.signalType === 'capability' &&
        decodedPayload.kind === 'capability' &&
        decodedPayload.audio === 'native-track' &&
        decodedPayload.version === 1 &&
        typeof decodedPayload.capabilityId === 'string' &&
        decodedPayload.capabilityId.length > 0 &&
        decodedPayload.capabilityId.length <= 128 &&
        dmRtcPeerNativeCapabilityCallIdRef.current === callId &&
        dmRtcOnAudioSurfaceRef.current
      ) {
        const ack: DirectVoiceCapabilityAckPayload = {
          kind: 'capability-ack',
          generation: DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION,
          capabilityId: decodedPayload.capabilityId,
        };
        await sendAuthenticatedDirectVoiceRtcPayload({
          generation: DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION,
          signalType: 'ack',
          payload: JSON.stringify(ack),
        });
      }
      return;
    }

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
        pushDirectVoiceUiLog(
          'warn',
          'gcall:key ignored (not a DM voice room id)',
          {
            roomId: p.roomId,
          }
        );
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
      if (!reticulumSessionActiveRef.current) {
        pendingDmVoiceGcallKeyRef.current = p;
        pushDirectVoiceUiLog(
          'log',
          'gcall:key queued (media session is still joining)'
        );
        return;
      }
      void handleDmVoiceGcallKeyPayload(p);
      return;
    }

    if (event === 'gcall:audio') {
      const p = payload as {
        roomId?: string;
      };
      if (!isDmVoiceRoomId(p.roomId) || p.roomId !== dmRoomIdRef.current)
        return;
      dmVoiceAudioPacketCountRef.current += 1;
      const now = Date.now();
      if (now - dmVoiceLastAudioUiLogAtRef.current >= 2500) {
        dmVoiceLastAudioUiLogAtRef.current = now;
        pushDirectVoiceUiLog(
          'log',
          'gcall:audio rx ignored by renderer (audio-surface owns DM media)',
          {
            packets: dmVoiceAudioPacketCountRef.current,
            audioSurfaceMedia: dmMediaOnAudioSurfaceRef.current,
          },
          'debug'
        );
      }
    }
  };

  useEffect(() => {
    const gc = (window as any).groupCall;
    if (!gc?.onEvent) return;
    return gc.onEvent((event: string, payload: unknown) => {
      void groupCallDmIpcHandlerRef.current(event, payload);
    });
  }, []);

  useEffect(() => {
    if (!window.audioSurface?.onEvent) return;
    return window.audioSurface.onEvent((event) => {
      const roomId = dmRoomIdRef.current;
      const peer = peerAddressRef.current;
      if (
        'ownerId' in event &&
        event.ownerId !== directVoiceOwnerIdRef.current
      ) {
        return;
      }
      if (
        'roomId' in event &&
        'peerAddress' in event &&
        (event.roomId !== roomId || event.peerAddress !== peer)
      ) {
        return;
      }
      if (event.type === 'direct-voice-media-ready') {
        setCallMediaReady(true);
        pushDirectVoiceUiLog('log', 'direct voice media ready', {
          roomTrunc: event.roomId.slice(0, 24),
          peerTrunc: event.peerAddress.slice(0, 8),
        });
        return;
      }
      if (event.type === 'direct-voice-rtc-state') {
        dmRtcOpenRef.current = event.state === 'open';
        pushDirectVoiceUiLog(
          event.state === 'failed' ? 'warn' : 'log',
          'WebRTC transport state',
          {
            state: event.state,
            roomTrunc: event.roomId.slice(0, 24),
            peerTrunc: event.peerAddress.slice(0, 8),
          }
        );
        if (event.state === 'open') {
          for (const resolve of dmRtcOpenWaitersRef.current) resolve(true);
          dmRtcOpenWaitersRef.current.clear();
        }
        const nextAudioMode = event.state === 'open' ? 'webrtc' : 'reticulum';
        audioModeRef.current = nextAudioMode;
        setAudioMode(nextAudioMode);
        if (
          (event.state === 'failed' || event.state === 'closed') &&
          screenShareStateRef.current !== 'idle'
        ) {
          void stopScreenShareRef.current(true);
        }
        return;
      }
      if (event.type !== 'direct-voice-rtc-signal') return;
      const lifecycleGeneration = dmRtcLifecycleGenerationRef.current;
      const expectedCallId = callIdRef.current;
      const expectedRoomId = dmRoomIdRef.current;
      const expectedPeerAddress = peerAddressRef.current;
      const sendTask = dmRtcSignalSendChainRef.current.then(async () => {
        if (
          lifecycleGeneration !== dmRtcLifecycleGenerationRef.current ||
          expectedCallId !== callIdRef.current ||
          expectedRoomId !== dmRoomIdRef.current ||
          expectedPeerAddress !== peerAddressRef.current
        ) {
          return;
        }
        const payload = JSON.stringify(event.signal);
        const signalType =
          event.signal.kind === 'ice' || event.signal.kind === 'ice-candidates'
            ? 'candidate'
            : event.signal.kind === 'ice-refresh-request'
              ? 'reconnect'
              : event.signal.description.type === 'offer'
                ? 'offer'
                : 'answer';
        await sendAuthenticatedDirectVoiceRtcPayload({
          generation: event.signal.generation,
          signalType,
          payload,
        });
      });
      dmRtcSignalSendChainRef.current = sendTask.catch(() => {});
      void sendTask.catch((error) => {
        pushDirectVoiceUiLog('warn', 'WebRTC signaling failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }, [sendAuthenticatedDirectVoiceRtcPayload]);

  const startDurationTimer = useCallback(() => {
    setCallDuration(0);
    durationTimerRef.current = setInterval(
      () => setCallDuration((d) => d + 1),
      1_000
    );
  }, []);

  callIpcHandlerRef.current = async (event: string, payload: unknown) => {
    const p = payload as Record<string, unknown>;

    switch (event) {
      case 'call:rtc-signal': {
        if (
          isReticulumCallEnabled ||
          p.callId !== callIdRef.current ||
          callStateRef.current !== 'connected' ||
          typeof p.payload !== 'string' ||
          p.payload.length > 64 * 1024
        ) {
          break;
        }
        try {
          const decoded = JSON.parse(p.payload);
          if (isDirectScreenShareRtcSignal(decoded)) {
            const expectedSignalType =
              decoded.kind === 'screen-ice'
                ? 'candidate'
                : decoded.kind === 'screen-stop'
                  ? 'reconnect'
                  : decoded.description.type;
            if (
              decoded.generation !== p.generation ||
              expectedSignalType !== p.signalType
            ) {
              break;
            }
            try {
              await screenShareSignalHandlerRef.current(decoded);
            } catch (error) {
              pushDirectVoiceUiLog('warn', 'Screen share signaling failed', {
                error: error instanceof Error ? error.message : String(error),
              });
              await resetScreenShare(true);
              showGlobalCallSnack(
                'info',
                'Screen sharing stopped because the direct connection could not be established.'
              );
            }
            break;
          }
          if (p.signalType === 'capability') {
            const capability = decoded as Record<string, unknown>;
            if (
              p.generation !==
                DIRECT_VOICE_NATIVE_AUDIO_CAPABILITY_GENERATION ||
              capability.kind !== 'capability' ||
              capability.audio !== 'native-track' ||
              capability.version !== 1
            ) {
              break;
            }
            const callId = callIdRef.current;
            dmRtcPeerNativeCapabilityCallIdRef.current = callId;
            const supportsScreenShare =
              capability.screen === 'video-track' &&
              capability.screenVersion === 1;
            screenShareSupportedRef.current = supportsScreenShare;
            setScreenShareSupported(supportsScreenShare);
            pushDirectVoiceUiLog('log', 'peer supports native WebRTC audio', {
              callTrunc: callId?.slice(0, 8) ?? '',
              screenShare: supportsScreenShare,
            });
            if (dmRoomIdRef.current) {
              await startDirectVoiceRtcOnAudioSurface();
            }
            break;
          }
          const signal = decoded as DirectVoiceRtcSignal;
          const validGeneration =
            typeof signal?.generation === 'string' &&
            /^[A-Za-z0-9_-]{8,64}$/.test(signal.generation) &&
            signal.generation === p.generation;
          const validKind =
            (p.signalType === 'candidate' &&
              (signal?.kind === 'ice' || signal?.kind === 'ice-candidates')) ||
            (p.signalType === 'reconnect' &&
              signal?.kind === 'ice-refresh-request') ||
            ((p.signalType === 'offer' || p.signalType === 'answer') &&
              signal?.kind === 'description' &&
              signal.description?.type === p.signalType);
          if (!validGeneration || !validKind) break;
          // The bounded pending queue preserves an offer/candidate that beats
          // its capability packet. It is never activated unless the peer later
          // advertises the exact native-track capability for this call.
          await applyDirectVoiceRtcSignalOnAudioSurface(signal);
        } catch {
          // Invalid authenticated payloads are ignored without touching media.
        }
        break;
      }

      case 'call:incoming': {
        const incCallId = p.callId as string;
        const incFrom = p.fromAddress as string;
        const incChatId = p.chatId as string;

        const rejectIncoming = async (reason: string) => {
          const rejectTs = Date.now();
          const { signature, publicKey } = await authorizeCallSignal({
            type: 'CALL_REJECT',
            callId: incCallId,
            timestamp: rejectTs,
          });
          const reasonAuthorization = await authorizeCallSignal({
            type: 'CALL_REJECT',
            callId: incCallId,
            timestamp: rejectTs,
            reason,
          });
          await callApiRef.current?.reject?.(
            incCallId,
            reason,
            signature,
            publicKey,
            rejectTs,
            reasonAuthorization.signature
          );
        };

        if (isDirectVoiceCallChatId(incChatId)) {
          if (blockedAddressesRef.current[incFrom]) {
            await rejectIncoming('blocked');
            break;
          }
          if (
            optionsRef.current.skipDirectFriendValidation !== true &&
            !dmFriendsByAddressRef.current[incFrom]
          ) {
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
          pushDirectVoiceUiLog(
            'warn',
            'call:accepted ignored (wrong callId or state)',
            {
              expectedCallId: callIdRef.current,
              gotCallId: p.callId,
              state: callStateRef.current,
            }
          );
          break;
        }
        await reticulumTeardownChainRef.current.catch(() => {});
        const chatIdForRoom = activeCallChatIdRef.current;
        if (chatIdForRoom && isDirectVoiceCallChatId(chatIdForRoom)) {
          try {
            const roomId = await buildDmVoiceRoomId(chatIdForRoom);
            dmRoomIdRef.current = roomId;
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
        pushDirectVoiceUiLog(
          'log',
          'call:accepted — starting Reticulum media session'
        );
        screenShareTerminalGenerationsRef.current.clear();
        screenShareSupportedRef.current = false;
        setScreenShareSupported(false);
        updateCallState('connected');
        setCallMediaReady(false);
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
          rejectReason === 'not_friend'
            ? i18n.t('core:voice_call.rejected_not_friend', {
                name:
                  peerDisplayNameRef.current ||
                  shortenCallPeerAddress(peerAddressRef.current),
              })
            : rejectReason === 'media unavailable'
              ? i18n.t('core:voice_call.rejected_media')
              : i18n.t('core:voice_call.rejected_declined');
        showGlobalCallSnack('info', message);
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
    const callAPI = callApiRef.current;
    if (!callAPI?.onEvent) {
      console.warn(
        '[DM voice] window.call is undefined — call IPC unavailable'
      );
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

  useEffect(() => {
    if (callState !== 'calling') {
      stopOutboundRingtone();
      return;
    }
    stopOutboundRingtoneRef.current = startDirectOutboundRingtone();
    return () => {
      stopOutboundRingtone();
    };
  }, [callState, stopOutboundRingtone]);

  const reassertCallLocalAddress = useCallback(
    async (reason: string, opts?: { requireReticulumReady?: boolean }) => {
      const addr = userInfo?.address;
      const callApi = callApiRef.current;
      if (!addr) {
        if (
          registeredCallLocalAddressRef.current &&
          callApi?.setLocalAddresses
        ) {
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
      sign?: (
        fields: Record<string, unknown>
      ) => Promise<{ signature: string; publicKey: string }>,
      targetDisplayName?: string
    ) => {
      if (callStateRef.current !== 'idle') return;
      const localAddress = userInfo?.address;
      if (!localAddress) return;
      if (
        optionsRef.current.skipSystemReadiness !== true &&
        !(await isSystemReadyForCall(showSystemNotReadyForCall))
      ) {
        return;
      }

      const apiOwnsSignatures = optionsRef.current.callApiSignsSignals === true;
      const callId =
        optionsRef.current.createCallId?.() ||
        (apiOwnsSignatures ? crypto.randomUUID() : await createDirectCallId());
      if (!callId) {
        pushDirectVoiceUiLog('warn', 'local Reticulum call route unavailable');
        showGlobalCallSnack(
          'error',
          i18n.t('core:voice_call.failed') ?? 'Voice call failed'
        );
        return;
      }
      const timestamp = Date.now();
      const myPublicKey = userInfo?.publicKey ?? '';

      const requestFields = {
        type: 'CALL_REQUEST',
        callId,
        chatId,
        fromAddress: localAddress,
        fromPublicKey: myPublicKey,
        timestamp,
      };
      let authorization: { signature: string; publicKey: string };
      let cancellation: { signature: string; publicKey: string };
      const cancellationTimestamp = timestamp;
      try {
        if (!apiOwnsSignatures && !sign) {
          throw new Error('Call signaling signer is unavailable');
        }
        authorization = apiOwnsSignatures
          ? await authorizeCallSignal(requestFields)
          : await sign!(requestFields);
        const cancellationFields = {
          type: 'CALL_HANGUP',
          callId,
          timestamp: cancellationTimestamp,
        };
        cancellation = apiOwnsSignatures
          ? await authorizeCallSignal(cancellationFields)
          : await sign!(cancellationFields);
      } catch (error) {
        pushDirectVoiceUiLog('warn', 'call authorization failed', {
          error: String(error),
        });
        showGlobalCallSnack(
          'error',
          i18n.t('core:voice_call.failed') ?? 'Voice call failed'
        );
        return;
      }
      const { signature, publicKey } = authorization;

      isOutboundCallRef.current = true;
      peerAddressRef.current = targetAddress;
      const requestedDisplayName = targetDisplayName?.trim() ?? '';
      const friendDisplayName =
        dmFriendsByAddressRef.current[targetAddress]?.name?.trim() ?? '';
      const normalizedDisplayName =
        requestedDisplayName && requestedDisplayName !== targetAddress
          ? requestedDisplayName
          : friendDisplayName && friendDisplayName !== targetAddress
            ? friendDisplayName
            : '';
      peerDisplayNameRef.current =
        normalizedDisplayName.length > 0 && normalizedDisplayName.length <= 100
          ? normalizedDisplayName
          : shortenCallPeerAddress(targetAddress);
      callIdRef.current = callId;
      activeCallChatIdRef.current = chatId;
      setActiveCallChatId(chatId);
      setCallMediaReady(false);
      updateCallState('calling');

      let result:
        | { success: boolean; callId?: string; error?: string }
        | undefined;
      try {
        result = await callApiRef.current?.initiate?.(
          targetAddress,
          chatId,
          localAddress,
          signature,
          publicKey,
          callId,
          timestamp,
          cancellation.signature,
          cancellation.publicKey,
          cancellationTimestamp
        );
      } catch (error) {
        result = { success: false, error: String(error) };
      }

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
        showGlobalCallSnack(
          'error',
          result?.error ||
            (i18n.t('core:voice_call.failed') ?? 'Voice call failed')
        );
      } else {
        pushDirectVoiceUiLog('log', 'call.initiate ok (waiting for peer)', {
          callIdTrunc: callId.slice(0, 8),
          chatIdTrunc: chatId.slice(0, 24),
        });
      }
    },
    [
      showSystemNotReadyForCall,
      authorizeCallSignal,
      showGlobalCallSnack,
      updateCallState,
      userInfo?.address,
      userInfo?.publicKey,
    ]
  );

  const acceptCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming || callStateRef.current !== 'ringing') return;
    if (
      optionsRef.current.skipSystemReadiness !== true &&
      !(await isSystemReadyForCall(showSystemNotReadyForCall))
    ) {
      return;
    }

    await reticulumTeardownChainRef.current.catch(() => {});
    isOutboundCallRef.current = false;
    peerAddressRef.current = incoming.fromAddress;
    callIdRef.current = incoming.callId;
    const acceptedChatId = incoming.chatId;
    updateIncomingCall(null);

    activeCallChatIdRef.current = acceptedChatId;
    setActiveCallChatId(acceptedChatId);
    screenShareTerminalGenerationsRef.current.clear();
    screenShareSupportedRef.current = false;
    setScreenShareSupported(false);

    if (isDirectVoiceCallChatId(acceptedChatId)) {
      try {
        const roomId = await buildDmVoiceRoomId(acceptedChatId);
        dmRoomIdRef.current = roomId;
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
    setCallMediaReady(false);
    startDurationTimer();

    const acceptTs = Date.now();
    const { signature, publicKey } = await authorizeCallSignal({
      type: 'CALL_ACCEPT',
      callId: incoming.callId,
      timestamp: acceptTs,
    });
    const acceptResult = await callApiRef.current?.accept?.(
      incoming.callId,
      signature,
      publicKey,
      acceptTs
    );
    if (!acceptResult?.success) {
      pushDirectVoiceUiLog('warn', 'call.accept failed', {
        result: acceptResult ?? null,
      });
      endCall(false);
      return;
    }

    pushDirectVoiceUiLog(
      'log',
      'incoming call accepted — starting Reticulum media session'
    );
    void startReticulumMediaSession().catch((e) => {
      pushDirectVoiceUiLog('warn', 'startReticulumMediaSession rejected', {
        err: String(e),
      });
    });
  }, [
    endCall,
    authorizeCallSignal,
    startDurationTimer,
    startReticulumMediaSession,
    showSystemNotReadyForCall,
    updateCallState,
    updateIncomingCall,
  ]);

  const rejectCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;

    try {
      const rejectTs = Date.now();
      const { signature, publicKey } = await authorizeCallSignal({
        type: 'CALL_REJECT',
        callId: incoming.callId,
        timestamp: rejectTs,
      });
      const reasonAuthorization = await authorizeCallSignal({
        type: 'CALL_REJECT',
        callId: incoming.callId,
        timestamp: rejectTs,
        reason: 'rejected',
      });
      const rejectResult = await callApiRef.current?.reject?.(
        incoming.callId,
        'rejected',
        signature,
        publicKey,
        rejectTs,
        reasonAuthorization.signature
      );
      if (!rejectResult?.success) {
        pushDirectVoiceUiLog('warn', 'call.reject failed', {
          result: rejectResult ?? null,
        });
        return;
      }
    } catch (error) {
      pushDirectVoiceUiLog('warn', 'call.reject failed', {
        error: String(error),
      });
      return;
    }

    // Keep the call in ringing state until rejection succeeds. Entering idle
    // earlier lets QortalLand cleanup discard the caller route before send.
    updateIncomingCall(null);
    updateCallState('idle');
  }, [authorizeCallSignal, updateCallState, updateIncomingCall]);

  const hangUp = useCallback(async () => {
    await endCall(true);
  }, [endCall]);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    void updateDirectVoiceMediaOnAudioSurface();
    setIsMuted(next);
  }, [updateDirectVoiceMediaOnAudioSurface]);

  const setHearCall = useCallback(
    (hear: boolean) => {
      hearCallRef.current = hear;
      setHearCallState(hear);
      void updateDirectVoiceMediaOnAudioSurface();
    },
    [updateDirectVoiceMediaOnAudioSurface]
  );

  const toggleHearCall = useCallback(() => {
    setHearCall(!hearCallRef.current);
  }, [setHearCall]);

  const swapVoiceCallInput = useCallback(
    async (deviceId: string | null) => {
      if (callStateRef.current !== 'connected') return;
      void deviceId;
      await updateDirectVoiceMediaOnAudioSurface();
    },
    [updateDirectVoiceMediaOnAudioSurface]
  );

  useEffect(() => {
    if (callState !== 'connected') {
      inputSwapSeededRef.current = false;
      prevInputPrefRef.current = undefined;
      return;
    }
    const want = callAudioDevices.inputDeviceId;
    if (!inputSwapSeededRef.current) {
      inputSwapSeededRef.current = true;
      prevInputPrefRef.current = want;
      return;
    }
    if (prevInputPrefRef.current === want) return;
    prevInputPrefRef.current = want;
    void swapVoiceCallInput(want);
  }, [
    callState,
    callAudioDevices.inputDeviceId,
    callAudioWireNonce,
    swapVoiceCallInput,
  ]);

  useEffect(() => {
    if (callState !== 'connected') return;
    // Device ids are scoped to the audio-surface origin. Validating an id in
    // the main renderer can incorrectly classify it as stale and reset DM
    // playback to the system default. Let the audio surface resolve and apply
    // its own device id instead.
    void updateDirectVoiceMediaOnAudioSurface();
  }, [
    callState,
    callAudioDevices.outputDeviceId,
    callAudioWireNonce,
    updateDirectVoiceMediaOnAudioSurface,
  ]);

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
      unmountVoiceCallCleanupRef.current();
    };
  }, []);

  const startupStageKey =
    callState === 'connected'
      ? `${callState}:${audioMode ?? 'none'}:${callMediaReady ? 'live' : 'startup'}`
      : `${callState}:${audioMode ?? 'none'}`;

  useEffect(() => {
    startupStageSinceRef.current = Date.now();
    setStartupClock((tick) => tick + 1);
  }, [startupStageKey]);

  useEffect(() => {
    if (
      callState !== 'calling' &&
      !(callState === 'connected' && !callMediaReady)
    ) {
      return;
    }
    const id = window.setInterval(() => {
      setStartupClock((tick) => tick + 1);
    }, 1_000);
    return () => window.clearInterval(id);
  }, [callMediaReady, callState]);

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
    if (callState === 'connected' && !callMediaReady) {
      return {
        stage: 'starting-audio',
        headline: 'Connecting...',
        detail: delayed
          ? 'Still establishing the secure audio link.'
          : 'Establishing the secure audio link.',
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
    callMediaReady,
    isMuted,
    hearCall,
    callDuration,
    incomingCall,
    activeCallChatId,
    screenShareState,
    screenShareSupported,
    screenShareSources,
    screenShareStream,
    screenShareViewerOpen,
    screenShareIsLocal,
    initiateCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    setHearCall,
    toggleHearCall,
    openScreenSharePicker,
    cancelScreenSharePicker,
    startScreenShare,
    stopScreenShare,
    setScreenShareViewerOpen,
  };
}
