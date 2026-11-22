import { describe, expect, it } from 'vitest';
import type { AssetTrade } from './assetTrades';
import {
  badgeText,
  BIG_BOTH_MAX,
  BIG_LAYOUT,
  BIG_SIDE_MAX,
  BOTTOM_NAME_MAX,
  BOTTOM_ROW_MARGIN,
  bottomNameHeight,
  bottomNames,
  circleAspect,
  circleHeight,
  circleLayout,
  circleNodes,
  circleOverlaps,
  fitCircle,
  layoutFor,
  NARROW_LAYOUT,
  NARROW_MIN,
  nodeOrders,
  nodeRadius,
  nodeSize,
  nodeTransactions,
  qortSize,
  receivedShare,
  shortAmount,
  sideMaxSize,
  TINY_LAYOUT,
  WIDE_LAYOUT,
  WIDE_MIN,
  type AmountRows,
  type CircleGroups,
  type CircleLayout,
  type CircleNode,
  type CircleOrder,
  type CircleRoom,
  type LayoutOptions,
  type PlacedNode,
} from './circle';
import { recordedFindings, type Finding } from './findings';
import type { TxRow } from './reads';
import { wrapRows } from './textWidth';

// The Connections circle's rules (from Q-Mintership+'s circle tests): which
// side each account is drawn on, in which order, how big, and where; and
// that nothing in the drawing overlaps at any width it is drawn at.

const tx = (n: number, from = 0): TxRow[] =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        type: 'PAYMENT',
        signature: `s${from + i}`,
        blockHeight: from + i,
        timestamp: from + i,
      }) as TxRow
  );

const finding = (
  kind: Finding['kind'],
  other: string | null,
  txs: TxRow[],
  extra: Partial<Finding> = {}
): Finding => ({
  key: `${kind}:${other}`,
  kind,
  other,
  sentence: { key: 'x', slots: {} },
  height: 1,
  timestamp: 1,
  signature: 's',
  evidence: txs,
  evidenceKind: 'transactions',
  ...extra,
});

const QORT = 100_000_000n;

