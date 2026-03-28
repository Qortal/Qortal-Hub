/**
 * Manual QA (two clients): member and non-member of the same Qortal group join
 * `gcall-qortal-{id}`; non-member must not appear on the member-gated roster and
 * must not receive a room key from an honest root.
 */
import { describe, expect, it } from 'vitest';
import {
  addressFromPublicKeyBase58,
  filterRosterMapByMemberSet,
  passesGroupCallMemberGate,
} from './gcall-member-gate';

describe('gcall-member-gate', () => {
  it('addressFromPublicKeyBase58 returns null for invalid input', () => {
    expect(addressFromPublicKeyBase58('')).toBeNull();
    expect(addressFromPublicKeyBase58('not-valid-base58!!!')).toBeNull();
  });

  it('passesGroupCallMemberGate rejects empty pubkey', () => {
    expect(
      passesGroupCallMemberGate({
        claimedAddress: 'QLtrHewTXBSui3Bo6S8uC7yXbN1rRCh4af',
        publicKeyBase58: '',
        memberSet: new Set(['QLtrHewTXBSui3Bo6S8uC7yXbN1rRCh4af']),
      })
    ).toBe(false);
  });

  it('filterRosterMapByMemberSet intersects with member set', () => {
    const roster = new Map([
      ['A', { publicKey: 'pkA' }],
      ['B', { publicKey: 'pkB' }],
    ]);
    const filtered = filterRosterMapByMemberSet(roster, new Set(['B']));
    expect([...filtered.keys()]).toEqual(['B']);
    expect(filtered.get('B')).toEqual({ publicKey: 'pkB' });
  });
});
