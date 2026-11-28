import { describe, expect, it } from 'vitest';
import { levelUpBlocks } from '../../components/Minting/MintingStats';
import type { AccountInfo, GroupOf, TxRow } from './reads';
import {
  minterStandingOf,
  mintingNowOf,
  nameNotes,
  nextTrail,
  paymentTotals,
  qortUnits,
  sortGroups,
  levelProgressOf,
  TRAIL_MAX,
  visibleName,
} from './rules';

const OWNER = `QWWByH${'a'.repeat(23)}MUgKx`;

describe('nameNotes', () => {
  it('notes a name written like an address, or like its owner', () => {
    expect(nameNotes(`Q${'b'.repeat(33)}`, OWNER)).toEqual([
      { kind: 'addressLike' },
    ]);
    expect(nameNotes('Qabc…xyz', OWNER)).toEqual([{ kind: 'addressLike' }]);
    expect(nameNotes('qwwbyh-shop', OWNER)).toEqual([
      { kind: 'ownerPrefix', start: 'QWWBy' },
    ]);
    expect(nameNotes('shop-mugkx', OWNER)).toEqual([
      { kind: 'ownerSuffix', end: 'MUgKx' },
    ]);
    expect(nameNotes('Publisher', OWNER)).toEqual([]);
  });

  it('counts characters a reader cannot see', () => {
    expect(nameNotes('Pub\u200Blisher', OWNER)).toEqual([
      { kind: 'invisible', count: 1 },
    ]);
    expect(nameNotes('\u2800\u2800', OWNER)).toEqual([
      { kind: 'invisible', count: 2 },
    ]);
    expect(visibleName('Pub\u200Blisher')).toBe('Pub·lisher');
  });
});

const group = (groupId: number, extra: Partial<GroupOf> = {}): GroupOf => ({
  groupId,
  groupName: `g${groupId}`,
  owner: null,
  isOpen: true,
  memberCount: 10,
  isAdmin: false,
  created: null,
  description: null,
  ...extra,
});

describe('groups', () => {
  it("lists MINTER first, and the account's own groups first when asked", () => {
    const groups = [
      group(5, { groupName: 'beta' }),
      group(694, { groupName: 'MINTER' }),
      group(7, { groupName: 'alpha', isAdmin: true }),
      group(9, { groupName: 'gamma', owner: OWNER }),
    ];
    expect(sortGroups(groups, 'minter', OWNER).map((g) => g.groupId)).toEqual([
      694, 5, 7, 9,
    ]);
    expect(sortGroups(groups, 'roles', OWNER).map((g) => g.groupId)).toEqual([
      9, 7, 5, 694,
    ]);
    expect(sortGroups(groups, 'az', OWNER).map((g) => g.groupName)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'MINTER',
    ]);
  });

  it('reads where it stands in MINTER from its groups', () => {
    expect(minterStandingOf([group(1)])).toBe('outside');
    expect(minterStandingOf([group(694)])).toBe('member');
    expect(minterStandingOf([group(694, { isAdmin: true })])).toBe('admin');
  });
});

describe('mintingNowOf', () => {
  it('tells minting on its own from minting through reward shares', () => {
    const other = `Q${'c'.repeat(33)}`;
    expect(mintingNowOf([], OWNER)).toBeNull();
    expect(
      mintingNowOf([{ minterAddress: OWNER, recipientAddress: OWNER }], OWNER)
    ).toEqual({ self: true, others: [] });
    expect(
      mintingNowOf(
        [
          { minterAddress: other, recipientAddress: OWNER },
          { minterAddress: OWNER, recipientAddress: other },
        ],
        OWNER
      )
    ).toEqual({ self: false, others: [other] });
  });
});

describe('payments', () => {
  it('adds amounts exactly', () => {
    expect(qortUnits('0.1')).toBe(10_000_000n);
    expect(qortUnits('12.50000000')).toBe(1_250_000_000n);
    expect(qortUnits('nonsense')).toBe(0n);
    const tenths = Array.from(
      { length: 3 },
      (_, i): TxRow => ({
        type: 'PAYMENT',
        timestamp: i,
        signature: `s${i}`,
        creatorAddress: 'other',
        recipient: OWNER,
        amount: '0.1',
      })
    );
    // 0.1 + 0.1 + 0.1 in floating point is 0.30000000000000004.
    expect(paymentTotals(tenths, OWNER)).toEqual({ received: 0.3, sent: 0 });
  });
});

const accountAt = (level: number, blocksMinted: number): AccountInfo => ({
  address: OWNER,
  reference: null,
  publicKey: null,
  level,
  blocksMinted,
  blocksMintedAdjustment: 0,
  blocksMintedPenalty: 0,
});

describe('levelProgressOf', () => {
  it("counts the blocks to the next level as Hub's Minting window does", () => {
    const account = accountAt(3, 300_000);
    const timing = {
      height: 2_803_860,
      currentTimestamp: 2_000_000,
      dayBackTimestamp: 1_000_000,
    };
    const progress = levelProgressOf(account, timing);
    expect(progress.blocksToNext).toBe(
      levelUpBlocks(account, { height: timing.height })
    );
    expect(progress.next).toBe(4);
    // Of all the blocks level 4 needs (374,400), as User search and Home show it.
    expect(progress.fraction).toBeCloseTo(300_000 / 374_400, 5);
  });

  it("leaves the blocks to the next level out without the node's height", () => {
    expect(levelProgressOf(accountAt(3, 300_000), null)).toMatchObject({
      next: 4,
      blocksToNext: null,
      days: null,
    });
  });

  it('has no next level at the top', () => {
    expect(levelProgressOf(accountAt(10, 5_000_000), null)).toMatchObject({
      next: null,
      blocksToNext: null,
    });
  });
});

describe('nextTrail', () => {
  it('starts again unless opened from inside the Explorer, and goes back to a step', () => {
    expect(nextTrail(['A', 'B'], 'C', false)).toEqual(['C']);
    expect(nextTrail(['A', 'B'], 'C', true)).toEqual(['A', 'B', 'C']);
    expect(nextTrail(['A', 'B', 'C'], 'A', true)).toEqual(['A']);
    const long = Array.from({ length: TRAIL_MAX }, (_, i) => `x${i}`);
    expect(nextTrail(long, 'y', true)).toHaveLength(TRAIL_MAX);
  });
});
