/**
 * Presence protocol for the Qortal P2P network.
 *
 * Design (Design A — renderer signs, Node transports):
 *   - The renderer holds the private key and produces signed envelopes.
 *   - The Node process validates, stores, and relays them via the P2P network.
 *   - Validation: address derived from publicKey must match claimed address;
 *     detached Ed25519 signature must verify; timestamp must be fresh.
 */

import * as nodeCrypto from 'crypto';
import { EventEmitter } from 'events';
import { log as loggerLog, error as loggerError } from './logger';
import { runEd25519VerifySync } from './ed25519-verify-common';
import { VerifyWorkerPool } from './verify-worker-pool';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADDRESS_VERSION = 58;

export const PRESENCE_HEARTBEAT_INTERVAL_MS = 25_000;
export const PRESENCE_SESSION_TIMEOUT_MS = 70_000;
const MAX_PRESENCE_AGE_MS = 60_000;
/** Extra slack for honest clock skew vs GC_JOIN policy (same tradeoff). */
const PRESENCE_SKEW_ALLOWANCE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const PRESENCE_CLEANUP_INTERVAL_MS = 15_000;
const RETICULUM_ROUTE_TTL_MS = 45_000;
const PRESENCE_TOO_OLD_LOG_MIN_MS = 5_000;
export const RETICULUM_OVERLAY_MAX_NEIGHBORS = 16;
/** Keep a verified overlay peer sticky across transient local link loss. */
export const RETICULUM_VERIFIED_PEER_LINK_CLOSE_GRACE_MS = 30_000;
const RETICULUM_CANDIDATE_PROOF_WINDOW_MS = 45_000;
const RETICULUM_CANDIDATE_FAILURE_LIMIT = 2;

// ── Message Types ─────────────────────────────────────────────────────────────

export type NetworkMessageType =
  | 'PRESENCE_ANNOUNCE'
  | 'PRESENCE_HEARTBEAT'
  | 'PRESENCE_OFFLINE';

export const PRESENCE_MESSAGE_TYPES = new Set<string>([
  'PRESENCE_ANNOUNCE',
  'PRESENCE_HEARTBEAT',
  'PRESENCE_OFFLINE',
]);

/**
 * The user-selectable status shown to the network.
 * All three values count as "online" (present in the network).
 */
export type UserStatus = 'online' | 'away' | 'busy' | 'idle';

// ── Payload types ─────────────────────────────────────────────────────────────

export interface PresenceAnnouncePayload {
  address: string;
  publicKey: string;
  sessionId: string;
  status: UserStatus;
  clientVersion: string;
}

export interface PresenceHeartbeatPayload {
  address: string;
  publicKey: string;
  sessionId: string;
  status: UserStatus;
}

export interface PresenceOfflinePayload {
  address: string;
  publicKey: string;
  sessionId: string;
  status: 'offline';
}

export type PresencePayload =
  | PresenceAnnouncePayload
  | PresenceHeartbeatPayload
  | PresenceOfflinePayload;

// ── Envelope ─────────────────────────────────────────────────────────────────

export interface PresenceEnvelope {
  /** Globally unique message id for deduplication. */
  id: string;
  type: NetworkMessageType;
  /** Claimed address of the sender (must match derivedAddress(publicKey)). */
  senderAddress: string;
  /** Unix timestamp in ms when the message was created. */
  timestamp: number;
  payload: PresencePayload;
  /**
   * Detached Ed25519 signature of `canonicalizeForSigning(envelope)`,
   * Base58-encoded.
   */
  signature: string;
}

// ── Signed data shapes (what is actually signed) ─────────────────────────────

export interface SignedPresenceAnnounce {
  type: 'PRESENCE_ANNOUNCE';
  address: string;
  publicKey: string;
  sessionId: string;
  status: UserStatus;
  timestamp: number;
  clientVersion: string;
}

export interface SignedPresenceHeartbeat {
  type: 'PRESENCE_HEARTBEAT';
  address: string;
  publicKey: string;
  sessionId: string;
  status: UserStatus;
  timestamp: number;
}

export interface SignedPresenceOffline {
  type: 'PRESENCE_OFFLINE';
  address: string;
  publicKey: string;
  sessionId: string;
  timestamp: number;
}

export type SignedPresenceData =
  | SignedPresenceAnnounce
  | SignedPresenceHeartbeat
  | SignedPresenceOffline;

// ── Presence store types ──────────────────────────────────────────────────────

export interface PresenceSession {
  address: string;
  publicKey: string;
  sessionId: string;
  lastSeen: number;
  firstSeen: number;
  originNodeId: string;
  viaPeerId: string;
  route: PresenceRoute;
  routeLastValidated: number;
  routeExpiresAt: number | null;
  clientVersion?: string;
  status: UserStatus;
  signatureValid: true;
}

export interface PresenceStatusResult {
  online: boolean;
  lastSeen: number | null;
  sessions: PresenceSession[];
}

export type PresenceRoute =
  | { kind: 'local' }
  | { kind: 'mesh-node'; id: string }
  | {
      kind: 'reticulum';
      destinationHash: string;
      viaDestinationHash?: string;
      linkId?: string;
      overlayHopsRemaining?: number;
    };

export interface PresenceTransportHandlers {
  onEnvelope: (remoteEnvelope: PresenceEnvelope, route: PresenceRoute) => void;
  onReady?: () => void;
  onDegraded?: (reason?: string) => void;
  onCandidatePeerDiscovered?: (payload: {
    peerHash: string;
    source?: string;
  }) => void;
  onOverlayLinkClosed?: (payload: {
    peerHash: string;
    reason?: string;
  }) => void;
}

export interface PresenceTransport {
  readonly kind: 'mesh-node' | 'reticulum';
  publish(envelope: PresenceEnvelope): Promise<boolean> | boolean;
  subscribe(handlers: PresenceTransportHandlers): () => void;
  /** Reticulum local destination hash (hex); used to exclude self from overlay fanout. */
  getLocalDestinationHash?: () => string | undefined;
}

function describePresenceRoute(route: PresenceRoute | null | undefined): string {
  if (!route) return 'none';
  if (route.kind === 'local') return 'local';
  if (route.kind === 'mesh-node') return `mesh-node:${route.id}`;
  const via =
    typeof route.viaDestinationHash === 'string' &&
    route.viaDestinationHash !== route.destinationHash
      ? ` via=${route.viaDestinationHash}`
      : '';
  return `reticulum:${route.destinationHash}${route.linkId ? `#${route.linkId}` : ''}${via}`;
}

function describePresenceEnvelope(
  envelope: Partial<PresenceEnvelope> | null | undefined
): string {
  const payload =
    envelope?.payload && typeof envelope.payload === 'object'
      ? (envelope.payload as Partial<PresencePayload>)
      : null;
  const address =
    typeof payload?.address === 'string' ? payload.address : envelope?.senderAddress;
  const sessionId =
    typeof payload?.sessionId === 'string' ? payload.sessionId : 'unknown-session';
  const status =
    typeof payload?.status === 'string' ? payload.status : 'n/a';
  return `id=${envelope?.id ?? 'unknown'} type=${envelope?.type ?? 'unknown'} address=${address ?? 'unknown'} sessionId=${sessionId} status=${status} timestamp=${typeof envelope?.timestamp === 'number' ? envelope.timestamp : 'unknown'}`;
}

interface PresenceAddressAggregate {
  liveSessionCount: number;
  lastSeen: number | null;
  status: UserStatus | null;
  originNodeId: string | null;
  route: PresenceRoute | null;
  nextExpiryAt: number | null;
}

