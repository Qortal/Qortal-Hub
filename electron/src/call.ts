/**
 * Direct 1:1 call control and authenticated WebRTC negotiation over Reticulum.
 *
 * This module handles only setup / teardown signaling:
 *   - CALL_REQUEST / CALL_ACCEPT / CALL_REJECT
 *   - CALL_HANGUP
 *
 * WebRTC negotiation is fragmented over the selected authenticated direct
 * Reticulum link. Audio itself is owned by the audio surface and can use a
 * a native WebRTC audio track while the Reticulum media fallback stays
 * available.
 */

import { EventEmitter } from 'events';
import { createHash, randomBytes } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';
import {
  log as loggerLog,
  error as loggerError,
  warn as loggerWarn,
} from './logger';
import {
  byteLengthUtf8JsonWithBridgeSenderOnly,
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  wireFitsReticulum,
} from './reticulum-wire-size';
import { deriveAddressFromPublicKey } from './presence';
import { VerifyWorkerPool } from './verify-worker-pool';
import type { PresenceManager, PresenceRoute } from './presence';
import type { ReticulumBridge } from './reticulum-bridge';
import { getRouteBoundDestinationHash } from './reticulum-route-bound-id';

const CALL_MAX_HOPS = 4;
const CALL_REQUEST_TTL_MS = 60_000;
const RETICULUM_OVERLAY_SEEN_TTL_MS = 60_000;
const CALL_VERIFY_WORKER_COUNT = 2;
const CALL_MAX_PENDING_VERIFY = 512;
const CALL_WIRE_REQUEST = 'CR';
const CALL_WIRE_ACCEPT = 'CA';
const CALL_WIRE_REJECT = 'CX';
const CALL_WIRE_HANGUP = 'CH';
const CALL_WIRE_RTC_START = 'RS';
const CALL_WIRE_RTC_AUTH = 'RH';
const CALL_WIRE_RTC_PART = 'RP';
const CALL_WIRE_RTC_ACK = 'RA';
const CALL_WIRE_RTC_RESEND = 'RR';

const CALL_RTC_SIGNAL_TTL_MS = 15_000;
const CALL_RTC_FRAGMENT_CHARS = 144;
const CALL_RTC_MAX_FRAGMENTS = 192;
// ICE gathering can legitimately produce dozens of independently signed
// candidates in one burst. Memory is bounded separately by buffered bytes.
const CALL_RTC_MAX_INBOUND_SIGNALS = 128;
const CALL_RTC_MAX_BUFFERED_BYTES = 256 * 1024;
const CALL_RTC_MAX_RECOVERY_ROUNDS = 4;
const CALL_RTC_RECOVERY_WAIT_MS = 350;
const CALL_RTC_START_REPEAT_MS = 175;
const CALL_RTC_MAX_CANDIDATES_PER_GENERATION = 96;

/** If the bridge is briefly not `ready`, retry before dropping (bursty GC / transport flaps). */
const CALL_SEND_MAX_ATTEMPTS = 40;
const CALL_SEND_RETRY_MS = 50;
// A call request can reach a recipient through an existing overlay neighbour
// before the recipient has a pinned Link back to the exact calling device.
// Opening that Link commonly takes several seconds. Keep pinned delivery alive
// long enough for it to establish, while retaining a hard time/attempt bound
// so a dead route cannot retry forever. Retries are additionally guarded by
// shouldSendPinnedCallWire(), so acceptance and negotiation data cannot
// outlive their call.
const CALL_PINNED_SEND_MAX_ATTEMPTS = 120;
const CALL_PINNED_SEND_RETRY_MS = 250;
const CALL_PINNED_SEND_TIMEOUT_MS = 30_000;
const CALL_ACCEPT_REPEAT_ATTEMPTS = 5;
const CALL_ACCEPT_REPEAT_MS = 350;
const DM_HANGUP_ACK_WAIT_MS = 900;
const DM_HANGUP_ACK_QUEUE_WAIT_MS = 500;
let retainedCallLocalAddresses: string[] = [];

export type CallNetworkType =
  | 'CALL_REQUEST'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_HANGUP';

export type DirectCallRtcSignalType =
  | 'capability'
  | 'offer'
  | 'answer'
  | 'candidate';

const CALL_RTC_SIGNAL_CODE: Record<DirectCallRtcSignalType, string> = {
  capability: 'c',
  offer: 'o',
  answer: 'a',
  candidate: 'i',
};

const CALL_RTC_SIGNAL_FROM_CODE: Record<string, DirectCallRtcSignalType> = {
  c: 'capability',
  o: 'offer',
  a: 'answer',
  i: 'candidate',
};

export function buildDirectCallRtcSignedFields(input: {
  callId: string;
  generation: string;
  signalId: string;
  signalType: DirectCallRtcSignalType;
  payloadHash: string;
  timestamp: number;
}): Record<string, unknown> {
  return {
    type: 'CALL_RTC_SIGNAL',
    callId: input.callId,
    generation: input.generation,
    signalId: input.signalId,
    signalType: input.signalType,
    payloadHash: input.payloadHash,
    timestamp: input.timestamp,
  };
}

export const CALL_MESSAGE_TYPES = new Set<string>([
  'CALL_REQUEST',
  'CALL_ACCEPT',
  'CALL_REJECT',
  'CALL_HANGUP',
]);

export function resolveDirectCallSourceEndpoint(
  verifiedRouteHashes: readonly string[],
  stampedSourceHash: string,
  transportPeerHash: string
): string | null {
  const routes = [
    ...new Set(
      verifiedRouteHashes
        .map((hash) => hash.trim().toLowerCase())
        .filter((hash) => /^[0-9a-f]{32}$/.test(hash))
    ),
  ];
  const stamped = stampedSourceHash.trim().toLowerCase();
  if (routes.includes(stamped)) return stamped;
  const transport = transportPeerHash.trim().toLowerCase();
  if (routes.includes(transport)) return transport;
  // An older relay may have replaced the source hint. A single verified
  // account route is unambiguous and is safer than selecting the relay.
  if (routes.length === 1) return routes[0]!;
  // With several account devices, wait for a copy carrying one of their
  // verified routes rather than guessing which device owns this call.
  if (routes.length > 1) return null;
  // A genuinely unstamped legacy frame can only identify the authenticated
  // immediate link peer. Once `r` exists, however, accepting an unverified
  // transport fallback would let a relay become the media destination.
  if (!stamped && transport) return transport;
  // Compatibility for old direct callers. Current relays preserve `r`, so a
  // relayed frame normally has different origin/transport values. Route-bound
  // calls below do not rely on this legacy-only heuristic.
  if (stamped && stamped === transport) return stamped;
  return null;
}

function buildDirectCallChatId(addressA: string, addressB: string): string {
  return `direct:${[addressA, addressB].sort().join(':')}`;
}

function encodeCallWire(env: CallWireEnvelope): Record<string, unknown> {
  switch (env.type) {
    case 'CALL_REQUEST': {
      const wire: Record<string, unknown> = {
        t: CALL_WIRE_REQUEST,
        c: env.callId,
        a: env.fromAddress,
        k: env.fromPublicKey,
        g: env.signature,
        m: env.timestamp,
        ...(env.reticulumDestinationHash
          ? { r: env.reticulumDestinationHash }
          : {}),
      };
      // For direct calls the chatId is derivable from sender + overlay target address,
      // so omit it to stay under Reticulum's encrypted MDU.
      if (!env.chatId.startsWith('direct:')) {
        wire.H = env.chatId;
      }
      return wire;
    }
    case 'CALL_ACCEPT':
      return {
        t: CALL_WIRE_ACCEPT,
        c: env.callId,
        k: env.fromPublicKey,
        g: env.signature,
        m: env.timestamp,
        ...(env.reticulumDestinationHash
          ? { r: env.reticulumDestinationHash }
          : {}),
      };
    case 'CALL_REJECT':
      return {
        t: CALL_WIRE_REJECT,
        c: env.callId,
        ...(typeof env.reason === 'string' && env.reason.length > 0
          ? { e: env.reason }
          : {}),
        k: env.fromPublicKey,
        g: env.signature,
        m: env.timestamp,
        ...(env.reticulumDestinationHash
          ? { r: env.reticulumDestinationHash }
          : {}),
      };
    case 'CALL_HANGUP':
      return {
        t: CALL_WIRE_HANGUP,
        c: env.callId,
        k: env.fromPublicKey,
        g: env.signature,
        m: env.timestamp,
        ...(env.reticulumDestinationHash
          ? { r: env.reticulumDestinationHash }
          : {}),
      };
    default:
      return {};
  }
}

function decodeCompactCallWire(
  wire: Record<string, unknown>
): CallWireEnvelope | null {
  const t = wire.t;
  switch (t) {
    case CALL_WIRE_REQUEST: {
      if (
        typeof wire.c !== 'string' ||
        typeof wire.a !== 'string' ||
        typeof wire.k !== 'string' ||
        typeof wire.g !== 'string' ||
        typeof wire.m !== 'number'
      ) {
        return null;
      }
      const chatId =
        typeof wire.H === 'string'
          ? wire.H
          : typeof wire.U === 'string' && wire.U.length > 0
            ? buildDirectCallChatId(wire.a, wire.U)
            : null;
      if (!chatId) return null;
      const reticulumDestinationHash = getRouteBoundDestinationHash(
        'call',
        wire.c
      );
      return {
        type: 'CALL_REQUEST',
        callId: wire.c,
        fromAddress: wire.a,
        fromPublicKey: wire.k,
        chatId,
        signature: wire.g,
        timestamp: wire.m,
        ...(reticulumDestinationHash ? { reticulumDestinationHash } : {}),
      };
    }
    case CALL_WIRE_ACCEPT:
      if (
        typeof wire.c !== 'string' ||
        typeof wire.k !== 'string' ||
        typeof wire.g !== 'string' ||
        typeof wire.m !== 'number'
      ) {
        return null;
      }
      return {
        type: 'CALL_ACCEPT',
        callId: wire.c,
        fromPublicKey: wire.k,
        signature: wire.g,
        timestamp: wire.m,
      };
    case CALL_WIRE_REJECT:
      if (
        typeof wire.c !== 'string' ||
        typeof wire.k !== 'string' ||
        typeof wire.g !== 'string' ||
        typeof wire.m !== 'number'
      ) {
        return null;
      }
      return {
        type: 'CALL_REJECT',
        callId: wire.c,
        ...(typeof wire.e === 'string' ? { reason: wire.e } : {}),
        fromPublicKey: wire.k,
        signature: wire.g,
        timestamp: wire.m,
      };
    case CALL_WIRE_HANGUP:
      if (
        typeof wire.c !== 'string' ||
        typeof wire.k !== 'string' ||
        typeof wire.g !== 'string' ||
        typeof wire.m !== 'number'
      ) {
        return null;
      }
      return {
        type: 'CALL_HANGUP',
        callId: wire.c,
        fromPublicKey: wire.k,
        signature: wire.g,
        timestamp: wire.m,
      };
    default:
      return null;
  }
}

