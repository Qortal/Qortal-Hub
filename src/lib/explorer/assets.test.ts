import { describe, expect, it } from 'vitest';
import {
  allocation,
  assetAvatarIdentifier,
  assetHue,
  assetInitials,
  assetMetaOf,
  assetsTotals,
  assetViews,
  avatarAssetId,
  avatarPublishers,
  bidLevels,
  buyOrderOf,
  dealOf,
  holdingOf,
  matchesAsset,
  notHeldView,
  orderLevelOf,
  ownedNotHeld,
  perUnitOf,
  pricesFrom,
  quantityShown,
  recentTradeOf,
  saleNow,
  shareOf,
  sortAssets,
  worthOf,
  type AssetMeta,
  type Holding,
} from './assets';

// The Q-Assets an account holds, priced by their last trades with QORT and
// by what buyers offer now (from Q-Mintership+'s rules/explorer/assets.ts
// tests), with made-up accounts and assets.

const A = `Q${'a'.repeat(33)}`;
const B = `Q${'b'.repeat(33)}`;
const U = 100_000_000n;

const meta = (
  assetId: number,
  name: string,
  owner: string,
  units: bigint,
  extra: Partial<AssetMeta> = {}
): AssetMeta => ({
  assetId,
  name,
  owner,
  description: '',
  quantity: units * U,
  isDivisible: true,
  isUnspendable: false,
  ...extra,
});

describe('reading the node’s answers', () => {
  it('an asset from /assets, its quantity in atomic units up to 10^18', () => {
    expect(
      assetMetaOf({
        assetId: 11,
        owner: B,
        name: 'Gadget',
        description: 'd',
        quantity: 109400000000,
        isDivisible: true,
        isUnspendable: false,
      })
    ).toEqual({
      assetId: 11,
      name: 'Gadget',
      owner: B,
      description: 'd',
      quantity: 109_400_000_000n,
      isDivisible: true,
      isUnspendable: false,
    });
    expect(
      assetMetaOf({ assetId: 3, name: 'TEST', quantity: 1e18 })?.quantity
    ).toBe(10n ** 18n);
    expect(
      assetMetaOf({ assetId: 4, name: 'Whole', isDivisible: false })
        ?.isDivisible
    ).toBe(false);
    expect(assetMetaOf({ name: 'no id' })).toBeNull();
  });

  it('a holding from /assets/balances; QORT and nothing held are left out', () => {
    expect(
      holdingOf({
        address: A,
        assetId: 6,
        balance: '2370.00000000',
        assetName: 'Widget',
      })
    ).toEqual({
      assetId: 6,
      name: 'Widget',
      balance: 2370n * U,
    });
    expect(
      holdingOf({
        address: A,
        assetId: 0,
        balance: '6868.98667763',
        assetName: 'QORT',
      })
    ).toBeNull();
    expect(
      holdingOf({
        address: A,
        assetId: 9,
        balance: '0E-8',
        assetName: 'Native',
      })
    ).toBeNull();
    // No name carried: the page says its number.
    expect(
      holdingOf({ address: A, assetId: 9, balance: '1.00000000' })?.name
    ).toBeNull();
  });
});

