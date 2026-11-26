import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blockedAddressesAtom } from '../../../atoms/global';
import { GroupCallAudioReceiveEngine } from '../../../lib/group-call/groupCallAudioReceiveEngine';
import { GroupCallAudioSenderEngine } from '../../../lib/group-call/groupCallAudioSenderEngine';
import { qortalLandRealtime } from '../realtime/qortalLandRealtime';

export type ProximityVoiceMode = 'push-to-talk' | 'open-mic';
export type ProximityVoiceState =
  | 'off'
  | 'authorizing'
  | 'ready'
  | 'suspended'
  | 'reconnecting'
  | 'permission-denied'
  | 'unavailable';

export type ProximityPeer = {
  key: string;
  address: string;
  sessionId: string;
  sourceId: number;
  state: string;
  distance: number | null;
  gain: number;
  pan: number;
  audible: boolean;
  muted: boolean;
  volume: number;
  speaking: boolean;
};

type Options = {
  address: string;
  publicKey?: string;
  groupId: number;
  sessionId: string;
  enabled: boolean;
  suspended: boolean;
  getPosition: () => { roomId: string; x: number; y: number };
};

const HEADER_BYTES = 26;
const MAGIC = [0x51, 0x4c, 0x41, 0x31] as const;
const PROXIMITY_OPUS_BITRATE = 24_000;
const PROXIMITY_CONGESTED_OPUS_BITRATE = 16_000;
const OPEN_MIC_VAD_HANGOVER_MS = 320;
const PROXIMITY_AUDIO_PROFILE = 'high-stability' as const;
// Reticulum proximity media arrives in short bursts. Keep a little more audio
// in reserve and prevent the PCM playout fallback from audibly lowering pitch.
const PROXIMITY_MINIMUM_PLAYOUT_RATE = 0.985;
const PROXIMITY_MINIMUM_TARGET_PLAYOUT_MS = 160;
const INBOUND_MICROBATCH_MAX_FRAMES = 8;
const INBOUND_MICROBATCH_WAIT_MS = 6;

const isExpectedCapability = (
  value: unknown,
  expected: {
    address: string;
    publicKey: string;
    groupId: number;
    sessionId: string;
    destinationHash: string;
  }
): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields).sort();
  const expectedKeys = [
    'address',
    'createdAt',
    'ephemeralPublicKey',
    'expiresAt',
    'groupId',
    'destinationHash',
    'instanceId',
    'landSessionId',
    'nonce',
    'protocolVersion',
    'signerPublicKey',
    'type',
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  )
    return false;
  const now = Date.now();
  return (
    fields.type === 'QORTAL_LAND_PROXIMITY_VOICE_SESSION' &&
    fields.protocolVersion === 1 &&
    fields.address === expected.address &&
    fields.signerPublicKey === expected.publicKey &&
    String(fields.groupId) === String(expected.groupId) &&
    fields.landSessionId === expected.sessionId &&
    fields.destinationHash === expected.destinationHash &&
    fields.instanceId === qortalLandRealtime.getInstanceId() &&
    typeof fields.ephemeralPublicKey === 'string' &&
    /^[0-9a-f]{64}$/i.test(fields.ephemeralPublicKey) &&
    typeof fields.nonce === 'string' &&
    /^[0-9a-f]{64}$/i.test(fields.nonce) &&
    typeof fields.createdAt === 'number' &&
    Math.abs(now - fields.createdAt) <= 120_000 &&
    typeof fields.expiresAt === 'number' &&
    fields.expiresAt > now &&
    fields.expiresAt - fields.createdAt <= 4 * 60 * 60 * 1_000
  );
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable ||
    element?.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]'
    )
  );
};

const encodeLocalAudio = (
  generation: number,
  sequence: number,
  opus: Uint8Array
): ArrayBuffer => {
  const buffer = new ArrayBuffer(HEADER_BYTES + opus.byteLength);
  const view = new DataView(buffer);
  MAGIC.forEach((byte, index) => view.setUint8(index, byte));
  view.setUint8(4, 1);
  view.setUint8(5, 0);
  view.setUint16(6, 0);
  view.setUint32(8, generation);
  view.setUint32(12, sequence);
  view.setBigUint64(16, BigInt(Date.now()));
  view.setUint16(24, opus.byteLength);
  new Uint8Array(buffer, HEADER_BYTES).set(opus);
  return buffer;
};

