/**
 * Compact Reticulum wire for group-call control messages.
 * Per-packet JSON budget: [reticulum-wire-size.ts](reticulum-wire-size.ts); fragmentation for large topology / keys.
 * Root `GC_TOPOLOGY` heartbeats are sent from the renderer at `TOPOLOGY_HEARTBEAT_MS` in `useGroupVoiceCall.ts`
 * (each tick may emit `GT` or many `GT0`/`GT1` fragments, then overlay fanout) — keep that interval moderate.
 */

import * as nodeCrypto from 'crypto';

import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSender,
} from './reticulum-wire-size';

/** Mirrors `ClusterDef` in group-call.ts (avoid circular import). */
export interface WireClusterDef {
  members: string[];
  forwarder: string;
  standby: string;
  standby2: string;
}

/** Alias for shared budget ([reticulum-wire-size.ts](reticulum-wire-size.ts)). */
export const RT_GCALL_MAX_WIRE_JSON_BYTES = RT_RETICULUM_MAX_WIRE_JSON_BYTES;

/**
 * Bump when Reticulum group-call wire encoding changes; grep logs for this string to confirm rebuild.
 * Keep in sync with `PRESENCE_BRIDGE_BUILD` in `electron/resources/presence_bridge.py`.
 */
export const GC_RETICULUM_WIRE_BUILD_MARKER = 'wire383-gj-gi-split-rk-v1';

/** Max payload fragments for topology / key-rotate / SDP (defensive). */
export const RT_GCALL_MAX_FRAGMENTS = 96;

function sha256HexUtf8(s: string): string {
  return nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function byteLengthUtf8Json(obj: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

export { byteLengthUtf8JsonWithBridgeSender };

/** 64 hex chars (e.g. SHA-256 digest) — used for fragment `z` fields, not RNS addresses. */
export function isHex64(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}

/** Reticulum/RNS destination address: 16 bytes, 32 hex chars (see Reticulum manual). */
export function isRnsDestinationHashHex(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{32}$/i.test(s);
}

/** RNS.Identity full public key: 64 bytes, standard or unpadded base64 (wire key `rk`). */
export function isRnsIdentityPublicKeyBase64(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 86 || s.length > 88) {
    return false;
  }
  try {
    const buf = Buffer.from(s, 'base64');
    return buf.length === 64;
  } catch {
    return false;
  }
}

/**
 * Strip base64 padding for wire (saves bytes); decoders must accept unpadded.
 * `GC_JOIN_RK` signatures must sign this same string (see
 * `normalizeRkBase64ForGcJoinRkSign` in useGroupVoiceCall.ts).
 */
export function normalizeRkBase64ForWire(rk: string): string {
  return rk.replace(/=+$/u, '');
}

/** Wire types routed to `group_call_message` in presence_bridge.py */
export const GROUP_CALL_RETICULUM_WIRE_TYPES = new Set<string>([
  'GA',
  'GJ',
  'GI',
  'GL',
  'GH',
  'GK',
  'GK0',
  'GK1',
  'GQ',
  'GQ0',
  'GQ1',
  'GT',
  'GT0',
  'GT1',
  'GR',
  'GR0',
  'GR1',
]);

export function isGroupCallReticulumWireType(t: unknown): boolean {
  return typeof t === 'string' && GROUP_CALL_RETICULUM_WIRE_TYPES.has(t);
}

// ── Join / leave / cluster heartbeat (single packet) ─────────────────────────

export function encodeJoinWire(env: {
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  /** Joiner's Reticulum destination hash (32 hex). Wire key `d`. */
  reticulumDestinationHash: string;
  /** RNS.Identity.get_public_key() as standard base64 (64 bytes). Wire key `rk`. */
  reticulumIdentityPublicKeyBase64?: string;
  joinGeneration?: number;
}): Record<string, unknown> {
  const d = env.reticulumDestinationHash.trim().toLowerCase();
  const o: Record<string, unknown> = {
    t: 'GJ',
    R: env.roomId,
    H: env.chatId,
    a: env.fromAddress,
    k: env.fromPublicKey,
    m: env.timestamp,
    g: env.signature,
    d,
  };
  if (
    typeof env.reticulumIdentityPublicKeyBase64 === 'string' &&
    isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)
  ) {
    o.rk = env.reticulumIdentityPublicKeyBase64;
  }
  if (
    typeof env.joinGeneration === 'number' &&
    Number.isFinite(env.joinGeneration)
  ) {
    o.j = env.joinGeneration;
  }
  return o;
}

/**
 * Second Reticulum frame for join: signed `GC_JOIN_RK` with RNS identity key only.
 * Omits room/chat/publicKey on wire — receiver correlates to a verified GC_JOIN (GJ) by (a,m,d,j).
 * `rk` is unpadded base64 to stay under ENCRYPTED_MDU with bridge `r`/`X`/`L`.
 */