describe('circleNodes', () => {
  it('puts payments in on one side, payments out on the other, and every other link apart', () => {
    const groups = circleNodes([
      finding('paidBy', 'QA', tx(3)),
      finding('paidTo', 'QA', tx(2, 10)),
      finding('paidTo', 'QD', tx(5, 20)),
      finding('sponsor', 'QB', []),
      finding('levelMove', 'QB', tx(1, 30)),
      finding('nameDeal', 'QC', tx(1, 40)),
    ]);
    // An account paid both ways is one node, with each way's part.
    expect(groups.in).toEqual([]);
    expect(groups.out.map((n) => [n.key, n.count])).toEqual([['out:QD', 5]]);
    expect(groups.both.map((n) => [n.key, n.count, n.split])).toEqual([
      [
        'both:QA',
        5,
        {
          in: { count: 3, qort: 0n, assets: [] },
          out: { count: 2, qort: 0n, assets: [] },
        },
      ],
    ]);
    expect(nodeTransactions(groups.both[0])).toHaveLength(5);
    expect(
      groups.other.map((n) => [n.key, n.count, n.findings.length])
    ).toEqual([
      ['other:QB', 2, 2],
      ['other:QC', 1, 1],
    ]);
  });

  it('keeps a link with no one other account apart, never dropping it', () => {
    const sponsees = finding('sponsees', null, tx(4));
    const unknownMove = finding('levelMove', null, tx(1, 9));
    const groups = circleNodes([
      sponsees,
      finding('paidTo', 'QD', tx(1, 20)),
      unknownMove,
    ]);
    expect(groups.unplaced).toEqual([sponsees, unknownMove]);
    expect(groups.out.map((n) => n.key)).toEqual(['out:QD']);
  });

  it('adds up the QORT and the Q-Assets that went each way', () => {
    const coin = { id: 7, name: 'Coin' };
    const groups = circleNodes([
      finding('paidBy', 'QA', tx(3), { qort: 3n * QORT }),
      finding('paidTo', 'QA', tx(2, 10), {
        qort: 500n * QORT,
        assets: [{ asset: coin, atomic: 2n * QORT }],
      }),
      finding('paidTo', 'QZ', tx(1, 20), {
        assets: [{ asset: coin, atomic: QORT }],
      }),
      finding('levelMove', 'QA', tx(1, 30)),
    ]);
    expect(groups.both[0].split?.in.qort).toBe(3n * QORT);
    expect(groups.both[0].split?.out.qort).toBe(500n * QORT);
    expect(groups.both[0].qort).toBe(503n * QORT);
    expect(groups.both[0].assets).toEqual([{ asset: coin, atomic: 2n * QORT }]);
    expect(groups.out[0].assets).toEqual([{ asset: coin, atomic: QORT }]);
    expect(groups.other[0].qort).toBe(0n);
  });

  it('draws a Q-Asset trade both ways: what it got came in, what it gave went out', () => {
    const me = `Q${'m'.repeat(33)}`;
    const other = `Q${'o'.repeat(33)}`;
    const trade = (
      n: number,
      gaveQort: string,
      gotAsset: string
    ): AssetTrade => ({
      orderId: `mine${n}`,
      otherOrderId: `theirs${n}`,
      other,
      timestamp: 1_000 + n,
      initiated: true,
      gave: { asset: { id: 0, name: null }, amount: gaveQort },
      got: { asset: { id: 28, name: 'GBQ' }, amount: gotAsset },
    });
    const findings = recordedFindings({
      address: me,
      trades: [trade(1, '529.00000000', '23.00000000'), trade(2, '1', '1')],
    });
    expect(findings[0].trade).toEqual({
      got: {
        count: 2,
        qort: 0n,
        assets: [{ asset: { id: 28, name: 'GBQ' }, atomic: 24n * QORT }],
      },
      gave: { count: 2, qort: 530n * QORT, assets: [] },
    });
    const groups = circleNodes(findings);
    expect(groups.in).toEqual([]);
    expect(groups.out).toEqual([]);
    const [node] = groups.both;
    expect(node.key).toBe(`both:${other}`);
    // The trades are listed once, and their orders are what is behind them.
    expect(node.findings).toHaveLength(1);
    expect(nodeOrders(node).sort()).toEqual(
      ['mine1', 'mine2', 'theirs1', 'theirs2'].sort()
    );
    expect(nodeTransactions(node)).toEqual([]);
    // Counted as the transactions its dialog lists, its four orders, never
    // once each way: no payment either way, what moved is the trades'.
    expect(node.count).toBe(4);
    expect(node.split).toEqual({
      in: { count: 0, qort: 0n, assets: [] },
      out: { count: 0, qort: 0n, assets: [] },
    });
    expect(node.trade).toEqual({
      orders: 4,
      got: {
        qort: 0n,
        assets: [{ asset: { id: 28, name: 'GBQ' }, atomic: 24n * QORT }],
      },
      gave: { qort: 530n * QORT, assets: [] },
    });
    expect(node.qort).toBe(530n * QORT);
    // Everything it gave was QORT: by QORT, none of it came in.
    expect(receivedShare(node)).toBe(0);
  });

  it('counts each transaction behind a node once, as its dialog lists them, and a trade by its orders', () => {
    // A reward share that is both its sponsor's and the one it mints with
    // now: two links, one transaction.
    const share = tx(1, 50);
    const sponsor = circleNodes([
      finding('sponsor', 'QB', share),
      finding('mintingWith', 'QB', share),
    ]).other[0];
    expect(sponsor.findings).toHaveLength(2);
    expect(sponsor.count).toBe(1);
    expect(nodeTransactions(sponsor)).toHaveLength(1);
    // Paid both ways and traded with: its payments each way, and the
    // trade's two orders once, not one each way.
    const me = `Q${'m'.repeat(33)}`;
    const other = `Q${'o'.repeat(33)}`;
    const [traded] = recordedFindings({
      address: me,
      trades: [
        {
          orderId: 'mine',
          otherOrderId: 'theirs',
          other,
          timestamp: 1_000,
          initiated: true,
          gave: { asset: { id: 0, name: null }, amount: '529.00000000' },
          got: { asset: { id: 28, name: 'GBQ' }, amount: '23.00000000' },
        },
      ],
    });
    const [node] = circleNodes([
      traded,
      finding('paidTo', other, tx(3, 60), { qort: 13n * QORT }),
      finding('paidBy', other, tx(1, 70), { qort: 7n * QORT }),
    ]).both;
    expect(node.count).toBe(6);
    expect(node.count).toBe(
      nodeTransactions(node).length + nodeOrders(node).length
    );
    expect(node.split?.in).toEqual({ count: 1, qort: 7n * QORT, assets: [] });
    expect(node.split?.out).toEqual({
      count: 3,
      qort: 13n * QORT,
      assets: [],
    });
    expect(node.trade?.orders).toBe(2);
    // What moved, the trade's too: 7 QORT in, 542 out.
    expect(node.qort).toBe(549n * QORT);
    expect(receivedShare(node)).toBeCloseTo(7 / 549, 3);
  });

  it('puts the most QORT first on request, else the most transactions, ties by QORT then address', () => {
    const findings = [
      finding('paidTo', 'QA', tx(5), { qort: QORT }),
      finding('paidTo', 'QB', tx(1, 10), { qort: 500n * QORT }),
      finding('paidTo', 'QC', tx(2, 20), { qort: 500n * QORT }),
      finding('paidTo', 'QD', tx(1, 30), { qort: 10n * QORT }),
      finding('paidTo', 'QE', tx(1, 40)),
      finding('paidTo', 'QF', tx(1, 50)),
    ];
    const order = (by?: CircleOrder) =>
      circleNodes(findings, by).out.map((n) => n.address);
    expect(order()).toEqual(['QA', 'QC', 'QB', 'QD', 'QE', 'QF']);
    expect(order('count')).toEqual(order());
    expect(order('qort')).toEqual(['QC', 'QB', 'QD', 'QA', 'QE', 'QF']);
    // The same data in another order gives the same order.
    expect(
      circleNodes([...findings].reverse(), 'qort').out.map((n) => n.address)
    ).toEqual(order('qort'));
  });

  it('says what share came in: by QORT, else by transactions', () => {
    const node = (
      inCount: number,
      inQort: bigint,
      outCount: number,
      outQort: bigint
    ) => ({
      side: 'both' as const,
      split: {
        in: { count: inCount, qort: inQort, assets: [] },
        out: { count: outCount, qort: outQort, assets: [] },
      },
    });
    expect(receivedShare(node(1, 300n, 9, 100n))).toBeCloseTo(0.75);
    expect(receivedShare(node(3, 0n, 1, 0n))).toBeCloseTo(0.75);
    expect(receivedShare(node(0, 0n, 0, 0n))).toBe(0.5);
    expect(receivedShare({ side: 'in' })).toBe(1);
    expect(receivedShare({ side: 'out' })).toBe(0);
  });

  it('lists a node’s transactions once each, the newest first', () => {
    const shared = tx(2, 5);
    const node = {
      findings: [
        finding('levelMove', 'QB', shared),
        finding('sponsor', 'QB', [shared[1], ...tx(1, 9)]),
      ],
    };
    expect(nodeTransactions(node).map((t) => t.signature)).toEqual([
      's9',
      's6',
      's5',
    ]);
  });
});

