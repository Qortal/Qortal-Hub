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

import * as nodeCrypto from 'crypto';
import { EventEmitter } from 'events';
import { log as loggerLog, error as loggerError } from './logger';
import { deriveAddressFromPublicKey } from './presence';
import { VerifyWorkerPool } from './verify-worker-pool';
import type { P2PNetwork } from './p2p-network';
import type { PresenceManager } from './presence';

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
  /** Base58-encoded Ed25519 public key of the offering peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type }. */
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallAnswerEnvelope {
  type: 'CALL_ANSWER';
  callId: string;
  sdp: string;
  /** Base58-encoded Ed25519 public key of the answering peer. */
  fromPublicKey: string;
  /** Ed25519 signature over canonicalized { callId, timestamp, type }. */
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
  private activeCalls = new Map<string, CallRecord>();
  private localAddresses = new Set<string>();
  private verifyPool = new VerifyWorkerPool(
    'call',
    CALL_VERIFY_WORKER_COUNT,
    CALL_MAX_PENDING_VERIFY
  );

  constructor(p2p: P2PNetwork, presence: PresenceManager) {
    super();
    this.p2p = p2p;
    this.presence = presence;
  }

  start(): void {
    this.verifyPool.start();
    this.p2p.on('message', this.onP2PMessage);
    loggerLog('[Call] Manager started.');
  }

  stop(): void {
    this.verifyPool.stop();
    this.p2p.off('message', this.onP2PMessage);
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
   * Returns the new callId, or null if the target appears offline.
   */
  initiateCall(
    targetAddress: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    callId: string,
    timestamp: number
  ): string | null {
    const remoteNodeId = this.presence.getNodeIdForAddress(targetAddress);

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

    const record: CallRecord = {
      callId,
      localAddress,
      remoteAddress: targetAddress,
      remoteNodeId,
      chatId,
      direction: 'outbound',
      state: 'pending',
      startedAt: timestamp,
    };

    record.cleanupTimer = setTimeout(() => {
      if (this.activeCalls.get(callId)?.state === 'pending') {
        loggerLog(`[Call] Request ${callId.slice(0, 8)}… timed out.`);
        this.activeCalls.delete(callId);
      }
    }, CALL_REQUEST_TTL_MS);

    this.activeCalls.set(callId, record);

    if (remoteNodeId) {
      this.p2p.send(remoteNodeId, env);
    } else {
      // Target's nodeId unknown — broadcast via gossip
      this.p2p.send(null, env);
    }

    loggerLog(
      `[Call] Initiated call ${callId.slice(0, 8)}… to ${targetAddress}`
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
   * For 'offer' and 'answer', signature/publicKey/timestamp are required and
   * verified by the receiver.  ICE candidates are not signed (Tier C).
   */
  sendSignal(
    callId: string,
    type: 'offer' | 'answer' | 'ice',
    data: unknown,
    signature?: string,
    publicKey?: string,
    timestamp?: number
  ): void {
    const call = this.activeCalls.get(callId);
    if (!call || call.state === 'ended') return;

    let env: CallWireEnvelope;
    if (type === 'offer') {
      env = {
        type: 'CALL_OFFER',
        callId,
        sdp: data as string,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
        hopsRemaining: CALL_MAX_HOPS,
      };
    } else if (type === 'answer') {
      env = {
        type: 'CALL_ANSWER',
        callId,
        sdp: data as string,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
        hopsRemaining: CALL_MAX_HOPS,
      };
    } else {
      env = {
        type: 'CALL_ICE',
        callId,
        candidate: data as Record<string, unknown> | null,
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
          this.applyVerifiedIncomingRequest(fromNodeId, env);
        } catch (err) {
          loggerError('[Call] Error applying CALL_REQUEST:', err);
        }
      });
  }

  private applyVerifiedIncomingRequest(
    fromNodeId: string,
    env: CallRequestEnvelope
  ): void {
    if (this.activeCalls.has(env.callId)) return;

    const record: CallRecord = {
      callId: env.callId,
      localAddress: '',
      remoteAddress: env.fromAddress,
      remoteNodeId: fromNodeId,
      chatId: env.chatId,
      direction: 'inbound',
      state: 'pending',
      startedAt: Date.now(),
    };

    record.cleanupTimer = setTimeout(() => {
      if (this.activeCalls.get(env.callId)?.state === 'pending') {
        loggerLog(`[Call] Incoming call ${env.callId.slice(0, 8)}… timed out.`);
        this.activeCalls.delete(env.callId);
      }
    }, CALL_REQUEST_TTL_MS);

    this.activeCalls.set(env.callId, record);

    this.emit('call:incoming', {
      callId: env.callId,
      fromAddress: env.fromAddress,
      chatId: env.chatId,
    });

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, {
        ...env,
        hopsRemaining: (env.hopsRemaining ?? 1) - 1,
      });
    }

    loggerLog(
      `[Call] Incoming call ${env.callId.slice(0, 8)}… from ${env.fromAddress}`
    );
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
      this.emit('call:signal', {
        callId: env.callId,
        type: 'ice',
        data: env.candidate,
      });
      return;
    }

    if (
      typeof env.fromPublicKey !== 'string' ||
      typeof env.signature !== 'string' ||
      typeof env.timestamp !== 'number'
    ) {
      loggerLog(`[Call] Dropped ${env.type}: missing auth fields`);
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
          loggerLog(`[Call] Dropped ${env.type}: invalid signature`);
          return;
        }
        const c = this.activeCalls.get(env.callId);
        if (!c || c.state === 'ended') return;
        const type = env.type === 'CALL_OFFER' ? 'offer' : 'answer';
        const data = env.sdp;
        this.emit('call:signal', { callId: env.callId, type, data });
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
    const nodeId = call.remoteNodeId
      ?? this.presence.getNodeIdForAddress(call.remoteAddress);
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
  presence: PresenceManager
): CallManager {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
  callManager = new CallManager(p2p, presence);
  callManager.start();
  return callManager;
}

export function stopCallManager(): void {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
}