export function encodeJoinIdentityWire(env: {
  fromAddress: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64: string;
  joinGeneration?: number;
}): Record<string, unknown> {
  const d = env.reticulumDestinationHash.trim().toLowerCase();
  if (!isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)) {
    throw new Error('encodeJoinIdentityWire: invalid reticulumIdentityPublicKeyBase64');
  }
  const rk = normalizeRkBase64ForWire(env.reticulumIdentityPublicKeyBase64);
  const o: Record<string, unknown> = {
    t: 'GI',
    a: env.fromAddress,
    m: env.timestamp,
    g: env.signature,
    d,
    rk,
  };
  if (
    typeof env.joinGeneration === 'number' &&
    Number.isFinite(env.joinGeneration)
  ) {
    o.j = env.joinGeneration;
  }
  return o;
}

export function decodeJoinIdentityWireFailureReason(
  raw: Record<string, unknown>
): string | null {
  if (raw.t !== 'GI') return 'not_gi';
  const a = raw.a;
  const m = raw.m;
  const g = raw.g;
  const dRaw = raw.d;
  const rkRaw = raw.rk;
  const j = raw.j;
  if (typeof a !== 'string') return 'bad_a';
  if (typeof m !== 'number') return 'bad_m';
  if (typeof g !== 'string') return 'bad_g';
  if (typeof dRaw !== 'string') return 'bad_d';
  if (!isRnsDestinationHashHex(dRaw)) return 'bad_d_hex';
  if (typeof rkRaw !== 'string' || !isRnsIdentityPublicKeyBase64(rkRaw)) {
    return 'bad_rk';
  }
  if (
    j !== undefined &&
    j !== null &&
    (typeof j !== 'number' || !Number.isFinite(j))
  ) {
    return 'bad_j';
  }
  return null;
}

export function decodeJoinIdentityWire(raw: Record<string, unknown>): {
  fromAddress: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64: string;
  joinGeneration?: number;
} | null {
  if (decodeJoinIdentityWireFailureReason(raw) !== null) {
    return null;
  }
  const a = raw.a as string;
  const m = raw.m as number;
  const g = raw.g as string;
  const dRaw = raw.d as string;
  const rkRaw = raw.rk as string;
  const j = raw.j;
  return {
    fromAddress: a,
    signature: g,
    timestamp: m,
    reticulumDestinationHash: dRaw.trim().toLowerCase(),
    reticulumIdentityPublicKeyBase64: rkRaw,
    ...(typeof j === 'number' && Number.isFinite(j) ? { joinGeneration: j } : {}),
  };
}

/**
 * When `decodeJoinWire` would return null, explains why (for diagnostics).
 * Returns null if the wire is a valid GJ frame; otherwise a short reason code.
 */
export function decodeJoinWireFailureReason(
  raw: Record<string, unknown>
): string | null {
  if (raw.t !== 'GJ') {
    return 'not_gj';
  }
  const R = raw.R;
  const H = raw.H;
  const a = raw.a;
  const k = raw.k;
  const m = raw.m;
  const g = raw.g;
  const dRaw = raw.d;
  const rkRaw = raw.rk;
  if (typeof R !== 'string') return 'bad_R';
  if (typeof H !== 'string') return 'bad_H';
  if (typeof a !== 'string') return 'bad_a';
  if (typeof k !== 'string') return 'bad_k';
  if (typeof m !== 'number') return 'bad_m';
  if (typeof g !== 'string') return 'bad_g';
  if (typeof dRaw !== 'string') return 'bad_d_missing_or_not_string';
  if (!isRnsDestinationHashHex(dRaw)) {
    const t = String(dRaw).trim();
    return `bad_d_not_hex32(len=${t.length})`;
  }
  if (rkRaw !== undefined && rkRaw !== null) {
    if (typeof rkRaw !== 'string') return 'bad_rk_not_string';
    if (!isRnsIdentityPublicKeyBase64(rkRaw)) return 'bad_rk_not_b64_64';
  }
  return null;
}

export function decodeJoinWire(raw: Record<string, unknown>): {
  type: 'GC_JOIN';
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64?: string;
  joinGeneration?: number;
} | null {
  if (raw.t !== 'GJ') return null;
  const R = raw.R;
  const H = raw.H;
  const a = raw.a;
  const k = raw.k;
  const m = raw.m;
  const g = raw.g;
  const dRaw = raw.d;
  const rkRaw = raw.rk;
  if (
    typeof R !== 'string' ||
    typeof H !== 'string' ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string' ||
    !isRnsDestinationHashHex(dRaw)
  ) {
    return null;
  }
  if (rkRaw !== undefined && rkRaw !== null) {
    if (typeof rkRaw !== 'string' || !isRnsIdentityPublicKeyBase64(rkRaw)) {
      return null;
    }
  }
  const j = raw.j;
  return {
    type: 'GC_JOIN',
    roomId: R,
    chatId: H,
    fromAddress: a,
    fromPublicKey: k,
    signature: g,
    timestamp: m,
    reticulumDestinationHash: (dRaw as string).trim().toLowerCase(),
    ...(typeof rkRaw === 'string' && isRnsIdentityPublicKeyBase64(rkRaw)
      ? { reticulumIdentityPublicKeyBase64: rkRaw }
      : {}),
    ...(typeof j === 'number' && Number.isFinite(j) ? { joinGeneration: j } : {}),
  };
}