export interface CallRequestEnvelope {
  type: 'CALL_REQUEST';
  callId: string;
  fromAddress: string;
  fromPublicKey: string;
  chatId: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash?: string;
  hopsRemaining?: number;
}

export interface CallAcceptEnvelope {
  type: 'CALL_ACCEPT';
  callId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash?: string;
  hopsRemaining?: number;
}

export interface CallRejectEnvelope {
  type: 'CALL_REJECT';
  callId: string;
  reason?: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash?: string;
  hopsRemaining?: number;
}

export interface CallHangupEnvelope {
  type: 'CALL_HANGUP';
  callId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash?: string;
  hopsRemaining?: number;
}

export type CallWireEnvelope =
  | CallRequestEnvelope
  | CallAcceptEnvelope
  | CallRejectEnvelope
  | CallHangupEnvelope;

export type CallDirection = 'outbound' | 'inbound';
export type CallState = 'pending' | 'active' | 'ended';
export type DirectCallHistoryOutcome =
  | 'answered'
  | 'declined'
  | 'missed'
  | 'cancelled'
  | 'no_answer';

export type DirectCallHistoryUpdate = {
  callId: string;
  localAddress: string;
  remoteAddress: string;
  chatId: string;
  direction: CallDirection;
  outcome: DirectCallHistoryOutcome;
  startedAt: number;
  endedAt: number;
};

interface CallRecord {
  callId: string;
  localAddress: string;
  remoteAddress: string;
  reticulumPeerPresenceHash: string;
  invitedReticulumPeerHashes?: Set<string>;
  rejectedReticulumPeerHashes?: Set<string>;
  /** Authenticated rejection reason per invited endpoint; null is legacy/generic. */
  rejectionReasonsByReticulumPeerHash?: Map<string, string | null>;
  acceptedReticulumPeerHash?: string;
  cancellationSignature?: string;
  cancellationPublicKey?: string;
  cancellationTimestamp?: number;
  chatId: string;
  direction: CallDirection;
  state: CallState;
  startedAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  rejectionFinalizeTimer?: ReturnType<typeof setTimeout>;
  controlRepeatTimers?: Set<ReturnType<typeof setTimeout>>;
}

