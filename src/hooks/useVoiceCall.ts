/**
 * useVoiceCall — three-tier P2P voice call hook.
 *
 * Three audio transport tiers are tried in order:
 *
 *   Tier 1 — WebRTC media (addTrack)
 *     Direct UDP audio stream.  ~80% of user pairs succeed.
 *     Activated when RTCPeerConnection fires 'ontrack'.
 *
 *   Tier 2 — WebRTC DataChannel (Opus binary)
 *     Same RTCPeerConnection and ICE path as Tier 1.
 *     Activated 2 s after ICE 'connected' if ontrack hasn't fired.
 *     Binary ArrayBuffer frames: no base64, no IPC round-trip.
 *
 *   Tier 3 — P2P TCP relay (CALL_AUDIO)
 *     Completely independent of WebRTC.
 *     Activated 8 s after call acceptance if ICE never reaches 'connected'
 *     (decentralized peer STUN may slow ICE gather; Tier 3 remains the reliability floor).
 *     Opus frames → base64 → window.call.sendAudio → P2P relay.
 *
 * Signaling (CALL_REQUEST / OFFER / ANSWER / ICE / HANGUP) always flows
 * through window.call IPC → main process → P2P mesh.
 *
 * Caller is responsible for signing CALL_REQUEST before calling initiateCall().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { callAudioDevicesAtom, userInfoAtom } from '../atoms/global';
import {
  applyCallAudioOutput,
  getUserAudioStreamForCall,
} from '../lib/call/audioDevices';
import {
  enqueueBufferedCallSignal,
  takeDrainableBufferedCallSignals,
  type BufferedCallSignal,
  type BufferedCallSignalType,
} from '../lib/call/signalQueue';
import { scheduleLogIceServerSourcesForPeer } from '../lib/webrtc/iceCandidateStats';
import { getInitialIceServersFromHub } from '../lib/webrtc/stunBootstrap';

// ── ICE server configuration ──────────────────────────────────────────────────
// Electron: sync bootstrap from window.hub (preload), refined via hub.getIceServers().

function initialIceServersFromEnvironment(): RTCIceServer[] {
  return getInitialIceServersFromHub().map((s) => ({ urls: s.urls }));
}

// ── Timing constants ──────────────────────────────────────────────────────────

/** After ICE connects, wait this long for ontrack before switching to DataChannel. */
const DATACHANNEL_ACTIVATION_MS = 2_000;

/** After call acceptance, wait this long for ICE before switching to TCP relay. */
const ICE_FAILURE_TIMEOUT_MS = 8_000;

/** Jitter buffer: drop audio frames older than this many ms. */
const JITTER_DROP_MS = 300;

/** DataChannel frame size in ms. */
const DC_FRAME_MS = 20;

/** Relay frame size in ms (larger = fewer relay messages). */
const RELAY_FRAME_MS = 40;

/** Sample rate for AudioContext capture and DataChannel frames. */
const AUDIO_SAMPLE_RATE = 48_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';
export type AudioMode = 'media' | 'datachannel' | 'relay' | null;

export interface IncomingCall {
  callId: string;
  fromAddress: string;
  chatId: string;
}

export interface UseVoiceCallReturn {
  callState: CallState;
  audioMode: AudioMode;
  isMuted: boolean;
  callDuration: number; // seconds
  incomingCall: IncomingCall | null;
  initiateCall: (
    targetAddress: string,
    chatId: string,
    sign: (fields: Record<string, unknown>) => Promise<{ signature: string; publicKey: string }>
  ) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
}

// ── Inline PCM codec (no external dependency) ────────────────────────────────
//
// Converts between the AudioContext's native Float32 PCM and compact Int16 PCM
// wire format.  Int16 is half the size of Float32 and is the standard wire
// format for voice (G.711 / raw PCM telephony).
//
// Tier 2 (DataChannel): 48 kHz Int16 → ~96 KB/s — fine for direct WebRTC.
// Tier 3 (TCP relay):   16 kHz Int16 → ~32 KB/s before base64 — acceptable.

const RELAY_SAMPLE_RATE = 16_000; // downsampled for TCP relay