type ReticulumCandidatePeer = {
  destinationHash: string;
  firstSeenAt: number;
  lastSeenAt: number;
  proofDeadlineAt: number;
  failureCount: number;
  source: string;
  lastFailureReason?: string;
};

type VerifiedReticulumPeer = {
  destinationHash: string;
  address: string;
  lastSeen: number;
  verifiedAt: number;
  linkClosedAt: number | null;
};

export type ReticulumVerifiedPeerSnapshot = {
  destinationHash: string;
  address: string;
  lastSeen: number;
};

// ── Utility: Base58 (ported from src/encryption/Base58.ts) ───────────────────

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58-encode raw bytes (e.g. Ed25519 public key). */
export function encodeBytesBase58(bytes: Uint8Array): string {
  return base58Encode(bytes);
}

function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

export function base58Decode(str: string): Uint8Array {
  const alphabetMap: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    alphabetMap[BASE58_ALPHABET[i]] = i;
  }
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (!(c in alphabetMap)) {
      throw new Error(`Invalid Base58 character: ${c}`);
    }
    let carry = alphabetMap[c];
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's → leading zero bytes
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ── Utility: RIPEMD-160 (ported from src/encryption/ripemd160.ts) ─────────────

const _ARRAY16 = new Array(16);
const _zl = new Uint8Array([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13]);
const _zr = new Uint8Array([5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11]);
const _sl = new Uint8Array([11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6]);
const _sr = new Uint8Array([8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11]);
const _hl = new Uint32Array([0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e]);
const _hr = new Uint32Array([0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0x00000000]);

function _rotl(x: number, n: number): number { return (x << n) | (x >>> (32 - n)); }
function _rmd_fn1(a:number,b:number,c:number,d:number,e:number,m:number,k:number,s:number){return(_rotl((a+(b^c^d)+m+k)|0,s)+e)|0;}
function _rmd_fn2(a:number,b:number,c:number,d:number,e:number,m:number,k:number,s:number){return(_rotl((a+((b&c)|((~b)&d))+m+k)|0,s)+e)|0;}
function _rmd_fn3(a:number,b:number,c:number,d:number,e:number,m:number,k:number,s:number){return(_rotl((a+((b|(~c))^d)+m+k)|0,s)+e)|0;}
function _rmd_fn4(a:number,b:number,c:number,d:number,e:number,m:number,k:number,s:number){return(_rotl((a+((b&d)|(c&(~d)))+m+k)|0,s)+e)|0;}
function _rmd_fn5(a:number,b:number,c:number,d:number,e:number,m:number,k:number,s:number){return(_rotl((a+(b^(c|(~d)))+m+k)|0,s)+e)|0;}

function ripemd160(data: Uint8Array): Uint8Array {
  let a=0x67452301,b=0xefcdab89,c=0x98badcfe,d=0x10325476,e=0xc3d2e1f0;
  // Padding
  const len = data.length;
  const bitLen = len * 8;
  const padLen = ((len % 64) < 56 ? 56 : 120) - (len % 64);
  const padded = new Uint8Array(len + padLen + 8);
  padded.set(data);
  padded[len] = 0x80;
  // bit length as 64-bit LE
  let bl = bitLen;
  for (let i = 0; i < 8; i++) { padded[len + padLen + i] = bl & 0xff; bl = bl / 256; }
  // Process 64-byte blocks
  const view = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += 64) {
    const words = _ARRAY16;
    for (let j = 0; j < 16; j++) words[j] = view.getInt32(off + j * 4, true);
    let al=a,bl2=b,cl=c,dl=d,el=e,ar=a,br=b,cr=c,dr=d,er=e;
    for (let i = 0; i < 80; i++) {
      let tl: number, tr: number;
      if (i < 16) {
        tl = _rmd_fn1(al,bl2,cl,dl,el,words[_zl[i]],_hl[0],_sl[i]);
        tr = _rmd_fn5(ar,br,cr,dr,er,words[_zr[i]],_hr[0],_sr[i]);
      } else if (i < 32) {
        tl = _rmd_fn2(al,bl2,cl,dl,el,words[_zl[i]],_hl[1],_sl[i]);
        tr = _rmd_fn4(ar,br,cr,dr,er,words[_zr[i]],_hr[1],_sr[i]);
      } else if (i < 48) {
        tl = _rmd_fn3(al,bl2,cl,dl,el,words[_zl[i]],_hl[2],_sl[i]);
        tr = _rmd_fn3(ar,br,cr,dr,er,words[_zr[i]],_hr[2],_sr[i]);
      } else if (i < 64) {
        tl = _rmd_fn4(al,bl2,cl,dl,el,words[_zl[i]],_hl[3],_sl[i]);
        tr = _rmd_fn2(ar,br,cr,dr,er,words[_zr[i]],_hr[3],_sr[i]);
      } else {
        tl = _rmd_fn5(al,bl2,cl,dl,el,words[_zl[i]],_hl[4],_sl[i]);
        tr = _rmd_fn1(ar,br,cr,dr,er,words[_zr[i]],_hr[4],_sr[i]);
      }
      al=el; el=dl; dl=_rotl(cl,10); cl=bl2; bl2=tl;
      ar=er; er=dr; dr=_rotl(cr,10); cr=br; br=tr;
    }
    const t=(b+cl+dr)|0; b=(c+dl+er)|0; c=(d+el+ar)|0; d=(e+al+br)|0; e=(a+bl2+cr)|0; a=t;
  }
  // Write result as LE 32-bit words
  const result = new Uint8Array(20);
  const rv = new DataView(result.buffer);
  rv.setInt32(0,a,true); rv.setInt32(4,b,true); rv.setInt32(8,c,true);
  rv.setInt32(12,d,true); rv.setInt32(16,e,true);
  return result;
}

// ── Address derivation ────────────────────────────────────────────────────────

/**
 * Derives the Qortal address from a Base58-encoded Ed25519 public key.
 * Algorithm: SHA-256 → RIPEMD-160 → [ADDRESS_VERSION, ...hash, checksum[0:4]] → Base58
 */
export function deriveAddressFromPublicKey(publicKeyBase58: string): string {
  const publicKeyBytes = base58Decode(publicKeyBase58);

  // SHA-256 of public key
  const sha256 = nodeCrypto.createHash('sha256').update(publicKeyBytes).digest();

  // RIPEMD-160 of SHA-256
  const hash = ripemd160(new Uint8Array(sha256));

  // Versioned payload
  const versioned = new Uint8Array(1 + hash.length);
  versioned[0] = ADDRESS_VERSION;
  versioned.set(hash, 1);

  // Double-SHA-256 checksum
  const check1 = nodeCrypto.createHash('sha256').update(versioned).digest();
  const check2 = nodeCrypto.createHash('sha256').update(check1).digest();

  const full = new Uint8Array(versioned.length + 4);
  full.set(versioned);
  full.set(check2.slice(0, 4), versioned.length);

  return base58Encode(full);
}

// ── Canonical signed-data serialization ──────────────────────────────────────

/**
 * Produces a deterministic UTF-8 byte sequence for a signed-data object.
 * Keys are sorted alphabetically before JSON serialization so both the
 * renderer and the Node process produce identical bytes.
 */
export function canonicalizeForSigning(data: Record<string, unknown>): Uint8Array {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key];
  }
  return new TextEncoder().encode(JSON.stringify(sorted));
}

/**
 * Fields covered by the presence envelope detached signature (for workers / verify).
 * Only the security-relevant fields are signed.
 */
export function buildPresenceSignedFields(
  envelope: PresenceEnvelope
): Record<string, unknown> {
  return buildSignedData(envelope);
}

