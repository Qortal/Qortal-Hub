/**
 * Reticulum compact call signaling wire format (v1).
 * SDP CS0/CS1 uses the same per-packet budget as group-call wire (see reticulum-wire-size.ts).
 */

import * as nodeCrypto from 'crypto';
import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSender,
} from './reticulum-wire-size';
import type {
  CallAcceptEnvelope,
  CallHangupEnvelope,
  CallIceEnvelope,
  CallRejectEnvelope,
  CallRequestEnvelope,
  CallWireEnvelope,
} from './call';

/** Same budget as `send_call` / `send_group_call` after Python injects `r`. */
export const RT_CALL_MAX_JSON_BYTES = RT_RETICULUM_MAX_WIRE_JSON_BYTES;

/** Max SDP fragment count (defensive). */
export const RT_SDP_MAX_FRAGMENTS = 128;

/** Wait before first CK.w with missing indexes. */
export const RT_SDP_RESEND_WAIT_MS = 300;

/** Max receiver-driven recovery cycles (CK.w rounds). */
export const RT_SDP_MAX_RECOVERY_ROUNDS = 2;

/** Sender may repeat CS0 once after this delay if no CK a:1. */
export const RT_CS0_REPEAT_DELAY_MS = 150;

/** ICE candidates per second per call (send and receive). */
export const RT_ICE_MAX_PER_SEC = 15;

/** Total time to wait for a Reticulum presence route before giving up on outbound CR. */
export const RT_CALL_ROUTE_WINDOW_MS = 4000;

/** Poll interval while waiting for route. */
export const RT_CALL_ROUTE_POLL_MS = 500;

/** Max concurrent inbound SDP reassembly buffers (global). */
export const RT_SDP_MAX_CONCURRENT_BUFFERS = 16;

/** Max buffered bytes across all inbound SDP fragments. */
export const RT_SDP_MAX_TOTAL_BUFFER_BYTES = 512 * 1024;

export type ReticulumCallWireType =
  | 'CR'
  | 'CA'
  | 'CJ'
  | 'CH'
  | 'CI'
  | 'CS0'
  | 'CS1'
  | 'CK';

export function sha256HexUtf8(sdp: string): string {
  return nodeCrypto.createHash('sha256').update(sdp, 'utf8').digest('hex');
}

function isHex64(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}

/** Encode full call envelopes to compact wire (Python adds sender `r`). */
export function encodeReticulumCallWire(
  env: CallWireEnvelope
): Record<string, unknown> | null {
  switch (env.type) {
    case 'CALL_REQUEST':
      return {
        t: 'CR',
        i: env.callId,
        a: env.fromAddress,
        k: env.fromPublicKey,
        h: env.chatId,
        m: env.timestamp,
        g: env.signature,
      };
    case 'CALL_ACCEPT':
      return {
        t: 'CA',
        i: env.callId,
        k: env.fromPublicKey,
        m: env.timestamp,
        g: env.signature,
      };
    case 'CALL_REJECT':
      // Wire key `r` collides with Python-injected sender hash in presence_bridge — separate fix.
      return {
        t: 'CJ',
        i: env.callId,
        k: env.fromPublicKey,
        m: env.timestamp,
        g: env.signature,
        ...(env.reason != null && env.reason !== ''
          ? { r: env.reason }
          : {}),
      };
    case 'CALL_HANGUP':
      return {
        t: 'CH',
        i: env.callId,
        k: env.fromPublicKey,
        m: env.timestamp,
        g: env.signature,
      };
    case 'CALL_ICE':
      return {
        t: 'CI',
        i: env.callId,
        c: env.candidate,
      };
    case 'CALL_AUDIO':
      // Tier-3 audio stays on mesh; not used on Reticulum wire v1.
      return null;
    default:
      return null;
  }
}

export type DecodedCallEnvelope =
  | { kind: 'envelope'; envelope: CallWireEnvelope }
  | { kind: 'sdp_meta'; meta: Cs0Meta }
  | { kind: 'sdp_part'; part: Cs1Part }
  | { kind: 'ck'; ck: CkPayload }
  | { kind: 'invalid' };

export interface Cs0Meta {
  callId: string;
  dir: 'o' | 'a';
  n: number;
  z: string;
  k: string;
  m: number;
  g: string;
  f?: number;
}

export interface Cs1Part {
  callId: string;
  dir: 'o' | 'a';
  x: number;
  n: number;
  z: string;
  p: string;
}