interface DirectCallRtcOutboundSignal {
  callId: string;
  peerDestinationHash: string;
  signalId: string;
  startWire: Record<string, unknown>;
  authWire: Record<string, unknown>;
  partWires: Record<string, unknown>[];
  createdAt: number;
  repeatTimer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface DirectCallRtcInboundSignal {
  callId: string;
  senderDestinationHash: string;
  signalId: string;
  signalType?: DirectCallRtcSignalType;
  generation?: string;
  partCount?: number;
  payloadHash?: string;
  timestamp?: number;
  fromPublicKey?: string;
  signature?: string;
  parts: Map<number, string>;
  bufferedBytes: number;
  recoveryRounds: number;
  createdAt: number;
  verificationStarted?: boolean;
  completed?: boolean;
  recoveryTimer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export type DmCallLinkControlPayload = {
  kind: 'hangup' | 'hangup-ack';
  callId: string;
  chatId: string;
  controlId: string;
  fromAddress: string;
  toAddress: string;
  timestamp: number;
  publicKey?: string;
  signature?: string;
  verifiedPeerDestinationHash: string;
};

type DmCallLinkControlSendInput = Omit<
  DmCallLinkControlPayload,
  'verifiedPeerDestinationHash'
>;

type DmCallLinkControlSender = (
  input: DmCallLinkControlSendInput
) => Promise<{ success: boolean; error?: string }>;

type PendingDmHangupAck = {
  callId: string;
  localAddress: string;
  remoteAddress: string;
  peerDestinationHash: string;
  resolve: (acknowledged: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Events emitted (forwarded to the renderer via IPC):
 *   'call:incoming'  { callId, fromAddress, chatId }
 *   'call:accepted'  { callId }
 *   'call:rejected'  { callId, reason? }
 *   'call:hangup'    { callId }
 *   'call:history'   DirectCallHistoryUpdate
 */
export class CallManager extends EventEmitter {
  private presence: PresenceManager;
  private reticulumBridge: ReticulumBridge | null;
  private started = false;
  private activeCalls = new Map<string, CallRecord>();
  private localAddresses = new Set<string>();
  /**
   * Verified CALL_REQUEST payloads received while `localAddresses` was still empty (renderer
   * has not yet invoked `call:setLocalAddresses`). Flushed when addresses are set.
   */
  private pendingVerifiedIncomingWhenNoLocal: Array<{
    env: CallRequestEnvelope;
    ctx: { senderDestinationHash: string };
    receivedAt: number;
  }> = [];
  private localAccountGeneration = 0;
  private acceptPendingIncomingWithoutLocal = true;
  private verifyPool = new VerifyWorkerPool(
    'call',
    CALL_VERIFY_WORKER_COUNT,
    CALL_MAX_PENDING_VERIFY
  );
  private onReticulumCallMessage:
    | ((
        wire: Record<string, unknown>,
        senderDestinationHash: string,
        peerPresenceHash: string
      ) => void)
    | null = null;
  private reticulumUnsub: (() => void) | null = null;
  private seenReticulumOverlayIds = new Map<string, number>();
  private rtcOutboundSignals = new Map<string, DirectCallRtcOutboundSignal>();
  private rtcInboundSignals = new Map<string, DirectCallRtcInboundSignal>();
  private rtcInboundBufferedBytes = 0;
  private rtcCandidateCounts = new Map<string, number>();
  private dmCallLinkControlSender: DmCallLinkControlSender | null = null;
  private pendingDmHangupAcks = new Map<string, PendingDmHangupAck>();

  constructor(
    presence: PresenceManager,
    reticulumBridge?: ReticulumBridge | null
  ) {
    super();
    this.presence = presence;
    this.reticulumBridge = reticulumBridge ?? null;
  }

  private emitDirectCallHistory(
    call: CallRecord,
    outcome: DirectCallHistoryOutcome,
    endedAt = Date.now()
  ): void {
    if (!call.chatId.startsWith('direct:')) return;
    this.emit('call:history', {
      callId: call.callId,
      localAddress: call.localAddress,
      remoteAddress: call.remoteAddress,
      chatId: call.chatId,
      direction: call.direction,
      outcome,
      startedAt: call.startedAt,
      endedAt,
    } satisfies DirectCallHistoryUpdate);
  }

  private attachReticulumBridge(): void {
    const bridge = this.reticulumBridge;
    if (!bridge || this.reticulumUnsub) return;
    if (!this.onReticulumCallMessage) {
      this.onReticulumCallMessage = (
        wire: Record<string, unknown>,
        senderDestinationHash: string,
        peerPresenceHash: string
      ): void => {
        try {
          this.onReticulumCallWire(
            wire,
            senderDestinationHash,
            peerPresenceHash
          );
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

  setDmCallLinkControlSender(
    sender: DmCallLinkControlSender | null
  ): void {
    this.dmCallLinkControlSender = sender;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.verifyPool.start();
    this.attachReticulumBridge();
    loggerLog('[Call] Manager started.');
  }

  stop(): void {
    this.started = false;
    this.verifyPool.stop();
    this.detachReticulumBridge();
    for (const call of this.activeCalls.values()) {
      if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
      if (call.rejectionFinalizeTimer) {
        clearTimeout(call.rejectionFinalizeTimer);
      }
      this.clearControlRepeatTimers(call);
    }
    this.activeCalls.clear();
    this.clearAllRtcSignals();
    this.seenReticulumOverlayIds.clear();
    this.pendingVerifiedIncomingWhenNoLocal = [];
    this.clearPendingDmHangupAcks();
    loggerLog('[Call] Manager stopped.');
  }

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
    if (this.localAddresses.size > 0) {
      this.acceptPendingIncomingWithoutLocal = true;
    }
    retainedCallLocalAddresses = [...this.localAddresses];
    this.flushPendingVerifiedIncomingRequests();
  }

  clearLocalAccountState(): void {
    this.localAccountGeneration += 1;
    this.acceptPendingIncomingWithoutLocal = false;
    this.localAddresses.clear();
    retainedCallLocalAddresses = [];
    this.pendingVerifiedIncomingWhenNoLocal = [];
    for (const call of this.activeCalls.values()) {
      if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
      if (call.rejectionFinalizeTimer) {
        clearTimeout(call.rejectionFinalizeTimer);
      }
      this.clearControlRepeatTimers(call);
    }
    this.activeCalls.clear();
    this.clearAllRtcSignals();
    this.clearPendingDmHangupAcks();
  }

  /**
   * Inbound calls still ringing — replay to the renderer when it sends `call:subscribe`
   * after missing the initial `call:incoming` broadcast.
   */
  getPendingInboundRingingPayloads(): Array<{
    callId: string;
    fromAddress: string;
    chatId: string;
  }> {
    const out: Array<{
      callId: string;
      fromAddress: string;
      chatId: string;
    }> = [];
    for (const c of this.activeCalls.values()) {
      if (c.direction === 'inbound' && c.state === 'pending') {
        out.push({
          callId: c.callId,
          fromAddress: c.remoteAddress,
          chatId: c.chatId,
        });
      }
    }
    return out;
  }

  /**
   * Outbound calls already accepted by main — replay to the renderer when it sends
   * `call:subscribe` after missing the original `call:accepted` broadcast.
   */
  getActiveOutboundAcceptedPayloads(): Array<{ callId: string }> {
    const out: Array<{ callId: string }> = [];
    for (const c of this.activeCalls.values()) {
      if (c.direction === 'outbound' && c.state === 'active') {
        out.push({ callId: c.callId });
      }
    }
    return out;
  }

  /**
   * Return the authenticated device selected for an active 1:1 call.
   * This is consumed by the main-process media join path so renderer state or
   * a later account-wide presence update cannot reroute media to another
   * computer logged into the same account.
   */
  getActiveMediaPeerDestinationHash(
    chatId: string,
    localAddress: string,
    callId?: string
  ): string | null {
    for (const call of this.activeCalls.values()) {
      if (
        call.state !== 'active' ||
        call.chatId !== chatId ||
        call.localAddress !== localAddress ||
        (callId && call.callId !== callId)
      ) {
        continue;
      }
      const endpoint =
        call.direction === 'outbound'
          ? call.acceptedReticulumPeerHash
          : call.reticulumPeerPresenceHash;
      const normalized = endpoint?.trim().toLowerCase() ?? '';
      if (normalized) return normalized;
    }
    return null;
  }

  /**
   * Sends one WebRTC negotiation payload to the already selected device for an
   * active DM call. The payload is compressed and fragmented only after its
   * wallet signature is verified. Every fragment uses `send_call`, which is a
   * pinned direct Reticulum-link send and never the account fanout path.
   */
  async sendRtcSignal(input: {
    callId: string;
    generation: string;
    signalId: string;
    signalType: DirectCallRtcSignalType;
    payload: string;
    payloadHash: string;
    timestamp: number;
    signature: string;
    publicKey: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!input || typeof input !== 'object') {
      return { success: false, error: 'invalid-rtc-signal' };
    }
    const call = this.activeCalls.get(input.callId);
    if (!call || call.state !== 'active') {
      return { success: false, error: 'call-not-active' };
    }
    const peerDestinationHash = this.getRtcPeerDestinationHash(call);
    if (!peerDestinationHash) {
      return { success: false, error: 'selected-peer-unavailable' };
    }
    if (!this.isValidRtcSignalInput(input)) {
      return { success: false, error: 'invalid-rtc-signal' };
    }
    const actualHash = createHash('sha256')
      .update(input.payload, 'utf8')
      .digest('hex');
    if (actualHash !== input.payloadHash.toLowerCase()) {
      return { success: false, error: 'rtc-signal-hash-mismatch' };
    }
    const signedFields = buildDirectCallRtcSignedFields({
      callId: input.callId,
      generation: input.generation,
      signalId: input.signalId,
      signalType: input.signalType,
      payloadHash: actualHash,
      timestamp: input.timestamp,
    });
    const verified = await this.verifyPool.verify({
      kind: 'gc',
      fields: signedFields,
      signature: input.signature,
      fromPublicKey: input.publicKey,
      fromAddress: call.localAddress,
    });
    if (!verified) {
      return { success: false, error: 'invalid-rtc-signal-signature' };
    }
    // Wallet verification is asynchronous. Do not emit sensitive negotiation
    // material if the call ended, the account changed, or a different remote
    // device became selected while verification was in flight.
    const currentCall = this.activeCalls.get(input.callId);
    if (
      currentCall !== call ||
      currentCall.state !== 'active' ||
      this.getRtcPeerDestinationHash(currentCall) !== peerDestinationHash
    ) {
      return { success: false, error: 'call-route-changed' };
    }

    const compressed = deflateRawSync(Buffer.from(input.payload, 'utf8'));
    const encoded = compressed.toString('base64');
    const parts: string[] = [];
    for (let i = 0; i < encoded.length; i += CALL_RTC_FRAGMENT_CHARS) {
      parts.push(encoded.slice(i, i + CALL_RTC_FRAGMENT_CHARS));
    }
    if (parts.length === 0) parts.push('');
    if (parts.length > CALL_RTC_MAX_FRAGMENTS) {
      return { success: false, error: 'rtc-signal-too-large' };
    }

    const startWire: Record<string, unknown> = {
      t: CALL_WIRE_RTC_START,
      c: input.callId,
      i: input.signalId,
      y: CALL_RTC_SIGNAL_CODE[input.signalType],
      v: input.generation,
      n: parts.length,
      z: actualHash,
      m: input.timestamp,
    };
    const authWire: Record<string, unknown> = {
      t: CALL_WIRE_RTC_AUTH,
      c: input.callId,
      i: input.signalId,
      k: input.publicKey,
      g: input.signature,
    };
    const partWires = parts.map((part, index) => ({
      t: CALL_WIRE_RTC_PART,
      c: input.callId,
      i: input.signalId,
      x: index,
      p: part,
    }));
    if (
      !this.rtcDirectWireFits(startWire) ||
      !this.rtcDirectWireFits(authWire) ||
      partWires.some((wire) => !this.rtcDirectWireFits(wire))
    ) {
      return { success: false, error: 'rtc-signal-wire-too-large' };
    }

    const key = this.rtcSignalKey(input.callId, input.signalId);
    this.clearRtcOutboundSignal(key);
    const outbound: DirectCallRtcOutboundSignal = {
      callId: input.callId,
      peerDestinationHash,
      signalId: input.signalId,
      startWire,
      authWire,
      partWires,
      createdAt: Date.now(),
    };
    this.rtcOutboundSignals.set(key, outbound);
    if (input.signalType !== 'candidate') {
      loggerLog('[Call][RTC] authenticated signal queued', {
        signalType: input.signalType,
        call: input.callId.slice(0, 8),
        peer: peerDestinationHash.slice(0, 8),
        fragments: parts.length,
      });
    }
    this.sendPinnedCallWireWhenReady(peerDestinationHash, startWire, 0);
    this.sendPinnedCallWireWhenReady(peerDestinationHash, authWire, 0);
    for (const partWire of partWires) {
      this.sendPinnedCallWireWhenReady(peerDestinationHash, partWire, 0);
    }
    outbound.repeatTimer = setTimeout(() => {
      const current = this.rtcOutboundSignals.get(key);
      if (!current) return;
      this.sendPinnedCallWireWhenReady(
        current.peerDestinationHash,
        current.startWire,
        0
      );
      this.sendPinnedCallWireWhenReady(
        current.peerDestinationHash,
        current.authWire,
        0
      );
    }, CALL_RTC_START_REPEAT_MS);
    outbound.repeatTimer.unref?.();
    outbound.cleanupTimer = setTimeout(
      () => this.clearRtcOutboundSignal(key),
      CALL_RTC_SIGNAL_TTL_MS
    );
    outbound.cleanupTimer.unref?.();
    return { success: true };
  }

  private getRtcPeerDestinationHash(call: CallRecord): string | null {
    const raw =
      call.direction === 'outbound'
        ? call.acceptedReticulumPeerHash
        : call.reticulumPeerPresenceHash;
    const normalized = raw?.trim().toLowerCase() ?? '';
    return /^[0-9a-f]{32}$/.test(normalized) ? normalized : null;
  }

  private isValidRtcSignalInput(input: {
    callId: string;
    generation: string;
    signalId: string;
    signalType: DirectCallRtcSignalType;
    payload: string;
    payloadHash: string;
    timestamp: number;
    signature: string;
    publicKey: string;
  }): boolean {
    if (typeof input.callId !== 'string' || input.callId.length > 64) {
      return false;
    }
    if (typeof input.payload !== 'string') return false;
    if (typeof input.generation !== 'string') return false;
    if (
      typeof input.signalId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,24}$/.test(input.signalId)
    ) {
      return false;
    }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.generation)) return false;
    if (
      !Object.prototype.hasOwnProperty.call(
        CALL_RTC_SIGNAL_CODE,
        input.signalType
      )
    ) {
      return false;
    }
    if (
      typeof input.payloadHash !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(input.payloadHash)
    ) {
      return false;
    }
    if (
      typeof input.signature !== 'string' ||
      !input.signature ||
      input.signature.length > 256 ||
      typeof input.publicKey !== 'string' ||
      !input.publicKey ||
      input.publicKey.length > 256
    ) {
      return false;
    }
    if (!Number.isFinite(input.timestamp)) return false;
    const skew = Date.now() - input.timestamp;
    if (skew > 30_000 || skew < -10_000) return false;
    const maxBytes =
      input.signalType === 'capability'
        ? 512
        : input.signalType === 'candidate'
          ? 8 * 1024
          : 64 * 1024;
    return Buffer.byteLength(input.payload, 'utf8') <= maxBytes;
  }

  private rtcSignalKey(callId: string, signalId: string): string {
    return `${callId}|${signalId}`;
  }

  private rtcDirectWireFits(wire: Record<string, unknown>): boolean {
    return (
      byteLengthUtf8JsonWithBridgeSenderOnly(wire) <=
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
  }

  private clearRtcOutboundSignal(key: string): void {
    const signal = this.rtcOutboundSignals.get(key);
    if (!signal) return;
    if (signal.repeatTimer) clearTimeout(signal.repeatTimer);
    if (signal.cleanupTimer) clearTimeout(signal.cleanupTimer);
    this.rtcOutboundSignals.delete(key);
  }

  private clearRtcInboundSignal(key: string): void {
    const signal = this.rtcInboundSignals.get(key);
    if (!signal) return;
    if (signal.recoveryTimer) clearTimeout(signal.recoveryTimer);
    if (signal.cleanupTimer) clearTimeout(signal.cleanupTimer);
    this.rtcInboundBufferedBytes = Math.max(
      0,
      this.rtcInboundBufferedBytes - signal.bufferedBytes
    );
    this.rtcInboundSignals.delete(key);
  }

  private clearRtcSignalsForCall(callId: string): void {
    for (const [key, signal] of this.rtcOutboundSignals) {
      if (signal.callId === callId) this.clearRtcOutboundSignal(key);
    }
    for (const [key, signal] of this.rtcInboundSignals) {
      if (signal.callId === callId) this.clearRtcInboundSignal(key);
    }
    for (const key of this.rtcCandidateCounts.keys()) {
      if (key.startsWith(`${callId}|`)) this.rtcCandidateCounts.delete(key);
    }
  }

  private clearAllRtcSignals(): void {
    for (const key of [...this.rtcOutboundSignals.keys()]) {
      this.clearRtcOutboundSignal(key);
    }
    for (const key of [...this.rtcInboundSignals.keys()]) {
      this.clearRtcInboundSignal(key);
    }
    this.rtcCandidateCounts.clear();
    this.rtcInboundBufferedBytes = 0;
  }

  private getOrCreateRtcInboundSignal(
    callId: string,
    signalId: string,
    senderDestinationHash: string
  ): DirectCallRtcInboundSignal | null {
    const key = this.rtcSignalKey(callId, signalId);
    const existing = this.rtcInboundSignals.get(key);
    if (existing) {
      return existing.senderDestinationHash === senderDestinationHash
        ? existing
        : null;
    }
    if (this.rtcInboundSignals.size >= CALL_RTC_MAX_INBOUND_SIGNALS)
      return null;
    const signal: DirectCallRtcInboundSignal = {
      callId,
      senderDestinationHash,
      signalId,
      parts: new Map(),
      bufferedBytes: 0,
      recoveryRounds: 0,
      createdAt: Date.now(),
    };
    signal.cleanupTimer = setTimeout(
      () => this.clearRtcInboundSignal(key),
      CALL_RTC_SIGNAL_TTL_MS
    );
    signal.cleanupTimer.unref?.();
    this.rtcInboundSignals.set(key, signal);
    return signal;
  }

  private isRtcWireFromSelectedPeer(
    callId: string,
    senderDestinationHash: string,
    peerPresenceHash: string
  ): { call: CallRecord; peerDestinationHash: string } | null {
    const call = this.activeCalls.get(callId);
    if (!call || call.state !== 'active') return null;
    const selected = this.getRtcPeerDestinationHash(call);
    const sender = senderDestinationHash.trim().toLowerCase();
    const transportPeer = peerPresenceHash.trim().toLowerCase();
    // WebRTC negotiation material is accepted only from the selected device
    // over its authenticated direct Reticulum link. Relayed/overlay copies are
    // deliberately ineligible even when their wallet signature is valid.
    if (!selected || sender !== selected || transportPeer !== selected)
      return null;
    return { call, peerDestinationHash: selected };
  }

  private handleRtcWire(
    wire: Record<string, unknown>,
    senderDestinationHash: string,
    peerPresenceHash: string
  ): boolean {
    const wireType = wire.t;
    if (
      wireType !== CALL_WIRE_RTC_START &&
      wireType !== CALL_WIRE_RTC_AUTH &&
      wireType !== CALL_WIRE_RTC_PART &&
      wireType !== CALL_WIRE_RTC_ACK &&
      wireType !== CALL_WIRE_RTC_RESEND
    ) {
      return false;
    }
    const callId = typeof wire.c === 'string' ? wire.c : '';
    const signalId = typeof wire.i === 'string' ? wire.i : '';
    if (!callId || !/^[A-Za-z0-9_-]{8,24}$/.test(signalId)) return true;
    const selected = this.isRtcWireFromSelectedPeer(
      callId,
      senderDestinationHash,
      peerPresenceHash
    );
    if (!selected) return true;
    const key = this.rtcSignalKey(callId, signalId);

    if (wireType === CALL_WIRE_RTC_ACK) {
      const outbound = this.rtcOutboundSignals.get(key);
      if (outbound?.peerDestinationHash === selected.peerDestinationHash) {
        this.clearRtcOutboundSignal(key);
      }
      return true;
    }
    if (wireType === CALL_WIRE_RTC_RESEND) {
      const outbound = this.rtcOutboundSignals.get(key);
      if (
        !outbound ||
        outbound.peerDestinationHash !== selected.peerDestinationHash
      ) {
        return true;
      }
      if (wire.s === true) {
        this.sendPinnedCallWireWhenReady(
          outbound.peerDestinationHash,
          outbound.startWire,
          0
        );
      }
      if (wire.a === true) {
        this.sendPinnedCallWireWhenReady(
          outbound.peerDestinationHash,
          outbound.authWire,
          0
        );
      }
      const missing = Array.isArray(wire.q) ? wire.q : [];
      for (const rawIndex of missing.slice(0, 32)) {
        if (!Number.isInteger(rawIndex)) continue;
        const partWire = outbound.partWires[rawIndex as number];
        if (partWire) {
          this.sendPinnedCallWireWhenReady(
            outbound.peerDestinationHash,
            partWire,
            0
          );
        }
      }
      return true;
    }

    const signal = this.getOrCreateRtcInboundSignal(
      callId,
      signalId,
      selected.peerDestinationHash
    );
    if (!signal) return true;
    if (signal.completed) {
      this.sendPinnedCallWireWhenReady(
        selected.peerDestinationHash,
        {
          t: CALL_WIRE_RTC_ACK,
          c: callId,
          i: signalId,
        },
        0
      );
      return true;
    }

    if (wireType === CALL_WIRE_RTC_START) {
      const signalType =
        typeof wire.y === 'string'
          ? CALL_RTC_SIGNAL_FROM_CODE[wire.y]
          : undefined;
      const generation = typeof wire.v === 'string' ? wire.v : '';
      const partCount = typeof wire.n === 'number' ? wire.n : NaN;
      const payloadHash =
        typeof wire.z === 'string' ? wire.z.toLowerCase() : '';
      const timestamp = typeof wire.m === 'number' ? wire.m : NaN;
      if (
        !signalType ||
        !/^[A-Za-z0-9_-]{8,64}$/.test(generation) ||
        !Number.isSafeInteger(partCount) ||
        partCount < 1 ||
        partCount > CALL_RTC_MAX_FRAGMENTS ||
        !/^[0-9a-f]{64}$/.test(payloadHash) ||
        !Number.isFinite(timestamp) ||
        Date.now() - timestamp > 30_000 ||
        Date.now() - timestamp < -10_000
      ) {
        this.clearRtcInboundSignal(key);
        return true;
      }
      if (
        (signal.signalType && signal.signalType !== signalType) ||
        (signal.generation && signal.generation !== generation) ||
        (signal.partCount && signal.partCount !== partCount) ||
        (signal.payloadHash && signal.payloadHash !== payloadHash) ||
        (signal.timestamp && signal.timestamp !== timestamp)
      ) {
        this.clearRtcInboundSignal(key);
        return true;
      }
      signal.signalType = signalType;
      signal.generation = generation;
      signal.partCount = partCount;
      signal.payloadHash = payloadHash;
      signal.timestamp = timestamp;
    } else if (wireType === CALL_WIRE_RTC_AUTH) {
      const publicKey = typeof wire.k === 'string' ? wire.k : '';
      const signature = typeof wire.g === 'string' ? wire.g : '';
      if (!publicKey || !signature) {
        this.clearRtcInboundSignal(key);
        return true;
      }
      if (
        (signal.fromPublicKey && signal.fromPublicKey !== publicKey) ||
        (signal.signature && signal.signature !== signature)
      ) {
        this.clearRtcInboundSignal(key);
        return true;
      }
      signal.fromPublicKey = publicKey;
      signal.signature = signature;
    } else if (wireType === CALL_WIRE_RTC_PART) {
      const index = typeof wire.x === 'number' ? wire.x : NaN;
      const part = typeof wire.p === 'string' ? wire.p : '';
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= CALL_RTC_MAX_FRAGMENTS ||
        part.length > CALL_RTC_FRAGMENT_CHARS ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(part)
      ) {
        this.clearRtcInboundSignal(key);
        return true;
      }
      if (!signal.parts.has(index)) {
        const addedBytes = Buffer.byteLength(part, 'utf8');
        if (
          this.rtcInboundBufferedBytes + addedBytes >
          CALL_RTC_MAX_BUFFERED_BYTES
        ) {
          this.clearRtcInboundSignal(key);
          return true;
        }
        signal.parts.set(index, part);
        signal.bufferedBytes += addedBytes;
        this.rtcInboundBufferedBytes += addedBytes;
      }
    }

    this.maybeCompleteRtcInboundSignal(key, selected.call);
    return true;
  }

  private maybeCompleteRtcInboundSignal(key: string, call: CallRecord): void {
    const signal = this.rtcInboundSignals.get(key);
    if (!signal || signal.completed || signal.verificationStarted) return;
    if (
      !signal.signalType ||
      !signal.generation ||
      !signal.partCount ||
      !signal.payloadHash ||
      !signal.timestamp ||
      !signal.fromPublicKey ||
      !signal.signature
    ) {
      this.scheduleRtcRecovery(key);
      return;
    }
    const missing: number[] = [];
    for (let i = 0; i < signal.partCount; i += 1) {
      if (!signal.parts.has(i)) missing.push(i);
    }
    if (missing.length > 0) {
      this.scheduleRtcRecovery(key);
      return;
    }
    signal.verificationStarted = true;
    if (signal.recoveryTimer) {
      clearTimeout(signal.recoveryTimer);
      signal.recoveryTimer = undefined;
    }
    let payload: string;
    try {
      const encoded = Array.from(
        { length: signal.partCount },
        (_, index) => signal.parts.get(index) ?? ''
      ).join('');
      payload = inflateRawSync(Buffer.from(encoded, 'base64'), {
        maxOutputLength: 64 * 1024,
      }).toString('utf8');
    } catch {
      this.clearRtcInboundSignal(key);
      return;
    }
    const actualHash = createHash('sha256')
      .update(payload, 'utf8')
      .digest('hex');
    if (actualHash !== signal.payloadHash) {
      this.clearRtcInboundSignal(key);
      return;
    }
    const maxBytes =
      signal.signalType === 'capability'
        ? 512
        : signal.signalType === 'candidate'
          ? 8 * 1024
          : 64 * 1024;
    if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
      this.clearRtcInboundSignal(key);
      return;
    }
    const candidateKey = `${signal.callId}|${signal.generation}`;
    if (signal.signalType === 'candidate') {
      const count = this.rtcCandidateCounts.get(candidateKey) ?? 0;
      if (count >= CALL_RTC_MAX_CANDIDATES_PER_GENERATION) {
        this.clearRtcInboundSignal(key);
        return;
      }
    }
    const signedFields = buildDirectCallRtcSignedFields({
      callId: signal.callId,
      generation: signal.generation,
      signalId: signal.signalId,
      signalType: signal.signalType,
      payloadHash: signal.payloadHash,
      timestamp: signal.timestamp,
    });
    const accountGeneration = this.localAccountGeneration;
    void this.verifyPool
      .verify({
        kind: 'gc',
        fields: signedFields,
        signature: signal.signature,
        fromPublicKey: signal.fromPublicKey,
        fromAddress: call.remoteAddress,
      })
      .then((verified) => {
        if (accountGeneration !== this.localAccountGeneration) return;
        const current = this.rtcInboundSignals.get(key);
        const active = this.activeCalls.get(signal.callId);
        if (
          !verified ||
          current !== signal ||
          active !== call ||
          active.state !== 'active' ||
          this.getRtcPeerDestinationHash(active) !==
            signal.senderDestinationHash
        ) {
          this.clearRtcInboundSignal(key);
          return;
        }
        signal.completed = true;
        signal.parts.clear();
        this.rtcInboundBufferedBytes = Math.max(
          0,
          this.rtcInboundBufferedBytes - signal.bufferedBytes
        );
        signal.bufferedBytes = 0;
        if (signal.signalType === 'candidate') {
          this.rtcCandidateCounts.set(
            candidateKey,
            (this.rtcCandidateCounts.get(candidateKey) ?? 0) + 1
          );
        }
        if (signal.signalType !== 'candidate') {
          loggerLog('[Call][RTC] authenticated signal received', {
            signalType: signal.signalType,
            call: signal.callId.slice(0, 8),
            peer: signal.senderDestinationHash.slice(0, 8),
          });
        }
        this.emit('call:rtc-signal', {
          callId: signal.callId,
          generation: signal.generation,
          signalType: signal.signalType,
          payload,
        });
        this.sendPinnedCallWireWhenReady(
          signal.senderDestinationHash,
          {
            t: CALL_WIRE_RTC_ACK,
            c: signal.callId,
            i: signal.signalId,
          },
          0
        );
      })
      .catch(() => this.clearRtcInboundSignal(key));
  }

  private scheduleRtcRecovery(key: string): void {
    const signal = this.rtcInboundSignals.get(key);
    if (!signal || signal.recoveryTimer || signal.completed) return;
    signal.recoveryTimer = setTimeout(
      () => {
        signal.recoveryTimer = undefined;
        const current = this.rtcInboundSignals.get(key);
        if (!current || current.completed || current.verificationStarted)
          return;
        if (current.recoveryRounds >= CALL_RTC_MAX_RECOVERY_ROUNDS) {
          return;
        }
        current.recoveryRounds += 1;
        const missing: number[] = [];
        if (current.partCount) {
          for (let i = 0; i < current.partCount; i += 1) {
            if (!current.parts.has(i)) missing.push(i);
          }
        }
        const requests = Math.max(1, Math.ceil(missing.length / 32));
        for (let batch = 0; batch < requests; batch += 1) {
          const resend = {
            t: CALL_WIRE_RTC_RESEND,
            c: current.callId,
            i: current.signalId,
            q: missing.slice(batch * 32, batch * 32 + 32),
            ...(!current.partCount ? { s: true } : {}),
            ...(current.fromPublicKey && current.signature ? {} : { a: true }),
          };
          if (this.rtcDirectWireFits(resend)) {
            this.sendPinnedCallWireWhenReady(
              current.senderDestinationHash,
              resend,
              0
            );
          }
        }
        this.scheduleRtcRecovery(key);
      },
      Math.min(2_800, CALL_RTC_RECOVERY_WAIT_MS * 2 ** signal.recoveryRounds)
    );
    signal.recoveryTimer.unref?.();
  }

  private enqueuePendingVerifiedIncomingRequest(
    env: CallRequestEnvelope,
    senderDestinationHash: string
  ): void {
    const now = Date.now();
    const cutoff = now - CALL_REQUEST_TTL_MS;
    this.pendingVerifiedIncomingWhenNoLocal =
      this.pendingVerifiedIncomingWhenNoLocal.filter(
        (p) => p.receivedAt >= cutoff && p.env.callId !== env.callId
      );
    this.pendingVerifiedIncomingWhenNoLocal.push({
      env,
      ctx: { senderDestinationHash },
      receivedAt: now,
    });
    loggerLog(
      `[Call] Queued CALL_REQUEST until local addresses registered (callId=${env.callId.slice(0, 8)}…)`
    );
  }

  private flushPendingVerifiedIncomingRequests(): void {
    if (this.localAddresses.size === 0) return;
    const pending = [...this.pendingVerifiedIncomingWhenNoLocal];
    this.pendingVerifiedIncomingWhenNoLocal = [];
    const now = Date.now();
    for (const p of pending) {
      if (now - p.receivedAt > CALL_REQUEST_TTL_MS) continue;
      try {
        this.applyVerifiedIncomingRequest(p.env, p.ctx);
      } catch (err) {
        loggerError('[Call] Error applying queued CALL_REQUEST:', err);
      }
    }
  }

  async initiateCall(
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
  ): Promise<string | null> {
    const boundLocalDestination = getRouteBoundDestinationHash('call', callId);
    const currentLocalDestination =
      this.reticulumBridge?.getLocalDestinationHash?.()?.trim().toLowerCase() ??
      '';
    if (
      boundLocalDestination &&
      (!currentLocalDestination ||
        boundLocalDestination !== currentLocalDestination)
    ) {
      loggerWarn(
        `[Call] Refusing call with stale local route binding callId=${callId.slice(0, 8)}…`
      );
      return null;
    }
    const env: CallRequestEnvelope = {
      type: 'CALL_REQUEST',
      callId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      chatId,
      signature,
      timestamp,
      ...(boundLocalDestination
        ? { reticulumDestinationHash: boundLocalDestination }
        : {}),
      hopsRemaining: CALL_MAX_HOPS,
    };

    const allRoutes: PresenceRoute[] =
      typeof this.presence.getRoutesForAddress === 'function'
        ? this.presence.getRoutesForAddress(targetAddress)
        : [this.presence.getRouteForAddress(targetAddress)].filter(
            (route): route is PresenceRoute => route !== null
          );
    const routes = allRoutes.filter(
      (route): route is Extract<PresenceRoute, { kind: 'reticulum' }> =>
        route.kind === 'reticulum'
    );
    if (routes.length === 0) {
      loggerLog(`[Call] No Reticulum route to ${targetAddress}`);
      return null;
    }

    const record: CallRecord = {
      callId,
      localAddress,
      remoteAddress: targetAddress,
      reticulumPeerPresenceHash: routes[0].destinationHash,
      invitedReticulumPeerHashes: new Set(
        routes.map((route) => route.destinationHash)
      ),
      rejectedReticulumPeerHashes: new Set(),
      cancellationSignature,
      cancellationPublicKey,
      cancellationTimestamp,
      chatId,
      direction: 'outbound',
      state: 'pending',
      startedAt: timestamp,
    };

    record.cleanupTimer = setTimeout(() => {
      if (this.activeCalls.get(callId)?.state === 'pending') {
        loggerLog(`[Call] Request ${callId.slice(0, 8)}… timed out.`);
        this.emitDirectCallHistory(record, 'no_answer');
        this.activeCalls.delete(callId);
        this.clearRtcSignalsForCall(callId);
      }
    }, CALL_REQUEST_TTL_MS);

    this.activeCalls.set(callId, record);
    this.sendEnvelope(targetAddress, env);

    loggerLog(
      `[Call] Initiated call ${callId.slice(0, 8)}… to ${targetAddress} via reticulum`
    );
    return callId;
  }

  acceptCall(
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): boolean {
    const call = this.activeCalls.get(callId);
    if (!call || call.direction !== 'inbound' || call.state !== 'pending') {
      loggerWarn(
        `[Call] Refused accept for unknown or non-ringing call ${callId.slice(0, 8)}…`
      );
      return false;
    }
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    call.state = 'active';
    this.emitDirectCallHistory(call, 'answered', timestamp);

    const env: CallAcceptEnvelope = {
      type: 'CALL_ACCEPT',
      callId,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: CALL_MAX_HOPS,
    };
    this.sendToCallRepeated(
      call,
      env,
      CALL_ACCEPT_REPEAT_ATTEMPTS,
      CALL_ACCEPT_REPEAT_MS
    );
    // The request may have reached this device through a relay before a direct
    // overlay Link back to the caller is admitted. Preserve the exact accepting
    // device in `r`, but also send this small wallet-signed control envelope
    // through the same targeted overlay used by CALL_REQUEST. The caller still
    // accepts only an invited endpoint. WebRTC SDP/ICE and media keys never use
    // this fallback and remain pinned to the authenticated direct Link.
    this.sendEnvelope(call.remoteAddress, env);
    loggerLog(`[Call] Accepted call ${callId.slice(0, 8)}…`);
    return true;
  }

  rejectCall(
    callId: string,
    reason?: string,
    signature?: string,
    publicKey?: string,
    timestamp?: number,
    reasonSignature?: string
  ): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    if (call.rejectionFinalizeTimer) {
      clearTimeout(call.rejectionFinalizeTimer);
      call.rejectionFinalizeTimer = undefined;
    }
    this.clearControlRepeatTimers(call);
    call.state = 'ended';
    this.activeCalls.delete(callId);
    this.clearRtcSignalsForCall(callId);
    if (call.direction === 'inbound' && reason === 'rejected') {
      this.emitDirectCallHistory(call, 'declined', timestamp ?? Date.now());
    }

    const legacyEnv: CallRejectEnvelope = {
      type: 'CALL_REJECT',
      callId,
      fromPublicKey: publicKey ?? '',
      signature: signature ?? '',
      timestamp: timestamp ?? Date.now(),
      hopsRemaining: CALL_MAX_HOPS,
    };
    // Send the authenticated, descriptive rejection first. Older callers
    // reject this signature (because they verify the legacy field set), then
    // accept the reason-less legacy envelope sent immediately afterwards.
    if (reason && reasonSignature) {
      this.sendToCall(call, {
        ...legacyEnv,
        reason,
        signature: reasonSignature,
      });
    }
    this.sendToCall(call, legacyEnv);
    loggerLog(`[Call] Rejected call ${callId.slice(0, 8)}…`);
  }

  private clearPendingDmHangupAcks(): void {
    for (const pending of this.pendingDmHangupAcks.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingDmHangupAcks.clear();
  }

  private waitForDmHangupAck(
    call: CallRecord,
    controlId: string,
    timeoutMs = DM_HANGUP_ACK_WAIT_MS
  ): Promise<boolean> {
    const peerDestinationHash = this.getRtcPeerDestinationHash(call);
    if (!peerDestinationHash) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const finish = (acknowledged: boolean) => {
        const current = this.pendingDmHangupAcks.get(controlId);
        if (!current) return;
        clearTimeout(current.timer);
        this.pendingDmHangupAcks.delete(controlId);
        resolve(acknowledged);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      this.pendingDmHangupAcks.set(controlId, {
        callId: call.callId,
        localAddress: call.localAddress,
        remoteAddress: call.remoteAddress,
        peerDestinationHash,
        resolve: finish,
        timer,
      });
    });
  }

  private async sendActiveDmHangupOverMediaLink(
    call: CallRecord,
    env: CallHangupEnvelope
  ): Promise<boolean> {
    const sender = this.dmCallLinkControlSender;
    if (!sender) return false;
    const controlId = randomBytes(12).toString('hex');
    const ack = this.waitForDmHangupAck(call, controlId);
    let sendAttempt: Promise<{ success: boolean; error?: string }>;
    try {
      sendAttempt = sender({
        kind: 'hangup',
        callId: call.callId,
        chatId: call.chatId,
        controlId,
        fromAddress: call.localAddress,
        toAddress: call.remoteAddress,
        timestamp: env.timestamp,
        publicKey: env.fromPublicKey,
        signature: env.signature,
      });
    } catch (error) {
      sendAttempt = Promise.resolve({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    void sendAttempt
      .then((result) => {
        if (result.success) return;
        const pending = this.pendingDmHangupAcks.get(controlId);
        pending?.resolve(false);
        loggerWarn(
          `[Call] Dedicated DM hangup unavailable callId=${call.callId.slice(0, 8)}… reason=${result.error ?? 'unknown'}`
        );
      })
      .catch((error) => {
        const pending = this.pendingDmHangupAcks.get(controlId);
        pending?.resolve(false);
        loggerWarn(
          `[Call] Dedicated DM hangup unavailable callId=${call.callId.slice(0, 8)}… reason=${error instanceof Error ? error.message : String(error)}`
        );
      });
    const acknowledged = await ack;
    if (acknowledged) {
      loggerLog(
        `[Call] Dedicated DM hangup acknowledged callId=${call.callId.slice(0, 8)}…`
      );
    }
    return acknowledged;
  }

  async hangUp(
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    const previousState = call.state;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    if (call.rejectionFinalizeTimer) {
      clearTimeout(call.rejectionFinalizeTimer);
      call.rejectionFinalizeTimer = undefined;
    }
    this.clearControlRepeatTimers(call);
    call.state = 'ended';
    this.activeCalls.delete(callId);
    this.clearRtcSignalsForCall(callId);
    this.emitDirectCallHistory(
      call,
      previousState === 'active'
        ? 'answered'
        : call.direction === 'outbound'
          ? 'cancelled'
          : 'missed',
      timestamp
    );

    const env: CallHangupEnvelope = {
      type: 'CALL_HANGUP',
      callId,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: CALL_MAX_HOPS,
    };
    const dedicatedAcknowledged =
      previousState === 'active'
        ? await this.sendActiveDmHangupOverMediaLink(call, env)
        : false;
    if (!dedicatedAcknowledged) {
      // Preserve the selected-device direct attempt, then use the existing
      // signed targeted overlay as a multi-hop fallback for A↔B↔C layouts.
      this.sendToCall(call, env);
      this.sendEnvelope(call.remoteAddress, env);
      loggerLog(
        `[Call] Fell back to targeted overlay hangup callId=${callId.slice(0, 8)}…`
      );
    }
    loggerLog(`[Call] Hung up call ${callId.slice(0, 8)}…`);
  }

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
    ctx: { senderDestinationHash: string }
  ): void {
    if (this.activeCalls.has(env.callId)) return;

    const localRecipient = this.localCallRecipientAddress(env);
    if (!localRecipient) return;

    const record: CallRecord = {
      callId: env.callId,
      localAddress: localRecipient,
      remoteAddress: env.fromAddress,
      // The authenticated ingress endpoint is the exact device that placed
      // this call. A generic account presence route may belong to another
      // laptop, so all replies for this interaction remain pinned here.
      reticulumPeerPresenceHash: ctx.senderDestinationHash,
      chatId: env.chatId,
      direction: 'inbound',
      state: 'pending',
      startedAt: Date.now(),
    };

    record.cleanupTimer = setTimeout(() => {
      if (this.activeCalls.get(env.callId)?.state === 'pending') {
        loggerLog(`[Call] Incoming call ${env.callId.slice(0, 8)}… timed out.`);
        this.emitDirectCallHistory(record, 'missed');
        this.activeCalls.delete(env.callId);
        this.clearRtcSignalsForCall(env.callId);
      }
    }, CALL_REQUEST_TTL_MS);

    this.activeCalls.set(env.callId, record);
    this.emit('call:incoming', {
      callId: env.callId,
      fromAddress: env.fromAddress,
      chatId: env.chatId,
    });

    loggerLog(
      `[Call] Incoming call ${env.callId.slice(0, 8)}… from ${env.fromAddress} (reticulum)`
    );
  }

  private handleAccept(
    env: CallAcceptEnvelope,
    senderDestinationHash: string
  ): void {
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
    const accountGeneration = this.localAccountGeneration;
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
        if (accountGeneration !== this.localAccountGeneration) return;
        if (!ok) {
          loggerLog('[Call] Dropped CALL_ACCEPT: invalid signature');
          return;
        }
        const c = this.activeCalls.get(env.callId);
        if (!c || c.direction !== 'outbound' || c.state !== 'pending') return;
        if (c.cleanupTimer) clearTimeout(c.cleanupTimer);
        if (c.rejectionFinalizeTimer) {
          clearTimeout(c.rejectionFinalizeTimer);
          c.rejectionFinalizeTimer = undefined;
        }
        c.acceptedReticulumPeerHash = senderDestinationHash;
        c.reticulumPeerPresenceHash = senderDestinationHash;
        c.state = 'active';
        this.emitDirectCallHistory(c, 'answered', env.timestamp);
        this.cancelOtherRingingEndpoints(c);
        this.emit('call:accepted', { callId: env.callId });
        loggerLog(`[Call] Call ${env.callId.slice(0, 8)}… accepted.`);
      });
  }

  private handleReject(
    env: CallRejectEnvelope,
    senderDestinationHash: string
  ): void {
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
    const accountGeneration = this.localAccountGeneration;
    const boundedReason =
      typeof env.reason === 'string' && env.reason.length <= 32
        ? env.reason.trim()
        : '';
    const reasonFields = boundedReason
      ? {
          type: env.type,
          callId: env.callId,
          timestamp: env.timestamp,
          reason: boundedReason,
        }
      : null;
    if (reasonFields) {
      const timestampSkew = Date.now() - env.timestamp;
      if (timestampSkew > 30_000 || timestampSkew < -10_000) {
        loggerLog('[Call] Dropped CALL_REJECT: invalid timestamp');
        return;
      }
    }
    const applyVerifiedReject = (reasonAuthenticated: boolean, ok: boolean) => {
      if (accountGeneration !== this.localAccountGeneration) return;
      if (!ok) {
        loggerLog('[Call] Dropped CALL_REJECT: invalid signature');
        return;
      }
      const c = this.activeCalls.get(env.callId);
      if (!c || c.state !== 'pending') return;
      if (c.direction === 'outbound') {
        const invited = c.invitedReticulumPeerHashes ?? new Set<string>();
        if (senderDestinationHash) invited.add(senderDestinationHash);
        c.invitedReticulumPeerHashes = invited;
        const rejected = c.rejectedReticulumPeerHashes ?? new Set<string>();
        if (senderDestinationHash) rejected.add(senderDestinationHash);
        c.rejectedReticulumPeerHashes = rejected;
        const reasons =
          c.rejectionReasonsByReticulumPeerHash ??
          new Map<string, string | null>();
        if (senderDestinationHash) {
          const previous = reasons.get(senderDestinationHash);
          // A later legacy compatibility envelope must never erase the
          // authenticated reason received just before it.
          if (reasonAuthenticated || previous === undefined) {
            reasons.set(
              senderDestinationHash,
              reasonAuthenticated ? boundedReason : null
            );
          }
        }
        c.rejectionReasonsByReticulumPeerHash = reasons;
        if ([...invited].some((peer) => !rejected.has(peer))) {
          loggerLog(
            `[Call] Endpoint rejected ${env.callId.slice(0, 8)}…; waiting for ${invited.size - rejected.size} other endpoint(s).`
          );
          return;
        }
        if (
          [...reasons.values()].some((item) => item === null) &&
          !reasonAuthenticated
        ) {
          // The authenticated-reason and legacy compatibility frames are
          // sent back-to-back. Briefly tolerate network reordering before
          // settling on the generic result.
          if (!c.rejectionFinalizeTimer) {
            c.rejectionFinalizeTimer = setTimeout(() => {
              this.finalizeRejectedCall(env.callId, env.timestamp);
            }, 250);
            c.rejectionFinalizeTimer.unref?.();
          }
          return;
        }
      }
      this.finalizeRejectedCall(env.callId, env.timestamp);
    };

    const verifyLegacy = () =>
      this.verifyPool.verify({
        kind: 'call_signed',
        wireType: env.type,
        callId: env.callId,
        timestamp: env.timestamp,
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
        expectedAddress,
      });

    if (!reasonFields) {
      void verifyLegacy().then((ok) => applyVerifiedReject(false, ok));
      return;
    }

    void this.verifyPool
      .verify({
        kind: 'gc',
        fields: reasonFields,
        signature: env.signature,
        fromPublicKey: env.fromPublicKey,
        fromAddress: expectedAddress,
      })
      .then((reasonAuthenticated) => {
        if (reasonAuthenticated) {
          applyVerifiedReject(true, true);
          return;
        }
        void verifyLegacy().then((ok) => applyVerifiedReject(false, ok));
      });
  }

  private finalizeRejectedCall(callId: string, timestamp: number): void {
    const call = this.activeCalls.get(callId);
    if (!call || call.state !== 'pending') return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    if (call.rejectionFinalizeTimer) {
      clearTimeout(call.rejectionFinalizeTimer);
      call.rejectionFinalizeTimer = undefined;
    }
    this.clearControlRepeatTimers(call);
    call.state = 'ended';
    this.activeCalls.delete(callId);
    this.clearRtcSignalsForCall(callId);
    if (call.direction === 'outbound') {
      this.emitDirectCallHistory(call, 'declined', timestamp);
    }
    const endpointReasons = [
      ...(call.rejectionReasonsByReticulumPeerHash?.values() ?? []),
    ];
    const reason =
      endpointReasons.length > 0 &&
      endpointReasons.every((item) => item === 'not_friend')
        ? 'not_friend'
        : endpointReasons.length > 0 &&
            endpointReasons.every((item) => item === 'media unavailable')
          ? 'media unavailable'
          : 'rejected';
    this.emit('call:rejected', { callId, reason });
    loggerLog(`[Call] Call ${callId.slice(0, 8)}… rejected.`);
  }

  private finalizeRemoteHangup(
    call: CallRecord,
    timestamp: number
  ): void {
    const previousState = call.state;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    if (call.rejectionFinalizeTimer) {
      clearTimeout(call.rejectionFinalizeTimer);
      call.rejectionFinalizeTimer = undefined;
    }
    this.clearControlRepeatTimers(call);
    call.state = 'ended';
    this.activeCalls.delete(call.callId);
    this.clearRtcSignalsForCall(call.callId);
    this.emitDirectCallHistory(
      call,
      previousState === 'active'
        ? 'answered'
        : call.direction === 'inbound'
          ? 'missed'
          : 'cancelled',
      timestamp
    );
    this.emit('call:hangup', { callId: call.callId });
    loggerLog(`[Call] Remote hung up call ${call.callId.slice(0, 8)}…`);
  }

  acknowledgeDmCallLinkHangup(input: DmCallLinkControlPayload): boolean {
    if (input.kind !== 'hangup-ack') return false;
    const pending = this.pendingDmHangupAcks.get(input.controlId);
    if (
      !pending ||
      pending.callId !== input.callId ||
      pending.localAddress !== input.toAddress ||
      pending.remoteAddress !== input.fromAddress ||
      pending.peerDestinationHash !==
        input.verifiedPeerDestinationHash.trim().toLowerCase()
    ) {
      return false;
    }
    pending.resolve(true);
    return true;
  }

  async handleDmCallLinkHangup(
    input: DmCallLinkControlPayload,
    sendAck: (input: DmCallLinkControlSendInput) => Promise<{
      success: boolean;
      error?: string;
    }>
  ): Promise<boolean> {
    if (
      input.kind !== 'hangup' ||
      typeof input.publicKey !== 'string' ||
      typeof input.signature !== 'string' ||
      Math.abs(Date.now() - input.timestamp) > 30_000
    ) {
      return false;
    }
    const call = this.activeCalls.get(input.callId);
    const expectedPeer = call ? this.getRtcPeerDestinationHash(call) : null;
    if (
      !call ||
      call.state !== 'active' ||
      call.chatId !== input.chatId ||
      call.remoteAddress !== input.fromAddress ||
      call.localAddress !== input.toAddress ||
      !expectedPeer ||
      expectedPeer !== input.verifiedPeerDestinationHash.trim().toLowerCase()
    ) {
      return false;
    }
    const verified = await this.verifyPool.verify({
      kind: 'call_signed',
      wireType: 'CALL_HANGUP',
      callId: input.callId,
      timestamp: input.timestamp,
      signature: input.signature,
      fromPublicKey: input.publicKey,
      expectedAddress: call.remoteAddress,
    });
    const current = this.activeCalls.get(input.callId);
    if (
      !verified ||
      current !== call ||
      current.state !== 'active' ||
      this.getRtcPeerDestinationHash(current) !== expectedPeer
    ) {
      return false;
    }
    // Queue the receipt while the authenticated media link and room still
    // exist, but never let bridge backpressure delay remote UI cleanup for the
    // bridge's full command timeout. The sender's overlay fallback remains the
    // final delivery guarantee when this bounded enqueue does not complete.
    let ackQueueTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      sendAck({
        kind: 'hangup-ack',
        callId: call.callId,
        chatId: call.chatId,
        controlId: input.controlId,
        fromAddress: call.localAddress,
        toAddress: call.remoteAddress,
        timestamp: Date.now(),
      }).catch(() => ({ success: false })),
      new Promise<{ success: false }>((resolve) => {
        ackQueueTimer = setTimeout(
          () => resolve({ success: false }),
          DM_HANGUP_ACK_QUEUE_WAIT_MS
        );
        ackQueueTimer.unref?.();
      }),
    ]);
    if (ackQueueTimer) clearTimeout(ackQueueTimer);
    this.finalizeRemoteHangup(call, input.timestamp);
    return true;
  }