export function encodeLeaveWire(env: {
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
}): Record<string, unknown> {
  return {
    t: 'GL',
    R: env.roomId,
    a: env.fromAddress,
    k: env.fromPublicKey,
    m: env.timestamp,
    g: env.signature,
  };
}

export function decodeLeaveWire(raw: Record<string, unknown>): {
  type: 'GC_LEAVE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
} | null {
  if (raw.t !== 'GL') return null;
  const R = raw.R;
  const a = raw.a;
  const k = raw.k;
  const m = raw.m;
  const g = raw.g;
  if (
    typeof R !== 'string' ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'GC_LEAVE',
    roomId: R,
    fromAddress: a,
    fromPublicKey: k,
    signature: g,
    timestamp: m,
  };
}

export function encodeClusterHeartbeatWire(env: {
  roomId: string;
  topologyEpoch: number;
  clusterForwarder: string;
  clusterIndex: number;
  seq: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
}): Record<string, unknown> {
  // Reticulum JSON MDU (~383 bytes with bridge `r`/`X`/`L`): omit duplicate
  // `f` when clusterForwarder === fromAddress, and omit `k` (peers resolve pk
  // from roster). Verification still uses full signed fields from main.
  const w: Record<string, unknown> = {
    t: 'GH',
    R: env.roomId,
    e: env.topologyEpoch,
    i: env.clusterIndex,
    s: env.seq,
    a: env.fromAddress,
    m: env.timestamp,
    g: env.signature,
  };
  if (env.clusterForwarder !== env.fromAddress) {
    w.f = env.clusterForwarder;
  }
  return w;
}

export function decodeClusterHeartbeatWire(raw: Record<string, unknown>): {
  type: 'GC_CLUSTER_HEARTBEAT';
  roomId: string;
  topologyEpoch: number;
  clusterForwarder: string;
  clusterIndex: number;
  seq: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
} | null {
  if (raw.t !== 'GH') return null;
  const R = raw.R;
  const e = raw.e;
  const f = raw.f;
  const i = raw.i;
  const s = raw.s;
  const a = raw.a;
  const k = raw.k;
  const m = raw.m;
  const g = raw.g;
  if (
    typeof R !== 'string' ||
    typeof e !== 'number' ||
    typeof i !== 'number' ||
    typeof s !== 'number' ||
    typeof a !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string'
  ) {
    return null;
  }
  const clusterForwarder =
    typeof f === 'string' && f.length > 0 ? f : a;
  const fromPublicKey = typeof k === 'string' ? k : '';
  return {
    type: 'GC_CLUSTER_HEARTBEAT',
    roomId: R,
    topologyEpoch: e,
    clusterForwarder,
    clusterIndex: i,
    seq: s,
    fromAddress: a,
    fromPublicKey,
    signature: g,
    timestamp: m,
  };
}

// ── Key / key-request ───────────────────────────────────────────────────────

function keyRequestFragmentBodyJson(body: {
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  signature: string;
  timestamp: number;
}): string {
  return JSON.stringify({
    T: body.toAddress,
    a: body.fromAddress,
    k: body.fromPublicKey,
    S: body.callSessionId,
    G: body.mediaSessionGeneration,
    v: body.keyMessageVersion,
    m: body.timestamp,
    g: body.signature,
  });
}

function keyFragmentBodyJson(body: {
  encryptedKey: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeyDigest: string;
  signature: string;
  timestamp: number;
}): string {
  return JSON.stringify({
    y: body.encryptedKey,
    T: body.toAddress,
    a: body.fromAddress,
    k: body.fromPublicKey,
    v: body.keyMessageVersion,
    S: body.callSessionId,
    G: body.mediaSessionGeneration,
    h: body.keyCommitment,
    d: body.encryptedKeyDigest,
    g: body.signature,
    m: body.timestamp,
  });
}