describe('a trade with its orders', () => {
  // A buyer's order paid 529 QORT for 23 units of the waiting seller's asset 11.
  const row = {
    trade: {
      initiatingOrderId: 'order-i',
      targetOrderId: 'order-t',
      targetAmount: '23.00000000',
      initiatorAmount: '529.00000000',
      timestamp: 1785356277321,
    },
    initiatingOrder: { creator: A, haveAssetId: 0, wantAssetId: 11 },
    targetOrder: { creator: B, haveAssetId: 11, wantAssetId: 0 },
  };

  it('the order that gave QORT bought', () => {
    expect(dealOf(row)).toEqual({
      at: 1785356277321,
      buyer: A,
      seller: B,
      units: 23n * U,
      qort: 529n * U,
      orderId: 'order-i',
    });
    const sold = {
      ...row,
      trade: {
        ...row.trade,
        initiatorAmount: '23.00000000',
        targetAmount: '529.00000000',
      },
      initiatingOrder: { creator: B, haveAssetId: 11, wantAssetId: 0 },
      targetOrder: { creator: A, haveAssetId: 0, wantAssetId: 11 },
    };
    expect(dealOf(sold)).toMatchObject({
      buyer: A,
      seller: B,
      units: 23n * U,
      qort: 529n * U,
    });
    expect(
      dealOf({
        ...row,
        initiatingOrder: { creator: A, haveAssetId: 6, wantAssetId: 11 },
      })
    ).toBeNull();
  });

  it('never trusts the trade’s own asset labels, which Core swaps for a seller’s initiating order', () => {
    // As Core answers it: a seller's order (have 11, want QORT) came in and
    // gave 23 units; Core labels its amount as QORT.
    const swapped = {
      trade: {
        initiatingOrderId: 'order-i',
        targetOrderId: 'order-t',
        initiatorAmount: '23.00000000',
        initiatorAmountAssetId: 0,
        targetAmount: '529.00000000',
        targetAmountAssetId: 11,
        timestamp: 5,
      },
      initiatingOrder: { creator: B, haveAssetId: 11, wantAssetId: 0 },
      targetOrder: { creator: A, haveAssetId: 0, wantAssetId: 11 },
    };
    expect(dealOf(swapped)).toMatchObject({
      buyer: A,
      seller: B,
      units: 23n * U,
      qort: 529n * U,
    });
  });
});

describe('prices from the latest trades', () => {
  // The asset sold for QORT, and QORT paid for another; one trade between two assets.
  const rows = [
    {
      assetId: 6,
      otherAssetId: 0,
      otherAmount: '621.25000000',
      amount: '3500.00000000',
      timestamp: 2,
    },
    {
      assetId: 6,
      otherAssetId: 0,
      otherAmount: '327.48750000',
      amount: '1845.00000000',
      timestamp: 1,
    },
    {
      assetId: 0,
      otherAssetId: 11,
      otherAmount: '23.00000000',
      amount: '529.00000000',
      timestamp: 5,
    },
    {
      assetId: 6,
      otherAssetId: 11,
      otherAmount: '1.00000000',
      amount: '9.00000000',
      timestamp: 9,
    },
  ];
  const prices = pricesFrom(rows.map(recentTradeOf).filter((t) => t !== null));

  it('of newest trades at the same time (one order filled against several), the lowest price, whichever order Core lists them in', () => {
    const fills = [
      {
        assetId: 6,
        otherAssetId: 0,
        amount: 2n * U,
        otherAmount: 40n * U,
        timestamp: 7,
      },
      {
        assetId: 6,
        otherAssetId: 0,
        amount: 1n * U,
        otherAmount: 18n * U,
        timestamp: 7,
      },
      {
        assetId: 0,
        otherAssetId: 6,
        amount: 57n * U,
        otherAmount: 3n * U,
        timestamp: 7,
      },
    ];
    for (const order of [
      fills,
      [...fills].reverse(),
      [fills[1], fills[2], fills[0]],
    ])
      expect(pricesFrom(order).get(6)).toMatchObject({
        perUnit: 18n * U,
        units: U,
      });
    // The same price twice: the bigger trade.
    const twice = [
      {
        assetId: 6,
        otherAssetId: 0,
        amount: U,
        otherAmount: 18n * U,
        timestamp: 7,
      },
      {
        assetId: 6,
        otherAssetId: 0,
        amount: 4n * U,
        otherAmount: 72n * U,
        timestamp: 7,
      },
    ];
    expect(pricesFrom(twice).get(6)?.units).toBe(4n * U);
    expect(pricesFrom([...twice].reverse()).get(6)?.units).toBe(4n * U);
  });

  it('takes each asset’s newest trade with QORT, either way round', () => {
    expect(prices.get(6)).toEqual({
      perUnit: 17_750_000n,
      units: 3500n * U,
      qort: 62_125_000_000n,
      at: 2,
    });
    expect(prices.get(11)?.perUnit).toBe(23n * U);
    // A trade between two assets says nothing in QORT.
    expect(prices.size).toBe(2);
  });

  it('worth: the holding at that price, exact to the atomic unit', () => {
    expect(worthOf(2370n * U, prices.get(6)!)).toBe(42_067_500_000n);
    expect(perUnitOf(120n * U, 6n * U)).toBe(20n * U);
    expect(perUnitOf(1n, 0n)).toBe(0n);
  });
});

