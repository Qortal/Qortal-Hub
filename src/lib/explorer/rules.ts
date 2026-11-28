/**
 * The Explorer's small rules: notes on how a name is written, the orders
 * an account's groups can be listed in, where it stands in MINTER, who it
 * mints with, what its newest payments add up to, its level progress, and
 * the trail of accounts opened one from another. Pure: no reads, no text
 * (the components put these into words through i18n).
 */
import {
  accountTargetBlocks,
  levelUpBlocks,
  levelUpDays,
} from '../../components/Minting/MintingStats';
import {
  MINTER_GROUP_ID,
  type AccountInfo,
  type GroupOf,
  type NodeTiming,
  type OnlineShare,
  type TxRow,
} from './reads';

// ---- Names ------------------------------------------------------------------------------

export type NameNote =
  | { kind: 'addressLike' }
  | { kind: 'ownerPrefix'; start: string }
  | { kind: 'ownerSuffix'; end: string }
  | { kind: 'invisible'; count: number };

const ADDRESS_LIKE_NAME = /^[QA][1-9A-HJ-NP-Za-km-z]{25,34}$/;
/** Written as a shortened address: "Qabc…xyz" or "Qabc...xyz". */
const SHORT_ADDRESS_LIKE_NAME =
  /^[QA][1-9A-HJ-NP-Za-km-z]{2,10}(\.{2,}|…)[1-9A-HJ-NP-Za-km-z]{2,10}$/;
/**
 * Characters that show as nothing or as blank space: format controls,
 * zero-width characters, the Braille blank, Hangul fillers and odd spaces.
 * An ordinary space between words isn't counted.
 */
const INVISIBLE =
  /[\p{Cf}\u2800\u3164\uFFA0\u115F\u1160\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu;

/** How many characters of `name` a reader can't see. */
export const invisibleCount = (name: string): number =>
  name.match(INVISIBLE)?.length ?? 0;

/** Facts about how `name`, owned by `owner`, is written (none for an ordinary name). */
export function nameNotes(name: string, owner: string): NameNote[] {
  const notes: NameNote[] = [];
  const trimmed = name.trim();
  if (
    ADDRESS_LIKE_NAME.test(trimmed) ||
    SHORT_ADDRESS_LIKE_NAME.test(trimmed)
  ) {
    notes.push({ kind: 'addressLike' });
  } else if (owner.length > 10 && trimmed.length >= 5) {
    const start = owner.slice(0, 5);
    const end = owner.slice(-5);
    if (trimmed.toLowerCase().startsWith(start.toLowerCase()))
      notes.push({ kind: 'ownerPrefix', start });
    if (trimmed.toLowerCase().endsWith(end.toLowerCase()))
      notes.push({ kind: 'ownerSuffix', end });
  }
  const hidden = invisibleCount(name);
  if (hidden > 0 || (name.length > 0 && trimmed.length === 0))
    notes.push({ kind: 'invisible', count: Math.max(hidden, 1) });
  return notes;
}

/** The name as it can be read: characters a reader can't see shown as "·". */
export function visibleName(name: string): string {
  return name.replace(INVISIBLE, '·');
}

// ---- Groups and MINTER --------------------------------------------------------------------

export const GROUP_SORTS = ['minter', 'az', 'members', 'roles'] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];

export const isGroupSort = (value: unknown): value is GroupSort =>
  GROUP_SORTS.includes(value as GroupSort);

const groupLabel = (group: GroupOf) => group.groupName || `#${group.groupId}`;
const byName = (a: GroupOf, b: GroupOf) =>
  groupLabel(a).localeCompare(groupLabel(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });

/** Its part in a group: 0 owner, 1 admin, 2 member. */
const roleOf = (group: GroupOf, address: string) =>
  group.owner === address ? 0 : group.isAdmin ? 1 : 2;

/** The groups in `sort`'s order, as a new list. */
export function sortGroups(
  groups: readonly GroupOf[],
  sort: GroupSort,
  address: string
): GroupOf[] {
  const list = [...groups];
  switch (sort) {
    case 'minter':
      return [
        ...list.filter((group) => group.groupId === MINTER_GROUP_ID),
        ...list.filter((group) => group.groupId !== MINTER_GROUP_ID),
      ];
    case 'az':
      return list.sort(byName);
    case 'members':
      return list.sort(
        (a, b) => (b.memberCount ?? -1) - (a.memberCount ?? -1) || byName(a, b)
      );
    case 'roles':
      return list.sort(
        (a, b) => roleOf(a, address) - roleOf(b, address) || byName(a, b)
      );
  }
}

/** Where an account stands in MINTER, from the groups it is in. */
export type MinterStanding = 'admin' | 'member' | 'outside';