describe('sizes and numbers', () => {
  it('grow with the count, within a side’s room', () => {
    expect(nodeSize(1, 100, 28, 56)).toBe(28);
    expect(nodeSize(100, 100, 28, 56)).toBe(56);
    expect(nodeSize(25, 100, 28, 56)).toBeLessThan(nodeSize(50, 100, 28, 56));
    expect(nodeSize(1, 1, 28, 56)).toBe(42);
    expect(sideMaxSize(3, WIDE_LAYOUT)).toBe(56);
    expect(sideMaxSize(10, WIDE_LAYOUT)).toBeLessThan(44);
    expect(sideMaxSize(8, NARROW_LAYOUT)).toBeLessThan(NARROW_LAYOUT.maxSize);
  });

  it('grow with the QORT when the circle is ordered by it, the smallest for none', () => {
    expect(qortSize(0, 500, 28, 56)).toBe(28);
    expect(qortSize(500, 500, 28, 56)).toBe(56);
    expect(qortSize(125, 500, 28, 56)).toBe(42);
    expect(qortSize(0, 0, 28, 56)).toBe(42);
    const node = (
      address: string,
      count: number,
      qort: bigint
    ): CircleNode => ({
      key: `out:${address}`,
      address,
      side: 'out',
      count,
      findings: [],
      qort,
      assets: [],
    });
    // One transaction of 500 QORT, and nine of 1 QORT in all.
    const sent = {
      in: [],
      out: [node('QB', 1, 500n * QORT), node('QA', 9, QORT)],
      both: [],
    };
    const [big, small] = circleLayout(sent, WIDE_LAYOUT, 'qort').placed;
    expect(big.size).toBeGreaterThan(small.size);
    const [few, many] = circleLayout(sent).placed;
    expect(few.size).toBeLessThan(many.size);
  });

  it('says its transactions from 2, or, by QORT, the QORT that moved, short, in the viewer’s language', () => {
    const node = (count: number, qort: bigint) => ({ count, qort });
    expect(badgeText(node(1, 0n), 'count', 'en')).toBeNull();
    expect(badgeText(node(6, 126n * QORT), 'count', 'en')).toBe('6');
    expect(badgeText(node(1_200, 0n), 'count', 'en')).toBe('999+');
    expect(badgeText(node(6, 0n), 'qort', 'en')).toBeNull();
    expect(badgeText(node(1, QORT / 2n), 'qort', 'en')).toBe('<1');
    expect(badgeText(node(1, (3n * QORT) / 2n), 'qort', 'en')).toBe('1.5');
    expect(badgeText(node(6, 12_630_000_000n), 'qort', 'en')).toBe('126');
    expect(badgeText(node(1, 123_400_000_000n), 'qort', 'en')).toBe('1.2K');
    expect(badgeText(node(1, 123_456_700_000_000n), 'qort', 'en')).toBe('1.2M');
    expect(badgeText(node(1, (3n * QORT) / 2n), 'qort', 'de')).toBe('1,5');
  });

  it('says an amount short beside a name: whole from 100 up, two decimals below, four under 1', () => {
    expect(shortAmount(500n * QORT, 'en')).toBe('500');
    expect(shortAmount(123_456_789_000n, 'en')).toBe('1,235');
    expect(shortAmount(7_650_000_000n, 'en')).toBe('76.5');
    expect(shortAmount(25_000_000n, 'en')).toBe('0.25');
    expect(shortAmount(7_650_000_000n, 'fr')).toBe('76,5');
    expect(shortAmount(0n, 'en')).toBeNull();
  });
});

