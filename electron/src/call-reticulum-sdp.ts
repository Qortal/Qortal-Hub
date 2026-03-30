/**
 * Reticulum SDP fragmentation: inbound reassembly + outbound resend / CK handling.
 */

import { log as loggerLog } from './logger';
import type { Cs0Meta } from './call-wire-reticulum';
import {
  RT_CS0_REPEAT_DELAY_MS,
  RT_SDP_MAX_CONCURRENT_BUFFERS,
  RT_SDP_MAX_RECOVERY_ROUNDS,
  RT_SDP_MAX_TOTAL_BUFFER_BYTES,
  RT_SDP_RESEND_WAIT_MS,
  buildCkAck,
  buildCkResend,
  reassembleSdpFromParts,
  sha256HexUtf8,
} from './call-wire-reticulum';

export interface ReticulumSdpCallbacks {
  sendWire: (peerPresenceHash: string, msg: Record<string, unknown>) => void;
  onReassembled: (args: {
    callId: string;
    wireType: 'CALL_OFFER' | 'CALL_ANSWER';
    sdp: string;
    sdpHash: string;
    fromPublicKey: string;
    signature: string;
    timestamp: number;
  }) => void;
  onInboundFailed: (callId: string, reason: string) => void;
  getPeerPresenceHashForAddress: (address: string) => string | null;
  isCallActiveForSdp: (callId: string) => boolean;
}

interface InboundBuf {
  meta: Cs0Meta;
  senderCallHash: string;
  parts: Map<number, string>;
  bytesBuffered: number;
  timer: ReturnType<typeof setTimeout> | null;
  recoveryCycles: number;
  completed: boolean;
}

interface OutboundBuf {
  peerPresenceHash: string;
  callId: string;
  dir: 'o' | 'a';
  z: string;
  cs0: Record<string, unknown>;
  cs1List: Record<string, unknown>[];
  completed: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

function inboundKey(
  senderCallHash: string,
  callId: string,
  dir: 'o' | 'a',
  z: string
): string {
  return `${senderCallHash}|${callId}|${dir}|${z}`;
}

export class ReticulumSdpSession {
  private inbound = new Map<string, InboundBuf>();
  private inboundBytesTotal = 0;
  private outbound = new Map<string, OutboundBuf>();

  constructor(private readonly cb: ReticulumSdpCallbacks) {}

  disposeAll(): void {
    for (const b of this.inbound.values()) {
      if (b.timer) clearTimeout(b.timer);
    }
    this.inbound.clear();
    this.inboundBytesTotal = 0;
    for (const o of this.outbound.values()) {
      for (const t of o.timers) clearTimeout(t);
    }
    this.outbound.clear();
  }

  disposeCall(callId: string): void {
    for (const [k, b] of [...this.inbound.entries()]) {
      if (b.meta.callId === callId) {
        if (b.timer) clearTimeout(b.timer);
        this.inboundBytesTotal -= b.bytesBuffered;
        this.inbound.delete(k);
      }
    }
    for (const [k, o] of [...this.outbound.entries()]) {
      if (o.callId === callId) {
        for (const t of o.timers) clearTimeout(t);
        this.outbound.delete(k);
      }
    }
  }

  onCs0(meta: Cs0Meta, senderCallHash: string): void {
    if (!senderCallHash || !this.cb.isCallActiveForSdp(meta.callId)) {
      return;
    }
    if (this.inbound.size >= RT_SDP_MAX_CONCURRENT_BUFFERS) {
      loggerLog('[Call/RT] Inbound SDP buffer cap');
      return;
    }
    const key = inboundKey(senderCallHash, meta.callId, meta.dir, meta.z);
    if (this.inbound.has(key)) return;

    const buf: InboundBuf = {
      meta,
      senderCallHash,
      parts: new Map(),
      bytesBuffered: 0,
      timer: null,
      recoveryCycles: 0,
      completed: false,
    };
    this.inbound.set(key, buf);
    this.scheduleInboundTimer(key);
  }

  onCs1(
    callId: string,
    dir: 'o' | 'a',
    z: string,
    x: number,
    n: number,
    p: string,
    senderCallHash: string
  ): void {
    const key = inboundKey(senderCallHash, callId, dir, z.toLowerCase());
    const buf = this.inbound.get(key);
    if (!buf || buf.completed) return;
    if (n !== buf.meta.n || x < 0 || x >= n) return;
    if (buf.parts.has(x)) return;

    const partBytes = Buffer.byteLength(p, 'utf8');
    if (this.inboundBytesTotal + partBytes > RT_SDP_MAX_TOTAL_BUFFER_BYTES) {
      this.failInbound(key, 'buffer budget');
      return;
    }
    buf.parts.set(x, p);
    buf.bytesBuffered += partBytes;
    this.inboundBytesTotal += partBytes;
    this.resetInboundTimer(key);
    this.tryCompleteInbound(key);
  }

  onCkFromPeer(
    ck:
      | { mode: 'ack'; callId: string; dir: 'o' | 'a'; z: string }
      | {
          mode: 'resend';
          callId: string;
          dir: 'o' | 'a';
          z: string;
          indexes: number[];
        },
    _senderCallHash: string
  ): void {
    const z = ck.z.toLowerCase();
    const okey = `${ck.callId}|${ck.dir}|${z}`;
    const ob = this.outbound.get(okey);
    if (!ob || ob.completed) return;

    if (ck.mode === 'ack') {
      ob.completed = true;
      for (const t of ob.timers) clearTimeout(t);
      ob.timers = [];
      this.outbound.delete(okey);
      return;
    }

    const want = new Set(ck.indexes);
    for (const idx of want) {
      if (idx >= 0 && idx < ob.cs1List.length) {
        this.cb.sendWire(ob.peerPresenceHash, ob.cs1List[idx]!);
      }
    }
  }

