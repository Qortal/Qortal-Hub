import { describe, expect, it } from 'vitest';
import {
  movedParts,
  neverMinted,
  orderQort,
  qortBook,
  qortMinted,
  type OrderState,
  type OrderTrade,
} from './qortBook';
import type { TxRow } from './reads';
import { toAtomic } from './txWords';

// The bookkeeping that works out what an account minted. On a node on
// 2026-11-21 it came to exactly 0 for 33 accounts that never minted (sales
// and purchases through trade contracts, messages carrying QORT, names
// bought and sold, asset orders, fees). These are made-up accounts in the
// same shapes, whose balances were added up apart, by a second
// implementation of the same rules: each comes to 0 as well.

const Q = (amount: string) => toAtomic(amount) as bigint;
const account = (letter: string) => `Q${letter.repeat(33)}`;
const at = (letter: string) => `A${letter.repeat(33)}`;
/** Core's null account: the creator of a contract's own transactions. */
const NULL_ACCOUNT = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

let n = 0;
const tx = (type: string, fields: Record<string, unknown>): TxRow =>
  ({
    type,
    timestamp: 1_700_000_000_000 + ++n * 60_000,
    signature: `sig${n}`,
    fee: '0.01000000',
    txGroupId: 0,
    blockHeight: 1_500_000 + n,
    approvalStatus: 'NOT_REQUIRED',
    ...fields,
  }) as TxRow;

interface Fixture {
  name: string;
  address: string;
  rows: TxRow[];
  orders: Record<string, { order: OrderState; trades: OrderTrade[] }>;
  /** Its balance, added up apart. */
  balance: string;
  ordersNet: string;
}

const SECOND = account('S');
const THIRD = account('H');

function seller(): Fixture {
  const me = account('T');
  const own = at('O');
  const ownToo = at('W');
  const other = at('X');
  return {
    name: 'a seller on the Trade Portal',
    address: me,
    rows: [
      tx('PAYMENT', {
        creatorAddress: SECOND,
        recipient: me,
        amount: '4200.00000000',
      }),
      tx('REGISTER_NAME', {
        creatorAddress: me,
        name: 'Example',
        fee: '1.25000000',
      }),
      tx('PUBLICIZE', { creatorAddress: me, fee: '0.00000000' }),
      tx('ARBITRARY', { creatorAddress: me, payments: [] }),
      tx('DEPLOY_AT', {
        creatorAddress: me,
        aTAddress: own,
        amount: '2200.01000000',
        assetId: 0,
        fee: '0.02000000',
      }),
      tx('MESSAGE', {
        creatorAddress: me,
        recipient: own,
        amount: '0.00000000',
      }),
      tx('AT', {
        creatorAddress: NULL_ACCOUNT,
        atAddress: own,
        recipient: me,
        amount: '0.00999562',
        assetId: 0,
        fee: '0.00000000',
      }),
      tx('DEPLOY_AT', {
        creatorAddress: me,
        aTAddress: ownToo,
        amount: '1000.01000000',
        assetId: 0,
        fee: '0.02000000',
      }),
      tx('AT', {
        creatorAddress: NULL_ACCOUNT,
        atAddress: ownToo,
        recipient: me,
        amount: '1000.00512345',
        assetId: 0,
        fee: '0.00000000',
      }),
      tx('MESSAGE', {
        creatorAddress: me,
        recipient: other,
        amount: '0.00000000',
      }),
      tx('AT', {
        creatorAddress: NULL_ACCOUNT,
        atAddress: other,
        recipient: me,
        amount: '150.00000000',
        assetId: 0,
        fee: '0.00000000',
      }),
    ],
    orders: {},
    balance: '2148.67511907',
    ordersNet: '0',
  };
}