export type CkPayload =
  | { mode: 'ack'; callId: string; dir: 'o' | 'a'; z: string }
  | {
      mode: 'resend';
      callId: string;
      dir: 'o' | 'a';
      z: string;
      indexes: number[];
    };

export function decodeReticulumCallWire(
  raw: Record<string, unknown>
): DecodedCallEnvelope {
  const t = raw.t;
  if (t === 'CS0') {
    const i = raw.i;
    const d = raw.d;
    const n = raw.n;
    const z = raw.z;
    const k = raw.k;
    const m = raw.m;
    const g = raw.g;
    if (
      typeof i !== 'string' ||
      (d !== 'o' && d !== 'a') ||
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > RT_SDP_MAX_FRAGMENTS ||
      !isHex64(z) ||
      typeof k !== 'string' ||
      typeof m !== 'number' ||
      typeof g !== 'string'
    ) {
      return { kind: 'invalid' };
    }
    const f = raw.f;
    return {
      kind: 'sdp_meta',
      meta: {
        callId: i,
        dir: d,
        n,
        z: z.toLowerCase(),
        k,
        m,
        g,
        ...(typeof f === 'number' && Number.isInteger(f) && f >= 0
          ? { f }
          : {}),
      },
    };
  }
  if (t === 'CS1') {
    const i = raw.i;
    const d = raw.d;
    const x = raw.x;
    const n = raw.n;
    const z = raw.z;
    const p = raw.p;
    if (
      typeof i !== 'string' ||
      (d !== 'o' && d !== 'a') ||
      typeof x !== 'number' ||
      !Number.isInteger(x) ||
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      !isHex64(z) ||
      typeof p !== 'string'
    ) {
      return { kind: 'invalid' };
    }
    return {
      kind: 'sdp_part',
      part: {
        callId: i,
        dir: d,
        x,
        n,
        z: z.toLowerCase(),
        p,
      },
    };
  }
  if (t === 'CK') {
    const i = raw.i;
    const d = raw.d;
    const z = raw.z;
    if (
      typeof i !== 'string' ||
      (d !== 'o' && d !== 'a') ||
      !isHex64(z)
    ) {
      return { kind: 'invalid' };
    }
    const a = raw.a;
    const w = raw.w;
    const zNorm = z.toLowerCase();
    if (a === 1 && (w === undefined || w === null)) {
      return {
        kind: 'ck',
        ck: { mode: 'ack', callId: i, dir: d, z: zNorm },
      };
    }
    if (Array.isArray(w) && a === undefined) {
      const indexes: number[] = [];
      for (const v of w) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          return { kind: 'invalid' };
        }
        indexes.push(v);
      }
      return {
        kind: 'ck',
        ck: {
          mode: 'resend',
          callId: i,
          dir: d,
          z: zNorm,
          indexes,
        },
      };
    }
    return { kind: 'invalid' };
  }

  if (t === 'CR') {
    const env = parseCr(raw);
    return env ? { kind: 'envelope', envelope: env } : { kind: 'invalid' };
  }
  if (t === 'CA') {
    const env = parseCa(raw);
    return env ? { kind: 'envelope', envelope: env } : { kind: 'invalid' };
  }
  if (t === 'CJ') {
    const env = parseCj(raw);
    return env ? { kind: 'envelope', envelope: env } : { kind: 'invalid' };
  }
  if (t === 'CH') {
    const env = parseCh(raw);
    return env ? { kind: 'envelope', envelope: env } : { kind: 'invalid' };
  }
  if (t === 'CI') {
    const env = parseCi(raw);
    return env ? { kind: 'envelope', envelope: env } : { kind: 'invalid' };
  }

  return { kind: 'invalid' };
}

function parseCr(raw: Record<string, unknown>): CallRequestEnvelope | null {
  if (
    typeof raw.i !== 'string' ||
    typeof raw.a !== 'string' ||
    typeof raw.k !== 'string' ||
    typeof raw.h !== 'string' ||
    typeof raw.m !== 'number' ||
    typeof raw.g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'CALL_REQUEST',
    callId: raw.i,
    fromAddress: raw.a,
    fromPublicKey: raw.k,
    chatId: raw.h,
    timestamp: raw.m,
    signature: raw.g,
  };
}