const side = (prefix: 'in' | 'out', n: number, count = (i: number) => n - i) =>
  Array.from(
    { length: n },
    (_, i): CircleNode => ({
      key: `${prefix}:Q${i}`,
      address: `Q${prefix}${String(i).padStart(2, '0')}`,
      side: prefix,
      count: count(i),
      findings: [],
      qort: BigInt(count(i)) * QORT,
      assets: [],
    })
  );
const bothSide = (n: number, count = (i: number) => n - i) =>
  Array.from(
    { length: n },
    (_, i): CircleNode => ({
      key: `both:B${i}`,
      address: `QB${String(i).padStart(2, '0')}`,
      side: 'both',
      count: count(i),
      findings: [],
      qort: BigInt(count(i)) * QORT,
      assets: [],
    })
  );
const groups = (
  inCount: number,
  outCount: number,
  bothCount = 0
): Pick<CircleGroups, 'in' | 'out' | 'both'> => ({
  in: side('in', inCount),
  out: side('out', outCount),
  both: bothSide(bothCount),
});

describe('circleLayout', () => {
  it('draws what came in on the left and what went out on the right, from the top down', () => {
    const { placed, rest } = circleLayout(groups(3, 2));
    expect(rest).toEqual({ in: 0, out: 0, both: 0 });
    const left = placed.filter((p) => p.side === 'in');
    const right = placed.filter((p) => p.side === 'out');
    expect(left.every((p) => p.x < 50)).toBe(true);
    expect(right.every((p) => p.x > 50)).toBe(true);
    // The most transactions first, at the top.
    expect(left.map((p) => p.y)).toEqual(
      [...left.map((p) => p.y)].sort((a, b) => a - b)
    );
    // One node sits level with the middle.
    expect(circleLayout(groups(1, 0)).placed[0].y).toBeCloseTo(50);
  });

  it('gives every node its own angle, so the lines from the middle never cross or pass under one', () => {
    for (const options of [WIDE_LAYOUT, NARROW_LAYOUT]) {
      const { placed } = circleLayout(groups(12, 12, 4), options);
      const angles = placed.map((p) => Math.atan2(p.y - 50, p.x - 50));
      expect(new Set(angles.map((a) => a.toFixed(4))).size).toBe(placed.length);
      // Each line keeps clear of every other node of its side.
      for (const p of placed)
        for (const q of placed) {
          if (p === q || p.side !== q.side) continue;
          const length = Math.hypot(p.x - 50, p.y - 50);
          const cross =
            Math.abs((p.x - 50) * (q.y - 50) - (p.y - 50) * (q.x - 50)) /
            length;
          expect(cross).toBeGreaterThan(3);
        }
    }
  });

  it('draws at most a side’s maximum, counts the rest, and fewer when narrow', () => {
    expect(circleLayout(groups(20, 3)).rest).toEqual({
      in: 10,
      out: 0,
      both: 0,
    });
    expect(circleLayout(groups(20, 3), NARROW_LAYOUT).rest).toEqual({
      in: 12,
      out: 0,
      both: 0,
    });
    expect(circleLayout(groups(0, 0, 7)).rest.both).toBe(
      7 - WIDE_LAYOUT.bothMax
    );
    const { placed } = circleLayout(groups(20, 3));
    expect(placed.filter((p) => p.side === 'in')).toHaveLength(
      WIDE_LAYOUT.sideMax
    );
  });

  it('fills the bottom between the sides, the most in the middle, mirrored', () => {
    const { placed } = circleLayout(groups(0, 0, 6));
    expect(placed).toHaveLength(WIDE_LAYOUT.bothMax);
    for (const p of placed) {
      expect(p.y).toBeGreaterThan(70);
      expect(p.y).toBeLessThan(100);
      expect(Math.abs(p.x - 50)).toBeLessThanOrEqual(WIDE_LAYOUT.rx);
    }
    const byX = [...placed].sort((a, b) => a.x - b.x).map((p) => p.key);
    expect(byX.slice(1, 3).sort()).toEqual(['both:B0', 'both:B1']);
    const xs = placed.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i++)
      expect(xs[i] - 50).toBeCloseTo(50 - xs[xs.length - 1 - i]);
    expect(circleLayout(groups(0, 0, 1)).placed[0].x).toBeCloseTo(50);
  });

  it('lifts the sides off the bottom to make room', () => {
    const lowest = (bothCount: number) =>
      Math.max(
        ...circleLayout(groups(10, 0, bothCount))
          .placed.filter((p) => p.side === 'in')
          .map((p) => p.y)
      );
    expect(lowest(2)).toBeLessThan(lowest(0));
  });

  it('mirrors the two sides, evenly spaced in height, each on the ellipse', () => {
    const { placed } = circleLayout(groups(10, 10, 2));
    const left = placed.filter((p) => p.side === 'in');
    const right = placed.filter((p) => p.side === 'out');
    left.forEach((p, i) => {
      expect(p.x).toBeCloseTo(100 - right[i].x);
      expect(p.y).toBeCloseTo(right[i].y);
    });
    const steps = right.slice(1).map((p, i) => p.y - right[i].y);
    for (const s of steps) expect(s).toBeCloseTo(steps[0]);
    for (const p of right)
      expect(
        ((p.x - 50) / WIDE_LAYOUT.rx) ** 2 + ((p.y - 50) / WIDE_LAYOUT.ry) ** 2
      ).toBeCloseTo(1);
  });

  it('centres the fewer side on the fuller one’s slots', () => {
    const { placed } = circleLayout(groups(1, 5));
    const right = placed.filter((p) => p.side === 'out');
    expect(placed.find((p) => p.side === 'in')?.y).toBeCloseTo(right[2].y);
  });

  it('is stable: the same data gives the same places, whatever order it came in', () => {
    const findings = [
      ...Array.from({ length: 14 }, (_, i) =>
        finding(
          'paidTo',
          `Qo${String(i).padStart(2, '0')}`,
          tx(1 + (i % 3), 100 * i)
        )
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        finding(
          'paidBy',
          `Qi${String(i).padStart(2, '0')}`,
          tx(2, 5_000 + 10 * i)
        )
      ),
    ];
    for (const order of ['count', 'qort'] as const) {
      const once = circleLayout(
        circleNodes(findings, order),
        WIDE_LAYOUT,
        order
      );
      const again = circleLayout(
        circleNodes([...findings].reverse(), order),
        WIDE_LAYOUT,
        order
      );
      expect(again.placed.map((p) => [p.key, p.x, p.y, p.size])).toEqual(
        once.placed.map((p) => [p.key, p.x, p.y, p.size])
      );
    }
  });
});