function buildSignedData(envelope: PresenceEnvelope): Record<string, unknown> {
  const p = envelope.payload as unknown as Record<string, unknown>;
  const base: Record<string, unknown> = {
    type: envelope.type,
    address: p['address'],
    publicKey: p['publicKey'],
    sessionId: p['sessionId'],
    timestamp: envelope.timestamp,
  };
  if (envelope.type === 'PRESENCE_ANNOUNCE') {
    base['clientVersion'] = (p as unknown as PresenceAnnouncePayload).clientVersion;
    base['status'] = p['status'];
  }
  if (envelope.type === 'PRESENCE_HEARTBEAT') {
    base['status'] = p['status'];
  }
  return base;
}

// ── Signature verification ────────────────────────────────────────────────────

/** Synchronous verify (e.g. tests); hot path uses VerifyWorkerPool. */
export function verifyPresenceSignature(envelope: PresenceEnvelope): boolean {
  const publicKeyBase58 = (envelope.payload as PresenceAnnouncePayload).publicKey;
  return runEd25519VerifySync({
    kind: 'presence',
    signedFields: buildPresenceSignedFields(envelope),
    signature: envelope.signature,
    publicKeyBase58,
  });
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Module-level cache from Base58 public key to derived Qortal address.
 * Address derivation is deterministic and expensive (SHA-256 + RIPEMD-160),
 * so we compute it once per unique key and reuse the result.
 */
const derivedAddressCache = new Map<string, string>();

function cachedDeriveAddress(publicKeyBase58: string): string {
  const hit = derivedAddressCache.get(publicKeyBase58);
  if (hit) return hit;
  const derived = deriveAddressFromPublicKey(publicKeyBase58);
  derivedAddressCache.set(publicKeyBase58, derived);
  return derived;
}

type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Validates everything except Ed25519 (signature verified off-thread). */
function validateEnvelopeSansSignature(
  envelope: PresenceEnvelope,
  now: number
): ValidationResult {
  // 1. Required fields
  if (
    !envelope.id || typeof envelope.id !== 'string' ||
    !envelope.type || typeof envelope.type !== 'string' ||
    typeof envelope.timestamp !== 'number' ||
    !envelope.payload || typeof envelope.payload !== 'object' ||
    !envelope.signature || typeof envelope.signature !== 'string' ||
    !envelope.senderAddress || typeof envelope.senderAddress !== 'string'
  ) {
    return { ok: false, reason: 'missing or malformed required fields' };
  }

  // 2. Type must be a known presence type
  if (!PRESENCE_MESSAGE_TYPES.has(envelope.type)) {
    return { ok: false, reason: `unknown type: ${envelope.type}` };
  }

  // 3. Payload shape
  const p = envelope.payload as unknown as Record<string, unknown>;
  if (
    typeof p['address'] !== 'string' ||
    typeof p['publicKey'] !== 'string' ||
    typeof p['sessionId'] !== 'string'
  ) {
    return { ok: false, reason: 'payload missing address/publicKey/sessionId' };
  }

  // 4. Timestamp freshness
  if (now - envelope.timestamp > MAX_PRESENCE_AGE_MS) {
    return { ok: false, reason: 'message too old' };
  }
  if (envelope.timestamp - now > MAX_FUTURE_SKEW_MS) {
    return { ok: false, reason: 'message timestamp too far in the future' };
  }

  // 5. Address derivation check (cached)
  const claimedAddress = p['address'] as string;
  const publicKeyBase58 = p['publicKey'] as string;
  let derivedAddress: string;
  try {
    derivedAddress = cachedDeriveAddress(publicKeyBase58);
  } catch {
    return { ok: false, reason: 'invalid publicKey encoding' };
  }
  if (derivedAddress !== claimedAddress) {
    return {
      ok: false,
      reason: `address mismatch: claimed=${claimedAddress} derived=${derivedAddress}`,
    };
  }
  if (envelope.senderAddress !== claimedAddress) {
    return {
      ok: false,
      reason: 'senderAddress does not match payload address',
    };
  }

  return { ok: true };
}

const PRESENCE_VERIFY_WORKER_COUNT = 2;
const PRESENCE_MAX_PENDING_VERIFY = 1024;

function routeToLegacyPeerIds(route: PresenceRoute): {
  originNodeId: string;
  viaPeerId: string;
} {
  switch (route.kind) {
    case 'local':
      return { originNodeId: 'local', viaPeerId: 'local' };
    case 'mesh-node':
      return { originNodeId: route.id, viaPeerId: route.id };
    case 'reticulum':
      return {
        originNodeId: `reticulum:${route.destinationHash}`,
        viaPeerId: `reticulum:${route.viaDestinationHash ?? route.destinationHash}`,
      };
  }
}

function getRouteExpiry(route: PresenceRoute, now: number): number | null {
  if (route.kind === 'reticulum') return now + RETICULUM_ROUTE_TTL_MS;
  return null;
}

function isRouteFresh(session: PresenceSession, now: number): boolean {
  return session.routeExpiresAt === null || now <= session.routeExpiresAt;
}

function shouldPreferAggregateRoute(
  candidate: PresenceSession,
  current: PresenceSession | null,
  now: number
): boolean {
  if (!isRouteFresh(candidate, now)) return false;
  if (!current) return true;
  const candidateIsReticulum = candidate.route.kind === 'reticulum';
  const currentIsReticulum = current.route.kind === 'reticulum';
  if (candidateIsReticulum !== currentIsReticulum) {
    return candidateIsReticulum;
  }
  return candidate.lastSeen > current.lastSeen;
}

// ── Presence Manager ──────────────────────────────────────────────────────────

export class PresenceManager extends EventEmitter {
  /** Key: `${address}:${sessionId}` */
  private sessions = new Map<string, PresenceSession>();

  /** address -> session keys, so queries only touch one address. */
  private sessionKeysByAddress = new Map<string, Set<string>>();

  /** Derived per-address state used by hot-path lookups and emits. */
  private addressAggregates = new Map<string, PresenceAddressAggregate>();

  /**
   * Tracks the latest accepted timestamp per (address, sessionId, type).
   * Used for monotonic-timestamp replay protection.
   * Key: `${address}:${sessionId}:${type}`
   */
  private latestTimestamp = new Map<string, number>();

  /**
   * The most recently accepted local ANNOUNCE or HEARTBEAT envelope.
   * Sent directly to each newly connected peer so they learn about the
   * local user immediately rather than waiting for the next heartbeat.
   */
  private lastLocalEnvelope: PresenceEnvelope | null = null;

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** envelope.id → last log time for throttled "message too old" diagnostics */
  private presenceTooOldLogAt = new Map<string, number>();
  private presenceTooOldGlobalLogAt = 0;
  private reticulumCandidates = new Map<string, ReticulumCandidatePeer>();
  private verifiedReticulumPeers = new Map<string, VerifiedReticulumPeer>();
  /** Verified overlay peers admitted into the 16-slot mesh. */
  private activeReticulumNeighborHashes: string[] = [];
  /**
   * Reticulum publish/forward fanout: verified neighbors first, then candidate
   * backfill up to {@link RETICULUM_OVERLAY_MAX_NEIGHBORS} for bootstrap.
   */
  private activeReticulumPublishHashes: string[] = [];

  /** Local Reticulum destination hash (lowercase hex); set when Reticulum transport is ready. */
  private localReticulumDestinationHash: string | null = null;

  private verifyPool = new VerifyWorkerPool(
    'presence',
    PRESENCE_VERIFY_WORKER_COUNT,
    PRESENCE_MAX_PENDING_VERIFY
  );

  startVerifyPool(): void {
    this.verifyPool.start();
  }

  stopVerifyPool(): void {
    this.verifyPool.stop();
  }

  startCleanup(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      PRESENCE_CLEANUP_INTERVAL_MS
    );
    this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Returns the last accepted local announce/heartbeat envelope, or null if
   *  the local user has not yet announced presence. Used to bootstrap newly
   *  connected peers so they learn about the local user immediately. */
  getLastLocalEnvelope(): PresenceEnvelope | null {
    return this.lastLocalEnvelope;
  }

  /**
   * Called when the Reticulum bridge exposes the local destination hash (or clears on degrade).
   * Removes self from overlay fanout so we never treat our own hash as a peer.
   */
  setLocalReticulumDestinationHash(hex: string | null): void {
    const next = hex?.trim().toLowerCase() ?? null;
    if (next === this.localReticulumDestinationHash) return;
    this.localReticulumDestinationHash = next;
    this.pruneSelfFromReticulumOverlayState();
    const changed = this.recomputeReticulumActiveNeighbors(Date.now());
    if (changed) {
      this.emitReticulumOverlayChanged();
    }
  }

  private isSelfReticulumHash(hash: string): boolean {
    const local = this.localReticulumDestinationHash;
    if (!local) return false;
    return hash.trim().toLowerCase() === local;
  }

  private pruneSelfFromReticulumOverlayState(): void {
    const local = this.localReticulumDestinationHash;
    if (!local) return;
    const had = this.verifiedReticulumPeers.delete(local);
    const hadCand = this.reticulumCandidates.delete(local);
    if (had || hadCand) {
      loggerLog(
        `[Presence] Removed local destination hash from overlay peers (self) ${local}`
      );
    }
  }

  // ── Message handling ────────────────────────────────────────────────────────

  /**
   * Handles an incoming presence envelope from a remote peer or from the
   * local renderer. Returns true if the message was accepted.
   *
   * `route` identifies the transport path that delivered the message.
   * Use `{ kind: 'local' }` when called for a locally-originated envelope.
   */
  async handleEnvelope(
    raw: unknown,
    route: PresenceRoute
  ): Promise<boolean> {
    const envelope = raw as PresenceEnvelope;
    const now = Date.now();
    loggerLog(
      `[Presence] Handling envelope ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)} age_ms=${typeof envelope?.timestamp === 'number' ? now - envelope.timestamp : 'unknown'}`
    );

    const result = validateEnvelopeSansSignature(envelope, now);
    if (result.ok === false) {
      if (route.kind === 'reticulum') {
        this.noteReticulumCandidateFailure(route.destinationHash, result.reason, now);
      }
      if (result.reason === 'message too old') {
        const id = envelope?.id;
        const tnow = Date.now();
        if (typeof id === 'string' && id.length > 0) {
          const last = this.presenceTooOldLogAt.get(id) ?? 0;
          if (tnow - last < PRESENCE_TOO_OLD_LOG_MIN_MS) {
            loggerLog(
              `[Presence] Dropped stale envelope without repeat log ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)}`
            );
            return false;
          }
          this.presenceTooOldLogAt.set(id, tnow);
          if (this.presenceTooOldLogAt.size > 2_000) {
            const oldest = this.presenceTooOldLogAt.keys().next().value;
            if (oldest !== undefined) this.presenceTooOldLogAt.delete(oldest);
          }
        } else {
          if (tnow - this.presenceTooOldGlobalLogAt < PRESENCE_TOO_OLD_LOG_MIN_MS) {
            loggerLog(
              `[Presence] Dropped stale envelope without repeat log ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)}`
            );
            return false;
          }
          this.presenceTooOldGlobalLogAt = tnow;
        }
      }
      loggerLog(
        `[Presence] Rejected envelope ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)} reason=${result.reason}`
      );
      return false;
    }

    const p = envelope.payload as PresenceAnnouncePayload;
    const publicKeyBase58 = p.publicKey;
    const sigOk = await this.verifyPool.verify({
      kind: 'presence',
      signedFields: buildPresenceSignedFields(envelope),
      signature: envelope.signature,
      publicKeyBase58,
    });
    if (!sigOk) {
      if (route.kind === 'reticulum') {
        this.noteReticulumCandidateFailure(
          route.destinationHash,
          'invalid signature',
          now
        );
      }
      loggerLog(
        `[Presence] Rejected envelope ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)} reason=invalid signature`
      );
      return false;
    }
    loggerLog(
      `[Presence] Signature verified ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)}`
    );

    return this.applyVerifiedPresenceEnvelope(
      envelope,
      route,
      now
    );
  }

  /** After signature verify: monotonic timestamp + session mutation. */
  private applyVerifiedPresenceEnvelope(
    envelope: PresenceEnvelope,
    route: PresenceRoute,
    now: number
  ): boolean {
    const p = envelope.payload as PresenceAnnouncePayload;
    const { address, publicKey, sessionId } = p;
    const legacyPeerIds = routeToLegacyPeerIds(route);
    const routeExpiresAt = getRouteExpiry(route, now);
    const key = `${address}:${sessionId}`;
    const existing = this.sessions.get(key);

    const tsKey = `${address}:${sessionId}:${envelope.type}`;
    const prevTs = this.latestTimestamp.get(tsKey) ?? 0;
    if (envelope.timestamp <= prevTs) {
      loggerLog(
        `[Presence] Dropped envelope due to non-increasing timestamp ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)} prev_ts=${prevTs}`
      );
      if (route.kind === 'reticulum') {
        loggerLog(
          `[Presence] target=presence-reticulum rx=drop_dup peer_addr=${address} sender_hash=${route.destinationHash} type=${envelope.type} env_ts=${envelope.timestamp} prev_ts=${prevTs} envelope_id=${envelope.id ?? 'n/a'}`
        );
      }
      return false;
    }
    if (existing && envelope.timestamp < existing.lastSeen) {
      loggerLog(
        `[Presence] Dropped envelope due to stale session timestamp ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)} session_last_seen=${existing.lastSeen}`
      );
      if (route.kind === 'reticulum') {
        loggerLog(
          `[Presence] target=presence-reticulum rx=drop_stale_session peer_addr=${address} sender_hash=${route.destinationHash} type=${envelope.type} env_ts=${envelope.timestamp} session_last_seen=${existing.lastSeen} envelope_id=${envelope.id ?? 'n/a'}`
        );
      }
      return false;
    }
    this.latestTimestamp.set(tsKey, envelope.timestamp);

    if (route.kind === 'reticulum') {
      this.markReticulumOverlayPeerVerified(
        route.destinationHash,
        'presence',
        address,
        now
      );
    }

    if (envelope.type === 'PRESENCE_OFFLINE') {
      loggerLog(
        `[Presence] Applying offline envelope ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)}`
      );
      if (route.kind === 'reticulum') {
        loggerLog(
          `[Presence] target=presence-reticulum rx=offline_apply peer_addr=${address} sender_hash=${route.destinationHash} envelope_id=${envelope.id ?? 'n/a'}`
        );
      }
      this.removeSession(address, sessionId);
      if (route.kind === 'local') this.lastLocalEnvelope = null;
    } else {
      this.sessions.set(key, {
        address,
        publicKey,
        sessionId,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: envelope.timestamp,
        originNodeId: legacyPeerIds.originNodeId,
        viaPeerId: legacyPeerIds.viaPeerId,
        route,
        routeLastValidated: now,
        routeExpiresAt,
        clientVersion:
          envelope.type === 'PRESENCE_ANNOUNCE'
            ? (p as PresenceAnnouncePayload).clientVersion
            : existing?.clientVersion,
        status: (p as PresenceAnnouncePayload).status as UserStatus ?? 'online',
        signatureValid: true,
      });
      this.addSessionKey(address, key);
      if (route.kind === 'local') {
        this.lastLocalEnvelope = envelope as PresenceEnvelope;
      }
      loggerLog(
        `[Presence] Accepted envelope ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)} existing_session=${existing ? 'yes' : 'no'} route_expires_at=${routeExpiresAt ?? 'none'} live_sessions_for_address=${this.sessionKeysByAddress.get(address)?.size ?? 0}`
      );
      if (route.kind === 'reticulum') {
        loggerLog(
          `[Presence] target=presence-reticulum rx=accepted peer_addr=${address} sender_hash=${route.destinationHash} type=${envelope.type} env_ts=${envelope.timestamp} envelope_id=${envelope.id ?? 'n/a'} sessionId=${sessionId} existing_session=${existing ? 'yes' : 'no'}`
        );
      }
      this.emitPresenceUpdate(address, now);
    }

    if (route.kind === 'reticulum') {
      this.emit('reticulum-envelope-accepted', { envelope, route });
    }

    return true;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  isAddressOnline(address: string): boolean {
    return this.getAddressAggregate(address).liveSessionCount > 0;
  }

  getStatus(address: string): PresenceStatusResult {
    const now = Date.now();
    const active: PresenceSession[] = [];
    const keys = this.sessionKeysByAddress.get(address);

    if (keys) {
      for (const key of keys) {
        const session = this.sessions.get(key);
        if (!session) continue;
        if (now - session.lastSeen <= PRESENCE_SESSION_TIMEOUT_MS) {
          active.push(session);
        }
      }
    }

    const aggregate = this.getAddressAggregate(address, now);

    return {
      online: aggregate.liveSessionCount > 0,
      lastSeen: aggregate.lastSeen,
      sessions: active,
    };
  }

  getAllOnline(): PresenceSession[] {
    const now = Date.now();
    const result: PresenceSession[] = [];
    for (const [address, keys] of this.sessionKeysByAddress.entries()) {
      if (this.getAddressAggregate(address, now).liveSessionCount === 0) continue;
      for (const key of keys) {
        const session = this.sessions.get(key);
        if (
          session &&
          now - session.lastSeen <= PRESENCE_SESSION_TIMEOUT_MS
        ) {
          result.push(session);
        }
      }
    }
    return result;
  }

  getOnlineAddresses(): string[] {
    const now = Date.now();
    const addresses: string[] = [];
    for (const address of this.sessionKeysByAddress.keys()) {
      if (this.getAddressAggregate(address, now).liveSessionCount > 0) {
        addresses.push(address);
      }
    }
    return addresses;
  }

  /**
   * Returns the P2P nodeId (originNodeId) of the most-recently-seen live
   * session for a given Qortal address, or null if the address is offline or
   * unknown.  Used by the call system to route signaling messages.
   */
  getNodeIdForAddress(address: string): string | null {
    const route = this.getRouteForAddress(address);
    return route?.kind === 'mesh-node' ? route.id : null;
  }

  getRouteForAddress(address: string): PresenceRoute | null {
    return this.getAddressAggregate(address).route;
  }

  /**
   * Unique Reticulum presence destination hashes for non-expired sessions.
   * Passed to the Python bridge so fanout stays aligned with TS route state.
   */
  getReticulumFanoutDestinationHashes(): string[] {
    const now = Date.now();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.route.kind !== 'reticulum') continue;
      if (now - session.lastSeen > PRESENCE_SESSION_TIMEOUT_MS) continue;
      const h = session.route.destinationHash;
      if (typeof h !== 'string' || h.length === 0 || seen.has(h)) continue;
      if (this.isSelfReticulumHash(h)) continue;
      seen.add(h);
      out.push(h);
    }
    return out;
  }

  getReticulumVerifiedPeers(): ReticulumVerifiedPeerSnapshot[] {
    const now = Date.now();
    this.pruneReticulumOverlayState(now);
    return [...this.verifiedReticulumPeers.values()]
      .filter((peer) => !this.isSelfReticulumHash(peer.destinationHash))
      .sort((a, b) => a.verifiedAt - b.verifiedAt || b.lastSeen - a.lastSeen)
      .map((peer) => ({
        destinationHash: peer.destinationHash,
        address: peer.address,
        lastSeen: peer.lastSeen,
      }));
  }

  /**
   * Destination hashes for Reticulum overlay fanout (publish, forward, call/group
   * signaling gossip): admitted verified mesh peers first, then unverified
   * candidates filling remaining slots until the cap for cold-start bootstrap.
   */
  getReticulumActiveNeighborHashes(
    excludeDestinationHashes: string[] = []
  ): string[] {
    const now = Date.now();
    this.pruneReticulumOverlayState(now);
    const base = this.activeReticulumPublishHashes.filter(
      (h) => !this.isSelfReticulumHash(h)
    );
    if (excludeDestinationHashes.length === 0) {
      return [...base];
    }
    const exclude = new Set(
      excludeDestinationHashes
        .filter((h) => typeof h === 'string' && h.length > 0)
        .map((h) => h.toLowerCase())
    );
    return base.filter((hash) => !exclude.has(hash.toLowerCase()));
  }

  /** Verified Reticulum overlay neighbors only (no candidate backfill). */
  getReticulumVerifiedNeighborHashes(): string[] {
    const now = Date.now();
    this.pruneReticulumOverlayState(now);
    return this.activeReticulumNeighborHashes.filter((h) => !this.isSelfReticulumHash(h));
  }

  noteReticulumOverlayLinkClosed(
    destinationHash: string,
    reason?: string,
    now: number = Date.now()
  ): void {
    const hash = destinationHash.trim().toLowerCase();
    if (!hash) return;
    const existingVerified = this.verifiedReticulumPeers.get(hash);
    const wasVerified = Boolean(existingVerified);
    const wasActive = this.activeReticulumNeighborHashes.includes(hash);
    if (!wasVerified && !wasActive) return;
    if (existingVerified) {
      this.verifiedReticulumPeers.set(hash, {
        ...existingVerified,
        lastSeen: Math.max(existingVerified.lastSeen, now),
        linkClosedAt: now,
      });
      this.noteReticulumCandidateDiscovered(hash, 'overlay-link-closed', now);
    }
    loggerLog(
      `[Presence] Reticulum overlay peer closed sender_hash=${hash}${reason ? ` reason=${reason}` : ''}${wasVerified ? ' retained=yes' : ''}`
    );
    const neighborsChanged = this.recomputeReticulumActiveNeighbors(now);
    if (wasVerified || wasActive || neighborsChanged) {
      this.emitReticulumOverlayChanged();
    }
  }

  noteReticulumCandidateDiscovered(
    destinationHash: string,
    source: string = 'announce',
    now: number = Date.now()
  ): void {
    const hash = destinationHash.trim().toLowerCase();
    if (!hash) return;
    if (this.isSelfReticulumHash(hash)) return;
    const existing = this.reticulumCandidates.get(hash);
    const peer: ReticulumCandidatePeer = {
      destinationHash: hash,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      proofDeadlineAt: now + RETICULUM_CANDIDATE_PROOF_WINDOW_MS,
      failureCount: existing?.failureCount ?? 0,
      source,
      ...(existing?.lastFailureReason
        ? { lastFailureReason: existing.lastFailureReason }
        : {}),
    };
    this.reticulumCandidates.set(hash, peer);
    loggerLog(
      `[Presence] Reticulum candidate discovered sender_hash=${hash} source=${source} proof_deadline=${peer.proofDeadlineAt}`
    );
    this.recomputeReticulumActiveNeighbors(now);
    this.emitReticulumOverlayChanged();
  }

  noteReticulumCandidateFailure(
    destinationHash: string,
    reason: string,
    now: number = Date.now()
  ): void {
    const hash = destinationHash.trim().toLowerCase();
    if (!hash) return;
    const existing = this.reticulumCandidates.get(hash);
    if (!existing) {
      this.reticulumCandidates.set(hash, {
        destinationHash: hash,
        firstSeenAt: now,
        lastSeenAt: now,
        proofDeadlineAt: now + RETICULUM_CANDIDATE_PROOF_WINDOW_MS,
        failureCount: 1,
        source: 'failure',
        lastFailureReason: reason,
      });
      this.emit('reticulum-candidate-failed', {
        destinationHash: hash,
        reason,
        failureCount: 1,
      });
      this.recomputeReticulumActiveNeighbors(now);
      this.emitReticulumOverlayChanged();
      return;
    }
    existing.lastSeenAt = now;
    existing.failureCount += 1;
    existing.lastFailureReason = reason;
    if (existing.failureCount >= RETICULUM_CANDIDATE_FAILURE_LIMIT) {
      this.reticulumCandidates.delete(hash);
      loggerLog(
        `[Presence] Reticulum candidate evicted sender_hash=${hash} failures=${existing.failureCount} reason=${reason}`
      );
    } else {
      this.reticulumCandidates.set(hash, existing);
    }
    this.emit('reticulum-candidate-failed', {
      destinationHash: hash,
      reason,
      failureCount: existing.failureCount,
    });
    this.recomputeReticulumActiveNeighbors(now);
    this.emitReticulumOverlayChanged();
  }

  /**
   * Marks a Reticulum destination as a verified Qortal overlay participant after
   * any accepted Qortal overlay protocol traffic. Verification is latched by
   * destination hash; later accepted traffic only refreshes liveness metadata.
   */
  markReticulumOverlayPeerVerified(
    destinationHash: string,
    source: string = 'qortal-overlay',
    address?: string,
    now: number = Date.now()
  ): void {
    const hash = destinationHash.trim().toLowerCase();
    if (!hash) return;
    if (this.isSelfReticulumHash(hash)) return;
    this.promoteVerifiedReticulumPeer(hash, address ?? '', now, source);
  }

  /** Returns the most-recently-seen active status for an address, or null. */
  getAddressStatus(address: string): UserStatus | null {
    return this.getAddressAggregate(address).status;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  cleanupExpired(): void {
    const now = Date.now();
    const changedAddresses = new Set<string>();
    let expiredSessions = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastSeen > PRESENCE_SESSION_TIMEOUT_MS) {
        this.sessions.delete(key);
        this.removeSessionKey(session.address, key);
        changedAddresses.add(session.address);
        expiredSessions++;
        loggerLog(
          `[Presence] Expired session address=${session.address} sessionId=${session.sessionId} lastSeen=${session.lastSeen} age_ms=${now - session.lastSeen} route=${describePresenceRoute(session.route)}`
        );
        if (session.route.kind === 'reticulum') {
          loggerLog(
            `[Presence] target=presence-reticulum session_expired peer_addr=${session.address} sender_hash=${session.route.destinationHash} lastSeen=${session.lastSeen} age_ms=${now - session.lastSeen}`
          );
        }
      }
    }

    // Also evict old monotonic timestamp entries
    for (const [key, ts] of this.latestTimestamp.entries()) {
      if (now - ts > (MAX_PRESENCE_AGE_MS + PRESENCE_SKEW_ALLOWANCE_MS) * 5) {
        this.latestTimestamp.delete(key);
      }
    }

    for (const address of changedAddresses) {
      this.emitPresenceUpdate(address, now);
    }
    this.pruneReticulumOverlayState(now);
    if (expiredSessions > 0) {
      loggerLog(
        `[Presence] Cleanup removed ${expiredSessions} expired session(s) affecting ${changedAddresses.size} address(es)`
      );
    }
  }

  removeSessionsForPeer(peerId: string): void {
    if (!peerId) return;

    const changedAddresses = new Set<string>();
    let removedSessions = 0;

    for (const [key, session] of this.sessions.entries()) {
      // Only drop immediately when the disconnected peer was the origin node
      // itself. Relayed sessions may still be reachable through another path,
      // so they should stay online until they naturally time out or refresh
      // via a new route.
      if (
        session.route.kind !== 'mesh-node' ||
        session.originNodeId !== peerId ||
        session.viaPeerId !== peerId
      ) {
        continue;
      }
      this.sessions.delete(key);
      this.removeSessionKey(session.address, key);
      changedAddresses.add(session.address);
      removedSessions++;
      loggerLog(
        `[Presence] Removed session for disconnected mesh peer peerId=${peerId} address=${session.address} sessionId=${session.sessionId}`
      );
    }

    for (const address of changedAddresses) {
      this.emitPresenceUpdate(address);
    }
    if (removedSessions > 0) {
      loggerLog(
        `[Presence] Removed ${removedSessions} session(s) after mesh peer disconnect peerId=${peerId}`
      );
    }
  }

  invalidateTransportRoutes(routeKind: PresenceRoute['kind']): void {
    const changedAddresses = new Set<string>();
    let removedSessions = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (session.route.kind !== routeKind || routeKind === 'local') continue;
      this.sessions.delete(key);
      this.removeSessionKey(session.address, key);
      changedAddresses.add(session.address);
      removedSessions++;
      loggerLog(
        `[Presence] Invalidated session due to transport degradation routeKind=${routeKind} address=${session.address} sessionId=${session.sessionId} route=${describePresenceRoute(session.route)}`
      );
      if (session.route.kind === 'reticulum') {
        loggerLog(
          `[Presence] target=presence-reticulum transport_invalidate peer_addr=${session.address} sender_hash=${session.route.destinationHash} sessionId=${session.sessionId}`
        );
      }
    }

    for (const address of changedAddresses) {
      this.emitPresenceUpdate(address);
    }
    this.pruneReticulumOverlayState();
    if (removedSessions > 0) {
      loggerLog(
        `[Presence] Invalidated ${removedSessions} session(s) after transport degradation routeKind=${routeKind}`
      );
    }
  }

  private removeSession(address: string, sessionId: string): void {
    const key = `${address}:${sessionId}`;
    loggerLog(`[Presence] Removing session address=${address} sessionId=${sessionId}`);
    this.sessions.delete(key);
    this.removeSessionKey(address, key);
    this.emitPresenceUpdate(address);
    this.pruneReticulumOverlayState();
  }

  private addSessionKey(address: string, key: string): void {
    let keys = this.sessionKeysByAddress.get(address);
    if (!keys) {
      keys = new Set<string>();
      this.sessionKeysByAddress.set(address, keys);
    }
    keys.add(key);
    this.addressAggregates.delete(address);
  }

  private removeSessionKey(address: string, key: string): void {
    const keys = this.sessionKeysByAddress.get(address);
    if (!keys) return;
    keys.delete(key);
    if (keys.size === 0) {
      this.sessionKeysByAddress.delete(address);
    }
    this.addressAggregates.delete(address);
  }

  private getAddressAggregate(
    address: string,
    now: number = Date.now()
  ): PresenceAddressAggregate {
    const cached = this.addressAggregates.get(address);
    if (
      cached &&
      (cached.nextExpiryAt === null || now < cached.nextExpiryAt)
    ) {
      return cached;
    }

    const keys = this.sessionKeysByAddress.get(address);
    let liveSessionCount = 0;
    let lastSeen: number | null = null;
    let latestLiveSession: PresenceSession | null = null;
    let aggregateRouteSession: PresenceSession | null = null;
    let nextExpiryAt: number | null = null;

    if (keys) {
      for (const key of keys) {
        const session = this.sessions.get(key);
        if (!session) continue;
        if (lastSeen === null || session.lastSeen > lastSeen) {
          lastSeen = session.lastSeen;
        }
        const expiryAt = session.lastSeen + PRESENCE_SESSION_TIMEOUT_MS;
        if (now > expiryAt) continue;

        liveSessionCount++;
        if (nextExpiryAt === null || expiryAt < nextExpiryAt) {
          nextExpiryAt = expiryAt;
        }
        if (
          session.routeExpiresAt !== null &&
          (nextExpiryAt === null || session.routeExpiresAt < nextExpiryAt)
        ) {
          nextExpiryAt = session.routeExpiresAt;
        }
        if (
          !latestLiveSession ||
          session.lastSeen > latestLiveSession.lastSeen
        ) {
          latestLiveSession = session;
        }
        if (shouldPreferAggregateRoute(session, aggregateRouteSession, now)) {
          aggregateRouteSession = session;
        }
      }
    }

    const freshestRoute =
      aggregateRouteSession?.route ?? null;

    const aggregate: PresenceAddressAggregate = {
      liveSessionCount,
      lastSeen,
      status: latestLiveSession?.status ?? null,
      originNodeId:
        freshestRoute?.kind === 'mesh-node' ? freshestRoute.id : null,
      route: freshestRoute,
      nextExpiryAt,
    };

    if (keys && keys.size > 0) {
      this.addressAggregates.set(address, aggregate);
    } else {
      this.addressAggregates.delete(address);
    }

    return aggregate;
  }

  private emitPresenceUpdate(address: string, now: number = Date.now()): void {
    const aggregate = this.getAddressAggregate(address, now);
    loggerLog(
      `[Presence] Emitting update address=${address} online=${aggregate.liveSessionCount > 0} live_sessions=${aggregate.liveSessionCount} status=${aggregate.status ?? 'offline'} route=${describePresenceRoute(aggregate.route)} lastSeen=${aggregate.lastSeen ?? 'none'}`
    );
    if (aggregate.route?.kind === 'reticulum') {
      loggerLog(
        `[Presence] target=presence-reticulum emit peer_addr=${address} online=${aggregate.liveSessionCount > 0} sender_hash=${aggregate.route.destinationHash} lastSeen=${aggregate.lastSeen ?? 'none'}`
      );
    }
    this.emit('presence-updated', {
      address,
      online: aggregate.liveSessionCount > 0,
      status: aggregate.status,
    });
  }

  /**
   * Marks a Reticulum sender as a verified Qortal overlay peer after valid signed
   * presence. Latches once per destination hash: further envelopes on the same link do
   * not re-run mesh recompute or bridge sync — the overlay identity stays sticky across
   * brief link churn until {@link noteReticulumOverlayLinkClosed} ages out.
   */
  private promoteVerifiedReticulumPeer(
    destinationHash: string,
    address: string,
    now: number,
    source: string = 'presence'
  ): void {
    const hash = destinationHash.trim().toLowerCase();
    if (!hash) return;
    if (this.isSelfReticulumHash(hash)) return;
    this.reticulumCandidates.delete(hash);
    const existing = this.verifiedReticulumPeers.get(hash);
    if (existing) {
      this.verifiedReticulumPeers.set(hash, {
        destinationHash: hash,
        address: existing.address || address,
        lastSeen: now,
        verifiedAt: existing.verifiedAt,
        linkClosedAt: null,
      });
      return;
    }
    this.verifiedReticulumPeers.set(hash, {
      destinationHash: hash,
      address,
      lastSeen: now,
      verifiedAt: now,
      linkClosedAt: null,
    });
    this.recomputeReticulumActiveNeighbors(now);
    this.emit('reticulum-peer-verified', {
      destinationHash: hash,
      address,
      lastSeen: now,
      source,
    });
    this.emitReticulumOverlayChanged();
  }

  private pruneReticulumOverlayState(now: number = Date.now()): void {
    let changed = false;
    for (const [hash, peer] of [...this.verifiedReticulumPeers.entries()]) {
      if (
        peer.linkClosedAt !== null &&
        now - peer.linkClosedAt > RETICULUM_VERIFIED_PEER_LINK_CLOSE_GRACE_MS
      ) {
        this.verifiedReticulumPeers.delete(hash);
        changed = true;
      }
    }
    for (const [hash, candidate] of [...this.reticulumCandidates.entries()]) {
      if (now > candidate.proofDeadlineAt) {
        this.reticulumCandidates.delete(hash);
        changed = true;
      }
    }
    const neighborsChanged = this.recomputeReticulumActiveNeighbors(now);
    if (changed || neighborsChanged) {
      this.emitReticulumOverlayChanged();
    }
  }

  private recomputeReticulumActiveNeighbors(now: number): boolean {
    const nextVerified = this.activeReticulumNeighborHashes.filter(
      (hash) =>
        !this.isSelfReticulumHash(hash) && this.verifiedReticulumPeers.has(hash)
    );
    if (nextVerified.length < RETICULUM_OVERLAY_MAX_NEIGHBORS) {
      const seen = new Set(nextVerified.map((hash) => hash.toLowerCase()));
      const waitingVerified = [...this.verifiedReticulumPeers.values()]
        .filter((peer) => !seen.has(peer.destinationHash.toLowerCase()))
        .sort((a, b) => a.verifiedAt - b.verifiedAt || b.lastSeen - a.lastSeen);
      for (const peer of waitingVerified) {
        if (nextVerified.length >= RETICULUM_OVERLAY_MAX_NEIGHBORS) break;
        if (this.isSelfReticulumHash(peer.destinationHash)) continue;
        nextVerified.push(peer.destinationHash);
        seen.add(peer.destinationHash.toLowerCase());
      }
    }

    const verifiedChanged =
      nextVerified.length !== this.activeReticulumNeighborHashes.length ||
      nextVerified.some(
        (hash, idx) => hash !== this.activeReticulumNeighborHashes[idx]
      );
    if (verifiedChanged) {
      this.activeReticulumNeighborHashes = nextVerified;
    }

    const seen = new Set(nextVerified.map((h) => h.toLowerCase()));
    const publish: string[] = [...nextVerified];
    if (publish.length < RETICULUM_OVERLAY_MAX_NEIGHBORS) {
      const cand = [...this.reticulumCandidates.values()]
        .filter(
          (c) =>
            !this.isSelfReticulumHash(c.destinationHash) &&
            now <= c.proofDeadlineAt &&
            !seen.has(c.destinationHash.toLowerCase())
        )
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      for (const c of cand) {
        if (publish.length >= RETICULUM_OVERLAY_MAX_NEIGHBORS) break;
        publish.push(c.destinationHash);
        seen.add(c.destinationHash.toLowerCase());
      }
    }
    const publishChanged =
      publish.length !== this.activeReticulumPublishHashes.length ||
      publish.some((hash, idx) => hash !== this.activeReticulumPublishHashes[idx]);
    if (publishChanged) {
      this.activeReticulumPublishHashes = publish;
    }

    return verifiedChanged || publishChanged;
  }

  private emitReticulumOverlayChanged(): void {
    this.emit('reticulum-overlay-changed', {
      candidates: this.reticulumCandidates.size,
      verified: this.verifiedReticulumPeers.size,
      activeNeighbors: this.activeReticulumNeighborHashes.length,
      publishFanout: this.activeReticulumPublishHashes.length,
    });
  }
}

