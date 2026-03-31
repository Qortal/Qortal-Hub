/**
 * Call protocol for the Qortal Hub P2P network.
 *
 * Implements fully decentralized voice-call signaling on top of the existing
 * P2P mesh.  All CALL_* messages are ephemeral (never stored to disk).
 *
 * Three-tier audio transport (handled entirely in the renderer):
 *   Tier 1 — WebRTC media (addTrack) — direct UDP, ~80% of pairs
 *   Tier 2 — WebRTC DataChannel (Opus binary) — same ICE path, no base64
 *   Tier 3 — CALL_AUDIO over P2P TCP relay — last resort, 100% coverage
 *
 * This module handles only the signaling layer:
 *   - CALL_REQUEST / ACCEPT / REJECT — call setup
 *   - CALL_OFFER / ANSWER / ICE — WebRTC SDP + ICE exchange
 *   - CALL_HANGUP — call teardown
 *   - CALL_AUDIO — Tier-3 audio chunk relay
 *
 * Security:
 *   CALL_REQUEST must carry an Ed25519 signature over the canonical fields
 *   (same signing scheme as presence/chat).  Unsigned or spoofed requests
 *   are dropped before the renderer ever sees them.
 *
 * Relay hops: capped at 2 for all call messages (vs chat's 4) because stale
 * ICE candidates and out-of-order audio chunks are useless anyway.
 */