describe('what buyers would pay now', () => {
  const order = (
    creator: string,
    price: string,
    amount: string,
    fulfilled = '0'
  ) => buyOrderOf({ creator, price, amount, fulfilled })!;

  it('reads an open buy order: what it still wants', () => {
    expect(order(B, '0.17750000', '30000', '25900')).toEqual({
      creator: B,
      price: 17_750_000n,
      units: 4_100n * U,
    });
    expect(
      buyOrderOf({ creator: B, price: '1', amount: '5', fulfilled: '5' })
    ).toBeNull();
    expect(buyOrderOf({ price: '1', amount: '5' })).toBeNull();
  });

  it('sells into the best price first, until the holding or the buyers run out', () => {
    const book = [
      order(B, '0.16660000', '25000'),
      order(B, '0.17750000', '4100'),
    ];
    const sale = saleNow(2_781_037_000_000n, book, A);
    expect(sale.qort).toBe(
      72_775_000_000n +
        ((2_781_037_000_000n - 410_000_000_000n) * 16_660_000n) / U
    );
    expect(sale.unsold).toBe(0n);
    expect(sale.bestBid).toBe(17_750_000n);
    // More than the buyers want: the rest is unsold.
    const big = saleNow(40_000n * U, book, A);
    expect(big.sold).toBe(29_100n * U);
    expect(big.unsold).toBe(10_900n * U);
    expect(big.atLeast).toBe(false);
    // The node had more orders than were read, and some is left: at least.
    expect(saleNow(40_000n * U, book, A, true).atLeast).toBe(true);
    // All of it sold within the orders read: exact, whatever lies past them.
    expect(saleNow(U, book, A, true).atLeast).toBe(false);
  });

  it('no buyers: nothing, whatever its last trade said', () => {
    expect(saleNow(70_000n * U, [], A)).toEqual({
      qort: 0n,
      sold: 0n,
      unsold: 70_000n * U,
      atLeast: false,
    });
  });

  it('never sells to the account’s own buy orders', () => {
    const sale = saleNow(6n * U, [order(A, '20', '6'), order(B, '18', '4')], A);
    expect(sale).toMatchObject({
      qort: 72n * U,
      sold: 4n * U,
      unsold: 2n * U,
      bestBid: 18n * U,
    });
  });

  it('rounds the QORT of each order down to the atomic unit, as Core does', () => {
    // 3 atomic units at 0.5 QORT each: 1.5 atomic units of QORT, of which Core pays 1.
    expect(saleNow(3n, [order(B, '0.50000000', '1')], A).qort).toBe(1n);
    // Order by order, never once on the sum: two halves are nothing.
    const halves = [
      order(B, '0.50000000', '0.00000001'),
      order(B, '0.50000000', '0.00000001'),
    ];
    expect(saleNow(2n, halves, A)).toMatchObject({
      qort: 0n,
      sold: 2n,
      unsold: 0n,
    });
  });

  it('the book’s price levels; the lowest price read may go on past a read that was full', () => {
    expect(
      orderLevelOf({ price: '0.19200000', unfulfilled: '22310.00000000' })
    ).toEqual({
      price: 19_200_000n,
      units: 22_310n * U,
    });
    expect(
      bidLevels([
        order(B, '1', '2'),
        order(A, '2', '1'),
        order(B, '1', '3'),
      ]).map((l) => [l.price, l.units])
    ).toEqual([
      [2n * U, U],
      [U, 5n * U],
    ]);
    const more = bidLevels([order(B, '2', '1'), order(B, '1', '3')], 5, true);
    expect(more.map((level) => level.atLeast ?? false)).toEqual([false, true]);
  });
});