export function minterStandingOf(groups: readonly GroupOf[]): MinterStanding {
  const minter = groups.find((group) => group.groupId === MINTER_GROUP_ID);
  if (!minter) return 'outside';
  return minter.isAdmin ? 'admin' : 'member';
}

// ---- Minting ----------------------------------------------------------------------------

export interface MintingNow {
  /** It mints with its own key. */
  self: boolean;
  /** The other accounts it shares a reward-share key with, online now. */
  others: string[];
}

/** What the online list says about `address`; null when it isn't minting. */
export function mintingNowOf(
  shares: readonly OnlineShare[],
  address: string
): MintingNow | null {
  let self = false;
  const others: string[] = [];
  for (const share of shares) {
    if (share.minterAddress !== address && share.recipientAddress !== address)
      continue;
    if (share.minterAddress === share.recipientAddress) self = true;
    else {
      const other =
        share.minterAddress === address
          ? share.recipientAddress
          : share.minterAddress;
      if (!others.includes(other)) others.push(other);
    }
  }
  return self || others.length ? { self, others } : null;
}

// ---- Payments ---------------------------------------------------------------------------

const UNITS = 100_000_000n;

/** A QORT amount as Core writes it ("12.5", "0.00000001") in 1e-8 units, exactly. */
export function qortUnits(amount: unknown): bigint {
  const text = String(amount ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d{0,8})\d*)?$/.exec(text);
  if (!match) return 0n;
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(whole) * UNITS + BigInt(fraction.padEnd(8, '0') || '0');
  return sign ? -units : units;
}

/** 1e-8 units back to a number of QORT, for display. */
export const unitsToQort = (units: bigint): number =>
  Number(units / UNITS) + Number(units % UNITS) / 1e8;

/** What `owner` received and sent in `payments`, in QORT. */
export function paymentTotals(
  payments: readonly TxRow[],
  owner: string
): { received: number; sent: number } {
  let received = 0n;
  let sent = 0n;
  for (const payment of payments) {
    if (payment.type !== 'PAYMENT') continue;
    const units = qortUnits(payment.amount);
    if (payment.recipient === owner) received += units;
    if (payment.creatorAddress === owner) sent += units;
  }
  return { received: unitsToQort(received), sent: unitsToQort(sent) };
}

// ---- Level --------------------------------------------------------------------------------

export interface LevelProgress {
  level: number;
  /** The next level, or null at the top. */
  next: number | null;
  /** 0–1 of all the blocks the next level needs. */
  fraction: number;
  /** Blocks still to mint for the next level, as Hub's Minting window counts them (it needs the node's height). */
  blocksToNext: number | null;
  /** About how many days of minting that is, when the node's pace is known. */
  days: number | null;
}

/** Blocks minted as Hub's Minting window counts them for levels. */
export const countedBlocks = (account: AccountInfo): number =>
  account.blocksMinted + account.blocksMintedAdjustment;

/**
 * How far `account` is from its next level, with the maths of Hub's
 * Minting window (MintingStats.tsx), so both show the same numbers.
 */
export function levelProgressOf(
  account: AccountInfo,
  timing: NodeTiming | null
): LevelProgress {
  const target = accountTargetBlocks(account.level);
  if (target === undefined)
    return {
      level: account.level,
      next: null,
      fraction: 1,
      blocksToNext: null,
      days: null,
    };
  // Of all the blocks the next level needs, as User search and Home measure it.
  const fraction = Math.min(
    1,
    Math.max(0, countedBlocks(account) / Math.max(1, target))
  );
  const info = {
    level: account.level,
    blocksMinted: account.blocksMinted,
    blocksMintedAdjustment: account.blocksMintedAdjustment,
  };
  const blocksToNext = timing
    ? levelUpBlocks(info, { height: timing.height })
    : null;
  const days = timing
    ? levelUpDays(
        info,
        { currentTimestamp: timing.currentTimestamp },
        { timestamp: timing.dayBackTimestamp },
        { height: timing.height }
      )
    : undefined;
  return {
    level: account.level,
    next: account.level + 1,
    fraction,
    blocksToNext,
    days:
      typeof days === 'number' && Number.isFinite(days) && days >= 0
        ? days
        : null,
  };
}

// ---- The trail ----------------------------------------------------------------------------

/** The most accounts the trail keeps: older ones fall off the front. */
export const TRAIL_MAX = 20;

/**
 * The trail after opening `address`: back to it when it is in the trail
 * already (what came after it is cut), one more step when it was opened
 * from inside the Explorer, otherwise a new trail that starts with it.
 */
export function nextTrail(
  trail: readonly string[],
  address: string,
  fromExplorer: boolean
): string[] {
  const at = trail.indexOf(address);
  if (at >= 0) return trail.slice(0, at + 1);
  if (!fromExplorer) return [address];
  return [...trail, address].slice(-TRAIL_MAX);
}