export function encodeKeyWire(env: {
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeyDigest: string;
  signature: string;
  timestamp: number;
}): Record<string, unknown>[] {
  const single: Record<string, unknown> = {
    t: 'GK',
    R: env.roomId,
    T: env.toAddress,
    a: env.fromAddress,
    k: env.fromPublicKey,
    y: env.encryptedKey,
    v: env.keyMessageVersion,
    S: env.callSessionId,
    G: env.mediaSessionGeneration,
    h: env.keyCommitment,
    d: env.encryptedKeyDigest,
    m: env.timestamp,
    g: env.signature,
  };
  if (byteLengthUtf8JsonWithBridgeSender(single) <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
    return [single];
  }
  const body = keyFragmentBodyJson({
    encryptedKey: env.encryptedKey,
    toAddress: env.toAddress,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    keyMessageVersion: env.keyMessageVersion,
    callSessionId: env.callSessionId,
    mediaSessionGeneration: env.mediaSessionGeneration,
    keyCommitment: env.keyCommitment,
    encryptedKeyDigest: env.encryptedKeyDigest,
    signature: env.signature,
    timestamp: env.timestamp,
  });
  const z = sha256HexUtf8(body);
  const utf8 = Buffer.from(body, 'utf8');
  const frames = buildBinaryBlobFrames({
    kind0: 'GK0',
    kind1: 'GK1',
    roomId: env.roomId,
    z,
    meta: {
      f0: 1,
    },
    utf8,
  });
  return frames ?? [];
}

export function decodeKeyWireSingle(raw: Record<string, unknown>): {
  type: 'GC_KEY';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeyDigest: string;
  signature: string;
  timestamp: number;
} | null {
  if (raw.t !== 'GK') return null;
  const R = raw.R;
  const T = raw.T;
  const a = raw.a;
  const k = raw.k;
  const y = raw.y;
  const v = raw.v;
  const S = raw.S;
  const G = raw.G;
  const h = raw.h;
  const d = raw.d;
  const m = raw.m;
  const g = raw.g;
  if (
    typeof R !== 'string' ||
    typeof T !== 'string' ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof y !== 'string' ||
    typeof v !== 'number' ||
    typeof S !== 'string' ||
    typeof G !== 'number' ||
    typeof h !== 'string' ||
    typeof d !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'GC_KEY',
    roomId: R,
    toAddress: T,
    fromAddress: a,
    fromPublicKey: k,
    encryptedKey: y,
    keyMessageVersion: v,
    callSessionId: S,
    mediaSessionGeneration: G,
    keyCommitment: h,
    encryptedKeyDigest: d,
    signature: g,
    timestamp: m,
  };
}

export type GkFragmentMeta = {
  roomId: string;
  z: string;
  n: number;
  f: number;
};

export function parseGk0(
  raw: Record<string, unknown>
): GkFragmentMeta | null {
  if (raw.t !== 'GK0') return null;
  const R = raw.R;
  const z = raw.z;
  const n = raw.n;
  const f = raw.f;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < 1 ||
    typeof f !== 'number' ||
    !Number.isInteger(f) ||
    f < 0
  ) {
    return null;
  }
  return {
    roomId: R,
    z: z.toLowerCase(),
    n,
    f,
  };
}

export function decodeKeyWireFromGk1(
  meta: GkFragmentMeta,
  parts: Map<number, string>
): {
  type: 'GC_KEY';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeyDigest: string;
  signature: string;
  timestamp: number;
} | null {
  const json = reassembleBase64Parts(meta.n, meta.f, parts);
  if (json === null) return null;
  if (sha256HexUtf8(json) !== meta.z) return null;
  try {
    const parsed = JSON.parse(json) as {
      y?: unknown;
      T?: unknown;
      a?: unknown;
      k?: unknown;
      v?: unknown;
      S?: unknown;
      G?: unknown;
      h?: unknown;
      d?: unknown;
      g?: unknown;
      m?: unknown;
    };
    if (
      typeof parsed?.y !== 'string' ||
      typeof parsed?.T !== 'string' ||
      typeof parsed?.a !== 'string' ||
      typeof parsed?.k !== 'string' ||
      typeof parsed?.v !== 'number' ||
      typeof parsed?.S !== 'string' ||
      typeof parsed?.G !== 'number' ||
      typeof parsed?.h !== 'string' ||
      typeof parsed?.d !== 'string' ||
      typeof parsed?.g !== 'string' ||
      typeof parsed?.m !== 'number'
    ) {
      return null;
    }
    return {
      type: 'GC_KEY',
      roomId: meta.roomId,
      toAddress: parsed.T,
      fromAddress: parsed.a,
      fromPublicKey: parsed.k,
      encryptedKey: parsed.y,
      keyMessageVersion: parsed.v,
      callSessionId: parsed.S,
      mediaSessionGeneration: parsed.G,
      keyCommitment: parsed.h,
      encryptedKeyDigest: parsed.d,
      signature: parsed.g,
      timestamp: parsed.m,
    };
  } catch {
    return null;
  }
}

