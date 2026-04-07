/**
 * Shared Ed25519 verification used by worker threads and main-thread fallback.
 */

import nacl from 'tweetnacl';
import {
  deriveAddressFromPublicKey,
  canonicalizeForSigning,
  base58Decode,
} from './presence';

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
    return nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
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
    return nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
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
    const msgBytes = canonicalizeForSigning(fields);
    const sigBytes = base58Decode(signature) as Uint8Array;
    const keyBytes = base58Decode(fromPublicKey) as Uint8Array;
    return nacl.sign.detached.verify(msgBytes, sigBytes, keyBytes);
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
    return nacl.sign.detached.verify(msgBytes, sigBytes, keyBytes);
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
