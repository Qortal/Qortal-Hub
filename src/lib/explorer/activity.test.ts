import { describe, expect, it } from 'vitest';
import {
  activityBuckets,
  activitySpan,
  approvalHeights,
  axisTicks,
  bucketCount,
  chainMarks,
  familyCounts,
  firstShareMark,
  hoverCardLeft,
  minterEvents,
  periodIndexOf,
  minterMarks,
  rowsIn,
} from './activity';
import type { TxRow } from './reads';

const ME = `Q${'M'.repeat(33)}`;
const OTHER = `Q${'O'.repeat(33)}`;
const ADMIN = `Q${'A'.repeat(33)}`;
const DAY = 86_400_000;

let n = 0;
const tx = (
  type: string,
  timestamp: number,
  extra: Record<string, unknown> = {}
): TxRow =>
  ({
    type,
    timestamp,
    signature: `sig${n++}`,
    txGroupId: 0,
    creatorAddress: ME,
    ...extra,
  }) as TxRow;

describe('activityBuckets', () => {
  const rows = [
    tx('PAYMENT', 5),
    tx('PAYMENT', 15),
    tx('ARBITRARY', 16),
    tx('REGISTER_NAME', 99),
    tx('PAYMENT', 150), // after `to`: left out
  ];

  it('counts each period by family, from `from` to `to`', () => {
    const b = activityBuckets(rows, { from: 0, to: 100, count: 10 });
    expect(b).toHaveLength(10);
    expect(b[0]).toMatchObject({
      start: 0,
      end: 10,
      total: 1,
      byFamily: { payments: 1 },
    });
    expect(b[1]).toMatchObject({ total: 2, byFamily: { payments: 1, qdn: 1 } });
    expect(b[9]).toMatchObject({ total: 1, byFamily: { names: 1 }, end: 100 });
    expect(b.reduce((sum, x) => sum + x.total, 0)).toBe(4);
  });

  it('marks the periods before the oldest read as unread, never as empty', () => {
    const b = activityBuckets(rows, {
      from: 0,
      to: 100,
      count: 10,
      readFrom: 30,
    });
    expect(b.slice(0, 3).map((x) => x.unread)).toEqual([true, true, true]);
    expect(b[3].unread).toBe(false);
  });

  it('marks the period holding the oldest read as partly read, and only that one', () => {
    const b = activityBuckets(rows, {
      from: 0,
      to: 100,
      count: 10,
      readFrom: 15,
    });
    // 10–20 holds the oldest read (15): what is before it there isn't read.
    expect(b.map((x) => x.partial)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(b[1]).toMatchObject({ unread: false, total: 2 });
    expect(b[0].unread).toBe(true);
    // On a period's very start it is that period's.
    expect(
      activityBuckets(rows, { from: 0, to: 100, count: 10, readFrom: 20 })[2]
        .partial
    ).toBe(true);
    // All read: none.
    expect(
      activityBuckets(rows, { from: 0, to: 100, count: 10 }).some(
        (x) => x.partial
      )
    ).toBe(false);
  });

  it('finds a period picked by its start, or the one holding it once drawn anew', () => {
    const b = activityBuckets(rows, { from: 0, to: 100, count: 10 });
    expect(periodIndexOf(b, 30)).toBe(3);
    // Drawn anew in 8 periods (12.5 each): 30 is in the third.
    const wider = activityBuckets(rows, { from: 0, to: 100, count: 8 });
    expect(periodIndexOf(wider, 30)).toBe(2);
    expect(periodIndexOf(b, null)).toBe(-1);
    expect(periodIndexOf(b, 500)).toBe(-1);
  });

  it('leaves hidden families out', () => {
    const b = activityBuckets(rows, {
      from: 0,
      to: 100,
      count: 10,
      hidden: new Set(['qdn']),
    });
    expect(b[1]).toMatchObject({ total: 1, byFamily: { payments: 1 } });
  });

  it('counts families, lists a period newest first, and spaces the axis', () => {
    expect(familyCounts(rows)).toMatchObject({
      payments: 3,
      qdn: 1,
      names: 1,
      minting: 0,
    });
    expect(rowsIn(rows, 10, 20).map((r) => r.type)).toEqual([
      'ARBITRARY',
      'PAYMENT',
    ]);
    expect(axisTicks(0, 100, 640)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(0, 100, 100)).toHaveLength(3);
  });

  it('lists in the last period what its bar counts at its very end', () => {
    const atEnd = [tx('PAYMENT', 100)];
    const [last] = activityBuckets(atEnd, { from: 0, to: 100, count: 1 });
    expect(last.total).toBe(1);
    expect(rowsIn(atEnd, last.start, last.end, true)).toHaveLength(1);
    expect(rowsIn(atEnd, last.start, last.end)).toHaveLength(0);
  });

  it('shows about one bar every 10 px, between 24 and 240', () => {
    expect(bucketCount(1000)).toBe(100);
    expect(bucketCount(100)).toBe(24);
    expect(bucketCount(10_000)).toBe(240);
    expect(bucketCount(0)).toBe(48);
  });
});

describe('activitySpan', () => {
  const now = Date.UTC(2026, 10, 21, 8, 0, 30);

  it('ends now, to the minute, and starts when it was first seen once all is read', () => {
    const span = activitySpan({
      oldest: now - 400 * DAY,
      newest: now - DAY,
      done: true,
      firstSeenAt: now - 400 * DAY,
      now,
    });
    expect(span.to).toBe(Date.UTC(2026, 10, 21, 8, 1));
    expect(span.from).toBe(now - 400 * DAY);
    expect(span.readFrom).toBeNull();
  });

  it('ends after its newest transaction when the node’s clock runs ahead of this PC’s', () => {
    const ahead = now + 5 * 60_000;
    const span = activitySpan({
      oldest: now - DAY,
      newest: ahead,
      done: true,
      firstSeenAt: now - DAY,
      now,
    });
    expect(span.to).toBeGreaterThan(ahead);
    const [bucket] = activityBuckets([tx('PAYMENT', ahead)], {
      ...span,
      count: 1,
    });
    expect(bucket.total).toBe(1);
  });

  it('ends where it was kept, so its periods stay as drawn, but never before its newest transaction', () => {
    const kept = Date.UTC(2026, 10, 21, 8, 1);
    const later = now + 5 * 60_000;
    const first = activitySpan({
      oldest: now - DAY,
      newest: now - 60_000,
      done: true,
      firstSeenAt: now - DAY,
      now,
    });
    const again = activitySpan({
      oldest: now - DAY,
      newest: now - 60_000,
      done: true,
      firstSeenAt: now - DAY,
      now: later,
      end: kept,
    });
    expect(again).toEqual(first);
    // A transaction read since, newer than the end kept: it ends after it.
    expect(
      activitySpan({
        oldest: now - DAY,
        newest: later,
        done: true,
        firstSeenAt: now - DAY,
        now: later,
        end: kept,
      }).to
    ).toBe(later + 1);
  });

  it('until all is read, starts a short hatched stretch before the oldest read', () => {
    const oldest = now - 100 * DAY;
    const span = activitySpan({
      oldest,
      newest: now,
      done: false,
      firstSeenAt: now - 1000 * DAY,
      now,
    });
    expect(span.readFrom).toBe(oldest);
    expect(span.from).toBeLessThan(oldest);
    expect(span.from).toBeGreaterThan(now - 1000 * DAY);
    // Never before it was first seen.
    expect(
      activitySpan({
        oldest,
        newest: now,
        done: false,
        firstSeenAt: oldest - DAY / 2,
        now,
      }).from
    ).toBe(oldest - DAY / 2);
  });
});

describe('the hover card', () => {
  it('stands beside the pointer, on the side with more room, and never past an edge', () => {
    // Left half: to the right of the pointer.
    expect(hoverCardLeft(100, 800, 200)).toBe(112);
    // Right half: to its left.
    expect(hoverCardLeft(700, 800, 200)).toBe(488);
    // A narrow chart: inside it either way.
    expect(hoverCardLeft(150, 300, 200)).toBe(96);
    expect(hoverCardLeft(160, 300, 200)).toBe(4);
    // Wider than the chart: from its left edge.
    expect(hoverCardLeft(50, 150, 200)).toBe(4);
  });
});

describe('chainMarks', () => {
  it('names and level moves, oldest first; never a "first" reward share from what was read', () => {
    const marks = chainMarks(
      [
        tx('REWARD_SHARE', 50),
        tx('REGISTER_NAME', 10, { name: 'Example' }),
        tx('REWARD_SHARE', 40),
        tx('BUY_NAME', 60, { name: 'Sold', creatorAddress: OTHER, seller: ME }),
        tx('BUY_NAME', 70, { name: 'Bought' }),
        tx('UPDATE_NAME', 80, { name: 'Example', newName: 'Example Two' }),
        tx('UPDATE_NAME', 85, { name: 'Same', newName: 'Same' }),
        tx('REGISTER_NAME', 90, { name: 'NotMine', creatorAddress: OTHER }),
        tx('TRANSFER_PRIVS', 95, { creatorAddress: OTHER }),
      ],
      ME
    );
    expect(
      marks.map((m) => [m.at, m.kind, m.say, m.name ?? null, m.newName ?? null])
    ).toEqual([
      [10, 'name', 'registered', 'Example', null],
      [60, 'name', 'sold', 'Sold', null],
      [70, 'name', 'bought', 'Bought', null],
      [80, 'name', 'renamed', 'Example', 'Example Two'],
      [95, 'minting', 'level_in', null, null],
    ]);
    expect(marks.every((m) => m.signature)).toBe(true);
  });

  it('level moves in one block, one way, as one milestone with how many', () => {
    const marks = chainMarks(
      [3, 1, 2].map((i) =>
        tx('TRANSFER_PRIVS', 100 + i, {
          creatorAddress: OTHER,
          blockHeight: 1_585_006,
        })
      ),
      ME
    );
    expect(marks.map((m) => [m.at, m.say, m.count])).toEqual([
      [101, 'level_in_many', 3],
    ]);
  });

  it('names registered the same day as one milestone, with the first three', () => {
    const marks = chainMarks(
      ['A', 'B', 'C', 'D'].map((name, i) =>
        tx('REGISTER_NAME', 10 * DAY + i * 1000, { name })
      ),
      ME
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      kind: 'name',
      say: 'registered_many',
      count: 4,
      names: ['A', 'B', 'C'],
    });
  });

  it('marks its first reward share from its whole history, and the sponsorship era', () => {
    expect(
      firstShareMark({ timestamp: 40, height: 2_000_000, signature: 'sig40' })
    ).toEqual([
      {
        key: 'first_share:sig40',
        at: 40,
        kind: 'minting',
        say: 'first_share',
        signature: 'sig40',
      },
    ]);
    // Before MINTER membership counted (block 1,945,900).
    expect(
      firstShareMark({ timestamp: 4, height: 655_586, signature: 's' })[0].say
    ).toBe('first_share_sponsorship');
    expect(firstShareMark(null)).toEqual([]);
  });
});