export function encodeKeyRequestWire(env: {
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyMessageVersion: number;
  signature: string;
  timestamp: number;
}): Record<string, unknown>[] {
  const single: Record<string, unknown> = {
    t: 'GQ',
    R: env.roomId,
    T: env.toAddress,
    a: env.fromAddress,
    k: env.fromPublicKey,
    S: env.callSessionId,
    G: env.mediaSessionGeneration,
    v: env.keyMessageVersion,
    m: env.timestamp,
    g: env.signature,
  };
  if (
    byteLengthUtf8JsonWithBridgeSender(single) <=
    RT_RETICULUM_MAX_WIRE_JSON_BYTES
  ) {
    return [single];
  }
  const body = keyRequestFragmentBodyJson({
    toAddress: env.toAddress,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    keyMessageVersion: env.keyMessageVersion,
    callSessionId: env.callSessionId,
    mediaSessionGeneration: env.mediaSessionGeneration,
    signature: env.signature,
    timestamp: env.timestamp,
  });
  const z = sha256HexUtf8(body);
  const utf8 = Buffer.from(body, 'utf8');
  const frames = buildBinaryBlobFrames({
    kind0: 'GQ0',
    kind1: 'GQ1',
    roomId: env.roomId,
    z,
    meta: {
      f0: 1,
    },
    utf8,
  });
  return frames ?? [];
}

export function decodeKeyRequestWireSingle(raw: Record<string, unknown>): {
  type: 'GC_KEY_REQUEST';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyMessageVersion: number;
  signature: string;
  timestamp: number;
} | null {
  if (raw.t !== 'GQ') return null;
  const R = raw.R;
  const T = raw.T;
  const a = raw.a;
  const k = raw.k;
  const S = raw.S;
  const G = raw.G;
  const v = raw.v;
  const m = raw.m;
  const g = raw.g;
  if (
    typeof R !== 'string' ||
    typeof T !== 'string' ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof S !== 'string' ||
    typeof G !== 'number' ||
    typeof v !== 'number' ||
    typeof m !== 'number' ||
    typeof g !== 'string'
  ) {
    return null;
  }
  return {
    type: 'GC_KEY_REQUEST',
    roomId: R,
    toAddress: T,
    fromAddress: a,
    fromPublicKey: k,
    callSessionId: S,
    mediaSessionGeneration: G,
    keyMessageVersion: v,
    signature: g,
    timestamp: m,
  };
}

export function decodeKeyRequestFromGq1(
  meta: GkFragmentMeta,
  parts: Map<number, string>
): {
  type: 'GC_KEY_REQUEST';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyMessageVersion: number;
  signature: string;
  timestamp: number;
} | null {
  const json = reassembleBase64Parts(meta.n, meta.f, parts);
  if (json === null) return null;
  if (sha256HexUtf8(json) !== meta.z) return null;
  try {
    const parsed = JSON.parse(json) as {
      T?: unknown;
      a?: unknown;
      k?: unknown;
      S?: unknown;
      G?: unknown;
      v?: unknown;
      m?: unknown;
      g?: unknown;
    };
    if (
      typeof parsed?.T !== 'string' ||
      typeof parsed?.a !== 'string' ||
      typeof parsed?.k !== 'string' ||
      typeof parsed?.S !== 'string' ||
      typeof parsed?.G !== 'number' ||
      typeof parsed?.v !== 'number' ||
      typeof parsed?.m !== 'number' ||
      typeof parsed?.g !== 'string'
    ) {
      return null;
    }
    return {
      type: 'GC_KEY_REQUEST',
      roomId: meta.roomId,
      toAddress: parsed.T,
      fromAddress: parsed.a,
      fromPublicKey: parsed.k,
      callSessionId: parsed.S,
      mediaSessionGeneration: parsed.G,
      keyMessageVersion: parsed.v,
      signature: parsed.g,
      timestamp: parsed.m,
    };
  } catch {
    return null;
  }
}

// ── Topology (signed fields exclude clusters; body = clusters JSON) ─────────

function clustersJson(clusters: WireClusterDef[]): string {
  return JSON.stringify(clusters);
}

function topologyFragmentBodyJson(body: {
  clusters: WireClusterDef[];
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
}): string {
  return JSON.stringify({
    c: body.clusters,
    a: body.fromAddress,
    k: body.fromPublicKey,
    g: body.signature,
    m: body.timestamp,
  });
}

export function encodeTopologyWire(env: {
  roomId: string;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: WireClusterDef[];
  lastSeen: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
}): Record<string, unknown>[] {
  const single: Record<string, unknown> = {
    t: 'GT',
    R: env.roomId,
    e: env.topologyEpoch,
    o: env.rootForwarder,
    u: env.standbyForwarder,
    l: env.lastSeen,
    a: env.fromAddress,
    k: env.fromPublicKey,
    m: env.timestamp,
    g: env.signature,
    c: env.clusters,
  };
  if (byteLengthUtf8JsonWithBridgeSender(single) <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
    return [single];
  }
  const body = topologyFragmentBodyJson({
    clusters: env.clusters,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    signature: env.signature,
    timestamp: env.timestamp,
  });
  const z = sha256HexUtf8(body);
  const utf8 = Buffer.from(body, 'utf8');
  const frames = buildBinaryBlobFrames({
    kind0: 'GT0',
    kind1: 'GT1',
    roomId: env.roomId,
    z,
    meta: {
      e: env.topologyEpoch,
      o: env.rootForwarder,
      u: env.standbyForwarder,
      l: env.lastSeen,
    },
    utf8,
  });
  return frames ?? [];
}

