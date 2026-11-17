/**
 * Shared native Ed25519 operations used by worker threads and Electron main.
 */

import * as nodeCrypto from 'crypto';
import {
  deriveAddressFromPublicKey,
  canonicalizeForSigning,
  base58Decode,
} from './presence';

export const ED25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PUBLIC_KEY_CACHE_MAX = 1_024;
const ed25519PublicKeyCache = new Map<string, nodeCrypto.KeyObject>();

export type NativeEd25519KeyPair = {
  privateKey: nodeCrypto.KeyObject;
  publicKey: Uint8Array;
};

export function generateNativeEd25519KeyPair(): NativeEd25519KeyPair {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  if (
    publicKeyDer.byteLength !==
      ED25519_SPKI_PREFIX.byteLength + ED25519_PUBLIC_KEY_BYTES ||
    !publicKeyDer.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)
  ) {
    throw new Error('Unexpected native Ed25519 public key format');
  }
  return {
    privateKey,
    publicKey: new Uint8Array(
      publicKeyDer.subarray(ED25519_SPKI_PREFIX.byteLength)
    ),
  };
}

export function signEd25519Detached(
  message: Uint8Array,
  privateKey: nodeCrypto.KeyObject
): Uint8Array {
  if (
    privateKey.type !== 'private' ||
    privateKey.asymmetricKeyType !== 'ed25519'
  ) {
    throw new Error('Invalid native Ed25519 private key');
  }
  const signature = nodeCrypto.sign(null, Buffer.from(message), privateKey);
  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    throw new Error('Unexpected native Ed25519 signature size');
  }
  return new Uint8Array(signature);
}

export function verifyEd25519Detached(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    if (
      signature.byteLength !== ED25519_SIGNATURE_BYTES ||
      publicKey.byteLength !== ED25519_PUBLIC_KEY_BYTES
    ) {
      return false;
    }

    const publicKeyBytes = Buffer.from(publicKey);
    const cacheKey = publicKeyBytes.toString('hex');
    let publicKeyObject = ed25519PublicKeyCache.get(cacheKey);
    if (publicKeyObject) {
      ed25519PublicKeyCache.delete(cacheKey);
      ed25519PublicKeyCache.set(cacheKey, publicKeyObject);
    } else {
      publicKeyObject = nodeCrypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
        format: 'der',
        type: 'spki',
      });
      if (ed25519PublicKeyCache.size >= ED25519_PUBLIC_KEY_CACHE_MAX) {
        const oldestKey = ed25519PublicKeyCache.keys().next().value;
        if (typeof oldestKey === 'string') {
          ed25519PublicKeyCache.delete(oldestKey);
        }
      }
      ed25519PublicKeyCache.set(cacheKey, publicKeyObject);
    }

    return nodeCrypto.verify(
      null,
      Buffer.from(message),
      publicKeyObject,
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

export type Ed25519VerifyPayload =
  | {
      kind: 'gc';
      fields: Record<string, unknown>;
      signature: string;
      fromPublicKey: string;
      fromAddress: string;
    }
  | {
      kind: 'chat';
      signedFields: Record<string, unknown>;
      signature: string;
      authorPublicKey: string;
      authorAddress: string;
    }
  | {
      kind: 'presence';
      signedFields: Record<string, unknown>;
      signature: string;
      publicKeyBase58: string;
    }
  | {
      kind: 'call_request';
      fields: Record<string, unknown>;
      signature: string;
      fromPublicKey: string;
    }
  | {
      kind: 'call_signed';
      wireType: string;
      callId: string;
      timestamp: number;
      signature: string;
      fromPublicKey: string;
      expectedAddress: string;
    };

export function verifyGcDetached(
  fields: Record<string, unknown>,
  signature: string,
  fromPublicKey: string,
  fromAddress: string
): boolean {
  try {
    const derived = deriveAddressFromPublicKey(fromPublicKey);
    if (derived !== fromAddress) return false;
    const pkBytes = base58Decode(fromPublicKey);
    const sigBytes = base58Decode(signature);
    const msgBytes = canonicalizeForSigning(fields);
    return verifyEd25519Detached(msgBytes, sigBytes, pkBytes);
  } catch {
    return false;
  }
}

export function verifyChatDetached(
  signedFields: Record<string, unknown>,
  signature: string,
  authorPublicKey: string,
  authorAddress: string
): boolean {
  return verifyGcDetached(
    signedFields,
    signature,
    authorPublicKey,
    authorAddress
  );
}

export function verifyPresenceDetached(
  signedFields: Record<string, unknown>,
  signature: string,
  publicKeyBase58: string
): boolean {
  try {
    const pkBytes = base58Decode(publicKeyBase58);
    const sigBytes = base58Decode(signature);
    const msgBytes = canonicalizeForSigning(signedFields);
    return verifyEd25519Detached(msgBytes, sigBytes, pkBytes);
  } catch {
    return false;
  }
}

export function verifyCallRequestDetached(
  fields: Record<string, unknown>,
  signature: string,
  fromPublicKey: string
): boolean {
  try {
    const msgBytes = new Uint8Array(canonicalizeForSigning(fields));
    const sigBytes = new Uint8Array(base58Decode(signature));
    const keyBytes = new Uint8Array(base58Decode(fromPublicKey));
    return verifyEd25519Detached(msgBytes, sigBytes, keyBytes);
  } catch {
    return false;
  }
}

export function verifyCallSignedDetached(
  wireType: string,
  callId: string,
  timestamp: number,
  signature: string,
  fromPublicKey: string,
  expectedAddress: string
): boolean {
  try {
    const skew = Date.now() - timestamp;
    if (skew > 30_000 || skew < -10_000) return false;
    const derived = deriveAddressFromPublicKey(fromPublicKey);
    if (derived !== expectedAddress) return false;
    const msgBytes = canonicalizeForSigning({ callId, timestamp, type: wireType });
    const sigBytes = base58Decode(signature) as Uint8Array;
    const keyBytes = base58Decode(fromPublicKey) as Uint8Array;
    return verifyEd25519Detached(msgBytes, sigBytes, keyBytes);
  } catch {
    return false;
  }
}

export function runEd25519VerifySync(payload: Ed25519VerifyPayload): boolean {
  switch (payload.kind) {
    case 'gc':
      return verifyGcDetached(
        payload.fields,
        payload.signature,
        payload.fromPublicKey,
        payload.fromAddress
      );
    case 'chat':
      return verifyChatDetached(
        payload.signedFields,
        payload.signature,
        payload.authorPublicKey,
        payload.authorAddress
      );
    case 'presence':
      return verifyPresenceDetached(
        payload.signedFields,
        payload.signature,
        payload.publicKeyBase58
      );
    case 'call_request':
      return verifyCallRequestDetached(
        payload.fields,
        payload.signature,
        payload.fromPublicKey
      );
    case 'call_signed':
      return verifyCallSignedDetached(
        payload.wireType,
        payload.callId,
        payload.timestamp,
        payload.signature,
        payload.fromPublicKey,
        payload.expectedAddress
      );
    default:
      return false;
  }
}