function namesAndTransfers(): Fixture {
  const me = account('N');
  return {
    name: 'names, multi-payments, transfers, messages and QDN publishes',
    address: me,
    rows: [
      tx('PAYMENT', {
        creatorAddress: SECOND,
        recipient: me,
        amount: '50.00000000',
      }),
      tx('BUY_NAME', {
        creatorAddress: me,
        seller: SECOND,
        name: 'Bought',
        amount: '5.00000000',
      }),
      tx('SELL_NAME', {
        creatorAddress: me,
        name: 'Bought',
        amount: '7.50000000',
      }),
      tx('BUY_NAME', {
        creatorAddress: THIRD,
        seller: me,
        name: 'Bought',
        amount: '7.50000000',
      }),
      tx('MULTI_PAYMENT', {
        creatorAddress: me,
        payments: [
          { recipient: SECOND, assetId: 0, amount: '1.00000000' },
          { recipient: THIRD, assetId: 7, amount: '2.00000000' },
        ],
      }),
      tx('MULTI_PAYMENT', {
        creatorAddress: SECOND,
        payments: [
          { recipient: me, assetId: 0, amount: '0.50000000' },
          { recipient: THIRD, assetId: 0, amount: '9.00000000' },
        ],
      }),
      tx('TRANSFER_ASSET', {
        creatorAddress: THIRD,
        recipient: me,
        assetId: 0,
        amount: '3.00000000',
      }),
      tx('TRANSFER_ASSET', {
        creatorAddress: me,
        recipient: THIRD,
        assetId: 7,
        amount: '10.00000000',
      }),
      tx('MESSAGE', {
        creatorAddress: SECOND,
        recipient: me,
        assetId: 0,
        amount: '0.25000000',
      }),
      tx('MESSAGE', {
        creatorAddress: me,
        recipient: SECOND,
        assetId: 7,
        amount: '1.00000000',
      }),
      tx('ARBITRARY', {
        creatorAddress: me,
        payments: [{ recipient: SECOND, assetId: 0, amount: '0.30000000' }],
      }),
      tx('JOIN_GROUP', { creatorAddress: me, groupId: 12 }),
      tx('GROUP_INVITE', { creatorAddress: SECOND, invitee: me, groupId: 12 }),
    ],
    orders: {},
    balance: '54.88000000',
    ordersNet: '0',
  };
}

function assetOrders(): Fixture {
  const me = account('R');
  const sold = tx('CREATE_ASSET_ORDER', {
    creatorAddress: me,
    haveAssetId: 0,
    wantAssetId: 91,
    amount: '10.00000000',
    price: '2.00000000',
    amountAssetId: 91,
  });
  const bought = tx('CREATE_ASSET_ORDER', {
    creatorAddress: me,
    haveAssetId: 91,
    wantAssetId: 0,
    amount: '3.00000000',
    price: '2.50000000',
    amountAssetId: 91,
  });
  const older = tx('CREATE_ASSET_ORDER', {
    creatorAddress: me,
    haveAssetId: 0,
    wantAssetId: 91,
    amount: '5.00000000',
    price: '0.50000000',
  });
  const noQort = tx('CREATE_ASSET_ORDER', {
    creatorAddress: me,
    haveAssetId: 91,
    wantAssetId: 92,
    amount: '1.00000000',
    price: '1.00000000',
    amountAssetId: 92,
  });
  return {
    name: 'asset orders with QORT on one side',
    address: me,
    rows: [
      tx('PAYMENT', {
        creatorAddress: SECOND,
        recipient: me,
        amount: '100.00000000',
      }),
      tx('TRANSFER_ASSET', {
        creatorAddress: SECOND,
        recipient: me,
        assetId: 91,
        amount: '3.00000000',
      }),
      sold,
      tx('CANCEL_ASSET_ORDER', { creatorAddress: me, orderId: sold.signature }),
      bought,
      older,
      noQort,
    ],
    orders: {
      // Selling QORT, amount in the asset wanted: 20 QORT taken; part filled, then cancelled.
      [sold.signature]: {
        order: {
          haveAssetId: 0,
          wantAssetId: 91,
          amount: '10.00000000',
          price: '2.00000000',
          fulfilled: '4.00000000',
          isClosed: true,
          isFulfilled: false,
          amountAssetId: 91,
        },
        trades: [
          {
            initiatingOrderId: sold.signature,
            targetOrderId: 'other1',
            targetAmount: '4.00000000',
            initiatorAmount: '7.50000000',
            initiatorSaving: '0.50000000',
          },
        ],
      },
      // Buying QORT: what the trade paid it.
      [bought.signature]: {
        order: {
          haveAssetId: 91,
          wantAssetId: 0,
          amount: '3.00000000',
          price: '2.50000000',
          fulfilled: '3.00000000',
          isClosed: true,
          isFulfilled: true,
          amountAssetId: 91,
        },
        trades: [
          {
            initiatingOrderId: 'other2',
            targetOrderId: bought.signature,
            targetAmount: '3.00000000',
            initiatorAmount: '7.50000000',
            initiatorSaving: '0.00000000',
          },
        ],
      },
      // An older order, its amount in the asset it had.
      [older.signature]: {
        order: {
          haveAssetId: 0,
          wantAssetId: 91,
          amount: '5.00000000',
          price: '0.50000000',
          fulfilled: '5.00000000',
          isClosed: true,
          isFulfilled: true,
        },
        trades: [
          {
            initiatingOrderId: older.signature,
            targetOrderId: 'other3',
            targetAmount: '10.00000000',
            initiatorAmount: '5.00000000',
            initiatorSaving: '0.00000000',
          },
        ],
      },
    },
    balance: '94.95000000',
    ordersNet: '-5',
  };
}

