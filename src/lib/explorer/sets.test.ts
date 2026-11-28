import { describe, expect, it } from 'vitest';
import type { FundedPage } from './compareReads';
import { fundingFrom } from './connections';
import type { TxRow } from './reads';
import {
  firstPaidBy,
  fundedRead,
  groupFirstPayers,
  setSentence,
  paidAccounts,
  sortSponsees,
  sponseeRows,
  wentTo,
} from './sets';

const SPONSOR = `Q${'N'.repeat(33)}`;
const A = `Q${'A'.repeat(33)}`;
const B = `Q${'B'.repeat(33)}`;
const C = `Q${'C'.repeat(33)}`;
const K = `Q${'K'.repeat(33)}`;
const M = `Q${'M'.repeat(33)}`;
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
const share = (to: string, height: number, percent = '0.00') =>
  tx('REWARD_SHARE', height, {
    creatorAddress: SPONSOR,
    recipient: to,
    sharePercent: percent,
  });
const pay = (from: string, to: string, height: number, amount = '1') =>
  tx('PAYMENT', height, { creatorAddress: from, recipient: to, amount });

describe('the accounts a sponsor sponsored', () => {
  const rows = [
    share(A, 10),
    share(A, 20, '-1.00'),
    share(B, 15),
    share(C, 12),
    share(C, 13, '-1.00'),
    share(C, 14),
    share(SPONSOR, 5),
  ];

  it('counts the shares made to each (removals aside); who mints now only once the online list is read', () => {
    const read = sponseeRows(rows, SPONSOR, [
      { minterAddress: B, recipientAddress: B },
    ]);
    expect(
      read.map((row) => [row.address, row.shares, row.mintingNow])
    ).toEqual([
      [A, 1, false],
      [C, 2, false],
      [B, 1, true],
    ]);
    // Itself is never one of them.
    expect(read.some((row) => row.address === SPONSOR)).toBe(false);
    expect(
      sponseeRows(rows, SPONSOR, undefined).map((row) => row.mintingNow)
    ).toEqual([null, null, null]);
  });

  it('sorts them the first sponsored first, or another way, ties by their first share', () => {
    const read = sponseeRows(rows, SPONSOR, [
      { minterAddress: B, recipientAddress: B },
    ]);
    const order = (sort: Parameters<typeof sortSponsees>[1]) =>
      sortSponsees(read, sort).map((row) => row.address);
    expect(order('first')).toEqual([A, C, B]);
    expect(order('latest')).toEqual([B, C, A]);
    // A's share was removed; C's runs again; B's never stopped.
    expect(order('active')).toEqual([C, B, A]);
    expect(order('minting')).toEqual([B, A, C]);
    expect(order('shares')).toEqual([C, A, B]);
  });
});

describe('whose first QORT payment came from an account', () => {
  it('the accounts it paid, in the order of its first payment to each, AT addresses counted once each', () => {
    const rows = [
      pay(K, A, 1, '5'),
      pay(K, AT, 2),
      pay(K, B, 3, '2'),
      pay(K, A, 4),
      pay(K, AT, 5),
      pay(K, K, 6),
    ];
    const { paid, atLeftOut } = paidAccounts(rows, K);
    expect(
      paid.map((each) => [each.address, each.height, each.amount])
    ).toEqual([
      [A, 1, '5'],
      [B, 3, '2'],
    ]);
    // Two payments to one AT address: one address left out.
    expect(atLeftOut).toBe(1);
  });

  it('it made the first payment to those whose earliest one received came from it, among those checked', () => {
    const { paid } = paidAccounts(
      [pay(K, A, 1), pay(K, B, 2), pay(K, C, 3)],
      K
    );
    const checks = new Map([
      [A, { from: K, height: 1, timestamp: 0, amount: '1', signature: 's1' }],
      [B, { from: C, height: 0, timestamp: 0, amount: '1', signature: 's0' }],
    ]);
    // C isn't checked yet: never counted either way.
    expect(firstPaidBy(paid, checks, K).map((each) => each.address)).toEqual([
      A,
    ]);
  });
});

describe('a check’s sentence', () => {
  const slots = {
    from: { kind: 'account' as const, address: K },
    accounts: { kind: 'number' as const, value: 2 },
  };

  it('counts and words it by the accounts checked; one checked has a sentence of its own', () => {
    expect(setSentence('first_payer', 21, slots)).toEqual({
      base: 'explorer:sets.say',
      key: 'first_payer',
      count: 21,
      slots: { ...slots, total: { kind: 'number', value: 21 } },
    });
    expect(setSentence('went_to', 1, slots)).toEqual({
      base: 'explorer:sets.say',
      key: 'went_to_single',
      slots,
    });
  });
});

describe('what Funded’s pages add up to', () => {
  const page = (count: number, extra: Partial<FundedPage> = {}) => ({
    rows: Array.from({ length: count }, (_, i) => pay(K, A, i + 1)),
    full: count >= 100,
    ...extra,
  });

  it('a short page is the end: every payment it sent was read', () => {
    const read = fundedRead([page(100), page(40), undefined]);
    expect(read).toMatchObject({ complete: true, beyond: false, through: 2 });
    expect(read.rows).toHaveLength(140);
  });

  it('the last page full: all of them when no row came past it, else it sent more', () => {
    const full = Array.from({ length: 9 }, () => page(100));
    expect(fundedRead([...full, page(100, { beyond: false })])).toMatchObject({
      complete: true,
      beyond: false,
      through: 10,
    });
    expect(fundedRead([...full, page(100, { beyond: true })])).toMatchObject({
      complete: false,
      beyond: true,
      through: 10,
    });
  });

  it('a page not read yet stops it, never “all”; a node without the read says so', () => {
    expect(fundedRead([page(100), undefined, page(10)])).toMatchObject({
      complete: false,
      through: 1,
    });
    expect(fundedRead([null])).toMatchObject({
      unsupported: true,
      complete: false,
      through: 0,
    });
  });
});

describe('checks across a set', () => {
  it('first payers grouped, the most accounts first; other first transactions (a multi-payment too) and none counted apart', () => {
    const funding = new Map([
      [A, fundingFrom(pay(K, A, 1), A)],
      [B, fundingFrom(pay(K, B, 2), B)],
      [
        M,
        fundingFrom(
          tx('MULTI_PAYMENT', 4, {
            creatorAddress: K,
            payments: [{ recipient: M, amount: '1', assetId: 0 }],
          }),
          M
        ),
      ],
      [
        C,
        fundingFrom(
          tx('REWARD_SHARE', 3, {
            creatorAddress: K,
            recipient: C,
            sharePercent: '0',
          }),
          C
        ),
      ],
      [SPONSOR, null],
    ]);
    expect(groupFirstPayers(funding)).toEqual({
      payers: [{ from: K, accounts: [A, B] }],
      other: 2,
      none: 1,
    });
  });

  it('where their QORT went: paid by the most of them first, AT addresses left out and counted', () => {
    const sent = new Map<string, TxRow[]>([
      [A, [pay(A, K, 1, '2'), pay(A, K, 2, '3'), pay(A, AT, 3)]],
      [B, [pay(B, K, 4, '1'), pay(B, C, 5, '9')]],
    ]);
    const { recipients, atLeftOut } = wentTo(sent);
    expect(
      recipients.map((each) => [each.address, each.from, each.count, each.qort])
    ).toEqual([
      [K, [A, B], 3, 600_000_000n],
      [C, [B], 1, 900_000_000n],
    ]);
    expect(atLeftOut).toBe(1);
  });
});