const parseInboundAudio = (buffer: ArrayBuffer) => {
  if (buffer.byteLength < HEADER_BYTES || buffer.byteLength > 2_048)
    return null;
  const view = new DataView(buffer);
  if (MAGIC.some((byte, index) => view.getUint8(index) !== byte)) return null;
  const length = view.getUint16(24);
  if (
    view.getUint8(4) !== 1 ||
    view.getUint8(5) !== 1 ||
    length <= 0 ||
    length > 320 ||
    HEADER_BYTES + length !== buffer.byteLength
  )
    return null;
  return {
    sourceId: view.getUint16(6),
    generation: view.getUint32(8),
    sequence: view.getUint32(12),
    receivedAt: Number(view.getBigUint64(16)),
    opus: new Uint8Array(buffer.slice(HEADER_BYTES)),
  };
};

export function useQortalLandProximityVoice(options: Options) {
  const {
    address,
    publicKey,
    groupId,
    sessionId,
    enabled,
    suspended,
    getPosition,
  } = options;
  const blockedAddresses = useAtomValue(blockedAddressesAtom);
  const [state, setState] = useState<ProximityVoiceState>('off');
  const [localDestinationHash, setLocalDestinationHash] = useState('');
  const [mode, setModeState] = useState<ProximityVoiceMode>(() =>
    localStorage.getItem(`qortalland:proximity:mode:${address}`) === 'open-mic'
      ? 'open-mic'
      : 'push-to-talk'
  );
  const [pttKey, setPttKeyState] = useState(
    () => localStorage.getItem(`qortalland:proximity:key:${address}`) || 'v'
  );
  const [peers, setPeers] = useState<Record<string, ProximityPeer>>({});
  const [error, setError] = useState('');
  const [transmitting, setTransmitting] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceIdState] = useState(
    () => localStorage.getItem(`qortalland:proximity:input-v2:${address}`) || ''
  );
  const [outputDeviceId, setOutputDeviceIdState] = useState(
    () =>
      localStorage.getItem(`qortalland:proximity:output-v2:${address}`) || ''
  );
  const [masterVolume, setMasterVolumeState] = useState(() => {
    const storedValue = localStorage.getItem(
      `qortalland:proximity:volume-v2:${address}`
    );
    const stored = storedValue === null ? Number.NaN : Number(storedValue);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1
      ? stored
      : 0.75;
  });
  const optedInRef = useRef(false);
  const modeRef = useRef(mode);
  const pttHeldRef = useRef(false);
  const vadRef = useRef(false);
  const vadHangoverUntilRef = useRef(0);
  const advertisedTransmitRef = useRef(false);
  const suspendedRef = useRef(suspended);
  const generationRef = useRef(1);
  const sequenceRef = useRef(0);
  const sourcePeerRef = useRef(
    new Map<number, { key: string; address: string }>()
  );
  const sourceGenerationRef = useRef(new Map<number, number>());
  const senderRef = useRef<GroupCallAudioSenderEngine | null>(null);
  const receiverRef = useRef<GroupCallAudioReceiveEngine | null>(null);
  const audioFailureStateRef = useRef<Extract<
    ProximityVoiceState,
    'permission-denied' | 'unavailable'
  > | null>(null);
  const positionSequenceRef = useRef(0);
  const pythonRestartedRef = useRef(false);
  const blockedRef = useRef<Set<string>>(new Set());
  const blockedAddressesRef = useRef(blockedAddresses);
  const pendingCommandsRef = useRef(new Map<string, string>());

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);
  useEffect(() => {
    blockedAddressesRef.current = blockedAddresses;
  }, [blockedAddresses]);
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    if (!enabled) {
      setLocalDestinationHash('');
      return () => {
        cancelled = true;
      };
    }
    const loadDestination = async () => {
      let hash = '';
      try {
        const result =
          await window.electronAPI?.reticulumGetLocalDestinationHash?.();
        const candidate = String(result?.destinationHash || '')
          .trim()
          .toLowerCase();
        if (/^[0-9a-f]{32}$/.test(candidate)) hash = candidate;
      } catch {
        hash = '';
      }
      if (cancelled) return;
      setLocalDestinationHash(hash);
      if (!hash) retryTimer = window.setTimeout(loadDestination, 1_000);
    };
    void loadDestination();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [enabled]);

  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const requestId = crypto.randomUUID();
      pendingCommandsRef.current.set(requestId, type);
      try {
        qortalLandRealtime.send({ type, requestId, ...payload });
      } catch (error) {
        pendingCommandsRef.current.delete(requestId);
        throw error;
      }
      return requestId;
    },
    []
  );

  const updateTransmit = useCallback(
    (next: boolean) => {
      const allowed =
        next &&
        optedInRef.current &&
        !suspendedRef.current &&
        qortalLandRealtime.isReady();
      if (advertisedTransmitRef.current === allowed) return;
      advertisedTransmitRef.current = allowed;
      setTransmitting(allowed);
      try {
        send('SET_PROXIMITY_TRANSMIT', {
          transmitting: allowed,
          mode: modeRef.current,
        });
      } catch {
        /* reconnecting */
      }
    },
    [send]
  );

  const startAudio = useCallback(async () => {
    if (!senderRef.current)
      senderRef.current = new GroupCallAudioSenderEngine();
    if (!receiverRef.current)
      receiverRef.current = new GroupCallAudioReceiveEngine(() => {});
    const sender = senderRef.current;
    try {
      await receiverRef.current.configure({
        outputDeviceId: outputDeviceId || null,
        hearCall: true,
        profile: PROXIMITY_AUDIO_PROFILE,
        minimumPlayoutRate: PROXIMITY_MINIMUM_PLAYOUT_RATE,
        minimumTargetPlayoutMs: PROXIMITY_MINIMUM_TARGET_PLAYOUT_MS,
      });
      receiverRef.current.setMasterVolume(masterVolume);
      await sender.startOrUpdate({
        inputDeviceId: inputDeviceId || null,
        outputDeviceId: outputDeviceId || null,
        muted: false,
        profile: PROXIMITY_AUDIO_PROFILE,
        onVadChanged: (vad) => {
          vadRef.current = vad;
          if (vad)
            vadHangoverUntilRef.current = Date.now() + OPEN_MIC_VAD_HANGOVER_MS;
          // PTT is already an explicit speech gate. Applying frame-level VAD on top
          // clips quiet syllables and consonants and repeatedly starves the jitter buffer.
          const wantsAudio =
            modeRef.current === 'open-mic'
              ? vad || Date.now() < vadHangoverUntilRef.current
              : pttHeldRef.current;
          updateTransmit(wantsAudio);
        },
        onEncodedFrame: ({ opusFrame, vad }) => {
          if (vad)
            vadHangoverUntilRef.current = Date.now() + OPEN_MIC_VAD_HANGOVER_MS;
          const wantsAudio =
            modeRef.current === 'open-mic'
              ? vad || Date.now() < vadHangoverUntilRef.current
              : pttHeldRef.current;
          updateTransmit(wantsAudio);
          if (
            !wantsAudio ||
            !optedInRef.current ||
            suspendedRef.current ||
            opusFrame.byteLength > 320
          )
            return;
          try {
            sequenceRef.current = (sequenceRef.current + 1) >>> 0;
            qortalLandRealtime.sendBinary(
              encodeLocalAudio(
                generationRef.current,
                sequenceRef.current,
                opusFrame
              )
            );
          } catch {
            /* realtime reconnect owns recovery */
          }
        },
      });
      // startOrUpdate resets encoder overrides when it rebuilds capture, so apply
      // the proximity budget only after the new encoder is live.
      sender.setOpusBitrate(PROXIMITY_OPUS_BITRATE);
      audioFailureStateRef.current = null;
      const available = await navigator.mediaDevices
        .enumerateDevices()
        .catch(() => [] as MediaDeviceInfo[]);
      setDevices(
        available.filter(
          (device) =>
            device.kind === 'audioinput' || device.kind === 'audiooutput'
        )
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await sender.stop().catch(() => {});
      await receiverRef.current?.dispose().catch(() => {});
      senderRef.current = null;
      receiverRef.current = null;
      const failureState = /permission|denied|notallowed/i.test(message)
        ? 'permission-denied'
        : 'unavailable';
      audioFailureStateRef.current = failureState;
      setError(message);
      setState(failureState);
      optedInRef.current = false;
      throw cause;
    }
  }, [inputDeviceId, masterVolume, outputDeviceId, updateTransmit]);
  const startAudioRef = useRef(startAudio);
  useEffect(() => {
    startAudioRef.current = startAudio;
  }, [startAudio]);

  const handleBackgroundAudioFailure = useCallback(() => {
    try {
      send('DISABLE_PROXIMITY_VOICE');
    } catch {
      /* transport already unavailable */
    }
  }, [send]);

  const enable = useCallback(async () => {
    if (
      !enabled ||
      !publicKey ||
      !localDestinationHash ||
      !qortalLandRealtime.isReady()
    ) {
      setState('unavailable');
      return;
    }
    setError('');
    await startAudio();
    optedInRef.current = true;
    setState('authorizing');
    const position = getPosition();
    send('SET_LAND_CONTEXT', {
      address,
      publicKey,
      groupId: String(groupId),
      landSessionId: sessionId,
      roomId: position.roomId,
      localDestinationHash,
    });
    const blocked = Object.keys(blockedAddresses).filter(
      (item) => blockedAddresses[item]
    );
    for (const blockedAddress of blocked) {
      send('SET_PROXIMITY_PEER_POLICY', {
        address: blockedAddress,
        blocked: true,
      });
    }
    blockedRef.current = new Set(blocked);
    send('ENABLE_PROXIMITY_VOICE', { mode: modeRef.current });
  }, [
    address,
    blockedAddresses,
    enabled,
    getPosition,
    groupId,
    localDestinationHash,
    publicKey,
    send,
    sessionId,
    startAudio,
  ]);

  const disable = useCallback(async () => {
    audioFailureStateRef.current = null;
    optedInRef.current = false;
    pttHeldRef.current = false;
    vadHangoverUntilRef.current = 0;
    updateTransmit(false);
    try {
      send('DISABLE_PROXIMITY_VOICE');
    } catch {
      /* already disconnected */
    }
    await senderRef.current?.stop();
    await receiverRef.current?.dispose();
    senderRef.current = null;
    receiverRef.current = null;
    sourcePeerRef.current.clear();
    sourceGenerationRef.current.clear();
    setPeers({});
    setState('off');
  }, [send, updateTransmit]);

  useEffect(() => {
    if (!enabled && optedInRef.current) void disable();
  }, [disable, enabled]);

  const setMode = useCallback(
    (next: ProximityVoiceMode) => {
      modeRef.current = next;
      setModeState(next);
      localStorage.setItem(`qortalland:proximity:mode:${address}`, next);
      if (next === 'push-to-talk') updateTransmit(false);
      else
        updateTransmit(
          vadRef.current || Date.now() < vadHangoverUntilRef.current
        );
    },
    [address, updateTransmit]
  );

  const setPttKey = useCallback(
    (key: string) => {
      const normalized = key.trim().toLowerCase().slice(0, 20) || 'v';
      setPttKeyState(normalized);
      localStorage.setItem(`qortalland:proximity:key:${address}`, normalized);
    },
    [address]
  );

  const setInputDeviceId = useCallback(
    (deviceId: string) => {
      setInputDeviceIdState(deviceId);
      localStorage.setItem(
        `qortalland:proximity:input-v2:${address}`,
        deviceId
      );
    },
    [address]
  );

  const setOutputDeviceId = useCallback(
    (deviceId: string) => {
      setOutputDeviceIdState(deviceId);
      localStorage.setItem(
        `qortalland:proximity:output-v2:${address}`,
        deviceId
      );
    },
    [address]
  );

  const setMasterVolume = useCallback(
    (volume: number) => {
      const next = Math.max(0, Math.min(1, volume));
      setMasterVolumeState(next);
      localStorage.setItem(
        `qortalland:proximity:volume-v2:${address}`,
        String(next)
      );
      receiverRef.current?.setMasterVolume(next);
    },
    [address]
  );

  useEffect(() => {
    if (optedInRef.current && !suspendedRef.current) {
      void startAudio().catch(handleBackgroundAudioFailure);
    }
  }, [handleBackgroundAudioFailure, inputDeviceId, outputDeviceId, startAudio]);

  useEffect(() => {
    if (
      !enabled ||
      !publicKey ||
      !localDestinationHash ||
      !(window.qortalLandRealtime || window.qortalLandGames)
    ) {
      setState('unavailable');
      return;
    }
    const release = qortalLandRealtime.acquire();
    const disposeState = qortalLandRealtime.onState((ready) => {
      if (!ready) {
        pendingCommandsRef.current.clear();
        if (optedInRef.current) setState('reconnecting');
        updateTransmit(false);
        void senderRef.current?.stop();
        void receiverRef.current?.configure({ hearCall: false });
        return;
      }
      if (optedInRef.current) {
        if (!suspendedRef.current)
          void startAudioRef.current().catch(handleBackgroundAudioFailure);
        else void receiverRef.current?.configure({ hearCall: false });
        const position = getPosition();
        send('SET_LAND_CONTEXT', {
          address,
          publicKey,
          groupId: String(groupId),
          landSessionId: sessionId,
          roomId: position.roomId,
          localDestinationHash,
        });
        const currentBlocked = blockedAddressesRef.current;
        const blocked = Object.keys(currentBlocked).filter(
          (item) => currentBlocked[item]
        );
        for (const blockedAddress of blocked) {
          send('SET_PROXIMITY_PEER_POLICY', {
            address: blockedAddress,
            blocked: true,
          });
        }
        blockedRef.current = new Set(blocked);
        if (pythonRestartedRef.current) {
          pythonRestartedRef.current = false;
          setState('authorizing');
          send('ENABLE_PROXIMITY_VOICE', { mode: modeRef.current });
        } else {
          send('GET_PROXIMITY_STATE');
        }
      }
    });
    const disposeEvent = qortalLandRealtime.onEvent((event) => {
      if (event.type === 'COMMAND_RESULT') {
        const requestId = String(event.requestId || '');
        const command = pendingCommandsRef.current.get(requestId);
        if (!command) return;
        pendingCommandsRef.current.delete(requestId);
        if (
          event.ok === false &&
          !['UPDATE_PROXIMITY_POSITION', 'SET_PROXIMITY_TRANSMIT'].includes(
            command
          )
        ) {
          setError(String(event.error || 'Proximity voice command failed'));
          if (
            command === 'ENABLE_PROXIMITY_VOICE' ||
            command === 'SUBMIT_PROXIMITY_SESSION_SIGNATURE'
          ) {
            void disable();
          }
        }
        return;
      }
      if (event.type === 'TRANSPORT_RESTARTED') {
        blockedRef.current.clear();
        if (optedInRef.current) {
          pythonRestartedRef.current = true;
          setState('reconnecting');
        }
        return;
      }
      if (event.type === 'PROXIMITY_SIGNATURE_REQUIRED') {
        const fields = event.fields;
        if (
          !isExpectedCapability(fields, {
            address,
            publicKey,
            groupId,
            sessionId,
            destinationHash: localDestinationHash,
          })
        ) {
          setError(
            'Python returned an invalid proximity voice signing request'
          );
          void disable();
          return;
        }
        void window
          .sendMessage?.('signPresenceMessage', fields, 10_000)
          .then((result: { signature?: string; error?: string }) => {
            if (!result?.signature || result.error)
              throw new Error(result?.error || 'Wallet signature failed');
            send('SUBMIT_PROXIMITY_SESSION_SIGNATURE', {
              signature: result.signature,
              publicKey,
            });
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
            void disable();
          });
        return;
      }
      if (event.type === 'PROXIMITY_STATE') {
        const rawState = String(event.state || 'off');
        const next: ProximityVoiceState = [
          'off',
          'authorizing',
          'ready',
          'suspended',
          'reconnecting',
          'permission-denied',
          'unavailable',
        ].includes(rawState)
          ? (rawState as ProximityVoiceState)
          : 'unavailable';
        if (typeof event.streamGeneration === 'number')
          generationRef.current = event.streamGeneration;
        setState(
          next === 'off' && audioFailureStateRef.current
            ? audioFailureStateRef.current
            : next
        );
        if (next === 'ready') {
          updateTransmit(
            modeRef.current === 'open-mic'
              ? vadRef.current || Date.now() < vadHangoverUntilRef.current
              : pttHeldRef.current
          );
        }
        return;
      }
      if (event.type === 'PROXIMITY_TRANSPORT_STATS') {
        senderRef.current?.setOpusBitrate(
          event.capacityReduced === true
            ? PROXIMITY_CONGESTED_OPUS_BITRATE
            : PROXIMITY_OPUS_BITRATE
        );
        return;
      }
      if (event.type === 'PROXIMITY_SNAPSHOT') {
        if (typeof event.streamGeneration === 'number')
          generationRef.current = event.streamGeneration;
        if (Array.isArray(event.peers)) {
          const restored: Record<string, ProximityPeer> = {};
          const previousPeerKeys = new Set(
            Array.from(sourcePeerRef.current.values(), (peer) => peer.key)
          );
          sourcePeerRef.current.clear();
          sourceGenerationRef.current.clear();
          for (const raw of event.peers) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const peer = raw as Record<string, unknown>;
            const peerAddress = String(peer.address || '');
            const peerSessionId = String(peer.sessionId || '');
            const peerKey = String(peer.peerKey || '');
            const sourceId = Number(peer.sourceId || 0);
            if (
              !peerAddress ||
              !peerSessionId ||
              peerKey !== `${peerAddress}:${peerSessionId}` ||
              blockedAddressesRef.current[peerAddress] ||
              !Number.isInteger(sourceId) ||
              sourceId <= 0
            )
              continue;
            const gain = Number(peer.gain ?? 0);
            const pan = Number(peer.pan ?? 0);
            const volume = Number(peer.volume ?? 1);
            sourcePeerRef.current.set(sourceId, {
              key: peerKey,
              address: peerAddress,
            });
            previousPeerKeys.delete(peerKey);
            receiverRef.current?.setSourceSpatial(
              peerKey,
              peer.muted === true ? 0 : gain * volume,
              pan
            );
            restored[peerKey] = {
              key: peerKey,
              address: peerAddress,
              sessionId: peerSessionId,
              sourceId,
              state: String(peer.state || 'nearby'),
              distance:
                typeof peer.distance === 'number' ? peer.distance : null,
              gain,
              pan,
              volume,
              audible: peer.audible === true,
              muted: peer.muted === true,
              speaking: false,
            };
          }
          for (const stalePeerKey of previousPeerKeys)
            void receiverRef.current?.removeSource(stalePeerKey);
          setPeers(restored);
        }
        if (
          optedInRef.current &&
          event.enabled === false &&
          qortalLandRealtime.isReady()
        ) {
          setState('authorizing');
          send('ENABLE_PROXIMITY_VOICE', { mode: modeRef.current });
        }
        return;
      }
      if (event.type === 'PROXIMITY_PEER_STATE') {
        const peerAddress = String(event.address || '');
        const peerSessionId = String(event.sessionId || '');
        const peerKey = String(event.peerKey || '');
        const sourceId = Number(event.sourceId || 0);
        if (
          !peerAddress ||
          !peerSessionId ||
          peerKey !== `${peerAddress}:${peerSessionId}` ||
          !Number.isInteger(sourceId) ||
          sourceId <= 0
        )
          return;
        if (blockedAddressesRef.current[peerAddress]) {
          send('SET_PROXIMITY_PEER_POLICY', {
            address: peerAddress,
            blocked: true,
            muted: true,
            volume: 0,
          });
          return;
        }
        sourcePeerRef.current.set(sourceId, {
          key: peerKey,
          address: peerAddress,
        });
        const disconnected = event.state === 'disconnected';
        if (disconnected) {
          for (const [
            mappedSourceId,
            mappedPeer,
          ] of sourcePeerRef.current.entries()) {
            if (mappedPeer.key === peerKey) {
              sourcePeerRef.current.delete(mappedSourceId);
              sourceGenerationRef.current.delete(mappedSourceId);
            }
          }
          void receiverRef.current?.removeSource(peerKey);
          setPeers((current) => {
            const next = { ...current };
            delete next[peerKey];
            return next;
          });
          return;
        }
        const gain = Number(event.gain ?? 0);
        const volume = Number(event.volume ?? 1);
        const pan = Number(event.pan ?? 0);
        receiverRef.current?.setSourceSpatial(peerKey, gain * volume, pan);
        setPeers((current) => ({
          ...current,
          [peerKey]: {
            key: peerKey,
            address: peerAddress,
            sessionId: peerSessionId,
            sourceId,
            state: String(event.state || 'nearby'),
            distance:
              typeof event.distance === 'number' ? event.distance : null,
            gain,
            pan,
            volume,
            audible: event.audible === true,
            muted: event.muted === true,
            speaking: current[peerKey]?.speaking ?? false,
          },
        }));
        return;
      }
      if (event.type === 'PROXIMITY_SPEAKING_STATE') {
        const peerAddress = String(event.address || '');
        const peerKey = String(event.peerKey || '');
        if (!peerAddress || !peerKey || peerAddress === address) return;
        setPeers((current) =>
          current[peerKey]
            ? {
                ...current,
                [peerKey]: {
                  ...current[peerKey],
                  speaking: event.speaking === true,
                },
              }
            : current
        );
      }
    });
    type InboundPlayoutPacket = {
      sourceAddr: string;
      seq: number;
      opusFrame: Uint8Array;
      vad: boolean;
      timestampMs: number;
    };
    let inboundPackets: InboundPlayoutPacket[] = [];
    let inboundFlushTimer: number | null = null;
    const flushInboundPackets = () => {
      if (inboundFlushTimer !== null) {
        window.clearTimeout(inboundFlushTimer);
        inboundFlushTimer = null;
      }
      if (inboundPackets.length === 0) return;
      const packets = inboundPackets;
      inboundPackets = [];
      // WebSocket/RNS bursts can deliver several frames in one event-loop turn.
      // Hand them to the shared receiver together and in source/sequence order.
      packets.sort((left, right) =>
        left.sourceAddr === right.sourceAddr
          ? left.seq - right.seq
          : left.sourceAddr.localeCompare(right.sourceAddr)
      );
      void receiverRef.current?.handleDecodedPackets(packets);
    };
    const disposeBinary = qortalLandRealtime.onBinary((buffer) => {
      const frame = parseInboundAudio(buffer);
      if (!frame) return;
      const sourcePeer = sourcePeerRef.current.get(frame.sourceId);
      if (!sourcePeer || blockedAddressesRef.current[sourcePeer.address])
        return;
      const peerKey = sourcePeer.key;
      const previousGeneration = sourceGenerationRef.current.get(
        frame.sourceId
      );
      if (
        previousGeneration !== undefined &&
        previousGeneration !== frame.generation
      ) {
        inboundPackets = inboundPackets.filter(
          (packet) => packet.sourceAddr !== peerKey
        );
        void receiverRef.current?.removeSource(peerKey);
      }
      sourceGenerationRef.current.set(frame.sourceId, frame.generation);
      receiverRef.current?.noteIncomingAudio(frame.receivedAt);
      inboundPackets.push({
        sourceAddr: peerKey,
        seq: frame.sequence,
        opusFrame: frame.opus,
        vad: true,
        timestampMs: frame.receivedAt,
      });
      if (inboundPackets.length >= INBOUND_MICROBATCH_MAX_FRAMES) {
        flushInboundPackets();
      } else if (inboundFlushTimer === null) {
        inboundFlushTimer = window.setTimeout(
          flushInboundPackets,
          INBOUND_MICROBATCH_WAIT_MS
        );
      }
    });
    return () => {
      if (inboundFlushTimer !== null) window.clearTimeout(inboundFlushTimer);
      inboundPackets = [];
      disposeState();
      disposeEvent();
      disposeBinary();
      release();
    };
  }, [
    address,
    disable,
    enabled,
    getPosition,
    groupId,
    handleBackgroundAudioFailure,
    localDestinationHash,
    publicKey,
    send,
    sessionId,
    updateTransmit,
  ]);

  useEffect(() => {
    const next = new Set(
      Object.keys(blockedAddresses).filter((item) => blockedAddresses[item])
    );
    if (!qortalLandRealtime.isReady()) return;
    for (const peerAddress of next) {
      if (!blockedRef.current.has(peerAddress)) {
        try {
          send('SET_PROXIMITY_PEER_POLICY', {
            address: peerAddress,
            blocked: true,
          });
        } catch {
          /* reconnecting */
        }
      }
      for (const sourcePeer of sourcePeerRef.current.values()) {
        if (sourcePeer.address === peerAddress)
          void receiverRef.current?.removeSource(sourcePeer.key);
      }
      for (const [sourceId, sourcePeer] of sourcePeerRef.current.entries()) {
        if (sourcePeer.address === peerAddress) {
          sourcePeerRef.current.delete(sourceId);
          sourceGenerationRef.current.delete(sourceId);
        }
      }
      setPeers((current) => {
        const entries = Object.entries(current).filter(
          ([, peer]) => peer.address !== peerAddress
        );
        return entries.length === Object.keys(current).length
          ? current
          : Object.fromEntries(entries);
      });
    }
    for (const peerAddress of blockedRef.current) {
      if (!next.has(peerAddress)) {
        try {
          send('SET_PROXIMITY_PEER_POLICY', {
            address: peerAddress,
            blocked: false,
          });
        } catch {
          /* reconnecting */
        }
      }
    }
    blockedRef.current = next;
  }, [blockedAddresses, send, state]);

  useEffect(() => {
    if (!optedInRef.current || !qortalLandRealtime.isReady()) return;
    const publish = () => {
      const position = getPosition();
      positionSequenceRef.current += 1;
      try {
        send('UPDATE_PROXIMITY_POSITION', {
          landSessionId: sessionId,
          sequence: positionSequenceRef.current,
          ...position,
        });
      } catch {
        /* reconnecting */
      }
    };
    publish();
    const timer = window.setInterval(publish, 200);
    return () => window.clearInterval(timer);
  }, [getPosition, sessionId, send, state]);

  useEffect(() => {
    if (!optedInRef.current) return;
    try {
      send('SET_PROXIMITY_SUSPENDED', { suspended });
    } catch {
      /* reconnecting */
    }
    if (suspended) {
      pttHeldRef.current = false;
      updateTransmit(false);
      void senderRef.current?.stop();
      void receiverRef.current?.configure({ hearCall: false });
    } else if (state === 'suspended') {
      void receiverRef.current
        ?.configure({ hearCall: true })
        .then(() => receiverRef.current?.setMasterVolume(masterVolume));
      void startAudio().catch(handleBackgroundAudioFailure);
    }
  }, [
    handleBackgroundAudioFailure,
    masterVolume,
    send,
    startAudio,
    state,
    suspended,
    updateTransmit,
  ]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        modeRef.current !== 'push-to-talk' ||
        event.repeat ||
        isTypingTarget(event.target)
      )
        return;
      if (event.key.toLowerCase() !== pttKey) return;
      pttHeldRef.current = true;
      updateTransmit(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== pttKey) return;
      if (!pttHeldRef.current) return;
      pttHeldRef.current = false;
      updateTransmit(false);
    };
    const releasePtt = () => {
      if (!pttHeldRef.current) return;
      pttHeldRef.current = false;
      updateTransmit(false);
    };
    const releasePttForTyping = (event: FocusEvent) => {
      if (isTypingTarget(event.target)) releasePtt();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releasePtt);
    document.addEventListener('focusin', releasePttForTyping);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releasePtt);
      document.removeEventListener('focusin', releasePttForTyping);
    };
  }, [pttKey, updateTransmit]);

  const disableRef = useRef(disable);
  useEffect(() => {
    disableRef.current = disable;
  }, [disable]);
  useEffect(
    () => () => {
      void disableRef.current();
    },
    []
  );

  const setPeerPolicy = useCallback(
    (peerKey: string, muted: boolean, volume: number) => {
      const normalizedVolume = Math.max(0, Math.min(1, volume));
      const peer = peers[peerKey];
      if (!peer) return;
      send('SET_PROXIMITY_PEER_POLICY', {
        address: peer.address,
        sessionId: peer.sessionId,
        muted,
        volume: normalizedVolume,
      });
      setPeers((current) => {
        const currentPeer = current[peerKey];
        if (!currentPeer) return current;
        receiverRef.current?.setSourceSpatial(
          peerKey,
          muted ? 0 : currentPeer.gain * normalizedVolume,
          currentPeer.pan
        );
        return {
          ...current,
          [peerKey]: {
            ...currentPeer,
            muted,
            volume: normalizedVolume,
          },
        };
      });
    },
    [peers, send]
  );

  return useMemo(
    () => ({
      state,
      mode,
      pttKey,
      peers: Object.values(peers),
      error,
      transmitting,
      devices,
      inputDeviceId,
      outputDeviceId,
      masterVolume,
      enable,
      disable,
      setMode,
      setPttKey,
      setPeerPolicy,
      setInputDeviceId,
      setOutputDeviceId,
      setMasterVolume,
    }),
    [
      devices,
      disable,
      enable,
      error,
      inputDeviceId,
      masterVolume,
      mode,
      outputDeviceId,
      peers,
      pttKey,
      setInputDeviceId,
      setMasterVolume,
      setMode,
      setOutputDeviceId,
      setPeerPolicy,
      setPttKey,
      state,
      transmitting,
    ]
  );
}