function genesis(): Fixture {
  const me = account('G');
  return {
    name: 'given QORT when the chain began',
    address: me,
    rows: [
      tx('GENESIS', {
        creatorAddress: me,
        recipient: me,
        amount: '1000.00000000',
        assetId: 0,
        fee: '0.00000000',
      }),
      tx('PAYMENT', {
        creatorAddress: me,
        recipient: SECOND,
        amount: '250.00000000',
      }),
      tx('PAYMENT', {
        creatorAddress: me,
        recipient: SECOND,
        amount: '0.12345678',
      }),
    ],
    orders: {},
    balance: '749.85654322',
    ordersNet: '0',
  };
}

const FIXTURES = [seller(), namesAndTransfers(), assetOrders(), genesis()];

/** What its asset orders moved, added up. */
function ordersOf(fixture: Fixture, ids: readonly string[]): bigint {
  return ids.reduce((sum, id) => {
    const got = fixture.orders[id];
    return sum + orderQort(id, got.order, got.trades);
  }, 0n);
}

const signed = (text: string) =>
  text.startsWith('-') ? -Q(text.slice(1)) : Q(text);

describe('QORT minted, on made-up accounts that never minted', () => {
  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'comes to exactly 0 for %s',
    (_name, fixture) => {
      const book = qortBook(fixture.rows, fixture.address);
      expect(book.orders).toEqual(Object.keys(fixture.orders));
      const orders = ordersOf(fixture, book.orders);
      expect(orders).toBe(signed(fixture.ordersNet));
      expect(qortMinted(Q(fixture.balance), book, orders)).toBe(0n);
      // The same rows twice (a list read twice over) change nothing.
      const twice = qortBook(
        [...fixture.rows, ...fixture.rows],
        fixture.address
      );
      expect(qortMinted(Q(fixture.balance), twice, orders)).toBe(0n);
    }
  );

  it('counts what minting brought on top of what its transactions moved', () => {
    const fixture = seller();
    const book = qortBook(fixture.rows, fixture.address);
    // 12.34 QORT more than its transactions explain: minting rewards.
    expect(qortMinted(Q(fixture.balance) + Q('12.34'), book, 0n)).toBe(
      Q('12.34')
    );
    // Less than they explain: below 0, so it can't be worked out.
    expect(qortMinted(Q(fixture.balance) - 1n, book, 0n)).toBe(-1n);
  });
});

describe('qortBook', () => {
  it('sorts what moved: received, sent, contracts, names, fees', () => {
    const fixture = seller();
    const book = qortBook(fixture.rows, fixture.address);
    expect(book.received).toBe(Q('4200'));
    expect(book.sent).toBe(0n);
    // Someone else's contract paid it: QORT bought on the Trade Portal.
    expect(book.purchased).toBe(Q('150'));
    // Its own contracts paid it back.
    expect(book.returned).toBe(Q('1000.01511907'));
    expect(book.deployed).toBe(Q('3200.02'));
    expect(book.fees).toBe(Q('1.32'));
    expect(book.ownAts).toEqual([at('O'), at('W')]);
  });

  it('counts QORT only, in multi-payments, transfers, messages and QDN publishes', () => {
    const fixture = namesAndTransfers();
    const book = qortBook(fixture.rows, fixture.address);
    expect(book.received).toBe(Q('53.75'));
    expect(book.sent).toBe(Q('1.3'));
    // Bought a name for 5, sold it for 7.5.
    expect(book.names).toBe(Q('2.5'));
    expect(book.fees).toBe(Q('0.07'));
  });

  it('takes a fee only from what the account made, and none for its genesis', () => {
    const book = qortBook(genesis().rows, account('G'));
    expect(book.genesis).toBe(Q('1000'));
    expect(book.fees).toBe(Q('0.02'));
  });

  it('lists what moved part by part, leaving out the parts that are 0', () => {
    const fixture = namesAndTransfers();
    const book = qortBook(fixture.rows, fixture.address);
    expect(movedParts(book, -Q('5'))).toEqual([
      { part: 'received', atomic: Q('53.75') },
      { part: 'sent', atomic: Q('1.3') },
      { part: 'names', atomic: Q('2.5') },
      { part: 'orders', atomic: -Q('5') },
      { part: 'fees', atomic: Q('0.07') },
    ]);
  });
});