  private handleHangup(
    env: CallHangupEnvelope,
    senderDestinationHash: string
  ): void {
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
        const expectedEndpoint =
          c.direction === 'outbound'
            ? c.acceptedReticulumPeerHash
            : c.reticulumPeerPresenceHash;
        if (
          expectedEndpoint &&
          senderDestinationHash &&
          senderDestinationHash !== expectedEndpoint
        ) {
          loggerLog(
            `[Call] Dropped CALL_HANGUP from unselected endpoint callId=${env.callId.slice(0, 8)}…`
          );
          return;
        }
        this.finalizeRemoteHangup(c, env.timestamp);
      });
  }

  private onReticulumCallWire(
    wire: Record<string, unknown>,
    senderDestinationHash: string,
    peerPresenceHash: string
  ): void {
    if (this.handleRtcWire(wire, senderDestinationHash, peerPresenceHash)) {
      return;
    }
    // `r` is the original sender's stamped call destination. Direct legacy
    // frames may omit it, in which case the authenticated link peer is the
    // only safe fallback. Never prefer the relay/link peer when `r` exists.
    let sourceEndpoint = (senderDestinationHash || peerPresenceHash)
      .trim()
      .toLowerCase();
    const env = this.parseCallEnvelope(wire);
    if (!env) return;
    const overlayMeta = this.parseReticulumOverlayMeta(wire);
    const call = this.activeCalls.get(env.callId);
    const boundCallerDestination = getRouteBoundDestinationHash(
      'call',
      env.callId
    );
    const expectedSourceAddress =
      env.type === 'CALL_REQUEST' ? env.fromAddress : call?.remoteAddress;
    const targetIsLocal = overlayMeta
      ? this.localAddresses.has(overlayMeta.targetAddress)
      : Boolean(call);
    if (
      expectedSourceAddress &&
      (targetIsLocal || Boolean(call) || this.localAddresses.size === 0)
    ) {
      let resolvedSource: string | null = null;
      const wireSource = senderDestinationHash.trim().toLowerCase();
      const transportSource = peerPresenceHash.trim().toLowerCase();
      const callerAuthoredControl =
        env.type === 'CALL_REQUEST' || call?.direction === 'inbound';

      if (boundCallerDestination && callerAuthoredControl) {
        // The call id is wallet-signed by the caller and embeds its exact
        // Reticulum destination. Use that binding even if an older relay
        // replaced `r` with its own transport hash; the request is not applied
        // until its wallet signature is verified. Current senders also verify
        // this binding against their local bridge destination before sending.
        resolvedSource = boundCallerDestination;
      } else if (call?.direction === 'outbound') {
        // Responses come from one of the exact routes invited by this caller.
        // This remains deterministic for legacy callees without consulting a
        // mutable presence cache after the call has started.
        const invited = new Set(
          [
            ...(call.invitedReticulumPeerHashes ?? []),
            call.acceptedReticulumPeerHash,
            call.reticulumPeerPresenceHash,
          ]
            .filter((hash): hash is string => Boolean(hash))
            .map((hash) => hash.trim().toLowerCase())
        );
        resolvedSource = invited.has(wireSource)
          ? wireSource
          : invited.has(transportSource)
            ? transportSource
            : null;
      } else {
        const sourceRoutes: PresenceRoute[] =
          typeof this.presence.getRoutesForAddress === 'function'
            ? this.presence.getRoutesForAddress(expectedSourceAddress)
            : [this.presence.getRouteForAddress(expectedSourceAddress)].filter(
                (route): route is PresenceRoute => route !== null
              );
        const verifiedRouteHashes = sourceRoutes
          .filter(
            (route): route is Extract<PresenceRoute, { kind: 'reticulum' }> =>
              route.kind === 'reticulum'
          )
          .map((route) => route.destinationHash);
        resolvedSource = resolveDirectCallSourceEndpoint(
          verifiedRouteHashes,
          senderDestinationHash,
          peerPresenceHash
        );
      }
      if (!resolvedSource) {
        loggerLog(
          `[Call] Ignored ${env.type} with an unauthenticated device route callId=${env.callId.slice(0, 8)}… from=${expectedSourceAddress}`
        );
        // Do not remember the overlay id: a direct/authentic device copy with
        // the same id may still arrive and must remain processable.
        return;
      }
      if (resolvedSource !== sourceEndpoint) {
        loggerLog(
          `[Call] Replaced relay route with verified call endpoint callId=${env.callId.slice(0, 8)}… relay=${sourceEndpoint.slice(0, 8)} endpoint=${resolvedSource.slice(0, 8)}`
        );
      }
      sourceEndpoint = resolvedSource;
    }
    if (overlayMeta) {
      if (this.hasSeenReticulumOverlayId(overlayMeta.overlayId)) return;
      this.rememberReticulumOverlayId(overlayMeta.overlayId);
      if (overlayMeta.hopsRemaining > 0) {
        const forwarded = {
          ...wire,
          L: overlayMeta.hopsRemaining - 1,
        };
        this.broadcastReticulumOverlayWire(forwarded, [peerPresenceHash]);
      }
      if (!targetIsLocal) {
        if (this.localAddresses.size > 0) {
          return;
        }
        loggerLog(
          `[Call] Processing call wire while local addresses are not registered yet target=${overlayMeta.targetAddress.slice(0, 8)}…`
        );
      }
    }

    if (env.type === 'CALL_REQUEST') {
      if (sourceEndpoint) this.handleRequestReticulum(sourceEndpoint, env);
      return;
    }

    switch (env.type) {
      case 'CALL_ACCEPT':
        this.handleAccept(env, sourceEndpoint);
        break;
      case 'CALL_REJECT':
        this.handleReject(env, sourceEndpoint);
        break;
      case 'CALL_HANGUP':
        this.handleHangup(env, sourceEndpoint);
        break;
      default:
        break;
    }
  }

  private parseCallEnvelope(
    wire: Record<string, unknown>
  ): CallWireEnvelope | null {
    const compact = decodeCompactCallWire(wire);
    if (compact) return compact;
    return typeof wire.type === 'string' && CALL_MESSAGE_TYPES.has(wire.type)
      ? (wire as unknown as CallWireEnvelope)
      : null;
  }

  private handleRequestReticulum(
    senderDestinationHash: string,
    env: CallRequestEnvelope
  ): void {
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

    const accountGeneration = this.localAccountGeneration;
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
        if (accountGeneration !== this.localAccountGeneration) return;
        if (!ok) {
          loggerLog('[Call] Dropped CALL_REQUEST (RT): invalid signature');
          return;
        }
        if (this.localAddresses.size === 0) {
          if (!this.acceptPendingIncomingWithoutLocal) return;
          this.enqueuePendingVerifiedIncomingRequest(
            env,
            senderDestinationHash
          );
          return;
        }
        try {
          this.applyVerifiedIncomingRequest(env, {
            senderDestinationHash,
          });
        } catch (err) {
          loggerError('[Call] Error applying CALL_REQUEST (RT):', err);
        }
      });
  }

  private sendToCall(call: CallRecord, env: CallWireEnvelope): void {
    const peers = new Set<string>();
    if (call.direction === 'inbound') {
      peers.add(call.reticulumPeerPresenceHash);
    } else if (call.acceptedReticulumPeerHash) {
      peers.add(call.acceptedReticulumPeerHash);
    } else if (call.invitedReticulumPeerHashes?.size) {
      for (const peer of call.invitedReticulumPeerHashes) peers.add(peer);
    } else {
      peers.add(call.reticulumPeerPresenceHash);
    }
    const wire = encodeCallWire(env);
    if (!wireFitsReticulum(wire)) {
      loggerWarn('[Call] Skipping pinned call send: wire exceeds limit');
      return;
    }
    for (const peer of peers) {
      const normalized = peer.trim().toLowerCase();
      if (normalized) this.sendPinnedCallWireWhenReady(normalized, wire, 0);
    }
  }

  private sendPinnedCallWireWhenReady(
    peerDestinationHash: string,
    wire: Record<string, unknown>,
    attempt: number,
    deadlineAt = Date.now() + CALL_PINNED_SEND_TIMEOUT_MS
  ): void {
    if (!this.started) return;
    if (!this.shouldSendPinnedCallWire(peerDestinationHash, wire)) return;
    const exhausted =
      attempt >= CALL_PINNED_SEND_MAX_ATTEMPTS || Date.now() >= deadlineAt;
    const bridge = this.reticulumBridge;
    if (!bridge || bridge.getState() !== 'ready') {
      if (exhausted) {
        loggerWarn(
          `[Call] Abandoned pinned send after bounded retries type=${String(wire.t ?? 'unknown')} peer=${peerDestinationHash.slice(0, 16)} reason=bridge-not-ready`
        );
        return;
      }
      const timer = setTimeout(
        () =>
          this.sendPinnedCallWireWhenReady(
            peerDestinationHash,
            wire,
            attempt + 1,
            deadlineAt
          ),
        CALL_PINNED_SEND_RETRY_MS
      );
      timer.unref?.();
      return;
    }
    void bridge
      .sendCallDetailed(peerDestinationHash, wire)
      .then((result) => {
        if (result.ok === true) return;
        if (
          attempt >= CALL_PINNED_SEND_MAX_ATTEMPTS ||
          Date.now() >= deadlineAt
        ) {
          loggerWarn(
            `[Call] Abandoned pinned send after bounded retries type=${String(wire.t ?? 'unknown')} peer=${peerDestinationHash.slice(0, 16)} reason=${result.reason}${result.error ? `:${result.error}` : ''}`
          );
          return;
        }
        const timer = setTimeout(
          () =>
            this.sendPinnedCallWireWhenReady(
              peerDestinationHash,
              wire,
              attempt + 1,
              deadlineAt
            ),
          CALL_PINNED_SEND_RETRY_MS
        );
        timer.unref?.();
      })
      .catch(() => {
        if (
          attempt >= CALL_PINNED_SEND_MAX_ATTEMPTS ||
          Date.now() >= deadlineAt
        ) {
          loggerWarn(
            `[Call] Abandoned pinned send after bounded retries type=${String(wire.t ?? 'unknown')} peer=${peerDestinationHash.slice(0, 16)} reason=send-command-failed`
          );
          return;
        }
        const timer = setTimeout(
          () =>
            this.sendPinnedCallWireWhenReady(
              peerDestinationHash,
              wire,
              attempt + 1,
              deadlineAt
            ),
          CALL_PINNED_SEND_RETRY_MS
        );
        timer.unref?.();
      });
  }

  /**
   * RTC fragments may already have a bridge retry scheduled when a call ends
   * or an acknowledgement completes the signal. Revalidate every retry so SDP
   * and ICE material cannot leak past that lifecycle boundary.
   */
  private shouldSendPinnedCallWire(
    peerDestinationHash: string,
    wire: Record<string, unknown>
  ): boolean {
    const type = wire.t;
    if (type === CALL_WIRE_ACCEPT) {
      const callId = typeof wire.c === 'string' ? wire.c : '';
      const call = this.activeCalls.get(callId);
      return Boolean(
        call &&
        call.state === 'active' &&
        call.direction === 'inbound' &&
        call.reticulumPeerPresenceHash.trim().toLowerCase() ===
          peerDestinationHash.trim().toLowerCase()
      );
    }
    if (
      type !== CALL_WIRE_RTC_START &&
      type !== CALL_WIRE_RTC_AUTH &&
      type !== CALL_WIRE_RTC_PART &&
      type !== CALL_WIRE_RTC_ACK &&
      type !== CALL_WIRE_RTC_RESEND
    ) {
      return true;
    }
    const callId = typeof wire.c === 'string' ? wire.c : '';
    const signalId = typeof wire.i === 'string' ? wire.i : '';
    const peer = peerDestinationHash.trim().toLowerCase();
    const call = this.activeCalls.get(callId);
    if (
      !call ||
      call.state !== 'active' ||
      this.getRtcPeerDestinationHash(call) !== peer
    ) {
      return false;
    }
    const signalKey = this.rtcSignalKey(callId, signalId);
    if (
      type === CALL_WIRE_RTC_START ||
      type === CALL_WIRE_RTC_AUTH ||
      type === CALL_WIRE_RTC_PART
    ) {
      return (
        this.rtcOutboundSignals.get(signalKey)?.peerDestinationHash === peer
      );
    }
    return (
      this.rtcInboundSignals.get(signalKey)?.senderDestinationHash === peer
    );
  }

  private cancelOtherRingingEndpoints(call: CallRecord): void {
    if (
      call.direction !== 'outbound' ||
      !call.cancellationSignature ||
      !call.cancellationPublicKey ||
      !Number.isFinite(call.cancellationTimestamp)
    ) {
      return;
    }
    const acceptedPeer = call.acceptedReticulumPeerHash;
    const otherPeers = [...(call.invitedReticulumPeerHashes ?? [])].filter(
      (peer) => peer && peer !== acceptedPeer
    );
    if (otherPeers.length === 0) return;
    const wire = encodeCallWire({
      type: 'CALL_HANGUP',
      callId: call.callId,
      fromPublicKey: call.cancellationPublicKey,
      signature: call.cancellationSignature,
      timestamp: call.cancellationTimestamp!,
    });
    if (!wireFitsReticulum(wire)) return;
    for (const peer of otherPeers) {
      this.sendPinnedCallWireWhenReady(peer, wire, 0);
    }
  }

  private clearControlRepeatTimers(call: CallRecord): void {
    if (!call.controlRepeatTimers) return;
    for (const timer of call.controlRepeatTimers) {
      clearTimeout(timer);
    }
    call.controlRepeatTimers.clear();
  }

  private sendToCallRepeated(
    call: CallRecord,
    env: CallWireEnvelope,
    attempts: number,
    intervalMs: number
  ): void {
    this.clearControlRepeatTimers(call);
    this.sendToCall(call, env);
    const repeatCount = Math.max(0, Math.trunc(attempts) - 1);
    if (repeatCount === 0) return;
    call.controlRepeatTimers = new Set();
    for (let i = 1; i <= repeatCount; i += 1) {
      const timer = setTimeout(() => {
        call.controlRepeatTimers?.delete(timer);
        const latest = this.activeCalls.get(call.callId);
        if (
          !latest ||
          latest !== call ||
          latest.state !== 'active' ||
          latest.direction !== call.direction
        ) {
          return;
        }
        this.sendToCall(latest, env);
      }, intervalMs * i);
      timer.unref?.();
      call.controlRepeatTimers.add(timer);
    }
  }

  private sendEnvelope(targetAddress: string, env: CallWireEnvelope): void {
    void this.sendEnvelopeWhenReady(targetAddress, env, 0);
  }

  private sendEnvelopeWhenReady(
    targetAddress: string,
    env: CallWireEnvelope,
    attempt: number
  ): void {
    if (!this.started) return;
    if (this.reticulumBridge?.getState() !== 'ready') {
      if (attempt >= CALL_SEND_MAX_ATTEMPTS) {
        loggerWarn(
          '[Call] Abandoned send after retries: Reticulum transport unavailable'
        );
        return;
      }
      setTimeout(() => {
        this.sendEnvelopeWhenReady(targetAddress, env, attempt + 1);
      }, CALL_SEND_RETRY_MS);
      return;
    }
    const overlayWire = this.attachReticulumOverlayMeta(
      encodeCallWire(env),
      targetAddress,
      CALL_MAX_HOPS
    );
    if (!wireFitsReticulum(overlayWire)) {
      loggerWarn('[Call] Skipping Reticulum call send: wire exceeds limit');
      return;
    }
    this.broadcastReticulumOverlayWire(overlayWire);
  }

  private nextReticulumOverlayId(): string {
    return randomBytes(8).toString('hex');
  }

  private attachReticulumOverlayMeta(
    wire: Record<string, unknown>,
    targetAddress: string,
    hopsRemaining: number
  ): Record<string, unknown> {
    return {
      ...wire,
      U: targetAddress,
      L: Math.max(0, Math.trunc(hopsRemaining)),
      X: this.nextReticulumOverlayId(),
    };
  }

  private parseReticulumOverlayMeta(wire: Record<string, unknown>): {
    overlayId: string;
    targetAddress: string;
    hopsRemaining: number;
  } | null {
    if (
      typeof wire.X !== 'string' ||
      typeof wire.U !== 'string' ||
      typeof wire.L !== 'number'
    ) {
      return null;
    }
    return {
      overlayId: wire.X,
      targetAddress: wire.U,
      hopsRemaining: Math.max(0, Math.trunc(wire.L)),
    };
  }

  private rememberReticulumOverlayId(overlayId: string): void {
    const now = Date.now();
    this.seenReticulumOverlayIds.set(
      overlayId,
      now + RETICULUM_OVERLAY_SEEN_TTL_MS
    );
    for (const [id, expiresAt] of this.seenReticulumOverlayIds) {
      if (expiresAt <= now) this.seenReticulumOverlayIds.delete(id);
    }
  }

  private hasSeenReticulumOverlayId(overlayId: string): boolean {
    const now = Date.now();
    const expiresAt = this.seenReticulumOverlayIds.get(overlayId);
    if (typeof expiresAt !== 'number') return false;
    if (expiresAt <= now) {
      this.seenReticulumOverlayIds.delete(overlayId);
      return false;
    }
    return true;
  }

  private broadcastReticulumOverlayWire(
    wire: Record<string, unknown>,
    excludePeerHashes: string[] = []
  ): void {
    const bridge = this.reticulumBridge;
    if (!bridge || bridge.getState() !== 'ready') return;
    void bridge.fanoutCallDetailed([wire], excludePeerHashes).catch(() => {});
  }
}

let callManager: CallManager | null = null;

export function getCallManager(): CallManager | null {
  return callManager;
}

export function startCallManager(
  presence: PresenceManager,
  reticulumBridge?: ReticulumBridge | null
): CallManager {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
  callManager = new CallManager(presence, reticulumBridge ?? null);
  callManager.start();
  if (retainedCallLocalAddresses.length > 0) {
    callManager.setLocalAddresses(retainedCallLocalAddresses);
    loggerLog(
      `[Call] Restored ${retainedCallLocalAddresses.length} local address(es) after manager start.`
    );
  }
  return callManager;
}

export function stopCallManager(): void {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
}