// ── Helpers for the renderer (exported for use via IPC) ──────────────────────

/**
 * Builds the canonical signed-data bytes for a presence announce.
 * The renderer calls this (or its own equivalent) to produce the bytes
 * it will sign with `nacl.sign.detached`.
 */
export function buildAnnounceSignedBytes(fields: SignedPresenceAnnounce): Uint8Array {
  return canonicalizeForSigning(fields as unknown as Record<string, unknown>);
}

export function buildHeartbeatSignedBytes(fields: SignedPresenceHeartbeat): Uint8Array {
  return canonicalizeForSigning(fields as unknown as Record<string, unknown>);
}

export function buildOfflineSignedBytes(fields: SignedPresenceOffline): Uint8Array {
  return canonicalizeForSigning(fields as unknown as Record<string, unknown>);
}

/**
 * Creates a ready-to-broadcast presence envelope with a new message ID and
 * TTL set. The renderer fills in the `signature` field before calling
 * `window.presence.announce/heartbeat/offline`.
 */
export function buildEnvelope(
  type: NetworkMessageType,
  payload: PresencePayload,
  timestamp: number,
  signature: string
): PresenceEnvelope {
  return {
    id: nodeCrypto.randomUUID(),
    type,
    senderAddress: payload.address,
    timestamp,
    payload,
    signature,
  };
}