export function decodeTopologyWireSingle(raw: Record<string, unknown>): {
  type: 'GC_TOPOLOGY';
  roomId: string;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: WireClusterDef[];
  lastSeen: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
} | null {
  if (raw.t !== 'GT') return null;
  const R = raw.R;
  const e = raw.e;
  const o = raw.o;
  const u = raw.u;
  const l = raw.l;
  const a = raw.a;
  const k = raw.k;
  const m = raw.m;
  const g = raw.g;
  const c = raw.c;
  if (
    typeof R !== 'string' ||
    typeof e !== 'number' ||
    typeof o !== 'string' ||
    typeof u !== 'string' ||
    typeof l !== 'number' ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string' ||
    !Array.isArray(c)
  ) {
    return null;
  }
  return {
    type: 'GC_TOPOLOGY',
    roomId: R,
    topologyEpoch: e,
    rootForwarder: o,
    standbyForwarder: u,
    clusters: c as WireClusterDef[],
    lastSeen: l,
    fromAddress: a,
    fromPublicKey: k,
    signature: g,
    timestamp: m,
  };
}

export type GtFragmentMeta = {
  roomId: string;
  z: string;
  n: number;
  f: number;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  lastSeen: number;
};

export function parseGt0(raw: Record<string, unknown>): GtFragmentMeta | null {
  if (raw.t !== 'GT0') return null;
  const R = raw.R;
  const z = raw.z;
  const n = raw.n;
  const f = raw.f;
  const e = raw.e;
  const o = raw.o;
  const u = raw.u;
  const l = raw.l;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < 1 ||
    typeof f !== 'number' ||
    !Number.isInteger(f) ||
    f < 0 ||
    typeof e !== 'number' ||
    typeof o !== 'string' ||
    typeof u !== 'string' ||
    typeof l !== 'number'
  ) {
    return null;
  }
  return {
    roomId: R,
    z: z.toLowerCase(),
    n,
    f,
    topologyEpoch: e,
    rootForwarder: o,
    standbyForwarder: u,
    lastSeen: l,
  };
}

export function decodeTopologyFromGt1(
  meta: GtFragmentMeta,
  parts: Map<number, string>
): {
  type: 'GC_TOPOLOGY';
  roomId: string;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: WireClusterDef[];
  lastSeen: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
} | null {
  const json = reassembleBase64Parts(meta.n, meta.f, parts);
  if (json === null) return null;
  if (sha256HexUtf8(json) !== meta.z) return null;
  let clusters: WireClusterDef[];
  let fromAddress: string;
  let fromPublicKey: string;
  let signature: string;
  let timestamp: number;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const body = parsed as {
      c?: unknown;
      a?: unknown;
      k?: unknown;
      g?: unknown;
      m?: unknown;
    };
    if (
      !Array.isArray(body.c) ||
      typeof body.a !== 'string' ||
      typeof body.k !== 'string' ||
      typeof body.g !== 'string' ||
      typeof body.m !== 'number'
    ) {
      return null;
    }
    clusters = body.c as WireClusterDef[];
    fromAddress = body.a;
    fromPublicKey = body.k;
    signature = body.g;
    timestamp = body.m;
  } catch {
    return null;
  }
  return {
    type: 'GC_TOPOLOGY',
    roomId: meta.roomId,
    topologyEpoch: meta.topologyEpoch,
    rootForwarder: meta.rootForwarder,
    standbyForwarder: meta.standbyForwarder,
    clusters,
    lastSeen: meta.lastSeen,
    fromAddress,
    fromPublicKey,
    signature,
    timestamp,
  };
}

// ── Key rotate (body = canonical JSON of encryptedKeys map) ─────────────────

export function encodeKeyRotateWire(env: {
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKeys: Record<string, string>;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeysDigest: string;
  signature: string;
  timestamp: number;
}): Record<string, unknown>[] {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(env.encryptedKeys).sort()) {
    sorted[key] = env.encryptedKeys[key]!;
  }
  const body = JSON.stringify(sorted);
  const single: Record<string, unknown> = {
    t: 'GR',
    R: env.roomId,
    a: env.fromAddress,
    k: env.fromPublicKey,
    y: sorted,
    v: env.keyMessageVersion,
    S: env.callSessionId,
    G: env.mediaSessionGeneration,
    h: env.keyCommitment,
    d: env.encryptedKeysDigest,
    m: env.timestamp,
    g: env.signature,
  };
  if (byteLengthUtf8JsonWithBridgeSender(single) <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
    return [single];
  }
  const z = sha256HexUtf8(body);
  const utf8 = Buffer.from(body, 'utf8');
  const frames = buildBinaryBlobFrames({
    kind0: 'GR0',
    kind1: 'GR1',
    roomId: env.roomId,
    z,
    meta: {
      a: env.fromAddress,
      k: env.fromPublicKey,
      v: env.keyMessageVersion,
      S: env.callSessionId,
      G: env.mediaSessionGeneration,
      h: env.keyCommitment,
      d: env.encryptedKeysDigest,
      m: env.timestamp,
      g: env.signature,
    },
    utf8,
  });
  return frames ?? [];
}

