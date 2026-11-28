import { describe, expect, it } from 'vitest';
import {
  averageOf,
  chainOfOffer,
  coinPerQort,
  offerOutcomes,
  periodStart,
  periodUnit,
  purchaseFromContract,
  quarterOf,
  soldAts,
  summariseOffers,
  summarisePortal,
  tradeTime,
  volumeByPeriod,
  withCoins,
  type PortalTrade,
} from './portalTrades';

// The Trade Portal in figures (from Q-Mintership+'s
// rules/explorer/portalTrades.ts tests), with made-up accounts.

const QORT = 100_000_000n;
const ME = `Q${'M'.repeat(33)}`;
const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();

let n = 0;
const trade = (over: Partial<PortalTrade>): PortalTrade => ({
  chain: 'LITECOIN',
  side: 'sold',
  qort: 100n * QORT,
  coin: QORT / 3n,
  at: `A${(n += 1)}`,
  other: 'Qbuyer',
  timestamp: day('2026-05-10'),
  ...over,
});

describe('a trade offer’s coin', () => {
  it('comes from its tags, else its name', () => {
    expect(chainOfOffer('ACCT QORT LTC', 'QORT/LTC ACCT')).toBe('LITECOIN');
    expect(chainOfOffer('ACCT QORT DOGE')).toBe('DOGECOIN');
    expect(chainOfOffer('', 'QORT/ARRR ACCT')).toBe('PIRATECHAIN');
    expect(chainOfOffer('ACCT QORT XMR')).toBeNull();
    expect(chainOfOffer(undefined)).toBeNull();
  });
});

describe('the Trade Portal summary', () => {
  it('adds up each coin and side, in the coins’ own order, with the first and latest', () => {
    const summary = summarisePortal([
      trade({
        chain: 'DOGECOIN',
        qort: 50n * QORT,
        coin: 107n * QORT,
        timestamp: day('2026-03-01'),
      }),
      trade({ qort: 200n * QORT, coin: QORT, timestamp: day('2026-04-01') }),
      trade({
        side: 'bought',
        qort: 30n * QORT,
        coin: QORT / 10n,
        other: 'Qseller',
      }),
    ]);
    expect(summary.coins.map((coin) => coin.chain)).toEqual([
      'LITECOIN',
      'DOGECOIN',
    ]);
    expect(summary.coins[0].sold).toEqual({
      count: 1,
      qort: 200n * QORT,
      coin: QORT,
    });
    expect(summary.coins[0].bought).toEqual({
      count: 1,
      qort: 30n * QORT,
      coin: QORT / 10n,
    });
    expect(summary.sold).toEqual({
      count: 2,
      qort: 250n * QORT,
      coin: 108n * QORT,
    });
    expect(summary.first).toBe(day('2026-03-01'));
    expect(summary.last).toBe(day('2026-05-10'));
    expect(summary.biggestSale?.qort).toBe(200n * QORT);
    expect(summary.biggestBuy?.qort).toBe(30n * QORT);
    expect(averageOf(summary.sold)).toBe(125n * QORT);
    expect(averageOf({ count: 0, qort: 0n, coin: 0n })).toBe(0n);
  });

  it('names its partners, most trades first, then most QORT', () => {
    const summary = summarisePortal([
      trade({ other: 'Qa', qort: QORT }),
      trade({ other: 'Qb', qort: 5n * QORT }),
      trade({ other: 'Qb', side: 'bought', qort: QORT }),
      trade({ other: 'Qc', qort: 9n * QORT }),
      trade({ other: '' }),
    ]);
    expect(summary.partners).toEqual([
      { address: 'Qb', sold: 1, bought: 1, qort: 6n * QORT },
      { address: 'Qc', sold: 1, bought: 0, qort: 9n * QORT },
      { address: 'Qa', sold: 1, bought: 0, qort: QORT },
    ]);
  });

  it('keeps the earlier of two biggest trades the same size', () => {
    const early = trade({ qort: 9n * QORT, timestamp: day('2026-01-01') });
    const late = trade({ qort: 9n * QORT, timestamp: day('2026-02-01') });
    expect(summarisePortal([late, early]).biggestSale).toBe(early);
  });
});

