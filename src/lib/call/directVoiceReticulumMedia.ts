/**
 * Direct (1:1) voice media over Reticulum — shared with group calls via GroupCallManager.
 *
 * Uses a synthetic room id `dmv:<sha256HexPrefix>` — prefix is short for the Reticulum `R` field;
 * digest is the first 18 hex chars (72 bits) of UTF-8 SHA-256 of the canonical `direct:…` chatId.
 * DM joins omit `joinGeneration` on the wire. The full chatId is stored on `GroupRoom.chatId`.
 */

import ed2curve from '../../encryption/ed2curve';
import nacl from '../../encryption/nacl-fast';
import {
  compactDmVoiceJoinWireChatId,
  DM_VOICE_ROOM_PREFIX,
} from './dmVoiceWire';
import { buildMediaKeyCommitmentHex } from '../group-call/mediaKeyCommitment';

export { DM_VOICE_ROOM_PREFIX };

/** Hex chars from SHA-256 kept in `buildDmVoiceRoomId` (wire-size bound; full hash is 64 hex). */
export const DM_VOICE_ROOM_ID_DIGEST_HEX_LEN = 18;

export async function buildDmVoiceRoomId(directChatId: string): Promise<string> {
  const digest = await sha256Hex(directChatId);
  return `${DM_VOICE_ROOM_PREFIX}${digest.slice(0, DM_VOICE_ROOM_ID_DIGEST_HEX_LEN)}`;
}

export function isDmVoiceRoomId(roomId: string | null | undefined): boolean {
  if (typeof roomId !== 'string' || !roomId.startsWith(DM_VOICE_ROOM_PREFIX)) {
    return false;
  }
  const rest = roomId.slice(DM_VOICE_ROOM_PREFIX.length);
  return /^[0-9a-f]{18}$/i.test(rest);
}

export const GCALL_KEY_MESSAGE_VERSION = 3;

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildGcKeyDigest(
  toAddress: string,
  encryptedKey: string
): Promise<string> {
  return sha256Hex(JSON.stringify({ encryptedKey, toAddress }));
}