describe('the account’s assets', () => {
  const catalogue = new Map([
    [6, meta(6, 'Widget', B, 10_000_000n)],
    [11, meta(11, 'Gadget', A, 1_094n)],
    [12, meta(12, 'Tokens', A, 1n)],
    [13, meta(13, 'unpriced', B, 100n)],
  ]);
  const holdings: Holding[] = [
    { assetId: 6, name: 'Widget', balance: 2370n * U },
    { assetId: 11, name: 'Gadget', balance: 23n * U },
    { assetId: 13, name: 'unpriced', balance: 50n * U },
  ];
  const prices = pricesFrom([
    {
      assetId: 6,
      otherAssetId: 0,
      amount: 3500n * U,
      otherAmount: 62_125_000_000n,
      timestamp: 2,
    },
    {
      assetId: 0,
      otherAssetId: 11,
      amount: 529n * U,
      otherAmount: 23n * U,
      timestamp: 5,
    },
  ]);
  const views = assetViews(holdings, A, catalogue, prices);

  it('each with its asset, price, worth, share and whether the account owns it', () => {
    expect(views.find((v) => v.assetId === 11)).toMatchObject({
      worth: 529n * U,
      owned: true,
    });
    expect(views.find((v) => v.assetId === 11)?.share).toBeCloseTo(
      23 / 1094,
      7
    );
    expect(views.find((v) => v.assetId === 13)).toMatchObject({
      share: 0.5,
      owned: false,
    });
    expect(views.find((v) => v.assetId === 13)?.worth).toBeUndefined();
  });

  it('shares: all of it is 1, anything above none stays above 0, less than all never 1', () => {
    expect(shareOf(5n, 5n)).toBe(1);
    expect(shareOf(0n, 5n)).toBe(0);
    expect(shareOf(1n, 10n ** 18n)).toBeGreaterThan(0);
    // Past what a number can hold, a holding above none still shows above 0.
    expect(shareOf(1n, 10n ** 400n)).toBeGreaterThan(0);
    expect(shareOf(10n ** 18n - 1n, 10n ** 18n)).toBeLessThan(1);
    expect(shareOf(1n, 0n)).toBeUndefined();
  });

  it('assets it owns and holds none of; one it doesn’t hold opens as a view of its own', () => {
    expect(ownedNotHeld(catalogue, holdings, A).map((a) => a.assetId)).toEqual([
      12,
    ]);
    expect(notHeldView(catalogue.get(12)!, A)).toMatchObject({
      balance: 0n,
      share: 0,
      owned: true,
    });
  });

  it('sorts by worth (unpriced last), share, name or age', () => {
    expect(sortAssets(views, 'worth').map((v) => v.assetId)).toEqual([
      11, 6, 13,
    ]);
    expect(sortAssets(views, 'share').map((v) => v.assetId)).toEqual([
      13, 11, 6,
    ]);
    expect(sortAssets(views, 'name').map((v) => v.name)).toEqual([
      'Gadget',
      'unpriced',
      'Widget',
    ]);
    expect(sortAssets(views, 'id').map((v) => v.assetId)).toEqual([6, 11, 13]);
  });

  it('finds an asset by its name (any case, any accent) or its number', () => {
    expect(matchesAsset(views[0], 'wid')).toBe(true);
    expect(matchesAsset(views[0], '#6')).toBe(true);
    expect(matchesAsset(views[0], '6')).toBe(true);
    expect(matchesAsset(views[0], 'gad')).toBe(false);
    expect(matchesAsset({ assetId: 3, name: 'Café' }, 'cafe')).toBe(true);
    expect(matchesAsset({ assetId: 3, name: null }, 'x')).toBe(false);
  });

  it('adds up what the priced ones are worth, and splits it for the bar', () => {
    expect(assetsTotals(views)).toMatchObject({
      held: 3,
      priced: 2,
      worth: 529n * U + 42_067_500_000n,
      saleRead: 0,
    });
    const sold = assetViews(
      holdings,
      A,
      catalogue,
      prices,
      new Map([
        [
          6,
          saleNow(
            2370n * U,
            [buyOrderOf({ creator: B, price: '0.1775', amount: '4100' })!],
            A
          ),
        ],
        [
          11,
          saleNow(
            23n * U,
            [buyOrderOf({ creator: B, price: '2', amount: '1' })!],
            A
          ),
        ],
        [13, saleNow(50n * U, [], A)],
      ])
    );
    expect(assetsTotals(sold)).toMatchObject({
      saleRead: 3,
      sale: 42_067_500_000n + 2n * U,
      saleAll: 1,
      salePart: 1,
      saleNone: 1,
    });
    expect(sortAssets(sold, 'sale').map((v) => v.assetId)).toEqual([6, 11, 13]);
    const parts = allocation(views);
    expect(parts.map((p) => p.assetId)).toEqual([11, 6]);
    expect(parts[0].fraction + parts[1].fraction).toBeCloseTo(1, 5);
    const many = Array.from({ length: 7 }, (_, i) => ({
      assetId: i + 1,
      name: `a${i}`,
      balance: U,
      worth: BigInt(10 - i) * U,
      owned: false,
    }));
    const five = allocation(many);
    expect(five).toHaveLength(5);
    expect(five[4]).toMatchObject({
      assetId: null,
      others: 3,
      worth: (4n + 5n + 6n) * U,
    });
  });

  it('all there is in whole units from a million units up, exactly below', () => {
    expect(quantityShown(10n ** 18n)).toBe(10n ** 18n);
    expect(quantityShown(1_000_000n * U + 5n)).toBe(1_000_000n * U);
    expect(quantityShown(150_000_000n)).toBe(150_000_000n);
  });
});

