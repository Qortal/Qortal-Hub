/**
 * Direct 1:1 call signaling over Reticulum only.
 *
 * This module handles only setup / teardown signaling:
 *   - CALL_REQUEST / CALL_ACCEPT / CALL_REJECT
 *   - CALL_HANGUP
 *
 * Direct-call media is sent separately via the Reticulum group-call path.
 */

import { EventEmitter } from 'events';
import { log as loggerLog, error as loggerError, warn as loggerWarn } from './logger';
import { wireFitsReticulum } from './reticulum-wire-size';
import { deriveAddressFromPublicKey } from './presence';
import { VerifyWorkerPool } from './verify-worker-pool';
import type { PresenceManager } from './presence';
import type { ReticulumBridge } from './reticulum-bridge';

const CALL_MAX_HOPS = 4;
const CALL_REQUEST_TTL_MS = 60_000;
const RETICULUM_OVERLAY_SEEN_TTL_MS = 60_000;
const CALL_VERIFY_WORKER_COUNT = 2;
const CALL_MAX_PENDING_VERIFY = 512;
const CALL_WIRE_REQUEST = 'CR';
const CALL_WIRE_ACCEPT = 'CA';
const CALL_WIRE_REJECT = 'CX';
const CALL_WIRE_HANGUP = 'CH';

/** If the bridge is briefly not `ready`, retry before dropping (bursty GC / transport flaps). */
const CALL_SEND_MAX_ATTEMPTS = 40;
const CALL_SEND_RETRY_MS = 50;
const CALL_ACCEPT_REPEAT_ATTEMPTS = 5;
const CALL_ACCEPT_REPEAT_MS = 350;

export type CallNetworkType =
  | 'CALL_REQUEST'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_HANGUP';

