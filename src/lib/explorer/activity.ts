/**
 * An account's activity over time (the Overview's Activity, from
 * Q-Mintership+'s rules/explorer/activity.ts): its transactions in periods
 * of equal length from when it was first seen to now, each period counted
 * by family, and the milestones marked on it. Pure: no reads, no text (the
 * Activity section puts them into words).
 *
 * - Periods (`activityBuckets`): `count` of them between `from` and `to`;
 *   a period wholly before the oldest transaction read is `unread` (its
 *   older history isn't read yet), never "no activity", and the one holding
 *   the oldest transaction read is `partial` (its older part isn't read).
 * - Milestones, only from Core's own facts: a name registered, bought,
 *   sold or renamed and a minting level moved, in the transactions read
 *   (`chainMarks`); its first reward share, read on its own, since the
 *   oldest read so far may not be it (`firstShareMark`); and its MINTER
 *   story (group 694) in the transactions read (`minterEvents`): asked to
 *   join, invited, joined, removed or its request declined, banned, its ban
 *   lifted, left, made or no longer a Minter Admin. A change MINTER's admins
 *   approved took effect at its approval's block, whose time is read
 *   (`minterMarks`).
 */
import { MINTER_GROUP_ID, type TxRow } from './reads';
import { familyOf, type TxTypeFamily } from './txFamilies';

export type ActivityFamily = TxTypeFamily;

/** The families, in the order the bars stack them (bottom first) and the legend lists them. */
export const ACTIVITY_FAMILIES: readonly ActivityFamily[] = [
  'payments',
  'names',
  'minting',
  'groups',
  'qdn',
  'trading',
  'messages',
  'other',
];

export const isActivityFamily = (value: unknown): value is ActivityFamily =>
  ACTIVITY_FAMILIES.includes(value as ActivityFamily);

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface ActivityBucket {
  start: number;
  end: number;
  total: number;
  byFamily: Partial<Record<ActivityFamily, number>>;
  /** Wholly before the oldest transaction read: not read yet, not empty. */
  unread: boolean;
  /** It holds the oldest transaction read: what is before it in the period isn't read yet. */
  partial: boolean;
}

/**
 * `count` periods from `from` to `to`, counting `rows` (any order) by
 * family, leaving out the families in `hidden`. Periods that end before
 * `readFrom` (the oldest transaction read, when older ones exist) are
 * unread; the one holding it is partly read.
 */
export function activityBuckets(
  rows: readonly TxRow[],
  options: {
    from: number;
    to: number;
    count: number;
    readFrom?: number | null;
    hidden?: ReadonlySet<ActivityFamily>;
  }
): ActivityBucket[] {
  const { from, to } = options;
  const count = Math.max(1, Math.floor(options.count));
  const size = Math.max(1, to - from) / count;
  const readFrom = options.readFrom ?? null;
  const buckets: ActivityBucket[] = Array.from({ length: count }, (_, i) => {
    const start = from + i * size;
    const end = i === count - 1 ? to : start + size;
    return {
      start,
      end,
      total: 0,
      byFamily: {},
      unread: readFrom !== null && end <= readFrom,
      partial: readFrom !== null && start <= readFrom && readFrom < end,
    };
  });
  for (const tx of rows) {
    if (tx.timestamp < from || tx.timestamp > to) continue;
    const family = familyOf(tx.type);
    if (options.hidden?.has(family)) continue;
    const i = Math.min(
      count - 1,
      Math.max(0, Math.floor((tx.timestamp - from) / size))
    );
    const bucket = buckets[i];
    bucket.total += 1;
    bucket.byFamily[family] = (bucket.byFamily[family] ?? 0) + 1;
  }
  return buckets;
}

/**
 * Which of `buckets` a period picked (by its start) is: the one starting
 * there, or, when the periods were drawn anew since (a wider window, more
 * history read), the one holding it; -1 for none.
 */
export function periodIndexOf(
  buckets: readonly Pick<ActivityBucket, 'start' | 'end'>[],
  start: number | null
): number {
  if (start === null) return -1;
  const same = buckets.findIndex((bucket) => bucket.start === start);
  if (same >= 0) return same;
  return buckets.findIndex(
    (bucket) => bucket.start <= start && start < bucket.end
  );
}