function parseCa(raw: Record<string, unknown>): CallAcceptEnvelope | null {
  if (
    typeof raw.i !== 'string' ||
    typeof raw.k !== 'string' ||
    typeof raw.m !== 'number' ||
    typeof raw.g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'CALL_ACCEPT',
    callId: raw.i,
    fromPublicKey: raw.k,
    timestamp: raw.m,
    signature: raw.g,
  };
}

function parseCj(raw: Record<string, unknown>): CallRejectEnvelope | null {
  if (
    typeof raw.i !== 'string' ||
    typeof raw.k !== 'string' ||
    typeof raw.m !== 'number' ||
    typeof raw.g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'CALL_REJECT',
    callId: raw.i,
    fromPublicKey: raw.k,
    timestamp: raw.m,
    signature: raw.g,
    ...(typeof raw.r === 'string' ? { reason: raw.r } : {}),
  };
}

function parseCh(raw: Record<string, unknown>): CallHangupEnvelope | null {
  if (
    typeof raw.i !== 'string' ||
    typeof raw.k !== 'string' ||
    typeof raw.m !== 'number' ||
    typeof raw.g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'CALL_HANGUP',
    callId: raw.i,
    fromPublicKey: raw.k,
    timestamp: raw.m,
    signature: raw.g,
  };
}

function parseCi(raw: Record<string, unknown>): CallIceEnvelope | null {
  if (typeof raw.i !== 'string' || !('c' in raw)) return null;
  return {
    type: 'CALL_ICE',
    callId: raw.i,
    candidate: raw.c as Record<string, unknown> | null,
  };
}

export interface BuiltSdpWire {
  cs0: Record<string, unknown>;
  cs1List: Record<string, unknown>[];
}

/**
 * Split SDP into CS0 + CS1 frames that each fit within RT_RETICULUM_MAX_WIRE_JSON_BYTES (with bridge `r`).
 */
export function buildSdpWireFrames(
  callId: string,
  dir: 'o' | 'a',
  sdp: string,
  sdpHash: string,
  fromPublicKey: string,
  timestamp: number,
  signature: string
): BuiltSdpWire | null {
  const z = sdpHash.toLowerCase();
  if (!isHex64(z)) return null;

  const utf8 = Buffer.from(sdp, 'utf8');
  const f = utf8.length;

  const cs0Base: Record<string, unknown> = {
    t: 'CS0',
    i: callId,
    d: dir,
    n: 0,
    z,
    k: fromPublicKey,
    m: timestamp,
    g: signature,
    f,
  };

  let chunkSize = 120;
  let cs1List: Record<string, unknown>[] = [];
  let n = 0;

  for (let attempt = 0; attempt < 40; attempt++) {
    cs1List = [];
    n = 0;
    for (let off = 0; off < utf8.length; off += chunkSize) {
      const slice = utf8.subarray(off, off + chunkSize);
      const p = slice.toString('base64');
      cs1List.push({
        t: 'CS1',
        i: callId,
        d: dir,
        x: n,
        n: 0,
        z,
        p,
      });
      n++;
      if (n > RT_SDP_MAX_FRAGMENTS) break;
    }
    if (n > RT_SDP_MAX_FRAGMENTS) {
      chunkSize = Math.floor(chunkSize * 0.75);
      continue;
    }
    const cs0: Record<string, unknown> = { ...cs0Base, n };
    for (let i = 0; i < cs1List.length; i++) {
      (cs1List[i] as Record<string, unknown>).n = n;
    }
    const maxLen = Math.max(
      byteLengthUtf8JsonWithBridgeSender(cs0),
      ...cs1List.map((o) => byteLengthUtf8JsonWithBridgeSender(o))
    );
    if (maxLen <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
      return { cs0, cs1List };
    }
    chunkSize = Math.floor(chunkSize * 0.85);
    if (chunkSize < 32) return null;
  }
  return null;
}

export function buildCkAck(
  callId: string,
  dir: 'o' | 'a',
  z: string
): Record<string, unknown> {
  return {
    t: 'CK',
    i: callId,
    d: dir,
    z: z.toLowerCase(),
    a: 1,
  };
}

export function buildCkResend(
  callId: string,
  dir: 'o' | 'a',
  z: string,
  indexes: number[]
): Record<string, unknown> {
  return {
    t: 'CK',
    i: callId,
    d: dir,
    z: z.toLowerCase(),
    w: indexes,
  };
}

export function reassembleSdpFromParts(
  n: number,
  parts: Map<number, string>
): string | null {
  const chunks: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const b64 = parts.get(i);
    if (!b64) return null;
    try {
      chunks.push(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}