export const CALL_MESSAGE_TYPES = new Set<string>([
  'CALL_REQUEST',
  'CALL_ACCEPT',
  'CALL_REJECT',
  'CALL_HANGUP',
]);

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
      };
    case 'CALL_HANGUP':
      return {
        t: CALL_WIRE_HANGUP,
        c: env.callId,
        k: env.fromPublicKey,
        g: env.signature,
        m: env.timestamp,
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
      return {
        type: 'CALL_REQUEST',
        callId: wire.c,
        fromAddress: wire.a,
        fromPublicKey: wire.k,
        chatId,
        signature: wire.g,
        timestamp: wire.m,
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
  hopsRemaining?: number;
}

export interface CallAcceptEnvelope {
  type: 'CALL_ACCEPT';
  callId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallRejectEnvelope {
  type: 'CALL_REJECT';
  callId: string;
  reason?: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface CallHangupEnvelope {
  type: 'CALL_HANGUP';
  callId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export type CallWireEnvelope =
  | CallRequestEnvelope
  | CallAcceptEnvelope
  | CallRejectEnvelope
  | CallHangupEnvelope;

export type CallDirection = 'outbound' | 'inbound';
export type CallState = 'pending' | 'active' | 'ended';

interface CallRecord {
  callId: string;
  localAddress: string;
  remoteAddress: string;
  reticulumPeerPresenceHash: string;
  chatId: string;
  direction: CallDirection;
  state: CallState;
  startedAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  controlRepeatTimers?: Set<ReturnType<typeof setTimeout>>;
}

/**
 * Events emitted (forwarded to the renderer via IPC):
 *   'call:incoming'  { callId, fromAddress, chatId }
 *   'call:accepted'  { callId }
 *   'call:rejected'  { callId, reason? }
 *   'call:hangup'    { callId }
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

  constructor(
    presence: PresenceManager,
    reticulumBridge?: ReticulumBridge | null
  ) {
    super();
    this.presence = presence;
    this.reticulumBridge = reticulumBridge ?? null;
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
      this.clearControlRepeatTimers(call);
    }
    this.activeCalls.clear();
    this.seenReticulumOverlayIds.clear();
    this.pendingVerifiedIncomingWhenNoLocal = [];
    loggerLog('[Call] Manager stopped.');
  }

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
    this.flushPendingVerifiedIncomingRequests();
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

  private enqueuePendingVerifiedIncomingRequest(
    env: CallRequestEnvelope,
    senderDestinationHash: string
  ): void {
    const now = Date.now();
    const cutoff = now - CALL_REQUEST_TTL_MS;
    this.pendingVerifiedIncomingWhenNoLocal =
      this.pendingVerifiedIncomingWhenNoLocal.filter(
        (p) =>
          p.receivedAt >= cutoff &&
          p.env.callId !== env.callId
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

    const route = this.presence.getRouteForAddress(targetAddress);
    if (
      route?.kind !== 'reticulum' ||
      this.reticulumBridge?.getState() !== 'ready'
    ) {
      loggerLog(`[Call] No Reticulum route to ${targetAddress}`);
      return null;
    }

    const record: CallRecord = {
      callId,
      localAddress,
      remoteAddress: targetAddress,
      reticulumPeerPresenceHash: route.destinationHash,
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
  ): void {
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
    this.sendToCallRepeated(
      call,
      env,
      CALL_ACCEPT_REPEAT_ATTEMPTS,
      CALL_ACCEPT_REPEAT_MS
    );
    loggerLog(`[Call] Accepted call ${callId.slice(0, 8)}…`);
  }

  rejectCall(
    callId: string,
    reason?: string,
    signature?: string,
    publicKey?: string,
    timestamp?: number
  ): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    this.clearControlRepeatTimers(call);
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

  hangUp(
    callId: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    const call = this.activeCalls.get(callId);
    if (!call) return;
    if (call.cleanupTimer) clearTimeout(call.cleanupTimer);
    this.clearControlRepeatTimers(call);
    call.state = 'ended';
    this.activeCalls.delete(callId);

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

    const presenceRoute = this.presence.getRouteForAddress(env.fromAddress);
    const retHash =
      presenceRoute?.kind === 'reticulum'
        ? presenceRoute.destinationHash
        : ctx.senderDestinationHash;

    const record: CallRecord = {
      callId: env.callId,
      localAddress: localRecipient,
      remoteAddress: env.fromAddress,
      reticulumPeerPresenceHash: retHash,
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

    loggerLog(
      `[Call] Incoming call ${env.callId.slice(0, 8)}… from ${env.fromAddress} (reticulum)`
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
        this.clearControlRepeatTimers(c);
        c.state = 'ended';
        this.activeCalls.delete(env.callId);
        this.emit('call:rejected', { callId: env.callId, reason: env.reason });
        loggerLog(`[Call] Call ${env.callId.slice(0, 8)}… rejected.`);
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
        this.clearControlRepeatTimers(c);
        c.state = 'ended';
        this.activeCalls.delete(env.callId);
        this.emit('call:hangup', { callId: env.callId });
        loggerLog(`[Call] Remote hung up call ${env.callId.slice(0, 8)}…`);
      });
  }

  private onReticulumCallWire(
    wire: Record<string, unknown>,
    senderDestinationHash: string,
    peerPresenceHash: string
  ): void {
    const overlayMeta = this.parseReticulumOverlayMeta(wire);
    if (overlayMeta) {
      if (this.hasSeenReticulumOverlayId(overlayMeta.overlayId)) return;
      this.rememberReticulumOverlayId(overlayMeta.overlayId);
      const targetIsLocal = this.localAddresses.has(overlayMeta.targetAddress);
      if (!targetIsLocal) {
        if (overlayMeta.hopsRemaining > 0) {
          const forwarded = {
            ...wire,
            L: overlayMeta.hopsRemaining - 1,
          };
          this.broadcastReticulumOverlayWire(forwarded, [peerPresenceHash]);
        }
        if (this.localAddresses.size > 0) {
          return;
        }
        loggerLog(
          `[Call] Processing call wire while local addresses are not registered yet target=${overlayMeta.targetAddress.slice(0, 8)}…`
        );
      }
    }

    const env = this.parseCallEnvelope(wire);
    if (!env) return;

    if (env.type === 'CALL_REQUEST') {
      this.handleRequestReticulum(senderDestinationHash, env);
      return;
    }

    switch (env.type) {
      case 'CALL_ACCEPT':
        this.handleAccept(env);
        break;
      case 'CALL_REJECT':
        this.handleReject(env);
        break;
      case 'CALL_HANGUP':
        this.handleHangup(env);
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
        if (this.localAddresses.size === 0) {
          this.enqueuePendingVerifiedIncomingRequest(env, senderDestinationHash);
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
    this.sendEnvelope(call.remoteAddress, env);
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

  private sendEnvelope(
    targetAddress: string,
    env: CallWireEnvelope
  ): void {
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
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

  private parseReticulumOverlayMeta(
    wire: Record<string, unknown>
  ): { overlayId: string; targetAddress: string; hopsRemaining: number } | null {
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
  return callManager;
}

export function stopCallManager(): void {
  if (callManager) {
    callManager.stop();
    callManager = null;
  }
}