export function decodeKeyRotateWireSingle(raw: Record<string, unknown>): {
  type: 'GC_KEY_ROTATE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKeys: Record<string, string>;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeysDigest: string;
  signature: string;
  timestamp: number;
} | null {
  if (raw.t !== 'GR') return null;
  const R = raw.R;
  const a = raw.a;
  const k = raw.k;
  const y = raw.y;
  const v = raw.v;
  const S = raw.S;
  const G = raw.G;
  const h = raw.h;
  const d = raw.d;
  const m = raw.m;
  const g = raw.g;
  if (
    typeof R !== 'string' ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof y !== 'object' ||
    y === null ||
    typeof v !== 'number' ||
    typeof S !== 'string' ||
    typeof G !== 'number' ||
    typeof h !== 'string' ||
    typeof d !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string'
  ) {
    return null;
  }
  const enc: Record<string, string> = {};
  for (const [kk, vv] of Object.entries(y as Record<string, unknown>)) {
    if (typeof vv === 'string') enc[kk] = vv;
  }
  return {
    type: 'GC_KEY_ROTATE',
    roomId: R,
    fromAddress: a,
    fromPublicKey: k,
    encryptedKeys: enc,
    keyMessageVersion: v,
    callSessionId: S,
    mediaSessionGeneration: G,
    keyCommitment: h,
    encryptedKeysDigest: d,
    signature: g,
    timestamp: m,
  };
}

export type GrFragmentMeta = {
  roomId: string;
  z: string;
  n: number;
  f: number;
  fromAddress: string;
  fromPublicKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeysDigest: string;
  signature: string;
  timestamp: number;
};

export function parseGr0(raw: Record<string, unknown>): GrFragmentMeta | null {
  if (raw.t !== 'GR0') return null;
  const R = raw.R;
  const z = raw.z;
  const n = raw.n;
  const f = raw.f;
  const a = raw.a;
  const k = raw.k;
  const v = raw.v;
  const S = raw.S;
  const G = raw.G;
  const h = raw.h;
  const d = raw.d;
  const m = raw.m;
  const g = raw.g;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < 1 ||
    typeof f !== 'number' ||
    !Number.isInteger(f) ||
    f < 0 ||
    typeof a !== 'string' ||
    typeof k !== 'string' ||
    typeof v !== 'number' ||
    typeof S !== 'string' ||
    typeof G !== 'number' ||
    typeof h !== 'string' ||
    typeof d !== 'string' ||
    typeof m !== 'number' ||
    typeof g !== 'string'
  ) {
    return null;
  }
  return {
    roomId: R,
    z: z.toLowerCase(),
    n,
    f,
    fromAddress: a,
    fromPublicKey: k,
    keyMessageVersion: v,
    callSessionId: S,
    mediaSessionGeneration: G,
    keyCommitment: h,
    encryptedKeysDigest: d,
    signature: g,
    timestamp: m,
  };
}

export function decodeKeyRotateFromGr1(
  meta: GrFragmentMeta,
  parts: Map<number, string>
): {
  type: 'GC_KEY_ROTATE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKeys: Record<string, string>;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeysDigest: string;
  signature: string;
  timestamp: number;
} | null {
  const json = reassembleBase64Parts(meta.n, meta.f, parts);
  if (json === null) return null;
  if (sha256HexUtf8(json) !== meta.z) return null;
  let encryptedKeys: Record<string, string>;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    encryptedKeys = {};
    for (const [kk, vv] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof vv === 'string') encryptedKeys[kk] = vv;
    }
  } catch {
    return null;
  }
  return {
    type: 'GC_KEY_ROTATE',
    roomId: meta.roomId,
    fromAddress: meta.fromAddress,
    fromPublicKey: meta.fromPublicKey,
    encryptedKeys,
    keyMessageVersion: meta.keyMessageVersion,
    callSessionId: meta.callSessionId,
    mediaSessionGeneration: meta.mediaSessionGeneration,
    keyCommitment: meta.keyCommitment,
    encryptedKeysDigest: meta.encryptedKeysDigest,
    signature: meta.signature,
    timestamp: meta.timestamp,
  };
}

// ── Generic binary blob fragment builder (GT/GR/GK/GQ) ────────────────────────