describe('the drawing’s height: nothing overlaps', () => {
  const WIDTHS = [180, 220, 260, 300, 339, 340, 420, 520, 599, 600, 700, 832];
  const lines = () => 2;
  /** Sizes all different, so the big and the small sit beside each other. */
  const mixed = (n: number) => (i: number) => [1, 40, 3, 25, 2, 9][i % 6] + n;

  function check(
    g: Pick<CircleGroups, 'in' | 'out' | 'both'>,
    order: CircleOrder
  ) {
    for (const width of WIDTHS) {
      const options = layoutFor(width);
      const layout = circleLayout(g, options, order);
      const height = circleHeight(layout, options, width);
      expect(
        circleOverlaps(layout, options, width, height, lines),
        `${width} px, ${layout.placed.length} nodes, ${order}`
      ).toEqual([]);
    }
  }

  it('names beside the avatars only from WIDE_MIN; fewer avatars on a phone', () => {
    expect(layoutFor(WIDE_MIN).named).toBe(true);
    expect(layoutFor(WIDE_MIN - 1).named).toBe(false);
    expect(layoutFor(NARROW_MIN)).toBe(NARROW_LAYOUT);
    expect(layoutFor(NARROW_MIN - 1)).toBe(TINY_LAYOUT);
  });

  it('at every width, for every number of accounts each way and at the bottom', () => {
    for (const inCount of [0, 1, 2, 4, 7, 10, 14])
      for (const outCount of [0, 1, 3, 6, 10, 12])
        for (const bothCount of [0, 1, 2, 4, 6])
          for (const order of ['count', 'qort'] as const)
            check(
              {
                in: side('in', inCount, mixed(inCount)),
                out: side('out', outCount, mixed(outCount)),
                both: bothSide(bothCount, mixed(bothCount)),
              },
              order
            );
  });

  it('the height made for it is what keeps them apart (a drawing of its aspect alone overlaps)', () => {
    const crowded = groups(10, 10, 4);
    let overlapped = 0;
    for (const width of WIDTHS) {
      const options: LayoutOptions = layoutFor(width);
      const layout = circleLayout(crowded, options);
      const plain = width / circleAspect(layout, options);
      if (circleOverlaps(layout, options, width, plain, lines).length)
        overlapped += 1;
      expect(circleHeight(layout, options, width)).toBeGreaterThanOrEqual(
        plain
      );
    }
    expect(overlapped).toBeGreaterThan(0);
  });

  it('a name under a bottom avatar takes a line for each amount', () => {
    expect(bottomNameHeight(0)).toBe(bottomNameHeight(1));
    expect(bottomNameHeight(3)).toBeGreaterThan(bottomNameHeight(1));
  });
});

// ---- A bigger window ------------------------------------------------------------------------

/** Around the drawing, as ConnectionsCircle has it: its padding. */
const PAD = 24;
/** The amounts under each bottom avatar: some long (German), some short. */
const AMOUNTS = [
  [
    '88 QORT empfangen, 13.277 gesendet',
    '983 BHC Coin empfangen, 10.000 gesendet',
  ],
  ['88 QORT in, 13,277 out'],
  ['7 QORT in, 542 out', '23 GBQ in'],
];
const amountRows: AmountRows = (node, room) =>
  AMOUNTS[Number(node.address.slice(3)) % AMOUNTS.length].reduce(
    (sum, line) => sum + wrapRows(line, room, 12),
    0
  );