describe('avatars', () => {
  it('the identifier the Q-Assets app publishes under, and back', () => {
    expect(assetAvatarIdentifier(88, 'Gem Coin')).toBe(
      'asset88_Gem Coin_aavatar'
    );
    expect(avatarAssetId('asset18_Fitness Club_aavatar')).toBe(18);
    expect(avatarAssetId('assetAvatar_default')).toBeNull();
  });

  it('only images for this very asset, its owner’s primary name first', () => {
    const resources = [
      { publisher: 'Second', identifier: 'asset88_Gem Coin_aavatar' },
      { publisher: 'Publisher', identifier: 'asset88_Gem Coin_aavatar' },
      { publisher: 'Someone', identifier: 'asset88_Gem_aavatar' },
    ];
    expect(
      avatarPublishers(
        resources,
        { assetId: 88, name: 'Gem Coin' },
        'Publisher'
      )
    ).toEqual(['Publisher', 'Second']);
    expect(
      avatarPublishers(resources, { assetId: 87, name: 'Gem' }, null)
    ).toEqual([]);
  });

  it('the coin’s letters', () => {
    expect(assetInitials('GEMCOIN')).toBe('G');
    expect(assetInitials('gadget')).toBe('G');
    expect(assetInitials('BHC')).toBe('BHC');
    expect(assetInitials('Gem Coin')).toBe('GC');
    expect(assetInitials('Bean Token')).toBe('BT');
    expect(assetInitials('Q-Asset')).toBe('QA');
    expect(assetInitials('10Coin')).toBe('10');
    expect(assetInitials('🐉')).toBe('🐉');
    expect(assetInitials('https://example.com/coin')).toBe('EC');
    expect(assetInitials('õunad')).toBe('Õ');
    expect(assetInitials('  ')).toBe('#');
  });

  it('neighbouring assets get colours far apart', () => {
    expect(assetHue(1)).toBe(138);
    expect(Math.abs(assetHue(2) - assetHue(1))).toBeGreaterThan(90);
  });
});