function buildBinaryBlobFrames(params: {
  kind0: string;
  kind1: string;
  roomId: string;
  z: string;
  meta: Record<string, unknown>;
  utf8: Buffer;
}): Record<string, unknown>[] | null {
  const { kind0, kind1, roomId, z, meta, utf8 } = params;
  const f = utf8.length;
  const zNorm = z.toLowerCase();
  const base0: Record<string, unknown> = {
    t: kind0,
    R: roomId,
    z: zNorm,
    n: 0,
    f,
    ...meta,
  };
  let chunkSize = 96;
  let parts: Record<string, unknown>[] = [];
  let n = 0;
  for (let attempt = 0; attempt < 48; attempt++) {
    parts = [];
    n = 0;
    for (let off = 0; off < utf8.length; off += chunkSize) {
      const slice = utf8.subarray(off, off + chunkSize);
      parts.push({
        t: kind1,
        R: roomId,
        z: zNorm,
        x: n,
        n: 0,
        p: slice.toString('base64'),
      });
      n++;
      if (n > RT_GCALL_MAX_FRAGMENTS) break;
    }
    if (n > RT_GCALL_MAX_FRAGMENTS) {
      chunkSize = Math.floor(chunkSize * 0.75);
      continue;
    }
    const metaFrame = { ...base0, n };
    for (let i = 0; i < parts.length; i++) {
      (parts[i] as Record<string, unknown>).n = n;
    }
    const maxLen = Math.max(
      byteLengthUtf8JsonWithBridgeSender(metaFrame),
      ...parts.map((o) =>
        byteLengthUtf8JsonWithBridgeSender(o as Record<string, unknown>)
      )
    );
    if (maxLen <= RT_RETICULUM_MAX_WIRE_JSON_BYTES) {
      return [metaFrame, ...parts];
    }
    chunkSize = Math.floor(chunkSize * 0.82);
    if (chunkSize < 28) return null;
  }
  return null;
}

function reassembleBase64Parts(
  n: number,
  totalBytes: number,
  parts: Map<number, string>
): string | null {
  const chunks: Buffer[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const b64 = parts.get(i);
    if (!b64) return null;
    try {
      const buf = Buffer.from(b64, 'base64');
      chunks.push(buf);
      sum += buf.length;
    } catch {
      return null;
    }
  }
  if (sum !== totalBytes) return null;
  return Buffer.concat(chunks).toString('utf8');
}

export function parseGk1(
  raw: Record<string, unknown>
): { R: string; z: string; x: number; n: number; p: string } | null {
  if (raw.t !== 'GK1') return null;
  const R = raw.R;
  const z = raw.z;
  const x = raw.x;
  const n = raw.n;
  const p = raw.p;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof x !== 'number' ||
    !Number.isInteger(x) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    typeof p !== 'string'
  ) {
    return null;
  }
  return { R, z: z.toLowerCase(), x, n, p };
}

export function parseGq0(
  raw: Record<string, unknown>
): GkFragmentMeta | null {
  if (raw.t !== 'GQ0') return null;
  const R = raw.R;
  const z = raw.z;
  const n = raw.n;
  const f = raw.f;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < 1 ||
    typeof f !== 'number' ||
    !Number.isInteger(f) ||
    f < 0
  ) {
    return null;
  }
  return {
    roomId: R,
    z: z.toLowerCase(),
    n,
    f,
  };
}

export function parseGq1(
  raw: Record<string, unknown>
): { R: string; z: string; x: number; n: number; p: string } | null {
  if (raw.t !== 'GQ1') return null;
  const R = raw.R;
  const z = raw.z;
  const x = raw.x;
  const n = raw.n;
  const p = raw.p;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof x !== 'number' ||
    !Number.isInteger(x) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    typeof p !== 'string'
  ) {
    return null;
  }
  return { R, z: z.toLowerCase(), x, n, p };
}

export function parseGt1(
  raw: Record<string, unknown>
): { R: string; z: string; x: number; n: number; p: string } | null {
  if (raw.t !== 'GT1') return null;
  const R = raw.R;
  const z = raw.z;
  const x = raw.x;
  const n = raw.n;
  const p = raw.p;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof x !== 'number' ||
    !Number.isInteger(x) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    typeof p !== 'string'
  ) {
    return null;
  }
  return { R, z: z.toLowerCase(), x, n, p };
}

export function parseGr1(
  raw: Record<string, unknown>
): { R: string; z: string; x: number; n: number; p: string } | null {
  if (raw.t !== 'GR1') return null;
  const R = raw.R;
  const z = raw.z;
  const x = raw.x;
  const n = raw.n;
  const p = raw.p;
  if (
    typeof R !== 'string' ||
    !isHex64(z) ||
    typeof x !== 'number' ||
    !Number.isInteger(x) ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    typeof p !== 'string'
  ) {
    return null;
  }
  return { R, z: z.toLowerCase(), x, n, p };
}