/** What ConnectionsCircle has around the drawing: headings, padding, the names under the bottom. */
function around(
  layout: CircleLayout,
  options: LayoutOptions,
  width: number,
  height: number
): number {
  const bottom = layout.placed.filter((node) => node.side === 'both');
  let under = PAD;
  if (options.named && bottom.length) {
    const names = bottomNames(
      bottom,
      width,
      height,
      amountRows,
      options.bottomNameMax
    );
    under =
      16 +
      Math.max(
        36,
        ...bottom.map((node) =>
          bottomNameHeight(names.get(node.key)?.rows ?? 1)
        )
      );
  }
  return 68 + PAD + under + (bottom.length ? 68 : 0);
}

/**
 * The room an Explorer window gives, in CSS px, on a screen `screen` at
 * Hub's zoom `zoom` (a zoom changes how many CSS px there are): an
 * ordinary window (at most 1,140 by 900, its 1,080 column), or full
 * screen; the circle's column centred in its content area.
 */
function windowRoom(
  screen: [number, number],
  zoom: number,
  full: boolean
): CircleRoom & { visible: number; content: number; column: number } {
  const vw = screen[0] / zoom;
  const vh = screen[1] / zoom;
  const md = vw >= 900;
  const px = md ? 28 : vw >= 600 ? 20 : 12;
  const py = md ? 24 : 16;
  const paperWidth = full ? vw : Math.min(1140, vw - (md ? 48 : 32));
  const paperHeight = full
    ? vh
    : md
      ? Math.min(0.84 * vh, 900, vh - 24)
      : vh - 32;
  const border = full ? 0 : 2;
  const content = paperWidth - border - 2 * px;
  const visible = paperHeight - border - 57 - 2 * py;
  const column = Math.min(1080, content);
  return {
    ordinary: Math.min(column, 880) - 2 * PAD,
    big: content > 1140 ? { width: content - 2 * PAD, height: visible } : null,
    visible,
    content,
    column,
  };
}

const fitted = (
  g: Pick<CircleGroups, 'in' | 'out' | 'both'>,
  room: CircleRoom,
  order: CircleOrder = 'count'
) => fitCircle(g, order, room, around);

/** Sizes all different, so the big and the small sit beside each other. */
const mixedSizes = (n: number) => (i: number) =>
  [1, 40, 3, 25, 2, 9][i % 6] + n;

