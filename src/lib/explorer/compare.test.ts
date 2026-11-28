import { describe, expect, it } from 'vitest';
import type { AssetTrade } from './assetTrades';
import {
  checkState,
  firstSelfShare,
  firstSponsorOf,
  letterOf,
  pairFindings,
  pairsOf,
  pairTrades,
  portalFindings,
  saleTimeKnown,
  sameFirstPayers,
  sameSponsors,
  sharedCounterparties,
  sharedGroups,
  timelineEvents,
  timelineGap,
  type CompareSide,
} from './compare';
import { fundingFrom } from './connections';
import type { GroupOf, TxRow } from './reads';

const A = `Q${'A'.repeat(33)}`;
const B = `Q${'B'.repeat(33)}`;
const C = `Q${'C'.repeat(33)}`;
const K = `Q${'K'.repeat(33)}`;
const F = `Q${'F'.repeat(33)}`;
const N = `Q${'N'.repeat(33)}`;
const AT = `A${'T'.repeat(33)}`;

let n = 0;
function tx(type: string, height: number, extra: Partial<TxRow> = {}): TxRow {
  n += 1;
  return {
    type,
    timestamp: 1_700_000_000_000 + height * 60_000,
    signature: `sig${n}`,
    blockHeight: height,
    ...extra,
  } as TxRow;
}
const pay = (from: string, to: string, height: number, amount = '1') =>
  tx('PAYMENT', height, { creatorAddress: from, recipient: to, amount });
const share = (from: string, to: string, height: number, percent = '0.00') =>
  tx('REWARD_SHARE', height, {
    creatorAddress: from,
    recipient: to,
    sharePercent: percent,
  });

const side = (
  address: string,
  index: number,
  extra: Partial<CompareSide> = {}
): CompareSide => ({
  address,
  letter: letterOf(index),
  privs: {},
  ...extra,
});

describe('letters and pairs', () => {
  it('every pair in letter order', () => {
    expect(pairsOf(3).map((pair) => pair.id)).toEqual(['a-b', 'a-c', 'b-c']);
    expect(pairsOf(4)).toHaveLength(6);
    expect(pairsOf(1)).toEqual([]);
    expect(letterOf(0)).toBe('A');
    expect(letterOf(3)).toBe('D');
  });
});

describe('recorded between two accounts', () => {
  it('payments each way, from both accounts’ lists and the pair’s own read, each once, told by the payer', () => {
    const one = pay(A, B, 10, '2');
    const two = pay(A, B, 11, '3');
    const back = pay(B, A, 12, '7');
    const elsewhere = pay(A, K, 13, '1');
    const found = pairFindings({
      // A's own list has one of them; B's has the other; the pair's read both.
      x: side(A, 0, { payments: [one, elsewhere] }),
      y: side(B, 1, { payments: [two, back] }),
      xy: { rows: [two, one], more: false },
      yx: { rows: [back], more: false },
    });
    expect(found.map((item) => [item.actor, item.finding.kind])).toEqual([
      [A, 'paidTo'],
      [B, 'paidTo'],
    ]);
    const [paid] = found;
    expect(paid.finding.sentence.key).toBe('paid');
    expect(paid.finding.sentence.count).toBe(2);
    expect(paid.finding.evidence.map((row) => row.signature)).toEqual([
      two.signature,
      one.signature,
    ]);
    // Never the payments with anyone else.
    expect(found.some((item) => item.finding.other === K)).toBe(false);
  });

  it('a reward share is told by the account sponsored; one minting now, by the account that made it', () => {
    const made = share(B, A, 20, '5.00');
    const self = share(A, A, 5);
    const found = pairFindings({
      x: side(A, 0, { linkRows: [self] }),
      // Only B's list holds the share: what one of them read is enough.
      y: side(B, 1, { linkRows: [made] }),
      online: [{ minterAddress: B, recipientAddress: A }],
    });
    expect(
      found.map((item) => [item.actor, item.finding.sentence.key])
    ).toEqual([
      [A, 'sponsor.not_removed'],
      [B, 'minting_with.its_share'],
    ]);
  });

  it('a level move is told once, by its sender, from either account’s list', () => {
    const move = tx('TRANSFER_PRIVS', 30, { creatorAddress: A });
    const told = pairFindings({
      x: side(A, 0, { linkRows: [move], privs: { [move.signature]: B } }),
      y: side(B, 1, { linkRows: [move] }),
    });
    expect(told.map((item) => [item.actor, item.finding.sentence.key])).toEqual(
      [[A, 'transfer_privs.out']]
    );
    // The sender couldn't read where it went: B's own list says it came to B.
    const unknown = pairFindings({
      x: side(A, 0, { linkRows: [], privs: { [move.signature]: null } }),
      y: side(B, 1, { linkRows: [move] }),
    });
    expect(
      unknown.map((item) => [item.actor, item.finding.sentence.key])
    ).toEqual([[A, 'transfer_privs.out']]);
  });

  it('a level move B sent to someone else is never read as one between them', () => {
    const away = tx('TRANSFER_PRIVS', 40, { creatorAddress: B });
    const found = pairFindings({
      x: side(A, 0, { linkRows: [] }),
      y: side(B, 1, { linkRows: [away], privs: { [away.signature]: C } }),
    });
    expect(found).toEqual([]);
  });

  it('a name sale is told by its buyer', () => {
    const sale = tx('BUY_NAME', 50, {
      creatorAddress: A,
      seller: B,
      name: 'Spare Room',
      amount: '5.00000000',
    });
    const found = pairFindings({
      x: side(A, 0, { linkRows: [sale] }),
      y: side(B, 1, { linkRows: [sale] }),
    });
    expect(found.map((item) => [item.actor, item.finding.kind])).toEqual([
      [A, 'nameDeal'],
    ]);
  });

  it('Q-Asset trades from either side, turned to the first account’s, each once', () => {
    const asA: AssetTrade = {
      orderId: 'oa',
      otherOrderId: 'ob',
      other: B,
      timestamp: 100,
      initiated: true,
      gave: { asset: { id: 0, name: 'QORT' }, amount: '10' },
      got: { asset: { id: 5, name: 'Gold' }, amount: '1' },
    };
    const asB: AssetTrade = {
      orderId: 'ob',
      otherOrderId: 'oa',
      other: A,
      timestamp: 100,
      initiated: false,
      gave: { asset: { id: 5, name: 'Gold' }, amount: '1' },
      got: { asset: { id: 0, name: 'QORT' }, amount: '10' },
    };
    expect(
      pairTrades({ address: A, trades: [asA] }, { address: B, trades: [asB] })
    ).toEqual([asA]);
    // Only B's read: the same trade, from A's side.
    expect(pairTrades({ address: A }, { address: B, trades: [asB] })).toEqual([
      asA,
    ]);
    expect(pairTrades({ address: A }, { address: B })).toBeNull();
  });
});