/** How many of `rows` there are in each family. */
export function familyCounts(
  rows: readonly TxRow[]
): Record<ActivityFamily, number> {
  const counts = Object.fromEntries(
    ACTIVITY_FAMILIES.map((family) => [family, 0])
  ) as Record<ActivityFamily, number>;
  for (const tx of rows) counts[familyOf(tx.type)] += 1;
  return counts;
}

/**
 * The rows of the period [start, end), newest first; the last period
 * (`last`) takes its end too, as its bar does.
 */
export function rowsIn(
  rows: readonly TxRow[],
  start: number,
  end: number,
  last = false
): TxRow[] {
  return rows
    .filter(
      (tx) =>
        tx.timestamp >= start &&
        (tx.timestamp < end || (last && tx.timestamp === end))
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Where the chart starts and ends. It ends now (to the minute), or at
 * `end` when one is kept (the history step keeps the end it was first
 * drawn with, so its periods, and a period picked, stay as they were), or
 * just after its newest transaction when that is later (a transaction
 * read since, or the node's clock running ahead of this PC's). Once its
 * whole history is read it starts when it was first seen (at least 30
 * days back); until then, a short stretch before its oldest transaction
 * read, hatched, says older history exists (`readFrom`).
 */
export function activitySpan({
  oldest,
  newest,
  done,
  firstSeenAt,
  now,
  end = null,
}: {
  oldest: number | null;
  newest: number | null;
  done: boolean;
  firstSeenAt: number | null;
  now: number;
  /** The end kept for the chart, if any. */
  end?: number | null;
}): { from: number; to: number; readFrom: number | null } {
  const to = Math.max(
    end ?? Math.ceil(now / MINUTE) * MINUTE,
    (newest ?? 0) + 1
  );
  if (done || oldest === null)
    return {
      from: Math.min(
        ...[firstSeenAt, oldest].filter((t): t is number => t !== null),
        to - 30 * DAY
      ),
      to,
      readFrom: null,
    };
  return {
    from: Math.max(
      firstSeenAt ?? 0,
      oldest - Math.max(DAY, (to - oldest) * 0.15)
    ),
    to,
    readFrom: oldest,
  };
}

/** About one bar every this many px. */
export const BAR_PX = 10;
export const MIN_BARS = 24;
export const MAX_BARS = 240;

/** How many periods a chart `width` px wide shows. */
export function bucketCount(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 48;
  return Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(width / BAR_PX)));
}

/** How far a hover card keeps from the chart's edges, and from the pointer (px). */
const CARD_EDGE = 4;
const CARD_GAP = 12;

/**
 * Where a hover card `card` px wide stands in a chart `width` px wide, for
 * the pointer at `x`: beside the pointer (on the side with more room), and
 * never past either edge.
 */
export function hoverCardLeft(x: number, width: number, card: number): number {
  const left = x > width / 2 ? x - CARD_GAP - card : x + CARD_GAP;
  const most = Math.max(CARD_EDGE, width - card - CARD_EDGE);
  return Math.min(most, Math.max(CARD_EDGE, left));
}

/** Date ticks for an axis `width` px wide: one about every 160 px, at least two. */
export function axisTicks(from: number, to: number, width: number): number[] {
  const count = Math.max(2, Math.min(24, Math.floor(width / 160)));
  return Array.from(
    { length: count + 1 },
    (_, i) => from + ((to - from) * i) / count
  );
}

// ---- Milestones ---------------------------------------------------------------------

/** What a milestone is about: its colour, and what Activity's settings can hide. */
export type MarkKind =
  | 'joined'
  | 'asked'
  | 'declined'
  | 'removed'
  | 'banned'
  | 'unbanned'
  | 'left'
  | 'admin'
  | 'notAdmin'
  | 'name'
  | 'minting';

/** Every kind, in the order Activity's settings list them. */
export const MARK_KINDS: readonly MarkKind[] = [
  'joined',
  'asked',
  'declined',
  'removed',
  'banned',
  'unbanned',
  'left',
  'admin',
  'notAdmin',
  'name',
  'minting',
];

