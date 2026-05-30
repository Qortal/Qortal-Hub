/**
 * Qortal group call member gating: bind wallet public key to address and
 * restrict roster / key recipients to chain-reported group members.
 */

import Base58 from '../../encryption/Base58.js';
import publicKeyToAddress from '../../utils/generateWallet/publicKeyToAddress';

/** Derive Qortal address from wallet Ed25519 public key (base58). */
export function addressFromPublicKeyBase58(
  publicKeyBase58: string
): string | null {
  const trimmed = publicKeyBase58?.trim?.() ?? '';
  if (!trimmed) return null;
  try {
    const bytes = Base58.decode(trimmed);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return null;
    return publicKeyToAddress(bytes, false);
  } catch {
    return null;
  }
}

export function passesGroupCallMemberGate(opts: {
  claimedAddress: string;
  publicKeyBase58: string;
  memberSet: ReadonlySet<string>;
}): boolean {
  const derived = addressFromPublicKeyBase58(opts.publicKeyBase58);
  if (!derived || derived !== opts.claimedAddress) return false;
  return opts.memberSet.has(opts.claimedAddress);
}

export function filterRosterMapByMemberSet(
  roster: ReadonlyMap<string, { publicKey: string }>,
  memberSet: ReadonlySet<string>
): Map<string, { publicKey: string }> {
  const out = new Map<string, { publicKey: string }>();
  for (const [addr, v] of roster) {
    if (memberSet.has(addr)) out.set(addr, v);
  }
  return out;
}