describe('the drawing in a bigger window (full screen)', () => {
  it('in an ordinary window, as always: its column’s width, at most Q-Mintership+’s, and the options for it', () => {
    for (const width of [300, 500, 700, 832]) {
      const fit = fitted(groups(20, 20, 10), { ordinary: width, big: null });
      expect(fit.big).toBe(false);
      expect(fit.width).toBe(width);
      expect(fit.options).toBe(layoutFor(width));
      expect(fit.layout).toEqual(
        circleLayout(groups(20, 20, 10), layoutFor(width))
      );
    }
    // An ordinary window, however it is zoomed: never bigger than 1,140 px of its own.
    for (const zoom of [0.5, 0.67, 1])
      expect(windowRoom([1920, 1080], zoom, false).big).toBeNull();
  });

  it('full screen draws every account it may, names given more room, all of it in the height it shows where it fits there', () => {
    const accounts = groups(12, 12, 6);
    const ordinaryFit = fitted(accounts, { ordinary: 832, big: null });
    const room = windowRoom([2560, 1440], 1, true);
    const fit = fitted(accounts, room);
    expect(fit.big).toBe(true);
    // Every one of them; an ordinary window leaves 2 a side and 2 at the bottom to the list.
    expect(fit.layout.rest).toEqual({ in: 0, out: 0, both: 0 });
    expect(ordinaryFit.layout.rest).toEqual({ in: 2, out: 2, both: 2 });
    expect(fit.width).toBeGreaterThan(832);
    expect(fit.width + 2 * PAD).toBeLessThanOrEqual(room.content);
    expect(
      fit.height + around(fit.layout, fit.options, fit.width, fit.height)
    ).toBeLessThanOrEqual(room.visible);
    expect(
      circleOverlaps(fit.layout, fit.options, fit.width, fit.height, amountRows)
    ).toEqual([]);
    // The names beside the widest-placed avatars, and under the bottom ones.
    const besideRoom = (width: number, node: PlacedNode) =>
      ((node.side === 'out' ? 100 - node.x : node.x) / 100) * width;
    const widestRoom = (f: typeof fit) =>
      Math.min(
        ...f.layout.placed
          .filter((node) => node.side === 'in' || node.side === 'out')
          .map((node) => besideRoom(f.width, node))
      );
    expect(widestRoom(fit)).toBeGreaterThan(widestRoom(ordinaryFit));
    const bottom = fit.layout.placed.filter((node) => node.side === 'both');
    const names = bottomNames(
      bottom,
      fit.width,
      fit.height,
      amountRows,
      fit.options.bottomNameMax
    );
    // More room under each bottom avatar than an ordinary window ever gives.
    expect(bottom.length).toBe(6);
    for (const node of bottom)
      expect(names.get(node.key)?.room).toBeGreaterThan(BOTTOM_NAME_MAX);
    // Its amounts each on one line where they fit.
    const short = bottom.find(
      (node) => Number(node.address.slice(3)) % AMOUNTS.length === 2
    );
    expect(short && names.get(short.key)?.rows).toBe(AMOUNTS[2].length);
  });

  it('as many as fit, never more than BIG_SIDE_MAX and BIG_BOTH_MAX, nor more than there are', () => {
    const room = windowRoom([3840, 2160], 1, true);
    const crowded = fitted(groups(30, 30, 12), room);
    expect(crowded.options.sideMax).toBe(BIG_SIDE_MAX);
    expect(crowded.options.bothMax).toBe(BIG_BOTH_MAX);
    expect(crowded.layout.rest).toEqual({ in: 14, out: 14, both: 4 });
    const few = fitted(groups(12, 3, 2), room);
    expect(few.options.sideMax).toBe(12);
    expect(few.options.bothMax).toBe(BIG_LAYOUT.bothMax);
    expect(few.layout.rest).toEqual({ in: 0, out: 0, both: 0 });
    // Fewer accounts spread over the room the window gives.
    expect(few.width).toBeGreaterThan(crowded.width * 0.5);
  });

  it('more than fits in the height it shows: every account it may draw anyway, the window scrolling, no taller than they need', () => {
    // A laptop's screen at full window (1,440 by 873 CSS px), an account
    // that received from 11, sent to 19 and was paid both ways by 18.
    const room = windowRoom([1440, 873], 1, true);
    const fit = fitted(groups(11, 19, 18), room);
    const drawn = (side: string) =>
      fit.layout.placed.filter((node) => node.side === side).length;
    expect(fit.big).toBe(true);
    // More than an ordinary window's 10 a side and 4 at the bottom.
    expect([drawn('in'), drawn('out'), drawn('both')]).toEqual([
      11,
      BIG_SIDE_MAX,
      BIG_BOTH_MAX,
    ]);
    expect(fit.layout.rest).toEqual({ in: 0, out: 3, both: 10 });
    expect(
      circleOverlaps(fit.layout, fit.options, fit.width, fit.height, amountRows)
    ).toEqual([]);
    // Taller than the window shows: it scrolls. As wide as it can be in
    // the window without being taller than they need at an ordinary
    // window's width.
    expect(
      fit.height + around(fit.layout, fit.options, fit.width, fit.height)
    ).toBeGreaterThan(room.visible);
    expect(fit.width).toBeGreaterThan(room.ordinary);
    expect(fit.width + 2 * PAD).toBeLessThanOrEqual(room.content);
    expect(fit.height).toBeLessThanOrEqual(
      circleHeight(fit.layout, fit.options, room.ordinary) + 1
    );
    // So short a window that nothing is gained: the ordinary drawing.
    const short = fitted(groups(3, 3, 0), {
      ordinary: 832,
      big: { width: 1800, height: 300 },
    });
    expect(short.big).toBe(false);
    expect(short.width).toBe(832);
  });

  it('nothing overlaps or leaves the window, ordinary or full screen, at Hub’s zooms from 50 % to 200 %', () => {
    const counts: Array<[number, number, number]> = [
      [0, 0, 1],
      [1, 1, 0],
      [3, 3, 2],
      [10, 10, 4],
      [12, 12, 6],
      [20, 20, 10],
      [16, 2, 0],
      [2, 16, 8],
    ];
    for (const screen of [
      [1366, 768],
      [1920, 1080],
      [2560, 1440],
    ] as Array<[number, number]>)
      for (const zoom of [0.5, 0.67, 1, 1.5, 2])
        for (const full of [false, true]) {
          const room = windowRoom(screen, zoom, full);
          for (const [inCount, outCount, bothCount] of counts)
            for (const order of ['count', 'qort'] as const) {
              const g = {
                in: side('in', inCount, mixedSizes(inCount)),
                out: side('out', outCount, mixedSizes(outCount)),
                both: bothSide(bothCount, mixedSizes(bothCount)),
              };
              const fit = fitted(g, room, order);
              const what = `${screen.join('x')} at ${zoom * 100} %${full ? ', full screen' : ''}, ${inCount}/${outCount}/${bothCount} ${order}`;
              expect(
                circleOverlaps(
                  fit.layout,
                  fit.options,
                  fit.width,
                  fit.height,
                  amountRows
                ),
                what
              ).toEqual([]);
              expect(fit.width, what).toBeGreaterThan(0);
              // Never wider than its column in an ordinary window, nor than the window.
              expect(fit.width + 2 * PAD, what).toBeLessThanOrEqual(
                (fit.big ? room.content : room.column) + 0.5
              );
              // A bigger drawing: every account it may draw.
              if (fit.big) {
                const most = Math.max(inCount, outCount);
                expect(fit.options.sideMax, what).toBe(
                  Math.min(BIG_SIDE_MAX, Math.max(WIDE_LAYOUT.sideMax, most))
                );
                expect(fit.options.bothMax, what).toBe(
                  Math.min(
                    BIG_BOTH_MAX,
                    Math.max(WIDE_LAYOUT.bothMax, bothCount)
                  )
                );
              }
            }
        }
  });

  it('a bottom avatar’s amounts wrap where its name is narrow, and the room under it grows with them', () => {
    const lone = circleLayout(groups(0, 0, 1), BIG_LAYOUT).placed;
    // One line: on one row with a big drawing's room, wrapped in an ordinary one's.
    const english: AmountRows = (_node, room) =>
      wrapRows('88 QORT in, 13,277 out', room, 12);
    const big = bottomNames(lone, 1200, 900, english, BIG_LAYOUT.bottomNameMax);
    const ordinary = bottomNames(lone, 1200, 900, english, BOTTOM_NAME_MAX);
    expect(big.get(lone[0].key)?.rows).toBe(1);
    expect(ordinary.get(lone[0].key)?.rows).toBe(2);
    expect(
      bottomNameHeight(ordinary.get(lone[0].key)?.rows ?? 0)
    ).toBeGreaterThan(bottomNameHeight(1));
    // The long German pair takes more rows still.
    const german: AmountRows = (_node, room) =>
      AMOUNTS[0].reduce((sum, line) => sum + wrapRows(line, room, 12), 0);
    // Neighbours close by: narrower rooms, and the rows they wrap to.
    const crowd = circleLayout(groups(0, 0, 4), WIDE_LAYOUT).placed;
    const tight = bottomNames(crowd, 600, 500, german, 220);
    for (const node of crowd) {
      const name = tight.get(node.key);
      expect(name?.room).toBeLessThan(220);
      expect(name?.rows).toBe(
        german(node, (name?.room ?? 0) - BOTTOM_ROW_MARGIN)
      );
    }
  });
});

