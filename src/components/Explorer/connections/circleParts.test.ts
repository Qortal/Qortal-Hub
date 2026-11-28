import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n/i18n';
import { circleNodes } from '../../../lib/explorer/circle';
import { recordedFindings, type Finding } from '../../../lib/explorer/findings';
import type { TxRow } from '../../../lib/explorer/reads';
import { bothLines, nodeWords } from './circleParts';

// What an avatar of the Connections circle says it stands for: its
// transactions counted once each, as its dialog lists them, a trade by its
// orders; and the amounts under it, its trades' too.

const QORT = 100_000_000n;
const ME = `Q${'m'.repeat(33)}`;
const OTHER = `Q${'o'.repeat(33)}`;

const txs = (n: number, from: number): TxRow[] =>
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

const paid = (
  kind: 'paidTo' | 'paidBy',
  rows: TxRow[],
  qort: bigint
): Finding => ({
  key: `${kind}:${OTHER}`,
  kind,
  other: OTHER,
  sentence: { key: 'x', slots: {} },
  height: 1,
  timestamp: 1,
  signature: rows[0].signature,
  evidence: rows,
  evidenceKind: 'payments',
  qort,
  assets: [],
});

/** One trade with OTHER: 23 GBQ got for 529 QORT, its two orders. */
const traded = () =>
  recordedFindings({
    address: ME,
    trades: [
      {
        orderId: 'mine',
        otherOrderId: 'theirs',
        other: OTHER,
        timestamp: 1_000,
        initiated: true,
        gave: { asset: { id: 0, name: null }, amount: '529.00000000' },
        got: { asset: { id: 28, name: 'GBQ' }, amount: '23.00000000' },
      },
    ],
  })[0];

const en = i18n.getFixedT('en');

describe('an avatar in words', () => {
  it('paid both ways and traded with: each way’s payments, then the trade by its orders, adding up to its number', () => {
    const [node] = circleNodes([
      traded(),
      paid('paidTo', txs(3, 10), 13n * QORT),
      paid('paidBy', txs(1, 20), 7n * QORT),
    ]).both;
    expect(nodeWords(node, en, 'en')).toBe(
      '6 transactions: 1 received (7 QORT); 3 sent (13 QORT); traded in 2 orders (got 23 GBQ for 529 QORT)'
    );
    // Under its name: what moved each way, the trade's too.
    expect(bothLines(node, en, 'en')).toEqual([
      '7 QORT in, 542 out',
      '23 GBQ in',
    ]);
  });

  it('traded with only: its orders, never one received and one sent', () => {
    const [node] = circleNodes([traded()]).both;
    expect(nodeWords(node, en, 'en')).toBe(
      '2 transactions: traded in 2 orders (got 23 GBQ for 529 QORT)'
    );
  });

  it('joins its parts the way each language does', () => {
    const [node] = circleNodes([
      traded(),
      paid('paidBy', txs(1, 20), 7n * QORT),
    ]).both;
    const ja = nodeWords(node, i18n.getFixedT('ja'), 'ja');
    expect(ja).toContain('、');
    expect(ja).not.toContain('; ');
    expect(nodeWords(node, i18n.getFixedT('fr'), 'fr')).toContain(' ; ');
  });
});