describe('its trade offers', () => {
  const deployed = (
    at: string,
    chain: 'LITECOIN' | 'DOGECOIN' | null = 'LITECOIN',
    timestamp = 0
  ) => ({
    at,
    chain,
    qort: 10n * QORT,
    timestamp,
  });

  it('completed when sold, ended when paid back without a sale, open otherwise', () => {
    const offers = offerOutcomes(
      [
        deployed('A1'),
        deployed('A2'),
        deployed('A3'),
        deployed('A4', 'DOGECOIN'),
      ],
      soldAts([trade({ at: 'A1' }), trade({ at: 'A9', side: 'bought' })]),
      // A sold AT pays back what is left for its fees: still completed.
      new Set(['A1', 'A2'])
    );
    expect(offers.map((offer) => offer.outcome)).toEqual([
      'completed',
      'ended',
      'open',
      'open',
    ]);
    const { total, byCoin } = summariseOffers(offers);
    expect(total).toEqual({
      made: 4,
      completed: 1,
      ended: 1,
      open: 2,
      unknown: 0,
      openQort: 20n * QORT,
    });
    expect(byCoin.map((coin) => [coin.chain, coin.made, coin.open])).toEqual([
      ['LITECOIN', 3, 1],
      ['DOGECOIN', 1, 1],
    ]);
  });

  it('not known, never open, when its payouts weren’t all read and it is as old as the oldest read', () => {
    const offers = offerOutcomes(
      [
        deployed('A1', 'LITECOIN', 500),
        deployed('A2', 'LITECOIN', 100),
        deployed('A3', 'LITECOIN', 50),
      ],
      soldAts([trade({ at: 'A3' })]),
      new Set(),
      // The oldest payout read was at 100: one made at 100 or before may have paid back before it.
      100
    );
    expect(offers.map((offer) => offer.outcome)).toEqual([
      'open',
      'unknown',
      'completed',
    ]);
    expect(summariseOffers(offers).total).toMatchObject({
      open: 1,
      unknown: 1,
      openQort: 10n * QORT,
    });
  });

  it('lists offers with no coin it trades now last', () => {
    const { byCoin } = summariseOffers(
      offerOutcomes(
        [deployed('A1', null), deployed('A2')],
        new Set(),
        new Set()
      )
    );
    expect(byCoin.map((coin) => coin.chain)).toEqual(['LITECOIN', null]);
  });
});

describe('a contract that paid an account without a public key', () => {
  const record = {
    qortalAtAddress: 'Aone',
    qortalCreator: 'Qseller',
    qortAmount: '25.00000000',
    expectedForeignAmount: '0.08000000',
    mode: 'REDEEMED',
    qortalPartnerReceivingAddress: ME,
    foreignBlockchain: 'LITECOIN',
  };

  it('is its purchase when it was redeemed and names it as where the QORT went', () => {
    expect(purchaseFromContract(record, 'Aone', ME, 7)).toEqual({
      chain: 'LITECOIN',
      side: 'bought',
      qort: 25n * QORT,
      coin: 8_000_000n,
      at: 'Aone',
      other: 'Qseller',
      timestamp: 7,
    });
  });

  it('is nothing for a refund, another buyer, or no record; a chain not listed here is another coin', () => {
    expect(
      purchaseFromContract({ ...record, mode: 'REFUNDED' }, 'Aone', ME, 7)
    ).toBeNull();
    expect(
      purchaseFromContract(
        { ...record, qortalPartnerReceivingAddress: 'Qother' },
        'Aone',
        ME,
        7
      )
    ).toBeNull();
    // A trade on a chain this list doesn't have yet is never left out.
    expect(
      purchaseFromContract(
        { ...record, foreignBlockchain: 'MONERO' },
        'Aone',
        ME,
        7
      )
    ).toMatchObject({ chain: 'OTHER', qort: 25n * QORT });
    expect(purchaseFromContract(null, 'Aone', ME, 7)).toBeNull();
  });
});