const pcmCodec = {
  /** Float32 PCM → Int16 ArrayBuffer. */
  encode(pcm: Float32Array): ArrayBuffer {
    const buf = new ArrayBuffer(pcm.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  },

  /** Int16 ArrayBuffer → Float32 PCM. */
  decode(buf: ArrayBuffer): Float32Array {
    const view = new DataView(buf);
    const len = Math.floor(buf.byteLength / 2);
    const pcm = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      pcm[i] = view.getInt16(i * 2, true) / 0x7fff;
    }
    return pcm;
  },

  /** Downsample Float32 PCM from srcRate to dstRate (integer ratio required). */
  downsample(pcm: Float32Array, srcRate: number, dstRate: number): Float32Array {
    if (srcRate === dstRate) return pcm;
    const ratio = srcRate / dstRate;
    const out = new Float32Array(Math.floor(pcm.length / ratio));
    for (let i = 0; i < out.length; i++) {
      out[i] = pcm[Math.floor(i * ratio)];
    }
    return out;
  },
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceCall(): UseVoiceCallReturn {
  const userInfo = useAtomValue(userInfoAtom);

  const [callState, setCallState] = useState<CallState>('idle');
  const [audioMode, setAudioMode] = useState<AudioMode>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callAudioWireNonce, setCallAudioWireNonce] = useState(0);

  const callAudioDevices = useAtomValue(callAudioDevicesAtom);
  const setCallAudioDevices = useSetAtom(callAudioDevicesAtom);
  const callAudioPrefsRef = useRef(callAudioDevices);
  callAudioPrefsRef.current = callAudioDevices;
  const setCallAudioDevicesRef = useRef(setCallAudioDevices);
  setCallAudioDevicesRef.current = setCallAudioDevices;

  // ── Refs (do not re-render on change) ──────────────────────────────────────
  const callIdRef = useRef<string | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dcActivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioModeRef = useRef<AudioMode>(null);
  const relaySeqRef = useRef(0);
  // Jitter buffer: Map<seq, { ts: number; data: Uint8Array }>
  const jitterBufferRef = useRef<Map<number, { ts: number; data: Uint8Array }>>(new Map());
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const pendingSignalsRef = useRef<BufferedCallSignal[]>([]);
  const outboundSetupCallIdRef = useRef<string | null>(null);
  const inboundSetupCallIdRef = useRef<string | null>(null);

  /** ICE servers for RTCPeerConnection (decentralized STUN + bootstrap); refined via IPC. */
  const iceServersRef = useRef<RTCIceServer[]>(initialIceServersFromEnvironment());
  /** STUN `urls` strings used for last PC — reported to main for score feedback. */
  const lastStunBundleRef = useRef<string[]>([]);

  /** Tier 2/3 mic capture graph (ScriptProcessor) — torn down on mic swap / teardown. */
  const tier23CaptureRef = useRef<{
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
  } | null>(null);

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  /** Skip the first input-device effect after connect (stream already matches prefs from setup). */
  const inputSwapSeededRef = useRef(false);
  const prevInputPrefRef = useRef<string | null | undefined>(undefined);

  // Stable ref for the local public key — avoids re-creating sign-dependent
  // callbacks whenever userInfo updates.
  const publicKeyRef = useRef(userInfo?.publicKey ?? '');
  useEffect(() => {
    publicKeyRef.current = userInfo?.publicKey ?? '';
  }, [userInfo?.publicKey]);

  useEffect(() => {
    const w = window as Window & {
      hub?: { getIceServers?: () => Promise<{ urls: string }[]> };
    };
    if (!w.hub?.getIceServers) return;
    const pull = (): void => {
      w.hub?.getIceServers?.()?.then((list) => {
        if (Array.isArray(list) && list.length > 0) {
          iceServersRef.current = list.map((s) => ({ urls: s.urls }));
        }
      }).catch(() => {});
    };
    pull();
    const id = setInterval(pull, 120_000);
    return () => clearInterval(id);
  }, []);

  const updateCallState = useCallback((nextState: CallState) => {
    callStateRef.current = nextState;
    setCallState(nextState);
  }, []);

  const updateIncomingCall = useCallback((nextIncomingCall: IncomingCall | null) => {
    incomingCallRef.current = nextIncomingCall;
    setIncomingCall(nextIncomingCall);
  }, []);

  /**
   * Sign a small set of fields via the wallet's Ed25519 key.
   * Uses a ref for the public key so this callback is stable (no deps).
   */
  const signFields = useCallback(
    async (fields: Record<string, unknown>): Promise<{ signature: string; publicKey: string }> => {
      try {
        const res = await (window as any).sendMessage('signPresenceMessage', fields, 10_000);
        return {
          signature: (res?.signature as string) ?? '',
          publicKey: publicKeyRef.current,
        };
      } catch {
        return { signature: '', publicKey: publicKeyRef.current };
      }
    },
    [] // stable — reads publicKeyRef.current at call time
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (iceFailTimerRef.current) {
      clearTimeout(iceFailTimerRef.current);
      iceFailTimerRef.current = null;
    }
    if (dcActivateTimerRef.current) {
      clearTimeout(dcActivateTimerRef.current);
      dcActivateTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const resetPendingSignals = useCallback(() => {
    pendingSignalsRef.current = [];
    outboundSetupCallIdRef.current = null;
    inboundSetupCallIdRef.current = null;
  }, []);

  const stopTier23Capture = useCallback(() => {
    const g = tier23CaptureRef.current;
    if (g) {
      try {
        g.source.disconnect();
        g.processor.disconnect();
      } catch {
        /* ignore */
      }
      tier23CaptureRef.current = null;
    }
  }, []);

  const teardownRTC = useCallback(() => {
    stopTier23Capture();
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    jitterBufferRef.current.clear();
    relaySeqRef.current = 0;
    resetPendingSignals();
  }, [resetPendingSignals, stopTier23Capture]);

  const endCall = useCallback(
    (sendHangup = false) => {
      const id = callIdRef.current;
      if (id) {
        const w = window as Window & {
          hub?: {
            reportStunCallOutcome?: (u: string[], s: boolean) => Promise<unknown>;
          };
        };
        const urls = lastStunBundleRef.current;
        const mode = audioModeRef.current;
        const stunHelped = mode === 'media' || mode === 'datachannel';
        if (w.hub?.reportStunCallOutcome && urls.length > 0) {
          void w.hub.reportStunCallOutcome(urls, stunHelped);
        }
      }
      clearTimers();
      teardownRTC();
      if (sendHangup && id) {
        const timestamp = Date.now();
        signFields({ type: 'CALL_HANGUP', callId: id, timestamp })
          .then(({ signature, publicKey }) => {
            (window as any).call?.hangup(id, signature, publicKey, timestamp).catch(() => {});
          })
          .catch(() => {});
      }
      callIdRef.current = null;
      audioModeRef.current = null;
      updateCallState('ended');
      setAudioMode(null);
      setCallDuration(0);
      setIsMuted(false);
      updateIncomingCall(null);
      inputSwapSeededRef.current = false;
      prevInputPrefRef.current = undefined;
      // Reset to idle after a brief moment so UI can show "ended" state
      setTimeout(() => updateCallState('idle'), 1_500);
    },
    [clearTimers, signFields, teardownRTC, updateCallState, updateIncomingCall]
  );

  // ── Duration timer ─────────────────────────────────────────────────────────

  const startDurationTimer = useCallback(() => {
    setCallDuration(0);
    durationTimerRef.current = setInterval(
      () => setCallDuration((d) => d + 1),
      1_000
    );
  }, []);

  // ── Audio playback (Tier 2 & 3) ───────────────────────────────────────────

  const ensureAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioCtxRef.current = ctx;
      void applyCallAudioOutput(callAudioPrefsRef.current.outputDeviceId, {
        audioContext: ctx,
      }).then(({ clearPersistedOutput }) => {
        if (clearPersistedOutput) {
          setCallAudioDevicesRef.current((p) => ({ ...p, outputDeviceId: null }));
        }
      });
    }
    return audioCtxRef.current;
  }, []);

  const playPcmFrame = useCallback(
    (pcm: Float32Array, sampleRate = AUDIO_SAMPLE_RATE) => {
      const ctx = ensureAudioContext();
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
      buffer.copyToChannel(pcm, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
    },
    [ensureAudioContext]
  );

  // ── DataChannel audio capture (Tier 2) ────────────────────────────────────

  const startDataChannelCapture = useCallback(() => {
    if (!localStreamRef.current || !dcRef.current) return;

    stopTier23Capture();
    const ctx = ensureAudioContext();
    const src = ctx.createMediaStreamSource(localStreamRef.current);
    const frameSize = Math.floor((DC_FRAME_MS / 1000) * AUDIO_SAMPLE_RATE);

    // ScriptProcessorNode is deprecated but universally supported.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processor = (ctx as any).createScriptProcessor(frameSize, 1, 1);
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (dcRef.current?.readyState !== 'open') return;
      const pcm = e.inputBuffer.getChannelData(0);
      const encoded = pcmCodec.encode(new Float32Array(pcm));
      dcRef.current.send(encoded);
    };
    src.connect(processor);
    processor.connect(ctx.destination);
    tier23CaptureRef.current = { source: src, processor };
  }, [ensureAudioContext, stopTier23Capture]);

  // ── TCP relay audio capture (Tier 3) ──────────────────────────────────────

  const startRelayCapture = useCallback(() => {
    if (!localStreamRef.current) return;

    stopTier23Capture();
    const ctx = ensureAudioContext();
    const src = ctx.createMediaStreamSource(localStreamRef.current);
    // Use a larger frame at the relay sample rate to reduce relay message rate.
    const captureFrameSize = Math.floor((RELAY_FRAME_MS / 1000) * AUDIO_SAMPLE_RATE);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processor = (ctx as any).createScriptProcessor(captureFrameSize, 1, 1);
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const callId = callIdRef.current;
      if (!callId) return;
      const pcm48k = new Float32Array(e.inputBuffer.getChannelData(0));
      // Downsample to relay sample rate to cut bandwidth ~3×.
      const pcm16k = pcmCodec.downsample(pcm48k, AUDIO_SAMPLE_RATE, RELAY_SAMPLE_RATE);
      const encoded = pcmCodec.encode(pcm16k);
      // Convert to base64 for JSON wire transport.
      const bytes = new Uint8Array(encoded);
      let b64 = '';
      for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
      const b64str = btoa(b64);
      const seq = ++relaySeqRef.current;
      (window as any).call?.sendAudio(callId, seq, b64str).catch(() => {});
    };
    src.connect(processor);
    processor.connect(ctx.destination);
    tier23CaptureRef.current = { source: src, processor };
  }, [ensureAudioContext, stopTier23Capture]);

  // ── DataChannel setup ──────────────────────────────────────────────────────

  const setupDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dcRef.current = dc;

      dc.onopen = () => {
        if (audioModeRef.current !== 'media') {
          audioModeRef.current = 'datachannel';
          setAudioMode('datachannel');
          startDataChannelCapture();
        }
      };

      dc.onmessage = async (e) => {
        const buf: ArrayBuffer =
          e.data instanceof ArrayBuffer
            ? e.data
            : await (e.data as Blob).arrayBuffer();
        const pcm = pcmCodec.decode(buf);
        playPcmFrame(pcm, AUDIO_SAMPLE_RATE);
      };

      dc.onerror = () => {};
    },
    [startDataChannelCapture, playPcmFrame]
  );

  const applyBufferedSignal = useCallback(
    async (
      pc: RTCPeerConnection,
      signal: BufferedCallSignal
    ) => {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'offer', sdp: signal.data as string })
        );
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const answerTs = Date.now();
        const { signature: ansSig, publicKey: ansKey } = await signFields({
          type: 'CALL_ANSWER', callId: signal.callId, timestamp: answerTs,
        });
        await (window as any).call?.sendSignal(
          signal.callId,
          'answer',
          answer.sdp,
          ansSig,
          ansKey,
          answerTs
        );
        return;
      }

      if (signal.type === 'answer') {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: signal.data as string })
        );
        return;
      }

      if (signal.data) {
        await pc
          .addIceCandidate(new RTCIceCandidate(signal.data as RTCIceCandidateInit))
          .catch(() => {});
      }
    },
    [signFields]
  );

  const drainPendingSignals = useCallback(async () => {
    const pc = pcRef.current;
    const activeCallId = callIdRef.current;
    if (!pc || !activeCallId || pendingSignalsRef.current.length === 0) return;

    let remaining = pendingSignalsRef.current.filter(
      (signal) => signal.callId === activeCallId
    );
    const otherCalls = pendingSignalsRef.current.filter(
      (signal) => signal.callId !== activeCallId
    );

    let guard = 0;
    while (remaining.length > 0 && guard < 10) {
      guard++;
      const hasRemoteDescription = Boolean(
        pc.remoteDescription || pc.pendingRemoteDescription
      );
      const nextBatch = takeDrainableBufferedCallSignals(
        remaining,
        hasRemoteDescription
      );
      if (nextBatch.ready.length === 0) break;
      remaining = nextBatch.remaining;
      for (const signal of nextBatch.ready) {
        if (signal.callId !== callIdRef.current) return;
        await applyBufferedSignal(pc, signal);
      }
    }

    pendingSignalsRef.current = [...otherCalls, ...remaining];
  }, [applyBufferedSignal]);

  // ── RTCPeerConnection factory ──────────────────────────────────────────────

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const servers = iceServersRef.current;
    lastStunBundleRef.current = servers
      .map((s) => (typeof s.urls === 'string' ? s.urls : s.urls[0]))
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    const pc = new RTCPeerConnection({ iceServers: servers });

    // ICE candidates → send via signaling
    pc.onicecandidate = (e) => {
      const callId = callIdRef.current;
      if (e.candidate) {
        console.log('[ICE] local candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address, e.candidate.port);
      } else {
        console.log('[ICE] local candidate gathering complete');
      }
      if (!callId) return;
      (window as any).call
        ?.sendSignal(callId, 'ice', e.candidate ? e.candidate.toJSON() : null)
        .catch(() => {});
    };

    pc.onicecandidateerror = (e: RTCPeerConnectionIceErrorEvent) => {
      console.error('[ICE] candidate error — code:', e.errorCode, '| text:', e.errorText, '| url:', e.url, '| addr:', e.address, e.port);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[ICE] connection state →', pc.iceConnectionState);
    };

    pc.onicegatheringstatechange = () => {
      console.log('[ICE] gathering state →', pc.iceGatheringState);
      if (pc.iceGatheringState === 'complete') {
        scheduleLogIceServerSourcesForPeer(pc, '[ICE]');
      }
    };

    // Tier 1: remote audio track arrived.
    // Chrome fires ontrack at setRemoteDescription time, before ICE fully connects.
    // Cancel the ICE-failure fallback timer here — if ICE genuinely fails afterwards
    // pc.connectionState === 'failed' will handle it via onconnectionstatechange.
    pc.ontrack = (e) => {
      console.log('[ICE] ontrack fired — activating Tier 1 (WebRTC media)');
      clearTimeout(iceFailTimerRef.current!);
      iceFailTimerRef.current = null;
      clearTimeout(dcActivateTimerRef.current!);
      dcActivateTimerRef.current = null;
      audioModeRef.current = 'media';
      setAudioMode('media');

      // Attach to an <audio> element for playback
      let audio = document.getElementById(
        '__qortal_call_audio__'
      ) as HTMLAudioElement | null;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = '__qortal_call_audio__';
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      audio.srcObject = e.streams[0] ?? null;
      void applyCallAudioOutput(callAudioPrefsRef.current.outputDeviceId, {
        audioElement: audio,
      }).then(({ clearPersistedOutput }) => {
        if (clearPersistedOutput) {
          setCallAudioDevicesRef.current((p) => ({ ...p, outputDeviceId: null }));
        }
      });
    };

    pc.onconnectionstatechange = () => {
      console.log('[ICE] pc.connectionState →', pc.connectionState);
      if (pc.connectionState === 'connected') {
        clearTimeout(iceFailTimerRef.current!);
        iceFailTimerRef.current = null;

        if (!audioModeRef.current) {
          console.log('[ICE] connected, no ontrack yet — waiting', DATACHANNEL_ACTIVATION_MS, 'ms for DataChannel');
          // ICE connected but no ontrack yet — start DataChannel activation timer
          dcActivateTimerRef.current = setTimeout(() => {
            if (audioModeRef.current !== 'media') {
              console.log('[ICE] DataChannel activation timer fired — dc.readyState:', dcRef.current?.readyState);
              audioModeRef.current = 'datachannel';
              setAudioMode('datachannel');
              // DataChannel may already be open; if so, startDataChannelCapture
              if (dcRef.current?.readyState === 'open') {
                startDataChannelCapture();
              }
            }
          }, DATACHANNEL_ACTIVATION_MS);
        }
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected'
      ) {
        console.warn('[ICE] connection', pc.connectionState, '— falling back to Relay (Tier 3)');
        // If ICE truly failed, switch to relay unconditionally — even if ontrack fired
        // earlier (Chrome fires ontrack at SDP time; without ICE the track carries no audio).
        if (audioModeRef.current !== 'relay') {
          audioModeRef.current = 'relay';
          setAudioMode('relay');
          startRelayCapture();
        }
      }
    };

    return pc;
  }, [startDataChannelCapture, startRelayCapture]);

  // ── User media ─────────────────────────────────────────────────────────────

  const getUserAudio = useCallback(async (): Promise<MediaStream | null> => {
    const { stream, clearedStaleInputDevice } = await getUserAudioStreamForCall(
      callAudioPrefsRef.current.inputDeviceId
    );
    if (clearedStaleInputDevice) {
      setCallAudioDevices((prev) => ({ ...prev, inputDeviceId: null }));
    }
    if (stream) {
      localStreamRef.current = stream;
    } else {
      console.error('[Call] getUserMedia failed');
    }
    return stream;
  }, [setCallAudioDevices]);

  const swapVoiceCallInput = useCallback(
    async (deviceId: string | null) => {
      if (callStateRef.current !== 'connected') return;
      if (!localStreamRef.current) return;

      const curTrack = localStreamRef.current.getAudioTracks()[0];
      const curId = curTrack?.getSettings?.().deviceId;
      if (deviceId != null && curId === deviceId) return;

      const mode = audioModeRef.current;
      const pc = pcRef.current;

      const { stream, clearedStaleInputDevice } = await getUserAudioStreamForCall(deviceId);
      if (clearedStaleInputDevice) {
        setCallAudioDevices((prev) => ({ ...prev, inputDeviceId: null }));
      }
      if (!stream) return;

      const newTrack = stream.getAudioTracks()[0];
      if (!newTrack) return;

      newTrack.enabled = !isMutedRef.current;

      if (mode === 'media' && pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = stream;
        return;
      }

      if (mode === 'datachannel' || mode === 'relay') {
        stopTier23Capture();
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = stream;
        if (mode === 'datachannel') {
          startDataChannelCapture();
        } else {
          startRelayCapture();
        }
        return;
      }

      // Connected but audio tier not chosen yet — keep localStreamRef aligned for the upcoming tier.
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = stream;
    },
    [
      setCallAudioDevices,
      startDataChannelCapture,
      startRelayCapture,
      stopTier23Capture,
    ]
  );

  // ── Outbound call setup ────────────────────────────────────────────────────

  const setupOutboundCall = useCallback(
    async (callId: string) => {
      const stream = await getUserAudio();
      if (!stream) {
        endCall();
        return false;
      }

      const pc = createPeerConnection();
      pcRef.current = pc;

      // Tier 1: add local audio track
      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

      // Tier 2: create DataChannel on same connection
      const dc = pc.createDataChannel('audio', {
        ordered: false,
        maxRetransmits: 0,
      });
      setupDataChannel(dc);

      // ICE failure fallback — only fires if ontrack hasn't already cancelled it
      iceFailTimerRef.current = setTimeout(() => {
        if (
          pc.connectionState !== 'connected' &&
          pc.connectionState !== 'completed' &&
          audioModeRef.current !== 'media' &&
          audioModeRef.current !== 'datachannel'
        ) {
          console.warn('[ICE] 8s timeout — ICE never connected (outbound). pc.connectionState:', pc.connectionState, '| iceConnectionState:', pc.iceConnectionState, '→ activating Relay (Tier 3)');
          audioModeRef.current = 'relay';
          setAudioMode('relay');
          startRelayCapture();
        }
      }, ICE_FAILURE_TIMEOUT_MS);

      // Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const offerTs = Date.now();
      const { signature: offerSig, publicKey: offerKey } = await signFields({
        type: 'CALL_OFFER', callId, timestamp: offerTs,
      });
      await (window as any).call?.sendSignal(callId, 'offer', offer.sdp, offerSig, offerKey, offerTs);
      await drainPendingSignals();
      setCallAudioWireNonce((n) => n + 1);
      return true;
    },
    [createPeerConnection, drainPendingSignals, endCall, getUserAudio, setupDataChannel, startRelayCapture, signFields]
  );

  // ── Inbound call setup ─────────────────────────────────────────────────────

  const setupInboundCall = useCallback(
    async (callId: string) => {
      const stream = await getUserAudio();
      if (!stream) {
        const rejectTs = Date.now();
        const { signature: rSig, publicKey: rKey } = await signFields({
          type: 'CALL_REJECT', callId, timestamp: rejectTs,
        });
        await (window as any).call?.reject(callId, 'media unavailable', rSig, rKey, rejectTs);
        endCall();
        return false;
      }

      const pc = createPeerConnection();
      pcRef.current = pc;

      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

      // Callee listens for DataChannel created by caller
      pc.ondatachannel = (e) => setupDataChannel(e.channel);

      // ICE failure fallback — only fires if ontrack hasn't already cancelled it
      iceFailTimerRef.current = setTimeout(() => {
        if (
          pc.connectionState !== 'connected' &&
          pc.connectionState !== 'completed' &&
          audioModeRef.current !== 'media' &&
          audioModeRef.current !== 'datachannel'
        ) {
          console.warn('[ICE] 8s timeout — ICE never connected (inbound). pc.connectionState:', pc.connectionState, '| iceConnectionState:', pc.iceConnectionState, '→ activating Relay (Tier 3)');
          audioModeRef.current = 'relay';
          setAudioMode('relay');
          startRelayCapture();
        }
      }, ICE_FAILURE_TIMEOUT_MS);
      return true;
    },
    [createPeerConnection, endCall, getUserAudio, setupDataChannel, startRelayCapture, signFields]
  );

  // ── window.call event listener ─────────────────────────────────────────────

  useEffect(() => {
    const callAPI = (window as any).call;
    if (!callAPI) return;

    const handleEvent = async (event: string, payload: unknown) => {
      const p = payload as Record<string, unknown>;

      switch (event) {
        case 'call:incoming': {
          if (callStateRef.current !== 'idle') break; // already in a call
          updateIncomingCall({
            callId: p.callId as string,
            fromAddress: p.fromAddress as string,
            chatId: p.chatId as string,
          });
          updateCallState('ringing');
          break;
        }

        case 'call:accepted': {
          if (
            callIdRef.current !== p.callId ||
            callStateRef.current !== 'calling' ||
            outboundSetupCallIdRef.current === p.callId
          )
            break;
          outboundSetupCallIdRef.current = p.callId as string;
          updateCallState('connected');
          startDurationTimer();
          try {
            await setupOutboundCall(p.callId as string);
          } finally {
            if (outboundSetupCallIdRef.current === p.callId) {
              outboundSetupCallIdRef.current = null;
            }
          }
          break;
        }

        case 'call:rejected': {
          if (callIdRef.current !== p.callId) break;
          endCall(false);
          break;
        }

        case 'call:signal': {
          if (callIdRef.current !== p.callId) break;
          pendingSignalsRef.current = enqueueBufferedCallSignal(
            pendingSignalsRef.current,
            {
              callId: p.callId as string,
              type: p.type as BufferedCallSignalType,
              data: p.data,
            }
          );
          await drainPendingSignals();
          break;
        }

        case 'call:hangup': {
          if (callIdRef.current !== p.callId) break;
          endCall(false);
          break;
        }

        case 'call:audio': {
          // Tier 3 relay frame
          if (callIdRef.current !== p.callId) break;
          const ts = Date.now();
          const seq = p.seq as number;

          // Drop stale frames
          const oldest = ts - JITTER_DROP_MS;
          for (const [s, v] of jitterBufferRef.current) {
            if (v.ts < oldest) jitterBufferRef.current.delete(s);
          }

          const raw = atob(p.data as string);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

          jitterBufferRef.current.set(seq, { ts, data: bytes });
          const pcm = pcmCodec.decode(bytes.buffer);
          playPcmFrame(pcm, RELAY_SAMPLE_RATE);
          break;
        }
      }
    };

    const unsubscribe = callAPI.onEvent(handleEvent);
    return unsubscribe;
  }, [
    drainPendingSignals,
    endCall,
    playPcmFrame,
    setupOutboundCall,
    startDurationTimer,
    updateCallState,
    updateIncomingCall,
  ]);

  // ── Register local address with call manager ───────────────────────────────

  useEffect(() => {
    const addr = userInfo?.address;
    if (!addr) return;
    (window as any).call
      ?.setLocalAddresses([addr])
      .catch(() => {});
  }, [userInfo?.address]);

  // ── Public actions ─────────────────────────────────────────────────────────

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

      callIdRef.current = callId;
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
        callIdRef.current = null;
        resetPendingSignals();
        updateCallState('idle');
      }
    },
    [resetPendingSignals, updateCallState, userInfo?.address, userInfo?.publicKey]
  );

  const acceptCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming || callStateRef.current !== 'ringing') return;
    if (inboundSetupCallIdRef.current === incoming.callId) return;

    inboundSetupCallIdRef.current = incoming.callId;
    callIdRef.current = incoming.callId;
    updateIncomingCall(null);

    try {
      const setupOk = await setupInboundCall(incoming.callId);
      if (!setupOk) return;

      updateCallState('connected');
      startDurationTimer();

      const acceptTs = Date.now();
      const { signature, publicKey } = await signFields({
        type: 'CALL_ACCEPT', callId: incoming.callId, timestamp: acceptTs,
      });
      await (window as any).call?.accept(incoming.callId, signature, publicKey, acceptTs);
      await drainPendingSignals();
    } finally {
      if (inboundSetupCallIdRef.current === incoming.callId) {
        inboundSetupCallIdRef.current = null;
      }
    }
  }, [drainPendingSignals, setupInboundCall, signFields, startDurationTimer, updateCallState, updateIncomingCall]);

  const rejectCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;
    updateIncomingCall(null);
    resetPendingSignals();
    updateCallState('idle');

    const rejectTs = Date.now();
    const { signature, publicKey } = await signFields({
      type: 'CALL_REJECT', callId: incoming.callId, timestamp: rejectTs,
    });
    await (window as any).call?.reject(incoming.callId, 'rejected', signature, publicKey, rejectTs);
  }, [resetPendingSignals, signFields, updateCallState, updateIncomingCall]);

  const hangUp = useCallback(() => {
    endCall(true);
  }, [endCall]);

  const toggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((m) => !m);
  }, []);

  useEffect(() => {
    if (callState !== 'connected') {
      inputSwapSeededRef.current = false;
      prevInputPrefRef.current = undefined;
      return;
    }
    if (!localStreamRef.current) return;
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
        audioElement: document.getElementById('__qortal_call_audio__') as HTMLAudioElement | null,
      });
      if (r.clearPersistedOutput) {
        setCallAudioDevices((p) => ({ ...p, outputDeviceId: null }));
      }
    })();
  }, [callState, callAudioDevices.outputDeviceId, callAudioWireNonce, setCallAudioDevices]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearTimers();
      teardownRTC();
    };
  }, [clearTimers, teardownRTC]);

  return {
    callState,
    audioMode,
    isMuted,
    callDuration,
    incomingCall,
    initiateCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
  };
}