describe('trade portal sales between them', () => {
  const sale = (
    seller: string,
    buyer: string,
    timestamp: number,
    qort: string
  ) => ({
    timestamp,
    qortAmount: qort,
    foreignAmount: '0.1',
    atAddress: null,
    seller,
    buyer,
  });

  it('each way, by the seller’s own sales and where the buyer received the QORT, added up exactly', () => {
    const found = portalFindings(
      {
        address: A,
        portal: [
          sale(A, B, 300, '0.1'),
          sale(A, B, 100, '0.2'),
          sale(A, K, 200, '9'),
        ],
      },
      // B never sold one: its sales were read and there are none.
      { address: B, portal: [] }
    );
    expect(found).toHaveLength(1);
    const [sold] = found;
    expect([sold.actor, sold.other]).toEqual([A, B]);
    expect(sold.sentence.key).toBe('portal_sold');
    expect(sold.sentence.count).toBe(2);
    expect(sold.sentence.slots.amount).toEqual({
      kind: 'amount',
      amounts: [{ amount: '0.30000000', asset: { id: 0, name: null } }],
    });
    expect(sold.trades.map((trade) => trade.timestamp)).toEqual([300, 100]);
    expect([sold.firstTimestamp, sold.timestamp]).toEqual([100, 300]);
  });

  it('dated only by the sales Core gave a time: one without (0) is listed last, never taken as the oldest', () => {
    const [some] = portalFindings(
      {
        address: A,
        portal: [
          sale(A, B, 300, '1'),
          sale(A, B, 0, '2'),
          sale(A, B, 100, '3'),
        ],
      },
      { address: B, portal: [] }
    );
    expect(some.trades.map((trade) => trade.timestamp)).toEqual([300, 100, 0]);
    expect([some.firstTimestamp, some.timestamp]).toEqual([100, 300]);
    expect(some.sentence.count).toBe(3);
    // None has a time: no date at all.
    const [none] = portalFindings(
      { address: A, portal: [sale(A, B, 0, '1'), sale(A, B, Number.NaN, '2')] },
      { address: B, portal: [] }
    );
    expect(none.trades).toHaveLength(2);
    expect([none.firstTimestamp, none.timestamp]).toEqual([0, 0]);
  });

  it('a sale’s time is one only when it is a positive number', () => {
    expect(saleTimeKnown(Date.UTC(2025, 5, 1))).toBe(true);
    for (const time of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(saleTimeKnown(time)).toBe(false);
  });

  it('the other way round too, and nothing before either is read', () => {
    expect(
      portalFindings(
        { address: A, portal: [] },
        { address: B, portal: [sale(B, A, 5, '1')] }
      ).map((item) => [item.actor, item.other])
    ).toEqual([[B, A]]);
    expect(portalFindings({ address: A }, { address: B })).toEqual([]);
  });
});

describe('what a check can say', () => {
  it('nothing found only from reads that reached their end', () => {
    expect(checkState(false, ['complete', 'complete'])).toBe('none');
    expect(checkState(false, ['complete', 'partial'])).toBe('none_so_far');
    expect(checkState(false, ['partial', 'reading'])).toBe('reading');
    expect(checkState(false, ['reading', 'failed'])).toBe('failed');
    expect(checkState(true, ['failed'])).toBe('found');
  });
});

describe('in common', () => {
  it('the same first sponsor, only from minting lists read in full', () => {
    const toA = share(N, A, 10);
    const toB = share(N, B, 11);
    const sides = [
      side(A, 0, { linkRows: [toA], minting: 'complete' }),
      side(B, 1, { linkRows: [toB], minting: 'complete' }),
    ];
    expect(sameSponsors(sides)).toEqual([{ sponsor: N, letters: ['A', 'B'] }]);
    // B's list stopped short: its first sponsor may be older than what was read.
    expect(firstSponsorOf({ ...sides[1], minting: 'partial' })).toBeUndefined();
    expect(
      sameSponsors([sides[0], { ...sides[1], minting: 'partial' }])
    ).toEqual([]);
    expect(
      firstSponsorOf(side(C, 2, { linkRows: [], minting: 'complete' }))
    ).toBeNull();
  });

  it('the same first payer: payments only (a multi-payment is another first transaction, as on the Funded page)', () => {
    const fa = fundingFrom(pay(F, A, 1, '5'), A);
    const fb = fundingFrom(pay(F, B, 2, '5'), B);
    const fc = fundingFrom(share(F, C, 3), C);
    const fk = fundingFrom(
      tx('MULTI_PAYMENT', 4, {
        creatorAddress: F,
        payments: [{ recipient: K, amount: '5', assetId: 0 }],
      }),
      K
    );
    expect(fk?.kind).toBe('multiPayment');
    const same = sameFirstPayers([
      side(A, 0, { funding: fa }),
      side(B, 1, { funding: fb }),
      side(C, 2, { funding: fc }),
      side(K, 3, { funding: fk }),
    ]);
    expect(same).toHaveLength(1);
    expect(same[0].from).toBe(F);
    expect(same[0].accounts.map((each) => each.letter)).toEqual(['A', 'B']);
  });

  it('shared accounts in their payments: the compared ones, AT addresses and busy payers left out and counted', () => {
    const sides = [
      side(A, 0, {
        payments: [
          pay(A, K, 1),
          pay(A, K, 2),
          pay(A, B, 3),
          pay(A, AT, 4),
          pay(F, A, 5),
        ],
      }),
      side(B, 1, {
        payments: [pay(K, B, 6), pay(B, AT, 7), pay(B, A, 8), pay(F, B, 9)],
      }),
      // C paid B too: B is compared, so it is never one of their shared accounts.
      side(C, 2, { payments: [pay(C, B, 10)] }),
    ];
    const shared = sharedCounterparties(sides, { [F]: 1000 });
    expect(shared.rows.map((row) => row.address)).toEqual([K]);
    expect(shared.rows[0].relation).toEqual({
      kind: 'through',
      from: 'A',
      to: 'B',
    });
    expect(shared.rows[0].counts).toEqual([
      { letter: 'A', address: A, sent: 2, received: 0 },
      { letter: 'B', address: B, sent: 0, received: 1 },
    ]);
    expect(shared.atLeftOut).toBe(1);
    expect(shared.busyLeftOut).toBe(1);
  });

  it('groups two or more are in, smallest first, MINTER aside', () => {
    const group = (
      groupId: number,
      name: string,
      members: number | null
    ): GroupOf => ({
      groupId,
      groupName: name,
      owner: null,
      isOpen: true,
      memberCount: members,
      isAdmin: false,
      created: null,
      description: null,
    });
    const sides = [
      side(A, 0, {
        groups: [
          group(694, 'MINTER', 600),
          group(2, 'Big', 90),
          group(3, 'Small', 4),
        ],
      }),
      side(B, 1, {
        groups: [
          group(694, 'MINTER', 600),
          group(2, 'Big', 90),
          group(3, 'Small', 4),
        ],
      }),
      side(C, 2, { groups: [group(3, 'Small', 4), group(9, 'Own', 1)] }),
    ];
    expect(sharedGroups(sides).map((g) => [g.groupName, g.letters])).toEqual([
      ['Small', ['A', 'B', 'C']],
      ['Big', ['A', 'B']],
    ]);
  });
});

describe('the timeline together', () => {
  it('each one’s firsts in order, each transaction once', () => {
    const funded = pay(F, A, 10, '5');
    const self = share(A, A, 20);
    const move = tx('TRANSFER_PRIVS', 30, {
      creatorAddress: F,
      recipient: undefined,
    });
    const events = timelineEvents([
      {
        address: A,
        letter: 'A',
        funding: fundingFrom(funded, A),
        linkRows: [self, move],
        minting: 'complete',
        names: 'complete',
        primary: null,
        firstSeen: funded.timestamp,
      },
    ]);
    expect(events.map((event) => event.kind)).toEqual([
      'funding',
      'selfShare',
      'levelMove',
    ]);
    expect(events[1].sentence.key).toBe('reward_share.self_start_mine');
  });

  it('a level move that was its first incoming transaction is told once, as where its first QORT came from', () => {
    const move = tx('TRANSFER_PRIVS', 30, {
      creatorAddress: F,
      recipient: undefined,
    });
    const events = timelineEvents([
      {
        address: A,
        letter: 'A',
        funding: fundingFrom(move, A),
        linkRows: [move],
        minting: 'complete',
        names: 'complete',
        primary: null,
        firstSeen: move.timestamp,
      },
    ]);
    expect(events.map((event) => [event.kind, event.signature])).toEqual([
      ['funding', move.signature],
    ]);
  });

  it('a name it bought reads as bought, never as registered; a registration only from all of its name transactions', () => {
    const bought = tx('BUY_NAME', 40, {
      creatorAddress: A,
      seller: B,
      name: 'Spare Room',
      amount: '5',
    });
    const base = {
      address: A,
      letter: 'A' as const,
      minting: 'complete' as const,
      firstSeen: 0,
    };
    const asBought = timelineEvents([
      {
        ...base,
        linkRows: [bought],
        names: 'complete',
        primary: { name: 'Spare Room', registered: 5 },
      },
    ]);
    expect(asBought.map((event) => event.sentence.key)).toEqual([
      'buy_name.out',
    ]);
    const registered = timelineEvents([
      {
        ...base,
        linkRows: [],
        names: 'complete',
        primary: { name: 'Own', registered: 5 },
      },
    ]);
    expect(registered.map((event) => event.sentence.key)).toEqual([
      'registered_name',
    ]);
    // A name it sold, then registered again once it was free: the sale is
    // someone else's purchase, never how it got the name.
    const sold = tx('BUY_NAME', 30, {
      creatorAddress: B,
      seller: A,
      name: 'Old Room',
      amount: '2',
    });
    expect(
      timelineEvents([
        {
          ...base,
          linkRows: [sold],
          names: 'complete',
          primary: { name: 'Old Room', registered: 50 },
        },
      ]).map((event) => event.sentence.key)
    ).toEqual(['registered_name']);
    // Its name transactions read only in part: a purchase may be among the rest.
    expect(
      timelineEvents([
        {
          ...base,
          linkRows: [],
          names: 'partial',
          primary: { name: 'Own', registered: 5 },
        },
      ])
    ).toEqual([]);
    // A registration older than the account itself is someone else's.
    expect(
      timelineEvents([
        {
          ...base,
          firstSeen: 10,
          linkRows: [],
          names: 'complete',
          primary: { name: 'Own', registered: 5 },
        },
      ])
    ).toEqual([]);
  });

  it('its first self-share only from all of its minting transactions', () => {
    const self = share(A, A, 20);
    expect(
      firstSelfShare({
        address: A,
        letter: 'A',
        linkRows: [self],
        minting: 'partial',
      })
    ).toBeNull();
    expect(
      firstSelfShare({
        address: A,
        letter: 'A',
        linkRows: [self],
        minting: 'complete',
      })
    ).toBe(self);
  });

  it('how far apart: blocks, the same block, or a time; never a negative count of blocks', () => {
    expect(
      timelineGap({ height: 10, timestamp: 0 }, { height: 15, timestamp: 1 })
    ).toEqual({
      kind: 'blocks',
      blocks: 5,
    });
    expect(
      timelineGap({ height: 10, timestamp: 0 }, { height: 10, timestamp: 1 })
    ).toEqual({
      kind: 'same_block',
    });
    expect(
      timelineGap(
        { height: 12, timestamp: 0 },
        { height: 10, timestamp: 120_000 }
      )
    ).toEqual({ kind: 'time', ms: 120_000 });
    expect(
      timelineGap(
        { height: null, timestamp: 0 },
        { height: 10, timestamp: 5_000 }
      )
    ).toEqual({ kind: 'moments' });
  });
});