  startOutbound(args: {
    peerPresenceHash: string;
    callId: string;
    dir: 'o' | 'a';
    z: string;
    cs0: Record<string, unknown>;
    cs1List: Record<string, unknown>[];
  }): void {
    const z = args.z.toLowerCase();
    const okey = `${args.callId}|${args.dir}|${z}`;
    if (this.outbound.has(okey)) return;

    const ob: OutboundBuf = {
      peerPresenceHash: args.peerPresenceHash,
      callId: args.callId,
      dir: args.dir,
      z,
      cs0: args.cs0,
      cs1List: args.cs1List,
      completed: false,
      timers: [],
    };
    this.outbound.set(okey, ob);

    this.cb.sendWire(args.peerPresenceHash, args.cs0);
    for (const part of args.cs1List) {
      this.cb.sendWire(args.peerPresenceHash, part);
    }

    const tRepeat = setTimeout(() => {
      const cur = this.outbound.get(okey);
      if (!cur || cur.completed) return;
      this.cb.sendWire(cur.peerPresenceHash, cur.cs0);
    }, RT_CS0_REPEAT_DELAY_MS);
    ob.timers.push(tRepeat);
  }

  private scheduleInboundTimer(key: string): void {
    const buf = this.inbound.get(key);
    if (!buf || buf.completed) return;
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => this.onInboundTimer(key), RT_SDP_RESEND_WAIT_MS);
    buf.timer.unref?.();
  }

  private resetInboundTimer(key: string): void {
    this.scheduleInboundTimer(key);
  }

  private onInboundTimer(key: string): void {
    const buf = this.inbound.get(key);
    if (!buf || buf.completed) return;
    if (buf.parts.size >= buf.meta.n) {
      this.tryCompleteInbound(key);
      return;
    }

    const peer = this.cb.getPeerPresenceHashForAddress(
      this.inferRemoteAddress(buf.meta.callId)
    );
    if (!peer) {
      this.failInbound(key, 'no peer route for CK');
      return;
    }

    const missing: number[] = [];
    for (let i = 0; i < buf.meta.n; i++) {
      if (!buf.parts.has(i)) missing.push(i);
    }

    buf.recoveryCycles += 1;
    if (buf.recoveryCycles > RT_SDP_MAX_RECOVERY_ROUNDS) {
      this.failInbound(key, 'recovery limit');
      return;
    }

    this.cb.sendWire(
      peer,
      buildCkResend(buf.meta.callId, buf.meta.dir, buf.meta.z, missing)
    );
    this.scheduleInboundTimer(key);
  }

  /** Remote address for presence lookup — supplied by CallManager via closure hack; use callId map. */
  private remoteAddressByCallId = new Map<string, string>();

  registerCallRemoteAddress(callId: string, remoteAddress: string): void {
    this.remoteAddressByCallId.set(callId, remoteAddress);
  }

  unregisterCallRemoteAddress(callId: string): void {
    this.remoteAddressByCallId.delete(callId);
  }

  private inferRemoteAddress(callId: string): string {
    return this.remoteAddressByCallId.get(callId) ?? '';
  }

  private tryCompleteInbound(key: string): void {
    const buf = this.inbound.get(key);
    if (!buf || buf.completed) return;
    if (buf.parts.size < buf.meta.n) return;

    const sdp = reassembleSdpFromParts(buf.meta.n, buf.parts);
    if (!sdp) {
      this.failInbound(key, 'reassembly');
      return;
    }
    const h = sha256HexUtf8(sdp);
    if (h.toLowerCase() !== buf.meta.z.toLowerCase()) {
      this.failInbound(key, 'hash mismatch');
      return;
    }

    buf.completed = true;
    if (buf.timer) clearTimeout(buf.timer);
    this.inboundBytesTotal -= buf.bytesBuffered;
    this.inbound.delete(key);

    const wireType = buf.meta.dir === 'o' ? 'CALL_OFFER' : 'CALL_ANSWER';
    this.cb.onReassembled({
      callId: buf.meta.callId,
      wireType,
      sdp,
      sdpHash: buf.meta.z,
      fromPublicKey: buf.meta.k,
      signature: buf.meta.g,
      timestamp: buf.meta.m,
    });

    const peer = this.cb.getPeerPresenceHashForAddress(
      this.inferRemoteAddress(buf.meta.callId)
    );
    if (peer) {
      this.cb.sendWire(peer, buildCkAck(buf.meta.callId, buf.meta.dir, buf.meta.z));
    }
  }

  private failInbound(key: string, reason: string): void {
    const buf = this.inbound.get(key);
    if (!buf) return;
    if (buf.timer) clearTimeout(buf.timer);
    this.inboundBytesTotal -= buf.bytesBuffered;
    this.inbound.delete(key);
    loggerLog(`[Call/RT] Inbound SDP failed ${buf.meta.callId}: ${reason}`);
    this.cb.onInboundFailed(buf.meta.callId, reason);
  }
}

export function allowIceReticulum(
  buckets: Map<string, { windowStart: number; count: number }>,
  callId: string,
  maxPerSec: number
): boolean {
  const now = Date.now();
  const b = buckets.get(callId);
  if (!b || now - b.windowStart >= 1000) {
    buckets.set(callId, { windowStart: now, count: 1 });
    return true;
  }
  if (b.count >= maxPerSec) return false;
  b.count += 1;
  return true;
}