describe('the names under the bottom avatars, as drawn', () => {
  // 10 a side and 4 at the bottom, 716 px wide: an ordinary window at about
  // 164 % on a 1,440 by 873 screen. The bottom from the left: the fourth
  // heaviest, the second, the heaviest, the third.
  const WIDTH = 716;
  const layout = circleLayout(groups(10, 10, 4), WIDE_LAYOUT);
  const height = circleHeight(layout, WIDE_LAYOUT, WIDTH);
  const bottom = layout.placed.filter((node) => node.side === 'both');
  const byKey = (key: string) => {
    const node = bottom.find((each) => each.key === key);
    if (!node) throw new Error(key);
    return node;
  };
  const heaviest = byKey('both:B0');
  const third = byKey('both:B2');
  /** Shaped like a level 7 account's amounts (asset names made up, as long as its own). */
  const LINES: Record<string, string[]> = {
    [heaviest.key]: ['980 QORT in, 30 out', '3 10Abcd in'],
    [third.key]: [
      '327 QORT in, 530 out',
      '1 Abcdefghij in',
      '14 Abcdefghij in',
      '23 Abcdefghi in',
    ],
  };
  const shaped: AmountRows = (node, room) =>
    (LINES[node.key] ?? ['5 QORT in, 1 out']).reduce(
      (sum, line) => sum + wrapRows(line, room, 12),
      0
    );

  it('each is given whole px, as the page draws it, its amounts counted a margin narrower', () => {
    const asked = new Map<string, number>();
    const rows: AmountRows = (node, room) => {
      asked.set(node.key, room);
      return shaped(node, room);
    };
    const names = bottomNames(
      bottom,
      WIDTH,
      height,
      rows,
      WIDE_LAYOUT.bottomNameMax
    );
    for (const node of bottom) {
      const name = names.get(node.key);
      expect(Number.isInteger(name?.room), node.key).toBe(true);
      // Its rows as they stand: counted where it is drawn, less the margin.
      expect(asked.get(node.key), node.key).toBe(
        (name?.room ?? 0) - BOTTOM_ROW_MARGIN
      );
      expect(name?.rows, node.key).toBe(
        shaped(node, (name?.room ?? 0) - BOTTOM_ROW_MARGIN)
      );
    }
  });

  it('labels shaped like these: the two names beside each other kept 6 px apart, nothing overlapping', () => {
    expect(circleOverlaps(layout, WIDE_LAYOUT, WIDTH, height, shaped)).toEqual(
      []
    );
    const names = bottomNames(
      bottom,
      WIDTH,
      height,
      shaped,
      WIDE_LAYOUT.bottomNameMax
    );
    // The heaviest's name hangs at the height of its neighbour's amounts.
    expect(bottom.indexOf(heaviest)).toBe(2);
    expect(bottom.indexOf(third)).toBe(3);
    const at = (node: PlacedNode) => ({
      x: (node.x / 100) * WIDTH,
      top: (node.y / 100) * height + nodeRadius(node.size),
    });
    const a = at(heaviest);
    const c = at(third);
    const thirdRows = names.get(third.key)?.rows ?? 0;
    expect(a.top).toBeLessThan(c.top + bottomNameHeight(thirdRows));
    // So neither is wider than leaves 6 px between them.
    const gap =
      Math.abs(a.x - c.x) -
      ((names.get(heaviest.key)?.room ?? 0) +
        (names.get(third.key)?.room ?? 0)) /
        2;
    expect(gap).toBeGreaterThanOrEqual(6);
    // Its four lines wrap there, and the room made under it counts them.
    expect(thirdRows).toBeGreaterThan(4);
  });
});