/** Local hub Reticulum destination hash (32 hex) from bridge; required for GC_JOIN. */
export async function fetchLocalReticulumDestinationHash(): Promise<string | null> {
  const fn = (
    window as Window & {
      electronAPI?: {
        reticulumGetLocalDestinationHash?: () => Promise<{
          destinationHash: string | null;
        }>;
      };
    }
  ).electronAPI?.reticulumGetLocalDestinationHash;
  if (typeof fn !== 'function') {
    return null;
  }
  const maxAttempts = 35;
  const delayMs = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const j = await fn();
      const raw = j?.destinationHash;
      if (typeof raw === 'string') {
        const h = raw.replace(/\s/g, '').trim().toLowerCase();
        if (/^[0-9a-f]{32}$/.test(h)) {
          return h;
        }
      }
    } catch {
      /* retry */
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

/** RNS.Identity public key (64 bytes, standard base64) for GC_JOIN wire `rk`; optional. */
export async function fetchLocalReticulumIdentityPublicKeyBase64(): Promise<
  string | null
> {
  const fn = (
    window as Window & {
      electronAPI?: {
        reticulumGetLocalIdentityPublicKeyBase64?: () => Promise<{
          publicKeyBase64: string | null;
        }>;
      };
    }
  ).electronAPI?.reticulumGetLocalIdentityPublicKeyBase64;
  if (typeof fn !== 'function') {
    return null;
  }
  try {
    const j = await fn();
    const raw = j?.publicKeyBase64;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

async function signGroupCallFields(
  fields: Record<string, unknown>
): Promise<string> {
  const result = await (window as any).sendMessage(
    'signPresenceMessage',
    fields,
    10_000
  );
  if (result?.error) throw new Error(String(result.error));
  if (typeof result?.signature !== 'string')
    throw new Error('signPresenceMessage returned no signature');
  return result.signature as string;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return btoa(s);
}

function base58DecodeRenderer(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes: number[] = [];
  let num = BigInt(0);
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58 char');
    num = num * BigInt(58) + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  for (let i = 0; i < hex.length; i += 2)
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return new Uint8Array(bytes);
}

/**
 * Encrypt a 32-byte room media key for one peer (same wire format as group calls).
 */
export function encryptRoomKeyForPeer(
  roomKey32: Uint8Array,
  recipientPublicKeyBase58: string
): string {
  const recipientPkBytes = base58DecodeRenderer(recipientPublicKeyBase58);
  const recipientCurve25519PK = ed2curve.convertPublicKey(recipientPkBytes);
  const ephemeralKP = nacl.box.keyPair();
  const sharedKey = nacl.box.before(
    recipientCurve25519PK,
    ephemeralKP.secretKey
  );
  const nonce = nacl.randomBytes(24);
  const ciphertext = nacl.box.after(roomKey32, nonce, sharedKey);
  const combined = new Uint8Array(32 + 24 + ciphertext.length);
  combined.set(ephemeralKP.publicKey, 0);
  combined.set(nonce, 32);
  combined.set(ciphertext, 56);
  return uint8ToBase64(combined);
}

function normalizeRkBase64ForGcJoinRkSign(rk: string): string {
  return rk.replace(/=+$/u, '');
}

export async function signGcJoin(params: {
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  timestamp: number;
  /** Omitted for DM voice to keep GC_JOIN under Reticulum MDU (wire has no `j`). */
  joinGeneration?: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64?: string | null;
}): Promise<{ joinSig: string; joinRkSig?: string } | null> {
  const wireChatId = compactDmVoiceJoinWireChatId(params.roomId, params.chatId);
  const jg = params.joinGeneration;
  const joinSig = await signGroupCallFields({
    type: 'GC_JOIN',
    roomId: params.roomId,
    chatId: wireChatId,
    fromAddress: params.fromAddress,
    fromPublicKey: params.fromPublicKey,
    timestamp: params.timestamp,
    reticulumDestinationHash: params.reticulumDestinationHash,
    ...(typeof jg === 'number' && Number.isFinite(jg) ? { joinGeneration: jg } : {}),
  }).catch(() => '');
  if (!joinSig) return null;
  if (!params.reticulumIdentityPublicKeyBase64) {
    return { joinSig };
  }
  const rkForSign = normalizeRkBase64ForGcJoinRkSign(
    params.reticulumIdentityPublicKeyBase64
  );
  const joinRkSig = await signGroupCallFields({
    type: 'GC_JOIN_RK',
    roomId: params.roomId,
    chatId: wireChatId,
    fromAddress: params.fromAddress,
    fromPublicKey: params.fromPublicKey,
    timestamp: params.timestamp,
    reticulumDestinationHash: params.reticulumDestinationHash,
    reticulumIdentityPublicKeyBase64: rkForSign,
    ...(typeof jg === 'number' && Number.isFinite(jg) ? { joinGeneration: jg } : {}),
  }).catch(() => '');
  if (!joinRkSig) return null;
  return { joinSig, joinRkSig };
}

export async function joinDirectVoiceReticulumRoom(opts: {
  roomId: string;
  chatId: string;
  address: string;
  publicKey: string;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64?: string | null;
}): Promise<{
  success: boolean;
  callSessionId?: string;
  mediaSessionGeneration?: number;
  error?: string;
}> {
  const gc = (window as any).groupCall;
  if (!gc?.join) {
    return { success: false, error: 'groupCall unavailable' };
  }
  const ts = Date.now();
  const signatures = await signGcJoin({
    roomId: opts.roomId,
    chatId: opts.chatId,
    fromAddress: opts.address,
    fromPublicKey: opts.publicKey,
    timestamp: ts,
    reticulumDestinationHash: opts.reticulumDestinationHash,
    reticulumIdentityPublicKeyBase64: opts.reticulumIdentityPublicKeyBase64,
  });
  if (!signatures?.joinSig) {
    return { success: false, error: 'join-sign-failed' };
  }
  await gc.setLocalAddresses?.([opts.address], 'dm').catch(() => {});
  const res = await gc.join(
    opts.roomId,
    opts.chatId,
    opts.address,
    signatures.joinSig,
    opts.publicKey,
    ts,
    opts.reticulumDestinationHash,
    undefined,
    0,
    opts.reticulumIdentityPublicKeyBase64 ?? undefined,
    signatures.joinRkSig
  );
  return res;
}

export async function leaveDirectVoiceReticulumRoom(opts: {
  roomId: string;
  address: string;
  publicKey: string;
}): Promise<void> {
  const gc = (window as any).groupCall;
  if (!gc?.leave) return;
  const ts = Date.now();
  const sig = await signGroupCallFields({
    type: 'GC_LEAVE',
    roomId: opts.roomId,
    fromAddress: opts.address,
    fromPublicKey: opts.publicKey,
    timestamp: ts,
  }).catch(() => '');
  await gc.leave(opts.roomId, opts.address, sig, opts.publicKey, ts);
  await gc.setLocalAddresses?.([], 'dm').catch(() => {});
}

export async function sendDirectVoiceRoomKey(opts: {
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  roomKey: Uint8Array;
  callSessionId: string;
  mediaSessionGeneration: number;
  recipientPublicKey: string;
}): Promise<boolean> {
  const gc = (window as any).groupCall;
  if (!gc?.sendKey) return false;

  const encryptedKey = encryptRoomKeyForPeer(
    opts.roomKey,
    opts.recipientPublicKey
  );
  const keyCommitment = await buildMediaKeyCommitmentHex(
    opts.roomKey,
    opts.callSessionId,
    opts.mediaSessionGeneration
  );
  const encryptedKeyDigest = await buildGcKeyDigest(
    opts.toAddress,
    encryptedKey
  );
  const ts = Date.now();
  const sig = await signGroupCallFields({
    type: 'GC_KEY',
    roomId: opts.roomId,
    toAddress: opts.toAddress,
    fromAddress: opts.fromAddress,
    fromPublicKey: opts.fromPublicKey,
    timestamp: ts,
    keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
    callSessionId: opts.callSessionId,
    mediaSessionGeneration: opts.mediaSessionGeneration,
    keyCommitment,
    encryptedKeyDigest,
  }).catch(() => '');
  if (!sig) return false;

  await gc.sendKey(
    opts.roomId,
    opts.toAddress,
    encryptedKey,
    opts.fromAddress,
    sig,
    opts.fromPublicKey,
    ts,
    {
      keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
      callSessionId: opts.callSessionId,
      mediaSessionGeneration: opts.mediaSessionGeneration,
      keyCommitment,
      encryptedKeyDigest,
    }
  );
  return true;
}

export async function sendDirectVoiceRoomKeyRequest(opts: {
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  callSessionId: string;
  mediaSessionGeneration: number;
}): Promise<boolean> {
  const gc = (window as any).groupCall;
  if (!gc?.sendKeyRequest) return false;

  const ts = Date.now();
  const sig = await signGroupCallFields({
    type: 'GC_KEY_REQUEST',
    roomId: opts.roomId,
    toAddress: opts.toAddress,
    fromAddress: opts.fromAddress,
    fromPublicKey: opts.fromPublicKey,
    callSessionId: opts.callSessionId,
    mediaSessionGeneration: opts.mediaSessionGeneration,
    keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
    timestamp: ts,
  }).catch(() => '');
  if (!sig) return false;

  await gc.sendKeyRequest(
    opts.roomId,
    opts.toAddress,
    opts.fromAddress,
    sig,
    opts.fromPublicKey,
    ts,
    opts.callSessionId,
    opts.mediaSessionGeneration
  );
  return true;
}