// ── Module-level singleton ────────────────────────────────────────────────────

let presenceManager: PresenceManager | null = null;
let presenceTransportUnsubscribers: Array<() => void> = [];

function clearPresenceTransportSubscriptions(): void {
  for (const unsubscribe of presenceTransportUnsubscribers) unsubscribe();
  presenceTransportUnsubscribers = [];
  activePresenceTransports = [];
}

function subscribePresenceTransport(
  manager: PresenceManager,
  transport: PresenceTransport
): void {
  const unsubscribe = transport.subscribe({
    onEnvelope: (envelope, route) => {
      loggerLog(
        `[Presence] Transport delivered envelope via ${transport.kind} ${describePresenceEnvelope(envelope)} route=${describePresenceRoute(route)}`
      );
      void presenceManager?.handleEnvelope(envelope, route);
    },
    onCandidatePeerDiscovered: ({ peerHash, source }) => {
      manager.noteReticulumCandidateDiscovered(peerHash, source ?? transport.kind);
    },
    onOverlayLinkClosed: ({ peerHash, reason }) => {
      manager.noteReticulumOverlayLinkClosed(peerHash, reason);
    },
    onReady: () => {
      if (transport.kind === 'reticulum' && typeof transport.getLocalDestinationHash === 'function') {
        manager.setLocalReticulumDestinationHash(
          transport.getLocalDestinationHash() ?? null
        );
      }
      const cached = manager.getLastLocalEnvelope();
      loggerLog(
        `[Presence] Transport ready kind=${transport.kind} cached_local_envelope=${cached ? 'yes' : 'no'}`
      );
      if (!cached) return;
      void Promise.resolve(transport.publish(cached)).catch((err) => {
        loggerError('[Presence] Failed to re-publish cached envelope:', err);
      });
    },
    onDegraded: () => {
      loggerLog(`[Presence] Transport degraded kind=${transport.kind}`);
      if (transport.kind === 'reticulum') {
        manager.setLocalReticulumDestinationHash(null);
      }
      manager.invalidateTransportRoutes(transport.kind);
    },
  });
  presenceTransportUnsubscribers.push(unsubscribe);
  if (
    transport.kind === 'reticulum' &&
    typeof transport.getLocalDestinationHash === 'function'
  ) {
    const h = transport.getLocalDestinationHash();
    if (h) {
      manager.setLocalReticulumDestinationHash(h);
    }
  }
}