import { EventEmitter } from 'events';
import { ReticulumSdpSession, allowIceReticulum } from './call-reticulum-sdp';
import {
  RT_CALL_ROUTE_POLL_MS,
  RT_CALL_ROUTE_WINDOW_MS,
  RT_ICE_MAX_PER_SEC,
  buildSdpWireFrames,
  decodeReticulumCallWire,
  encodeReticulumCallWire,
  sha256HexUtf8,
} from './call-wire-reticulum';
import { log as loggerLog, error as loggerError, warn as loggerWarn } from './logger';
import { wireFitsReticulum } from './reticulum-wire-size';
import { deriveAddressFromPublicKey } from './presence';
import { VerifyWorkerPool } from './verify-worker-pool';
import type { P2PNetwork } from './p2p-network';
import type { PresenceManager } from './presence';
import type { ReticulumBridge } from './reticulum-bridge';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max hops for call signaling and audio relay (less than chat's 4). */
const CALL_MAX_HOPS = 2;

/** How long an unanswered CALL_REQUEST lives before we auto-clean it. */
const CALL_REQUEST_TTL_MS = 60_000;

/** Max byte size for a single CALL_AUDIO chunk (base64 Opus frame). */
const CALL_AUDIO_MAX_BYTES = 8_192;

/** Max simultaneous CALL_AUDIO streams this node will relay for others. */
const CALL_AUDIO_MAX_RELAY_STREAMS = 3;

// ── Wire types ────────────────────────────────────────────────────────────────

export type CallNetworkType =
  | 'CALL_REQUEST'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_OFFER'
  | 'CALL_ANSWER'
  | 'CALL_ICE'
  | 'CALL_HANGUP'
  | 'CALL_AUDIO';

export const CALL_MESSAGE_TYPES = new Set<string>([
  'CALL_REQUEST',
  'CALL_ACCEPT',
  'CALL_REJECT',
  'CALL_OFFER',
  'CALL_ANSWER',
  'CALL_ICE',
  'CALL_HANGUP',
  'CALL_AUDIO',
]);

// ── Envelope shapes ───────────────────────────────────────────────────────────

export interface CallRequestEnvelope {
  type: 'CALL_REQUEST';
  callId: string;
  /** Qortal address of the caller. */
  fromAddress: string;
  /** Base58-encoded Ed25519 public key of the caller. */
  fromPublicKey: string;
  /** chatId of the support conversation this call belongs to. */
  chatId: string;
  /** Ed25519 signature over canonicalized { callId, chatId, fromAddress,
   *  fromPublicKey, timestamp, type }. */
  signature: string;
  timestamp: number;
  /** Remaining relay hops (decremented on each forward). */
  hopsRemaining?: number;
}

export interface CallAcceptEnvelope {
  type: 'CALL_ACCEPT';
  callId: string;
  /** Base58-encoded Ed25519 public key of the accepting peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type }. */
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallRejectEnvelope {
  type: 'CALL_REJECT';
  callId: string;
  reason?: string;
  /** Base58-encoded Ed25519 public key of the rejecting peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type }. */
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallOfferEnvelope {
  type: 'CALL_OFFER';
  callId: string;
  sdp: string;
  /** SHA-256 hex (lowercase) of SDP UTF-8; included in the signed payload. */
  sdpHash: string;
  /** Base58-encoded Ed25519 public key of the offering peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type, sdpHash }. */
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallAnswerEnvelope {
  type: 'CALL_ANSWER';
  callId: string;
  sdp: string;
  /** SHA-256 hex (lowercase) of SDP UTF-8; included in the signed payload. */
  sdpHash: string;
  /** Base58-encoded Ed25519 public key of the answering peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type, sdpHash }. */
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallIceEnvelope {
  type: 'CALL_ICE';
  callId: string;
  /** RTCIceCandidateInit or null (end-of-candidates). */
  candidate: Record<string, unknown> | null;
  hopsRemaining?: number;
}

export interface CallHangupEnvelope {
  type: 'CALL_HANGUP';
  callId: string;
  /** Base58-encoded Ed25519 public key of the hanging-up peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type }. */
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallAudioEnvelope {
  type: 'CALL_AUDIO';
  callId: string;
  /** Monotonically increasing per-sender sequence number. */
  seq: number;
  /** Base64-encoded Opus audio frame. */
  data: string;
  hopsRemaining?: number;
}

export type CallWireEnvelope =
  | CallRequestEnvelope
  | CallAcceptEnvelope
  | CallRejectEnvelope
  | CallOfferEnvelope
  | CallAnswerEnvelope
  | CallIceEnvelope
  | CallHangupEnvelope
  | CallAudioEnvelope;

// ── Internal call record ──────────────────────────────────────────────────────

export type CallDirection = 'outbound' | 'inbound';
export type CallState =
  | 'pending'   // CALL_REQUEST sent or received, awaiting response
  | 'active'    // accepted, WebRTC signaling in progress
  | 'ended';    // hung up, rejected, or timed out

interface CallRecord {
  callId: string;
  localAddress: string;
  remoteAddress: string;
  /** P2P nodeId of the remote peer (used for targeted signal delivery). */
  remoteNodeId: string | null;
  /** Preferred signaling transport when Reticulum is available. */
  remoteTransport: 'mesh' | 'reticulum';
  /** Callee/caller presence destination hash (Reticulum) for `send_call`. */
  reticulumPeerPresenceHash: string | null;
  chatId: string;
  direction: CallDirection;
  state: CallState;
  startedAt: number;
  /** Cleanup timer for unanswered CALL_REQUESTs. */
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const CALL_VERIFY_WORKER_COUNT = 2;
const CALL_MAX_PENDING_VERIFY = 512;

// ── Audio relay load tracking ─────────────────────────────────────────────────

/**
 * Tracks active audio relay streams by callId.  Each entry is removed when
 * we see a CALL_HANGUP for that call.  Capped at CALL_AUDIO_MAX_RELAY_STREAMS
 * to prevent bandwidth abuse.
 */
const activeAudioRelayStreams = new Set<string>();

// ── CallManager ───────────────────────────────────────────────────────────────

/**
 * Manages the call signaling layer on top of the P2P network.
 *
 * Events emitted (forwarded to the renderer via IPC):
 *   'call:incoming'  { callId, fromAddress, chatId }
 *   'call:accepted'  { callId }
 *   'call:rejected'  { callId, reason? }
 *   'call:signal'    { callId, type: 'offer'|'answer'|'ice', data }
 *   'call:hangup'    { callId }
 *   'call:audio'     { callId, seq, data }
 */
export class CallManager extends EventEmitter {
  private p2p: P2PNetwork;
  private presence: PresenceManager;
  private reticulumBridge: ReticulumBridge | null;
  private started = false;
  private activeCalls = new Map<string, CallRecord>();
  private localAddresses = new Set<string>();
  private verifyPool = new VerifyWorkerPool(
    'call',
    CALL_VERIFY_WORKER_COUNT,
    CALL_MAX_PENDING_VERIFY
  );
  private onReticulumCallMessage:
    | ((wire: Record<string, unknown>, senderCallHash: string) => void)
    | null = null;
  private reticulumUnsub: (() => void) | null = null;
  private readonly sdpSession: ReticulumSdpSession;
  private iceBuckets = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(
    p2p: P2PNetwork,
    presence: PresenceManager,
    reticulumBridge?: ReticulumBridge | null
  ) {
    super();
    this.p2p = p2p;
    this.presence = presence;
    this.reticulumBridge = reticulumBridge ?? null;
    this.sdpSession = new ReticulumSdpSession({
      sendWire: (peer, msg) => {
        if (!wireFitsReticulum(msg)) {
          loggerWarn('[Call] Skipping Reticulum sendCall: wire exceeds limit');
          return;
        }
        void this.reticulumBridge?.sendCall(peer, msg);
      },
      onReassembled: (args) => {
        this.deliverReticulumReassembledSdp(args);
      },
      onInboundFailed: (callId, reason) => {
        loggerLog(`[Call] Reticulum SDP inbound failed ${callId}: ${reason}`);
      },
      getPeerPresenceHashForAddress: (address) => {
        const r = this.presence.getRouteForAddress(address);
        return r?.kind === 'reticulum' ? r.destinationHash : null;
      },
      isCallActiveForSdp: (callId) => {
        const c = this.activeCalls.get(callId);
        return Boolean(c && c.state === 'active');
      },
    });
  }

  private attachReticulumBridge(): void {
    const bridge = this.reticulumBridge;
    if (!bridge || this.reticulumUnsub) return;
    if (!this.onReticulumCallMessage) {
      this.onReticulumCallMessage = (
        wire: Record<string, unknown>,
        senderCallHash: string
      ): void => {
        try {
          this.onReticulumCallWire(wire, senderCallHash);
        } catch (err) {
          loggerError('[Call] Reticulum wire error:', err);
        }
      };
    }
    bridge.on('call-message', this.onReticulumCallMessage);
    this.reticulumUnsub = () => {
      if (this.onReticulumCallMessage) {
        bridge.off('call-message', this.onReticulumCallMessage);
      }
    };
  }

  private detachReticulumBridge(): void {
    this.reticulumUnsub?.();
    this.reticulumUnsub = null;
  }

  setReticulumBridge(reticulumBridge?: ReticulumBridge | null): void {
    const nextBridge = reticulumBridge ?? null;
    if (this.reticulumBridge === nextBridge) {
      if (this.started) this.attachReticulumBridge();
      return;
    }
    this.detachReticulumBridge();
    this.reticulumBridge = nextBridge;
    if (this.started) {
      this.attachReticulumBridge();
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.verifyPool.start();
    this.p2p.on('message', this.onP2PMessage);
    this.attachReticulumBridge();
    loggerLog('[Call] Manager started.');
  }

  stop(): void {
    this.started = false;
    this.verifyPool.stop();
    this.p2p.off('message', this.onP2PMessage);
    this.detachReticulumBridge();
    this.sdpSession.disposeAll();
    this.iceBuckets.clear();
    for (const call of this.activeCalls.values()) {
      if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    }
    this.activeCalls.clear();
    activeAudioRelayStreams.clear();
    loggerLog('[Call] Manager stopped.');
  }

  // ── Public API (called via IPC) ───────────────────────────────────────────

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
  }

  /**
   * Initiate an outbound call to `targetAddress`.
   * Waits briefly for a Reticulum or mesh route, then sends CALL_REQUEST.
   * Returns the new callId, or null if no route appears in time.
   */
  async initiateCall(
    targetAddress: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    callId: string,
    timestamp: number
  ): Promise<string | null> {
    const env: CallRequestEnvelope = {
      type: 'CALL_REQUEST',
      callId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      chatId,
      signature,
      timestamp,
      hopsRemaining: CALL_MAX_HOPS,
    };

    const deadline = Date.now() + RT_CALL_ROUTE_WINDOW_MS;
    let remoteNodeId: string | null = null;
    let reticulumPeerHash: string | null = null;
    let useReticulum = false;

    while (Date.now() < deadline) {
      const route = this.presence.getRouteForAddress(targetAddress);
      if (
        route?.kind === 'reticulum' &&
        this.reticulumBridge?.getState() === 'ready'
      ) {
        reticulumPeerHash = route.destinationHash;
        useReticulum = true;
        break;
      }
      remoteNodeId = this.presence.getNodeIdForAddress(targetAddress);
      if (remoteNodeId) {
        useReticulum = false;
        break;
      }
      await new Promise((r) => setTimeout(r, RT_CALL_ROUTE_POLL_MS));
    }

    if (!useReticulum && !remoteNodeId) {
      loggerLog(`[Call] No route to ${targetAddress} within window`);
      return null;
    }

    const record: CallRecord = {
      callId,
      localAddress,
      remoteAddress: targetAddress,
      remoteNodeId: useReticulum
        ? this.presence.getNodeIdForAddress(targetAddress)
        : remoteNodeId,
      remoteTransport: useReticulum ? 'reticulum' : 'mesh',
      reticulumPeerPresenceHash: useReticulum ? reticulumPeerHash : null,
      chatId,
      direction: 'outbound',
      state: 'pending',
      startedAt: timestamp,
    };

    record.cleanupTimer = setTimeout(() => {
      if (this.activeCalls.get(callId)?.state === 'pending') {
        loggerLog(`[Call] Request ${callId.slice(0, 8)}… timed out.`);
        this.sdpSession.disposeCall(callId);
        this.iceBuckets.delete(callId);
        this.activeCalls.delete(callId);
      }
    }, CALL_REQUEST_TTL_MS);

    this.activeCalls.set(callId, record);
    this.sdpSession.registerCallRemoteAddress(callId, targetAddress);

    if (useReticulum && reticulumPeerHash) {
      const wire = encodeReticulumCallWire(env);
      if (wire) {
        if (!wireFitsReticulum(wire)) {
          loggerWarn('[Call] Skipping Reticulum CALL_REQUEST: wire exceeds limit');
        } else {
          void this.reticulumBridge?.sendCall(reticulumPeerHash, wire);
        }
      }
    } else if (remoteNodeId) {
      this.p2p.send(remoteNodeId, env);
    } else {
      this.p2p.send(null, env);
    }

    loggerLog(
      `[Call] Initiated call ${callId.slice(0, 8)}… to ${targetAddress} via ${useReticulum ? 'reticulum' : 'mesh'}`
    );
    return callId;
  }

  acceptCall(callId: string, signature: string, publicKey: string, timestamp: number): void {
    const call = this.activeCalls.get(callId);
    if (!call || call.direction !== 'inbound') return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    call.state = 'active';

    const env: CallAcceptEnvelope = {
      type: 'CALL_ACCEPT',
      callId,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: CALL_MAX_HOPS,
    };
    this.sendToCall(call, env);
    loggerLog(`[Call] Accepted call ${callId.slice(0, 8)}…`);
  }

  rejectCall(callId: string, reason?: string, signature?: string, publicKey?: string, timestamp?: number): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    call.state = 'ended';
    this.sdpSession.disposeCall(callId);
    this.sdpSession.unregisterCallRemoteAddress(callId);
    this.iceBuckets.delete(callId);
    this.activeCalls.delete(callId);

    const env: CallRejectEnvelope = {
      type: 'CALL_REJECT',
      callId,
      reason,
      fromPublicKey: publicKey ?? '',
      signature: signature ?? '',
      timestamp: timestamp ?? Date.now(),
      hopsRemaining: CALL_MAX_HOPS,
    };
    this.sendToCall(call, env);
    loggerLog(`[Call] Rejected call ${callId.slice(0, 8)}…`);
  }

  hangUp(callId: string, signature: string, publicKey: string, timestamp: number): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    call.state = 'ended';
    this.sdpSession.disposeCall(callId);
    this.sdpSession.unregisterCallRemoteAddress(callId);
    this.iceBuckets.delete(callId);
    this.activeCalls.delete(callId);
    activeAudioRelayStreams.delete(callId);

    const env: CallHangupEnvelope = {
      type: 'CALL_HANGUP',
      callId,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: CALL_MAX_HOPS,
    };
    this.sendToCall(call, env);
    loggerLog(`[Call] Hung up call ${callId.slice(0, 8)}…`);
  }

  /**
   * Forward a WebRTC signal (offer, answer, ice) to the remote peer.
   * `type` must be 'offer', 'answer', or 'ice'.
   * For 'offer' and 'answer', signature/publicKey/timestamp and sdpHash are required and
   * verified by the receiver.  ICE candidates are not signed (Tier C).
   */
  sendSignal(
    callId: string,
    type: 'offer' | 'answer' | 'ice',
    data: unknown,
    signature?: string,
    publicKey?: string,
    timestamp?: number,
    sdpHash?: string
  ): void {
    const call = this.activeCalls.get(callId);
    if (!call || call.state === 'ended') return;

    if (type === 'ice') {
      if (
        call.remoteTransport === 'reticulum' &&
        !allowIceReticulum(this.iceBuckets, callId, RT_ICE_MAX_PER_SEC)
      ) {
        return;
      }
      const env: CallIceEnvelope = {
        type: 'CALL_ICE',
        callId,
        candidate: data as Record<string, unknown> | null,
        hopsRemaining: CALL_MAX_HOPS,
      };
      this.sendToCall(call, env);
      return;
    }

    const sdp = data as string;
    const h = sdpHash?.toLowerCase() ?? '';
    if (
      !signature ||
      !publicKey ||
      typeof timestamp !== 'number' ||
      !/^[0-9a-f]{64}$/i.test(h)
    ) {
      loggerLog(`[Call] Dropped ${type}: missing sdpHash or auth fields`);
      return;
    }
    if (sha256HexUtf8(sdp).toLowerCase() !== h) {
      loggerLog(`[Call] Dropped ${type}: sdpHash mismatch`);
      return;
    }

    if (
      call.remoteTransport === 'reticulum' &&
      call.reticulumPeerPresenceHash &&
      this.reticulumBridge?.getState() === 'ready'
    ) {
      const dir = type === 'offer' ? 'o' : 'a';
      const built = buildSdpWireFrames(
        callId,
        dir,
        sdp,
        h,
        publicKey,
        timestamp,
        signature
      );
      if (!built) {
        loggerLog(`[Call] Failed to build SDP wire frames for ${callId}`);
        return;
      }
      this.sdpSession.startOutbound({
        peerPresenceHash: call.reticulumPeerPresenceHash,
        callId,
        dir,
        z: h,
        cs0: built.cs0,
        cs1List: built.cs1List,
      });
      return;
    }

    let env: CallWireEnvelope;
    if (type === 'offer') {
      env = {
        type: 'CALL_OFFER',
        callId,
        sdp,
        sdpHash: h,
        fromPublicKey: publicKey,
        signature,
        timestamp,
        hopsRemaining: CALL_MAX_HOPS,
      };
    } else {
      env = {
        type: 'CALL_ANSWER',
        callId,
        sdp,
        sdpHash: h,
        fromPublicKey: publicKey,
        signature,
        timestamp,
        hopsRemaining: CALL_MAX_HOPS,
      };
    }
    this.sendToCall(call, env);
  }

  /** Send a Tier-3 audio chunk over the P2P relay. */
  sendAudioChunk(callId: string, seq: number, base64Data: string): void {
    const call = this.activeCalls.get(callId);
    if (!call || call.state === 'ended') return;

    const env: CallAudioEnvelope = {
      type: 'CALL_AUDIO',
      callId,
      seq,
      data: base64Data,
      hopsRemaining: CALL_MAX_HOPS,
    };
    this.sendToCall(call, env);
  }

  // ── P2P message handler ───────────────────────────────────────────────────

  private onP2PMessage = ({
    from,
    data,
  }: {
    from: string;
    via?: string;
    to?: string;
    data: unknown;
  }): void => {
    if (!data || typeof data !== 'object') return;
    const type = (data as Record<string, unknown>).type;
    if (typeof type !== 'string' || !CALL_MESSAGE_TYPES.has(type)) return;
    this.handleIncoming(from, data as CallWireEnvelope);
  };

  private handleIncoming(fromNodeId: string, envelope: CallWireEnvelope): void {
    switch (envelope.type) {
      case 'CALL_REQUEST':
        this.handleRequest(fromNodeId, envelope);
        break;
      case 'CALL_ACCEPT':
        this.handleAccept(envelope);
        break;
      case 'CALL_REJECT':
        this.handleReject(envelope);
        break;
      case 'CALL_OFFER':
      case 'CALL_ANSWER':
      case 'CALL_ICE':
        this.handleSignal(envelope);
        break;
      case 'CALL_HANGUP':
        this.handleHangup(envelope);
        break;
      case 'CALL_AUDIO':
        this.handleAudio(envelope);
        break;
    }
  }

  // ── Incoming message handlers ─────────────────────────────────────────────

  private handleRequest(fromNodeId: string, env: CallRequestEnvelope): void {
    if (this.localAddresses.size === 0) return;

    if (
      typeof env.callId !== 'string' ||
      typeof env.fromAddress !== 'string' ||
      typeof env.fromPublicKey !== 'string' ||
      typeof env.chatId !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number'
    ) {
      loggerLog('[Call] Dropped CALL_REQUEST: missing fields');
      return;
    }

    const skew = Date.now() - env.timestamp;
    if (skew > 30_000 || skew < -10_000) {
      loggerLog('[Call] Dropped CALL_REQUEST: stale timestamp');
      return;
    }

    let derivedAddr: string;
    try {
      derivedAddr = deriveAddressFromPublicKey(env.fromPublicKey);
    } catch {
      loggerLog('[Call] Dropped CALL_REQUEST: invalid publicKey');
      return;
    }
    if (derivedAddr !== env.fromAddress) {
      loggerLog('[Call] Dropped CALL_REQUEST: address mismatch');
      return;
    }

    void this.verifyPool
      .verify({
        kind: 'call_request',
        fields: {
          type: env.type,
          callId: env.callId,
          chatId: env.chatId,
          fromAddress: env.fromAddress,
          fromPublicKey: env.fromPublicKey,
          timestamp: env.timestamp,
        },
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
      })
      .then((ok) => {
        if (!ok) {
          loggerLog('[Call] Dropped CALL_REQUEST: invalid signature');
          return;
        }
        try {
          this.applyVerifiedIncomingRequest(env, {
            transport: 'mesh',
            fromNodeId,
          });
        } catch (err) {
          loggerError('[Call] Error applying CALL_REQUEST:', err);
        }
      });
  }

  /**
   * Addresses that should see an incoming ring for this request (everyone in the
   * signed chatId except the caller). Relay nodes are not in this set, so they
   * forward gossip without surfacing UI.
   */
  private callRequestRecipientAddresses(
    chatId: string,
    fromAddress: string
  ): Set<string> | null {
    if (chatId.startsWith('direct:')) {
      const parts = chatId.slice('direct:'.length).split(':').filter(Boolean);
      if (parts.length !== 2) return null;
      const a = new Set(parts);
      if (!a.has(fromAddress)) return null;
      a.delete(fromAddress);
      return a.size === 1 ? a : null;
    }
    if (chatId.startsWith('support:')) {
      if (chatId === 'support:queue') return null;
      const parts = chatId.slice('support:'.length).split(':').filter(Boolean);
      if (parts.length < 2) return null;
      const recipients = new Set(parts);
      recipients.delete(fromAddress);
      return recipients.size > 0 ? recipients : null;
    }
    return null;
  }

  /** Local wallet address that is the intended callee, if any. */
  private localCallRecipientAddress(env: CallRequestEnvelope): string | null {
    const recipients = this.callRequestRecipientAddresses(
      env.chatId,
      env.fromAddress
    );
    if (!recipients) return null;
    for (const addr of this.localAddresses) {
      if (recipients.has(addr)) return addr;
    }
    return null;
  }

  private applyVerifiedIncomingRequest(
    env: CallRequestEnvelope,
    ctx:
      | { transport: 'mesh'; fromNodeId: string }
      | { transport: 'reticulum'; senderCallHash: string }
  ): void {
    if (this.activeCalls.has(env.callId)) return;

    const localRecipient = this.localCallRecipientAddress(env);

    if (localRecipient) {
      const presenceRoute = this.presence.getRouteForAddress(env.fromAddress);
      const retHash =
        presenceRoute?.kind === 'reticulum' ? presenceRoute.destinationHash : null;

      const record: CallRecord = {
        callId: env.callId,
        localAddress: localRecipient,
        remoteAddress: env.fromAddress,
        remoteNodeId:
          ctx.transport === 'mesh'
            ? ctx.fromNodeId
            : this.presence.getNodeIdForAddress(env.fromAddress),
        remoteTransport: ctx.transport === 'reticulum' ? 'reticulum' : 'mesh',
        reticulumPeerPresenceHash: retHash,
        chatId: env.chatId,
        direction: 'inbound',
        state: 'pending',
        startedAt: Date.now(),
      };

      record.cleanupTimer = setTimeout(() => {
        if (this.activeCalls.get(env.callId)?.state === 'pending') {
          loggerLog(`[Call] Incoming call ${env.callId.slice(0, 8)}… timed out.`);
          this.sdpSession.disposeCall(env.callId);
          this.sdpSession.unregisterCallRemoteAddress(env.callId);
          this.iceBuckets.delete(env.callId);
          this.activeCalls.delete(env.callId);
        }
      }, CALL_REQUEST_TTL_MS);

      this.activeCalls.set(env.callId, record);
      this.sdpSession.registerCallRemoteAddress(env.callId, env.fromAddress);

      this.emit('call:incoming', {
        callId: env.callId,
        fromAddress: env.fromAddress,
        chatId: env.chatId,
      });

      loggerLog(
        `[Call] Incoming call ${env.callId.slice(0, 8)}… from ${env.fromAddress} (${ctx.transport})`
      );
    }

    if (ctx.transport === 'mesh' && (env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, {
        ...env,
        hopsRemaining: (env.hopsRemaining ?? 1) - 1,
      });
    }
  }

  private handleAccept(env: CallAcceptEnvelope): void {
    const call = this.activeCalls.get(env.callId);
    if (!call || call.direction !== 'outbound') return;

    if (
      typeof env.fromPublicKey !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number'
    ) {
      loggerLog('[Call] Dropped CALL_ACCEPT: missing auth fields');
      return;
    }

    const expectedAddress = call.remoteAddress;
    void this.verifyPool
      .verify({
        kind: 'call_signed',
        wireType: env.type,
        callId: env.callId,
        timestamp: env.timestamp,
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
        expectedAddress,
      })
      .then((ok) => {
        if (!ok) {
          loggerLog('[Call] Dropped CALL_ACCEPT: invalid signature');
          return;
        }
        const c = this.activeCalls.get(env.callId);
        if (!c || c.direction !== 'outbound') return;
        if (c.cleanupTimer) clearTimeout(c.cleanupTimer);
        c.state = 'active';
        this.emit('call:accepted', { callId: env.callId });
        loggerLog(`[Call] Call ${env.callId.slice(0, 8)}… accepted.`);
      });
  }

  private handleReject(env: CallRejectEnvelope): void {
    const call = this.activeCalls.get(env.callId);
    if (!call) return;

    if (
      typeof env.fromPublicKey !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number'
    ) {
      loggerLog('[Call] Dropped CALL_REJECT: missing auth fields');
      return;
    }

    const expectedAddress = call.remoteAddress;
    void this.verifyPool
      .verify({
        kind: 'call_signed',
        wireType: env.type,
        callId: env.callId,
        timestamp: env.timestamp,
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
        expectedAddress,
      })
      .then((ok) => {
        if (!ok) {
          loggerLog('[Call] Dropped CALL_REJECT: invalid signature');
          return;
        }
        const c = this.activeCalls.get(env.callId);
        if (!c) return;
        if (c.cleanupTimer) clearTimeout(c.cleanupTimer);
        c.state = 'ended';
        this.sdpSession.disposeCall(env.callId);
        this.sdpSession.unregisterCallRemoteAddress(env.callId);
        this.iceBuckets.delete(env.callId);
        this.activeCalls.delete(env.callId);
        this.emit('call:rejected', { callId: env.callId, reason: env.reason });
        loggerLog(`[Call] Call ${env.callId.slice(0, 8)}… rejected.`);
      });
  }

  private handleSignal(
    env: CallOfferEnvelope | CallAnswerEnvelope | CallIceEnvelope
  ): void {
    const call = this.activeCalls.get(env.callId);
    if (!call || call.state === 'ended') return;

    if (env.type === 'CALL_ICE') {
      if (!allowIceReticulum(this.iceBuckets, env.callId, RT_ICE_MAX_PER_SEC)) {
        return;
      }
      this.emit('call:signal', {
        callId: env.callId,
        type: 'ice',
        data: env.candidate,
      });
      return;
    }

    this.deliverIncomingOfferAnswer(env);
  }

  /** Verify and emit offer/answer from mesh or reassembled Reticulum SDP. */
  private deliverIncomingOfferAnswer(
    env: CallOfferEnvelope | CallAnswerEnvelope
  ): void {
    const call = this.activeCalls.get(env.callId);
    if (!call || call.state === 'ended') return;

    if (
      typeof env.fromPublicKey !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number' ||
      typeof env.sdpHash !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(env.sdpHash)
    ) {
      loggerLog(`[Call] Dropped ${env.type}: missing auth or sdpHash`);
      return;
    }
    const h = env.sdpHash.toLowerCase();
    if (sha256HexUtf8(env.sdp).toLowerCase() !== h) {
      loggerLog(`[Call] Dropped ${env.type}: sdp does not match sdpHash`);
      return;
    }

    const expectedAddress = call.remoteAddress;
    void this.verifyPool
      .verify({
        kind: 'call_signed',
        wireType: env.type,
        callId: env.callId,
        timestamp: env.timestamp,
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
        expectedAddress,
        sdpHash: h,
      })
      .then((ok) => {
        if (!ok) {
          loggerLog(`[Call] Dropped ${env.type}: invalid signature`);
          return;
        }
        const c = this.activeCalls.get(env.callId);
        if (!c || c.state === 'ended') return;
        const type = env.type === 'CALL_OFFER' ? 'offer' : 'answer';
        this.emit('call:signal', { callId: env.callId, type, data: env.sdp });
      });
  }

  private deliverReticulumReassembledSdp(args: {
    callId: string;
    wireType: 'CALL_OFFER' | 'CALL_ANSWER';
    sdp: string;
    sdpHash: string;
    fromPublicKey: string;
    signature: string;
    timestamp: number;
  }): void {
    if (args.wireType === 'CALL_OFFER') {
      this.deliverIncomingOfferAnswer({
        type: 'CALL_OFFER',
        callId: args.callId,
        sdp: args.sdp,
        sdpHash: args.sdpHash,
        fromPublicKey: args.fromPublicKey,
        signature: args.signature,
        timestamp: args.timestamp,
      });
    } else {
      this.deliverIncomingOfferAnswer({
        type: 'CALL_ANSWER',
        callId: args.callId,
        sdp: args.sdp,
        sdpHash: args.sdpHash,
        fromPublicKey: args.fromPublicKey,
        signature: args.signature,
        timestamp: args.timestamp,
      });
    }
  }

  private onReticulumCallWire(
    wire: Record<string, unknown>,
    senderCallHash: string
  ): void {
    const decoded = decodeReticulumCallWire(wire);
    if (decoded.kind === 'invalid') return;

    if (decoded.kind === 'sdp_meta') {
      this.sdpSession.onCs0(decoded.meta, senderCallHash);
      return;
    }
    if (decoded.kind === 'sdp_part') {
      const { part } = decoded;
      this.sdpSession.onCs1(
        part.callId,
        part.dir,
        part.z,
        part.x,
        part.n,
        part.p,
        senderCallHash
      );
      return;
    }
    if (decoded.kind === 'ck') {
      this.sdpSession.onCkFromPeer(decoded.ck, senderCallHash);
      return;
    }

    const env = decoded.envelope;
    if (env.type === 'CALL_REQUEST') {
      this.handleRequestReticulum(senderCallHash, env);
      return;
    }

    switch (env.type) {
      case 'CALL_ACCEPT':
        this.handleAccept(env);
        break;
      case 'CALL_REJECT':
        this.handleReject(env);
        break;
      case 'CALL_OFFER':
      case 'CALL_ANSWER':
      case 'CALL_ICE':
        this.handleSignal(env);
        break;
      case 'CALL_HANGUP':
        this.handleHangup(env);
        break;
      default:
        break;
    }
  }

  private handleRequestReticulum(
    senderCallHash: string,
    env: CallRequestEnvelope
  ): void {
    if (this.localAddresses.size === 0) return;

    if (
      typeof env.callId !== 'string' ||
      typeof env.fromAddress !== 'string' ||
      typeof env.fromPublicKey !== 'string' ||
      typeof env.chatId !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number'
    ) {
      loggerLog('[Call] Dropped CALL_REQUEST (RT): missing fields');
      return;
    }

    const skew = Date.now() - env.timestamp;
    if (skew > 30_000 || skew < -10_000) {
      loggerLog('[Call] Dropped CALL_REQUEST (RT): stale timestamp');
      return;
    }

    let derivedAddr: string;
    try {
      derivedAddr = deriveAddressFromPublicKey(env.fromPublicKey);
    } catch {
      loggerLog('[Call] Dropped CALL_REQUEST (RT): invalid publicKey');
      return;
    }
    if (derivedAddr !== env.fromAddress) {
      loggerLog('[Call] Dropped CALL_REQUEST (RT): address mismatch');
      return;
    }

    void this.verifyPool
      .verify({
        kind: 'call_request',
        fields: {
          type: env.type,
          callId: env.callId,
          chatId: env.chatId,
          fromAddress: env.fromAddress,
          fromPublicKey: env.fromPublicKey,
          timestamp: env.timestamp,
        },
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
      })
      .then((ok) => {
        if (!ok) {
          loggerLog('[Call] Dropped CALL_REQUEST (RT): invalid signature');
          return;
        }
        try {
          this.applyVerifiedIncomingRequest(env, {
            transport: 'reticulum',
            senderCallHash,
          });
        } catch (err) {
          loggerError('[Call] Error applying CALL_REQUEST (RT):', err);
        }
      });
  }

  private handleHangup(env: CallHangupEnvelope): void {
    const call = this.activeCalls.get(env.callId);
    if (!call) return;

    if (
      typeof env.fromPublicKey !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number'
    ) {
      loggerLog('[Call] Dropped CALL_HANGUP: missing auth fields');
      return;
    }

    const expectedAddress = call.remoteAddress;
    void this.verifyPool
      .verify({
        kind: 'call_signed',
        wireType: env.type,
        callId: env.callId,
        timestamp: env.timestamp,
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
        expectedAddress,
      })
      .then((ok) => {
        if (!ok) {
          loggerLog('[Call] Dropped CALL_HANGUP: invalid signature');
          return;
        }
        const c = this.activeCalls.get(env.callId);
        if (!c) return;
        if (c.cleanupTimer) clearTimeout(c.cleanupTimer);
        c.state = 'ended';
        this.sdpSession.disposeCall(env.callId);
        this.sdpSession.unregisterCallRemoteAddress(env.callId);
        this.iceBuckets.delete(env.callId);
        this.activeCalls.delete(env.callId);
        activeAudioRelayStreams.delete(env.callId);
        this.emit('call:hangup', { callId: env.callId });
        loggerLog(`[Call] Remote hung up call ${env.callId.slice(0, 8)}…`);
      });
  }

  private handleAudio(env: CallAudioEnvelope): void {
    // Basic size guard
    if (
      typeof env.data !== 'string' ||
      env.data.length > CALL_AUDIO_MAX_BYTES
    ) {
      return;
    }

    const call = this.activeCalls.get(env.callId);
    if (call && call.state === 'active') {
      // This call is local — deliver to renderer
      this.emit('call:audio', {
        callId: env.callId,
        seq: env.seq,
        data: env.data,
      });
      return;
    }

    // Not a local call — relay if within hop budget and relay capacity allows
    if ((env.hopsRemaining ?? 0) <= 0) return;

    if (!activeAudioRelayStreams.has(env.callId)) {
      if (activeAudioRelayStreams.size >= CALL_AUDIO_MAX_RELAY_STREAMS) {
        // At capacity — drop this stream silently
        return;
      }
      activeAudioRelayStreams.add(env.callId);
    }

    this.p2p.send(null, {
      ...env,
      hopsRemaining: (env.hopsRemaining ?? 1) - 1,
    });
  }

  // ── Delivery helper ───────────────────────────────────────────────────────

  /**
   * Send a call envelope to the remote peer.  Tries targeted delivery via
   * the stored nodeId first, falls back to gossip if unknown.
   */
  private sendToCall(call: CallRecord, env: CallWireEnvelope): void {
    if (
      call.remoteTransport === 'reticulum' &&
      call.reticulumPeerPresenceHash &&
      this.reticulumBridge?.getState() === 'ready'
    ) {
      const wire = encodeReticulumCallWire(env);
      if (wire) {
        if (!wireFitsReticulum(wire)) {
          loggerWarn('[Call] Skipping Reticulum sendToCall: wire exceeds limit');
          return;
        }
        void this.reticulumBridge.sendCall(call.reticulumPeerPresenceHash, wire);
      }
      return;
    }

    const nodeId =
      call.remoteNodeId ?? this.presence.getNodeIdForAddress(call.remoteAddress);
    if (nodeId) {
      this.p2p.send(nodeId, env);
    } else {
      this.p2p.send(null, env);
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let callManager: CallManager | null = null;

export function getCallManager(): CallManager | null {
  return callManager;
}

export function startCallManager(
  p2p: P2PNetwork,
  presence: PresenceManager,
  reticulumBridge?: ReticulumBridge | null
): CallManager {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
  callManager = new CallManager(p2p, presence, reticulumBridge ?? null);
  callManager.start();
  return callManager;
}

export function stopCallManager(): void {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
}