export const isMarkKind = (value: unknown): value is MarkKind =>
  MARK_KINDS.includes(value as MarkKind);

/** What a milestone says (`explorer:activity.mark.<say>`). */
export type MarkSay =
  | 'registered'
  | 'registered_many'
  | 'bought'
  | 'sold'
  | 'renamed'
  | 'level_away'
  | 'level_away_many'
  | 'level_in'
  | 'level_in_many'
  | 'first_share'
  | 'first_share_sponsorship'
  | 'joined'
  | 'accepted'
  | 'invited'
  | 'asked'
  | 'join_uncertain'
  | 'declined'
  | 'removed'
  | 'kick_uncertain'
  | 'banned'
  | 'unbanned'
  | 'left'
  | 'admin'
  | 'not_admin'
  | 'stepped_down';

export interface ActivityMark {
  key: string;
  at: number;
  kind: MarkKind;
  say: MarkSay;
  /** The transaction behind it. */
  signature?: string;
  /** A name it is about. */
  name?: string;
  /** A rename: the name it got. */
  newName?: string;
  /** Names registered the same day: the first three. */
  names?: string[];
  /** How many names, or level moves in one block. */
  count?: number;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

/**
 * Milestones in what was read: a name registered, bought, sold or renamed,
 * and minting levels moved to or from it (those in one block, one way, as
 * one). Names registered the same day are one milestone. Oldest first.
 */
export function chainMarks(
  rows: readonly TxRow[],
  address: string
): ActivityMark[] {
  const marks: ActivityMark[] = [];
  const moves = new Map<string, ActivityMark>();
  const seen = new Set<string>();
  for (const tx of rows) {
    if (seen.has(tx.signature)) continue;
    seen.add(tx.signature);
    const mine = tx.creatorAddress === address;
    const name = str(tx.name);
    const push = (mark: Omit<ActivityMark, 'key' | 'at' | 'signature'>) =>
      marks.push({
        key: `${mark.say}:${tx.signature}`,
        at: tx.timestamp,
        signature: tx.signature,
        ...mark,
      });
    switch (tx.type) {
      case 'REGISTER_NAME':
        if (mine && name) push({ kind: 'name', say: 'registered', name });
        break;
      case 'BUY_NAME':
        if (mine && name) push({ kind: 'name', say: 'bought', name });
        else if (name && tx.seller === address)
          push({ kind: 'name', say: 'sold', name });
        break;
      case 'UPDATE_NAME': {
        const renamed = str(tx.newName);
        if (mine && name && renamed && renamed !== name)
          push({ kind: 'name', say: 'renamed', name, newName: renamed });
        break;
      }
      case 'TRANSFER_PRIVS': {
        const group = `${mine}:${tx.blockHeight ?? tx.signature}`;
        const same = moves.get(group);
        if (same) {
          same.count = (same.count ?? 1) + 1;
          same.say = mine ? 'level_away_many' : 'level_in_many';
          // The milestone stands at the earliest of them.
          if (tx.timestamp < same.at) {
            same.at = tx.timestamp;
            same.signature = tx.signature;
          }
          break;
        }
        push({ kind: 'minting', say: mine ? 'level_away' : 'level_in' });
        moves.set(group, marks[marks.length - 1]);
        break;
      }
    }
  }
  return sameDayNames(marks).sort((a, b) => a.at - b.at);
}

/** Names registered on the same day as one milestone, with how many and the first three. */
function sameDayNames(marks: ActivityMark[]): ActivityMark[] {
  const registered = (mark: ActivityMark) => mark.say === 'registered';
  const byDay = new Map<number, ActivityMark[]>();
  for (const mark of marks.filter(registered)) {
    const day = Math.floor(mark.at / DAY);
    byDay.set(day, [...(byDay.get(day) ?? []), mark]);
  }
  const grouped = [...byDay.values()].map((day): ActivityMark => {
    if (day.length === 1) return day[0];
    const sorted = [...day].sort((a, b) => a.at - b.at);
    return {
      ...sorted[0],
      key: `registered_many:${sorted[0].signature}`,
      say: 'registered_many',
      name: undefined,
      names: sorted.slice(0, 3).map((mark) => mark.name as string),
      count: day.length,
    };
  });
  return [...marks.filter((mark) => !registered(mark)), ...grouped];
}

/** The first block from which only minting under a MINTER member's reward share counts (Core's fixBatchRewardHeight). */
export const MINTER_ONLY_FROM = 1_945_900;

/**
 * Its first reward share, as the minter or the recipient: the oldest in
 * its whole history (read on its own), not the oldest read so far. One
 * from before block 1,945,900, when minting didn't need MINTER yet, says
 * it was the sponsorship era.
 */
export function firstShareMark(
  first:
    | { timestamp: number; height?: number; signature?: string }
    | null
    | undefined
): ActivityMark[] {
  if (!first) return [];
  const before = first.height !== undefined && first.height < MINTER_ONLY_FROM;
  return [
    {
      key: `first_share:${first.signature ?? first.timestamp}`,
      at: first.timestamp,
      kind: 'minting',
      say: before ? 'first_share_sponsorship' : 'first_share',
      signature: first.signature,
    },
  ];
}

// ---- Its MINTER story -------------------------------------------------------------------

/** One MINTER change about the account that took effect. */
export interface MinterEvent {
  signature: string;
  kind: MarkKind;
  say: MarkSay;
  /** The block it took effect at: its approval's, when MINTER's admins approved it. */
  height: number;
  /** Its own time; it took effect then when `approved` is false. */
  timestamp: number;
  /** Approved by MINTER's admins at a later block (`height`), whose time is read. */
  approved: boolean;
}

/** A MINTER transaction: its group, or (a cancelled invite names none) the group approving it. */
const isMinterRow = (tx: TxRow): boolean =>
  typeof tx.groupId === 'number'
    ? tx.groupId === MINTER_GROUP_ID
    : tx.txGroupId === MINTER_GROUP_ID;

/** Who a MINTER transaction is about. */
function subjectOf(tx: TxRow, address: string): unknown {
  switch (tx.type) {
    case 'GROUP_INVITE':
      return tx.invitee;
    case 'CANCEL_GROUP_INVITE':
      // Core's answer leaves the invitee out: in its own history, made by another, it is about it.
      return tx.invitee ?? (tx.creatorAddress !== address ? address : null);
    case 'GROUP_KICK':
    case 'ADD_GROUP_ADMIN':
    case 'CANCEL_GROUP_BAN':
      return tx.member;
    case 'GROUP_BAN':
      return tx.offender;
    case 'REMOVE_GROUP_ADMIN':
      return tx.admin;
    case 'JOIN_GROUP':
    case 'LEAVE_GROUP':
      return tx.creatorAddress;
    default:
      return null;
  }
}

/** Whether it took effect: approved, or needing no approval. */
function tookEffect(tx: TxRow): boolean {
  if (tx.type === 'JOIN_GROUP' || tx.type === 'LEAVE_GROUP')
    return tx.approvalStatus !== 'INVALID';
  return (
    tx.approvalStatus === undefined ||
    tx.approvalStatus === 'APPROVED' ||
    tx.approvalStatus === 'NOT_REQUIRED'
  );
}

interface Standing {
  member: boolean;
  invite: boolean;
  request: boolean;
}

/**
 * Its MINTER story in `rows` (any order): the changes about it that took
 * effect, oldest first, worked out the way Core does (Group.java). A join
 * makes a member when an invite waits for it, and otherwise asks to join;
 * an invite adds a member who asked, and otherwise invites; a kick of an
 * account that only asked declines its request. Which one it was depends
 * on what came before: when its whole history isn't read (`whole` false)
 * and nothing read before says, a join and a kick say both ways
 * (`join_uncertain`, `kick_uncertain`), so a milestone never claims more
 * than the transactions read show.
 */
export function minterEvents(
  rows: readonly TxRow[],
  address: string,
  whole: boolean
): MinterEvent[] {
  const seen = new Set<string>();
  const changes = rows
    .filter((tx) => {
      if (seen.has(tx.signature)) return false;
      seen.add(tx.signature);
      return (
        isMinterRow(tx) &&
        typeof tx.blockHeight === 'number' &&
        subjectOf(tx, address) === address &&
        tookEffect(tx)
      );
    })
    .map((tx) => {
      const own = tx.blockHeight as number;
      const approval =
        typeof tx.approvalHeight === 'number' ? tx.approvalHeight : own;
      return { tx, height: Math.max(own, approval), approved: approval > own };
    })
    .sort(
      (a, b) =>
        a.height - b.height ||
        a.tx.timestamp - b.tx.timestamp ||
        a.tx.signature.localeCompare(b.tx.signature)
    );

  const state: Standing = { member: false, invite: false, request: false };
  /** What it was before is known: from its first transaction, or from one read since. */
  let known = whole;
  const events: MinterEvent[] = [];
  const add = (
    { tx, height, approved }: (typeof changes)[number],
    kind: MarkKind,
    say: MarkSay
  ) =>
    events.push({
      signature: tx.signature,
      kind,
      say,
      height,
      timestamp: tx.timestamp,
      approved,
    });
  const settle = (next: Standing) => {
    Object.assign(state, next);
    known = true;
  };
  for (const change of changes) {
    const { tx } = change;
    switch (tx.type) {
      case 'GROUP_INVITE':
        if (known && state.request) {
          add(change, 'joined', 'accepted');
          settle({ member: true, invite: false, request: false });
        } else {
          // An invite, whether or not a request waited for it.
          add(change, 'joined', 'invited');
          if (known) settle({ member: false, invite: true, request: false });
        }
        break;
      case 'JOIN_GROUP':
        if (!known) add(change, 'joined', 'join_uncertain');
        else if (state.invite || state.member) {
          add(change, 'joined', 'joined');
          settle({ member: true, invite: false, request: false });
        } else {
          add(change, 'asked', 'asked');
          settle({ member: false, invite: false, request: true });
        }
        break;
      case 'GROUP_KICK':
        if (!known) add(change, 'removed', 'kick_uncertain');
        else if (state.request && !state.member)
          add(change, 'declined', 'declined');
        else add(change, 'removed', 'removed');
        settle({ member: false, invite: false, request: false });
        break;
      case 'GROUP_BAN':
        add(change, 'banned', 'banned');
        settle({ member: false, invite: false, request: false });
        break;
      case 'CANCEL_GROUP_BAN':
        add(change, 'unbanned', 'unbanned');
        break;
      case 'LEAVE_GROUP':
        add(change, 'left', 'left');
        settle({ member: false, invite: false, request: false });
        break;
      case 'ADD_GROUP_ADMIN':
        add(change, 'admin', 'admin');
        // Only a member can be made an admin.
        settle({ member: true, invite: false, request: false });
        break;
      case 'REMOVE_GROUP_ADMIN':
        add(
          change,
          'notAdmin',
          tx.creatorAddress === address ? 'stepped_down' : 'not_admin'
        );
        settle({ member: true, invite: false, request: false });
        break;
      case 'CANCEL_GROUP_INVITE':
        state.invite = false;
        break;
    }
  }
  return events;
}

/** The blocks whose time a MINTER milestone waits for. */
export const approvalHeights = (events: readonly MinterEvent[]): number[] => [
  ...new Set(events.filter((e) => e.approved).map((e) => e.height)),
];

/**
 * Its MINTER milestones, each at the time it took effect: its own time, or
 * its approval block's (`blockTimes`). One whose block time isn't known
 * (yet) is left out.
 */
export function minterMarks(
  events: readonly MinterEvent[],
  blockTimes: ReadonlyMap<number, number>
): ActivityMark[] {
  return events
    .flatMap((event): ActivityMark[] => {
      const at = event.approved
        ? blockTimes.get(event.height)
        : event.timestamp;
      return at === undefined
        ? []
        : [
            {
              key: `minter:${event.signature}`,
              at,
              kind: event.kind,
              say: event.say,
              signature: event.signature,
            },
          ];
    })
    .sort((a, b) => a.at - b.at);
}