async function republishCachedPresenceToTransport(
  manager: PresenceManager,
  transport: PresenceTransport
): Promise<void> {
  const cached = manager.getLastLocalEnvelope();
  if (!cached) return;
  loggerLog(
    `[Presence] Re-publishing cached local envelope to attached transport kind=${transport.kind}`
  );
  try {
    await Promise.resolve(transport.publish(cached));
  } catch (err) {
    loggerError('[Presence] Failed to publish cached envelope to attached transport:', err);
  }
}

export function setPresenceManagerTransports(
  transports: PresenceTransport[] = []
): PresenceManager | null {
  if (!presenceManager) {
    activePresenceTransports = [...transports];
    return null;
  }
  clearPresenceTransportSubscriptions();
  activePresenceTransports = [...transports];
  for (const transport of transports) {
    subscribePresenceTransport(presenceManager, transport);
    void republishCachedPresenceToTransport(presenceManager, transport);
  }
  loggerLog(`[Presence] Updated manager transports=${transports.length}`);
  return presenceManager;
}

export function getPresenceManager(): PresenceManager | null {
  return presenceManager;
}

export function startPresenceManager(
  transports: PresenceTransport[] = []
): PresenceManager {
  if (presenceManager) {
    loggerLog('[Presence] Restarting existing manager.');
    clearPresenceTransportSubscriptions();
    presenceManager.stopCleanup();
    presenceManager.stopVerifyPool();
    presenceManager.removeAllListeners();
  }
  presenceManager = new PresenceManager();
  presenceManager.startVerifyPool();
  presenceManager.startCleanup();
  setPresenceManagerTransports(transports);

  loggerLog(`[Presence] Manager started transports=${transports.length}`);
  return presenceManager;
}