describe('its MINTER story', () => {
  const minter = (
    type: string,
    height: number,
    extra: Record<string, unknown> = {}
  ) =>
    tx(type, height * 1000, {
      groupId: 694,
      blockHeight: height,
      approvalStatus: 'NOT_REQUIRED',
      ...extra,
    });
  const approved = (
    type: string,
    height: number,
    approvalHeight: number,
    extra = {}
  ) =>
    minter(type, height, {
      creatorAddress: ADMIN,
      txGroupId: 694,
      approvalStatus: 'APPROVED',
      approvalHeight,
      ...extra,
    });
  const says = (rows: TxRow[], whole = true) =>
    minterEvents(rows, ME, whole).map((e) => e.say);

  it('a join request, then an approved invite: asked, then added', () => {
    expect(
      says([
        approved('GROUP_INVITE', 120, 130, { invitee: ME }),
        minter('JOIN_GROUP', 100),
      ])
    ).toEqual(['asked', 'accepted']);
  });

  it('an invite approved first, then its join: invited, then joined', () => {
    expect(
      says([
        approved('GROUP_INVITE', 90, 95, { invitee: ME }),
        minter('JOIN_GROUP', 100),
      ])
    ).toEqual(['invited', 'joined']);
  });

  it('orders by when each took effect: an invite proposed before the join, approved after it', () => {
    expect(
      says([
        approved('GROUP_INVITE', 90, 130, { invitee: ME }),
        minter('JOIN_GROUP', 100),
      ])
    ).toEqual(['asked', 'accepted']);
  });

  it('only what took effect: proposals rejected, expired or waiting are no milestones', () => {
    expect(
      says([
        minter('JOIN_GROUP', 100),
        approved('GROUP_INVITE', 110, 120, {
          invitee: ME,
          approvalStatus: 'REJECTED',
        }),
        approved('GROUP_INVITE', 130, 140, {
          invitee: ME,
          approvalStatus: 'EXPIRED',
        }),
        minter('GROUP_INVITE', 150, {
          creatorAddress: ADMIN,
          invitee: ME,
          approvalStatus: 'PENDING',
        }),
      ])
    ).toEqual(['asked']);
  });

  it('a kick of a request declines it, of a member removes it; admins, leaving, a ban and its lifting', () => {
    expect(
      says([
        minter('JOIN_GROUP', 100),
        approved('GROUP_KICK', 110, 111, { member: ME }),
        minter('JOIN_GROUP', 120),
        approved('GROUP_INVITE', 130, 131, { invitee: ME }),
        approved('ADD_GROUP_ADMIN', 140, 141, { member: ME }),
        approved('REMOVE_GROUP_ADMIN', 150, 151, { admin: ME }),
        approved('ADD_GROUP_ADMIN', 152, 153, { member: ME }),
        // Proposed by itself: it stepped down.
        approved('REMOVE_GROUP_ADMIN', 155, 156, {
          admin: ME,
          creatorAddress: ME,
        }),
        minter('LEAVE_GROUP', 158),
        // After leaving, a join asks again.
        minter('JOIN_GROUP', 159),
        approved('GROUP_INVITE', 160, 161, { invitee: ME }),
        approved('GROUP_KICK', 162, 163, { member: ME }),
        approved('GROUP_BAN', 170, 171, { offender: ME }),
        approved('CANCEL_GROUP_BAN', 180, 181, { member: ME }),
      ])
    ).toEqual([
      'asked',
      'declined',
      'asked',
      'accepted',
      'admin',
      'not_admin',
      'admin',
      'stepped_down',
      'left',
      'asked',
      'accepted',
      'removed',
      'banned',
      'unbanned',
    ]);
  });

  it('leaves out other accounts’ changes and other groups’', () => {
    expect(
      says([
        approved('GROUP_KICK', 110, 111, { member: OTHER }),
        minter('JOIN_GROUP', 100, { groupId: 12 }),
        minter('JOIN_GROUP', 120, { creatorAddress: OTHER }),
      ])
    ).toEqual([]);
  });

  it('a cancelled invite in its own history means its join is a request again', () => {
    expect(
      says([
        approved('GROUP_INVITE', 90, 91, { invitee: ME }),
        // Core's answer names neither the group nor the invitee here.
        tx('CANCEL_GROUP_INVITE', 95_000, {
          creatorAddress: ADMIN,
          txGroupId: 694,
          blockHeight: 95,
          approvalStatus: 'APPROVED',
          approvalHeight: 96,
        }),
        minter('JOIN_GROUP', 100),
      ])
    ).toEqual(['invited', 'asked']);
  });

  it('says both ways when what came before isn’t read, never more than it knows', () => {
    // Its older history isn't read: whether a join asked or joined isn't known.
    expect(says([minter('JOIN_GROUP', 100)], false)).toEqual([
      'join_uncertain',
    ]);
    expect(
      says([approved('GROUP_KICK', 110, 111, { member: ME })], false)
    ).toEqual(['kick_uncertain']);
    // Read from its first transaction on, it is known.
    expect(says([minter('JOIN_GROUP', 100)], true)).toEqual(['asked']);
    // Something read since says: a ban leaves it outside, so the next join asks.
    expect(
      says(
        [
          approved('GROUP_BAN', 90, 91, { offender: ME }),
          minter('JOIN_GROUP', 100),
        ],
        false
      )
    ).toEqual(['banned', 'asked']);
  });

  it('puts an approved change at its approval block’s time, and waits for that time', () => {
    const events = minterEvents(
      [
        minter('JOIN_GROUP', 100),
        approved('GROUP_INVITE', 120, 130, { invitee: ME }),
      ],
      ME,
      true
    );
    expect(approvalHeights(events)).toEqual([130]);
    // The block's time isn't known yet: only the join shows.
    expect(minterMarks(events, new Map()).map((m) => m.say)).toEqual(['asked']);
    const marks = minterMarks(events, new Map([[130, 999_999]]));
    expect(marks.map((m) => [m.say, m.at, m.kind])).toEqual([
      ['asked', 100_000, 'asked'],
      ['accepted', 999_999, 'joined'],
    ]);
  });
});