describe('orderQort', () => {
  const sold: OrderState = {
    haveAssetId: 0,
    wantAssetId: 10,
    amount: '2',
    price: '10',
    fulfilled: '1',
    isClosed: true,
    isFulfilled: false,
    amountAssetId: 10,
  };
  const trade: OrderTrade = {
    initiatingOrderId: 'o1',
    targetOrderId: 't',
    targetAmount: '1',
    initiatorAmount: '10',
    initiatorSaving: '0',
  };

  it('settles an order selling QORT: taken when placed, the rest back when cancelled', () => {
    // 2 of an asset at 10 QORT each: 20 taken; cancelled after 1, so 10 came back.
    expect(orderQort('o1', sold, [trade])).toBe(-Q('10'));
    // Still open: all 20 stay taken.
    expect(orderQort('o1', { ...sold, isClosed: false }, [trade])).toBe(
      -Q('20')
    );
  });

  it('settles an order buying QORT by what each trade paid it, as initiator or target', () => {
    const buying = {
      ...sold,
      haveAssetId: 10,
      wantAssetId: 0,
      amountAssetId: 0,
    };
    expect(
      orderQort('o2', buying, [
        {
          initiatingOrderId: 'x',
          targetOrderId: 'o2',
          targetAmount: '1',
          initiatorAmount: '400',
        },
        {
          initiatingOrderId: 'o2',
          targetOrderId: 'y',
          targetAmount: '25',
          initiatorAmount: '2',
        },
      ])
    ).toBe(Q('425'));
  });

  it('rounds amount × price up, as Core does', () => {
    const tiny: OrderState = {
      ...sold,
      amount: '0.00000001',
      price: '0.5',
      fulfilled: '0',
      isClosed: false,
    };
    expect(orderQort('o1', tiny, [])).toBe(-1n);
  });
});

describe('neverMinted', () => {
  const none = { blocksMinted: 0, blocksMintedAdjustment: 0 };
  it('only with no blocks minted and no reward share ever', () => {
    expect(neverMinted(none, null)).toBe(true);
    expect(neverMinted({ ...none, blocksMinted: 1 }, null)).toBe(false);
    expect(neverMinted({ ...none, blocksMintedAdjustment: 20 }, null)).toBe(
      false
    );
  });

  it('not for an account that moved its minting level away: Core sets its blocks back to 0', () => {
    expect(
      neverMinted(none, { height: 1_200_000, timestamp: 1, signature: 's' })
    ).toBe(false);
  });

  it('not while its first reward share is still being read', () => {
    expect(neverMinted(none, undefined)).toBe(false);
  });
});

describe('amounts as Core writes them', () => {
  it('reads decimals and the exponent form of small balances, exactly', () => {
    expect(toAtomic('5416.68020260')).toBe(541_668_020_260n);
    expect(toAtomic('0E-8')).toBe(0n);
    expect(toAtomic('1E-8')).toBe(1n);
    expect(toAtomic('1.0E-7')).toBe(10n);
    expect(toAtomic('5E+2')).toBe(50_000_000_000n);
    expect(toAtomic('12.5')).toBe(1_250_000_000n);
    // Not amounts: below 0, more than 8 decimals, words.
    expect(toAtomic('-1')).toBeNull();
    expect(toAtomic('1.123456789')).toBeNull();
    expect(toAtomic('lots')).toBeNull();
  });
});