export async function publishPresenceEnvelope(
  envelope: PresenceEnvelope
): Promise<boolean> {
  const pm = getPresenceManager();
  if (!pm) {
    loggerLog(
      `[Presence] Refusing to publish without manager ${describePresenceEnvelope(envelope)}`
    );
    return false;
  }

  loggerLog(`[Presence] Publishing local envelope ${describePresenceEnvelope(envelope)}`);

  const accepted = await pm.handleEnvelope(envelope, { kind: 'local' });
  if (!accepted) {
    loggerLog(
      `[Presence] Local envelope was not accepted for publish ${describePresenceEnvelope(envelope)}`
    );
    return false;
  }

  if (presenceTransportUnsubscribers.length === 0) {
    loggerLog(
      `[Presence] No external transports active; local publish only ${describePresenceEnvelope(envelope)}`
    );
    return true;
  }

  let published = false;
  for (const transport of getActivePresenceTransports()) {
    try {
      const transportPublished = await transport.publish(envelope);
      loggerLog(
        `[Presence] Transport publish result kind=${transport.kind} published=${transportPublished ? 'yes' : 'no'} ${describePresenceEnvelope(envelope)}`
      );
      if (transport.kind === 'reticulum') {
        const paddr =
          typeof (envelope.payload as { address?: string })?.address === 'string'
            ? (envelope.payload as { address: string }).address
            : 'unknown';
        loggerLog(
          `[Presence] target=presence-reticulum tx=transport_publish kind=reticulum published=${transportPublished ? 'yes' : 'no'} peer_addr=${paddr} type=${envelope.type} envelope_id=${envelope.id ?? 'n/a'}`
        );
      }
      if (transportPublished) {
        published = true;
      }
    } catch (err) {
      loggerError('[Presence] Transport publish failed:', err);
    }
  }
  loggerLog(
    `[Presence] Finished publish published_any=${published ? 'yes' : 'no'} ${describePresenceEnvelope(envelope)}`
  );
  return published;
}

let activePresenceTransports: PresenceTransport[] = [];

function getActivePresenceTransports(): PresenceTransport[] {
  return activePresenceTransports;
}

export function stopPresenceManager(): void {
  if (presenceManager) {
    clearPresenceTransportSubscriptions();
    presenceManager.stopVerifyPool();
    presenceManager.stopCleanup();
    presenceManager.removeAllListeners();
    presenceManager = null;
  }
}
