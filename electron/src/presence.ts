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
import nacl from 'tweetnacl';
import { log as loggerLog, error as loggerError } from './logger';
import type { P2PNetwork } from './p2p-network';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADDRESS_VERSION = 58;

export const PRESENCE_HEARTBEAT_INTERVAL_MS = 25_000;
export const PRESENCE_SESSION_TIMEOUT_MS = 70_000;
const MAX_PRESENCE_AGE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const PRESENCE_CLEANUP_INTERVAL_MS = 15_000;

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
  capabilities?: string[];
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
  clientVersion?: string;
  status: UserStatus;
  signatureValid: true;
}

export interface PresenceStatusResult {
  online: boolean;
  lastSeen: number | null;
  sessions: PresenceSession[];
}

// ── Utility: Base58 (ported from src/encryption/Base58.ts) ───────────────────

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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
 * Builds the signed-data object from a presence envelope.
 * Only the security-relevant fields are signed.
 */
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

/**
 * Verifies the detached Ed25519 signature on a presence envelope.
 * Returns true if the signature is valid.
 */
export function verifyPresenceSignature(envelope: PresenceEnvelope): boolean {
  try {
    const publicKeyBase58 = (envelope.payload as PresenceAnnouncePayload).publicKey;
    const publicKeyBytes = base58Decode(publicKeyBase58);
    const signatureBytes = base58Decode(envelope.signature);
    const message = canonicalizeForSigning(buildSignedData(envelope));
    return nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
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

function validateEnvelope(
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

  // 6. Signature verification
  if (!verifyPresenceSignature(envelope)) {
    return { ok: false, reason: 'invalid signature' };
  }

  return { ok: true };
}

// ── Presence Manager ──────────────────────────────────────────────────────────

export class PresenceManager extends EventEmitter {
  /** Key: `${address}:${sessionId}` */
  private sessions = new Map<string, PresenceSession>();

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

  // ── Message handling ────────────────────────────────────────────────────────

  /**
   * Handles an incoming presence envelope from a remote peer or from the
   * local renderer. Returns true if the message was accepted.
   *
   * `originNodeId` is the P2P nodeId in the message's `from` field.
   * `viaPeerId` is the directly-connected peer that delivered the message to
   * us. For direct peers these are the same value; for relayed peers they
   * differ. Use 'local' for both when called by the renderer directly.
   */
  handleEnvelope(
    raw: unknown,
    originNodeId: string,
    viaPeerId: string = originNodeId
  ): boolean {
    const envelope = raw as PresenceEnvelope;
    const now = Date.now();

    const result = validateEnvelope(envelope, now);
    if (result.ok === false) {
      loggerLog(`[Presence] Rejected envelope ${envelope?.id}: ${result.reason}`);
      return false;
    }

    const p = envelope.payload as PresenceAnnouncePayload;
    const { address, publicKey, sessionId } = p;

    // Monotonic timestamp check (replay protection within freshness window)
    const tsKey = `${address}:${sessionId}:${envelope.type}`;
    const prevTs = this.latestTimestamp.get(tsKey) ?? 0;
    if (envelope.timestamp <= prevTs) {
      return false;
    }
    this.latestTimestamp.set(tsKey, envelope.timestamp);

    // Apply to store
    if (envelope.type === 'PRESENCE_OFFLINE') {
      this.removeSession(address, sessionId);
      // Clear the local bootstrap cache so newly connected peers don't receive
      // a stale ANNOUNCE from a user who has explicitly appeared offline.
      if (originNodeId === 'local') this.lastLocalEnvelope = null;
    } else {
      const key = `${address}:${sessionId}`;
      const existing = this.sessions.get(key);
      this.sessions.set(key, {
        address,
        publicKey,
        sessionId,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: envelope.timestamp,
        originNodeId,
        viaPeerId,
        clientVersion:
          envelope.type === 'PRESENCE_ANNOUNCE'
            ? (p as PresenceAnnouncePayload).clientVersion
            : existing?.clientVersion,
        status: (p as PresenceAnnouncePayload).status as UserStatus ?? 'online',
        signatureValid: true,
      });
      // Cache the envelope so we can bootstrap newly connected peers
      // (originNodeId is 'local' when it came from our own renderer).
      if (originNodeId === 'local') {
        this.lastLocalEnvelope = envelope as PresenceEnvelope;
      }
    }

    this.emit('presence-updated', {
      address,
      online: this.isAddressOnline(address),
      status: this.getAddressStatus(address),
    });

    return true;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  isAddressOnline(address: string): boolean {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.address === address &&
        now - session.lastSeen <= PRESENCE_SESSION_TIMEOUT_MS
      ) {
        return true;
      }
    }
    return false;
  }

  getStatus(address: string): PresenceStatusResult {
    const now = Date.now();
    const active: PresenceSession[] = [];
    let mostRecentSeen: number | null = null;

    for (const session of this.sessions.values()) {
      if (session.address !== address) continue;
      if (now - session.lastSeen <= PRESENCE_SESSION_TIMEOUT_MS) {
        active.push(session);
      }
      if (mostRecentSeen === null || session.lastSeen > mostRecentSeen) {
        mostRecentSeen = session.lastSeen;
      }
    }

    return {
      online: active.length > 0,
      lastSeen: mostRecentSeen,
      sessions: active,
    };
  }

  getAllOnline(): PresenceSession[] {
    const now = Date.now();
    const seen = new Set<string>();
    const result: PresenceSession[] = [];
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen <= PRESENCE_SESSION_TIMEOUT_MS) {
        if (!seen.has(session.address)) {
          seen.add(session.address);
        }
        result.push(session);
      }
    }
    return result;
  }

  getOnlineAddresses(): string[] {
    const now = Date.now();
    const addresses = new Set<string>();
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen <= PRESENCE_SESSION_TIMEOUT_MS) {
        addresses.add(session.address);
      }
    }
    return Array.from(addresses);
  }

  /** Returns the most-recently-seen active status for an address, or null. */
  getAddressStatus(address: string): UserStatus | null {
    const now = Date.now();
    let best: PresenceSession | null = null;
    for (const session of this.sessions.values()) {
      if (session.address !== address) continue;
      if (now - session.lastSeen > PRESENCE_SESSION_TIMEOUT_MS) continue;
      if (!best || session.lastSeen > best.lastSeen) best = session;
    }
    return best?.status ?? null;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  cleanupExpired(): void {
    const now = Date.now();
    const changedAddresses = new Set<string>();

    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastSeen > PRESENCE_SESSION_TIMEOUT_MS) {
        this.sessions.delete(key);
        changedAddresses.add(session.address);
      }
    }

    // Also evict old monotonic timestamp entries
    for (const [key, ts] of this.latestTimestamp.entries()) {
      if (now - ts > MAX_PRESENCE_AGE_MS * 5) {
        this.latestTimestamp.delete(key);
      }
    }

    for (const address of changedAddresses) {
      this.emit('presence-updated', {
        address,
        online: this.isAddressOnline(address),
        status: this.getAddressStatus(address),
      });
    }
  }

  removeSessionsForPeer(peerId: string): void {
    if (!peerId) return;

    const changedAddresses = new Set<string>();

    for (const [key, session] of this.sessions.entries()) {
      // Only drop immediately when the disconnected peer was the origin node
      // itself. Relayed sessions may still be reachable through another path,
      // so they should stay online until they naturally time out or refresh
      // via a new route.
      if (session.originNodeId !== peerId || session.viaPeerId !== peerId) {
        continue;
      }
      this.sessions.delete(key);
      changedAddresses.add(session.address);
    }

    for (const address of changedAddresses) {
      this.emit('presence-updated', {
        address,
        online: this.isAddressOnline(address),
        status: this.getAddressStatus(address),
      });
    }
  }

  private removeSession(address: string, sessionId: string): void {
    this.sessions.delete(`${address}:${sessionId}`);
    this.emit('presence-updated', {
      address,
      online: this.isAddressOnline(address),
      status: this.getAddressStatus(address),
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

export function getPresenceManager(): PresenceManager | null {
  return presenceManager;
}

export function startPresenceManager(p2p: P2PNetwork): PresenceManager {
  if (presenceManager) {
    presenceManager.stopCleanup();
    presenceManager.removeAllListeners();
  }
  presenceManager = new PresenceManager();
  presenceManager.startCleanup();

  // Feed incoming P2P broadcast messages into the presence manager when they
  // carry a presence envelope. The P2P layer already gossiped the message to
  // other peers — no re-broadcast needed here.
  p2p.on('message', ({ from, via, data }) => {
    if (
      data !== null &&
      typeof data === 'object' &&
      PRESENCE_MESSAGE_TYPES.has((data as PresenceEnvelope).type)
    ) {
      presenceManager?.handleEnvelope(data, from, via ?? from);
    }
  });

  p2p.on('peer-connected', ({ id }) => {
    // Immediately send our own cached presence to the newly connected peer so
    // they learn we're online without waiting up to 25 s for the next heartbeat.
    const cached = presenceManager?.getLastLocalEnvelope();
    if (cached) {
      p2p.send(id, cached);
    }
  });

  p2p.on('peer-disconnected', ({ id }) => {
    presenceManager?.removeSessionsForPeer(id);
  });

  loggerLog('[Presence] Manager started.');
  return presenceManager;
}

export function stopPresenceManager(): void {
  if (presenceManager) {
    presenceManager.stopCleanup();
    presenceManager.removeAllListeners();
    presenceManager = null;
  }
}