describe('which coin each trade was for', () => {
  const row = (at: string) => {
    const { chain: _chain, ...rest } = trade({ at });
    return rest;
  };

  it('a contract its chain claims has that coin; one none claims is another coin; none while that isn’t read', () => {
    const rows = [row('A1'), row('A2'), row('constructor')];
    expect(
      withCoins(rows, { A1: 'DOGECOIN' }).map((each) => each.chain)
    ).toEqual(['DOGECOIN', 'OTHER', 'OTHER']);
    expect(withCoins(rows, null).map((each) => each.chain)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('a trade Core gave no time (0) has none, never 1970', () => {
    expect(tradeTime(0)).toBeNull();
    expect(tradeTime('0')).toBeNull();
    expect(tradeTime(undefined)).toBeNull();
    expect(tradeTime(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('adds up another coin as a coin of its own, and trades whose coin isn’t known in the totals only', () => {
    const summary = summarisePortal([
      trade({ chain: 'OTHER', qort: 5n * QORT }),
      trade({ chain: 'LITECOIN', qort: 7n * QORT }),
      trade({ chain: null, qort: 11n * QORT, timestamp: null }),
    ]);
    expect(summary.coins.map((coin) => coin.chain)).toEqual([
      'LITECOIN',
      'OTHER',
    ]);
    expect(summary.sold.qort).toBe(23n * QORT);
    expect(summary.unlabeled).toBe(1);
    // A trade with no time is in no span.
    expect(summary.untimed).toBe(1);
    expect(summary.first).toBe(day('2026-05-10'));
  });
});

describe('over time', () => {
  it('months for up to two years, quarters up to eight, then years', () => {
    expect(periodUnit(day('2025-01-15'), day('2026-12-01'))).toBe('month');
    expect(periodUnit(day('2025-01-15'), day('2027-01-01'))).toBe('quarter');
    expect(periodUnit(day('2019-01-15'), day('2026-12-01'))).toBe('quarter');
    expect(periodUnit(day('2018-12-15'), day('2026-12-01'))).toBe('year');
  });

  it('every period from the first trade to the latest, the empty ones too', () => {
    const { unit, periods } = volumeByPeriod([
      trade({ timestamp: day('2026-01-20'), qort: 10n * QORT }),
      trade({
        timestamp: day('2026-01-25'),
        qort: 5n * QORT,
        chain: 'DOGECOIN',
      }),
      trade({ timestamp: day('2026-04-02'), qort: 7n * QORT, side: 'bought' }),
    ]);
    expect(unit).toBe('month');
    expect(periods.map((period) => new Date(period.start).getMonth())).toEqual([
      0, 1, 2, 3,
    ]);
    expect(periods[0]).toMatchObject({
      soldQort: 15n * QORT,
      soldCount: 2,
      sold: { LITECOIN: 10n * QORT, DOGECOIN: 5n * QORT },
    });
    expect(periods[1].soldCount + periods[1].boughtCount).toBe(0);
    expect(periods[3]).toMatchObject({ boughtQort: 7n * QORT, boughtCount: 1 });
    expect(volumeByPeriod([])).toEqual({
      unit: 'month',
      periods: [],
      untimed: 0,
    });
  });

  it('a trade with no time in no period, counted apart; one whose coin isn’t known in the totals only', () => {
    const { periods, untimed } = volumeByPeriod([
      trade({ timestamp: day('2026-01-20'), qort: 10n * QORT, chain: null }),
      trade({ timestamp: null, qort: 4n * QORT }),
    ]);
    expect(untimed).toBe(1);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ soldQort: 10n * QORT, sold: {} });
    // Never a period from 1970.
    expect(new Date(periods[0].start).getFullYear()).toBe(2026);
  });

  it('quarters start on their first month', () => {
    expect(new Date(periodStart(day('2026-08-15'), 'quarter')).getMonth()).toBe(
      6
    );
    expect(quarterOf(periodStart(day('2026-08-15'), 'quarter'))).toBe(3);
    expect(new Date(periodStart(day('2026-08-15'), 'year')).getMonth()).toBe(0);
  });
});

describe('prices', () => {
  it('the coin per QORT, as a ratio; none when either is 0', () => {
    expect(coinPerQort(35n * QORT, 10_000n * QORT)).toBeCloseTo(0.0035, 10);
    expect(coinPerQort(2_150n * QORT, 1_000n * QORT)).toBeCloseTo(2.15, 10);
    expect(coinPerQort(0n, QORT)).toBeNull();
  });
});
