import { describe, expect, it } from 'vitest';
import {
  fundingFrom,
  groupLevelMoves,
  linksOf,
  mintingWithNow,
  pairedOnline,
  sponseesOf,
} from './connections';
import type { TxRow } from './reads';

// How an account is linked to others by its minting and name transactions,
// and where its first QORT came from (ported from Q-Mintership+'s
// rules/explorer/connections.test.ts).

const addr = (c: string) => `Q${c.repeat(33)}`;
const ME = addr('m');
const A = addr('a');
const B = addr('b');
const C = addr('c');
const D = addr('d');
const AT = `A${'t'.repeat(33)}`;

let n = 0;
const sig = () => {
  n += 1;
  return `${String(n).padStart(6, '1')}${'s'.repeat(82)}`;
};
const T0 = Date.UTC(2023, 4, 15, 12);

function tx(type: string, height: number, extra: Partial<TxRow> = {}): TxRow {
  return {
    type,
    timestamp: T0 + (height - 1_000_000) * 60_000,
    signature: sig(),
    txGroupId: 0,
    blockHeight: height,
    approvalStatus: 'NOT_REQUIRED',
    ...extra,
  };
}
const share = (
  from: string,
  to: string,
  height: number,
  sharePercent = '0.00'
) =>
  tx('REWARD_SHARE', height, {
    creatorAddress: from,
    recipient: to,
    sharePercent,
  });

describe('linksOf: level moves', () => {
  it('a move it sent names the recipient read from the raw bytes', () => {
    const sent = tx('TRANSFER_PRIVS', 1_061_832, { creatorAddress: ME });
    const links = linksOf([sent], ME, { [sent.signature]: C });
    expect(links.levelMoves).toEqual([
      {
        direction: 'to',
        other: C,
        ref: {
          height: 1_061_832,
          timestamp: sent.timestamp,
          signature: sent.signature,
        },
        tx: sent,
      },
    ]);
  });

  it('a move it sent whose bytes couldn’t be read stays, without a recipient', () => {
    const sent = tx('TRANSFER_PRIVS', 1_061_832, { creatorAddress: ME });
    expect(
      linksOf([sent], ME, { [sent.signature]: null }).levelMoves[0]
    ).toMatchObject({ direction: 'to', other: null });
  });

  it('a move it received names its creator', () => {
    const got = tx('TRANSFER_PRIVS', 1_061_832, { creatorAddress: B });
    expect(linksOf([got], ME).levelMoves[0]).toMatchObject({
      direction: 'from',
      other: B,
    });
  });

  it('moves between the same two accounts the same way go together', () => {
    const rows = [
      tx('TRANSFER_PRIVS', 1_000, { creatorAddress: B }),
      tx('TRANSFER_PRIVS', 1_000, { creatorAddress: B }),
      tx('TRANSFER_PRIVS', 1_200, { creatorAddress: C }),
    ];
    const groups = groupLevelMoves(linksOf(rows, ME).levelMoves);
    expect(groups.map((group) => [group[0].other, group.length])).toEqual([
      [B, 2],
      [C, 1],
    ]);
  });
});

describe('linksOf: sponsors', () => {
  it('the sponsor is the creator of the earliest share to it, with how long it ran', () => {
    const rows = [
      share(A, ME, 1_371_641),
      share(A, ME, 1_378_875, '-1.00'),
      share(B, ME, 1_400_000, '10.00'),
      share(ME, ME, 1_380_007),
    ];
    const links = linksOf([...rows].reverse(), ME);
    expect(links.sponsors.map((s) => s.sponsor)).toEqual([A, B]);
    expect(links.sponsors[0]).toMatchObject({ percent: '0.00', blocks: 7_234 });
    expect(links.sponsors[0].txs.map((t) => t.blockHeight)).toEqual([
      1_378_875, 1_371_641,
    ]);
    expect(links.sponsors[1]).toMatchObject({ removal: null, blocks: null });
  });

  it('an old removal (-1000000) counts; a removal before any share doesn’t start one', () => {
    const rows = [
      share(A, ME, 900, '-1.00'),
      share(A, ME, 1_000),
      share(A, ME, 1_500, '-1000000.00'),
    ];
    const [sponsorship] = linksOf(rows, ME).sponsors;
    expect(sponsorship.start.height).toBe(1_000);
    expect(sponsorship.blocks).toBe(500);
  });

  it('a self-share is neither a sponsor nor a sponsee', () => {
    const links = linksOf([share(ME, ME, 1_000)], ME);
    expect(links.sponsors).toEqual([]);
    expect(links.sponsees).toEqual([]);
    expect(links.activeShares).toEqual([]);
  });

  it('a row waiting for a block is left out', () => {
    const waiting = { ...share(A, ME, 1), blockHeight: undefined };
    expect(linksOf([waiting], ME).sponsors).toEqual([]);
  });

  it('a share to or from something that isn’t an account is left out', () => {
    expect(linksOf([share('nobody', ME, 1_000)], ME).sponsors).toEqual([]);
  });
});

describe('sponsees', () => {
  const rows = [
    share(ME, A, 1_000),
    share(ME, A, 8_000, '-1.00'),
    share(ME, B, 2_000),
    share(ME, C, 3_000),
    share(ME, C, 4_000, '-1.00'),
    share(ME, C, 5_000),
    share(ME, ME, 500),
    share(D, ME, 600),
  ];

  it('lists each account it made a share to once, in the order of the first share', () => {
    const sponsees = sponseesOf(rows, ME);
    expect(sponsees.map((s) => s.address)).toEqual([A, B, C]);
    expect(sponsees[0]).toMatchObject({ blocks: 7_000, active: false });
    expect(sponsees[1]).toMatchObject({
      removal: null,
      blocks: null,
      active: true,
    });
    // Sponsored again after a removal: active again.
    expect(sponsees[2]).toMatchObject({ blocks: 1_000, active: true });
    expect(sponsees[2].txs).toHaveLength(3);
  });
});

describe('active shares and minting now', () => {
  it('keeps the pairs whose latest row isn’t a removal, either way', () => {
    const rows = [
      share(ME, A, 1_000),
      share(ME, A, 2_000, '-1.00'),
      share(ME, B, 3_000),
      share(C, ME, 4_000, '5.00'),
      share(ME, ME, 500),
    ];
    const links = linksOf(rows, ME);
    expect(links.activeShares.map((s) => [s.other, s.role, s.percent])).toEqual(
      [
        [B, 'minter', '0.00'],
        [C, 'recipient', '5.00'],
      ]
    );
    const online = [
      { minterAddress: C, recipientAddress: ME },
      { minterAddress: ME, recipientAddress: ME },
      { minterAddress: A, recipientAddress: ME },
    ];
    expect(mintingWithNow(links, ME, online).map((s) => s.other)).toEqual([C]);
    expect(pairedOnline(online, ME)).toBe(true);
    expect(
      pairedOnline([{ minterAddress: ME, recipientAddress: ME }], ME)
    ).toBe(false);
  });
});

describe('names bought and sold', () => {
  it('reads the buyer and the seller', () => {
    const bought = tx('BUY_NAME', 2_351_000, {
      creatorAddress: ME,
      seller: B,
      name: 'Spare Room',
      amount: '5.00000000',
    });
    const sold = tx('BUY_NAME', 2_352_000, {
      creatorAddress: C,
      seller: ME,
      name: 'Publisher',
      amount: '1.00000000',
    });
    const other = tx('BUY_NAME', 2_353_000, {
      creatorAddress: C,
      seller: D,
      name: 'x',
    });
    expect(
      linksOf([bought, sold, other], ME).nameDeals.map((d) => [
        d.kind,
        d.other,
        d.name,
      ])
    ).toEqual([
      ['bought', B, 'Spare Room'],
      ['sold', C, 'Publisher'],
    ]);
  });

  it('ignores the genesis-era flags and levels', () => {
    const rows = [
      tx('ACCOUNT_LEVEL', 1, { target: ME, level: 5 }),
      tx('ACCOUNT_FLAGS', 1, { target: ME }),
    ];
    expect(linksOf(rows, ME)).toEqual({
      levelMoves: [],
      sponsors: [],
      sponsees: [],
      activeShares: [],
      nameDeals: [],
    });
  });
});

describe('fundingFrom: where its first QORT came from', () => {
  it('a payment to it', () => {
    const paid = tx('PAYMENT', 10, {
      creatorAddress: A,
      recipient: ME,
      amount: '5.4321',
    });
    expect(fundingFrom(paid, ME)).toMatchObject({
      kind: 'payment',
      from: A,
      amount: '5.4321',
      assetId: 0,
      tx: paid,
    });
    // A payment it sent isn't its funding.
    expect(fundingFrom({ ...paid, recipient: B }, ME)).toBeNull();
  });

  it('a multi-payment is a QORT payment only when it paid QORT, and counts all it paid this account', () => {
    const qort = tx('MULTI_PAYMENT', 10, {
      creatorAddress: A,
      payments: [
        { recipient: B, amount: '1', assetId: 0 },
        { recipient: ME, amount: '3', assetId: 7, assetName: 'Example Coin' },
        { recipient: ME, amount: '2', assetId: 0 },
        { recipient: ME, amount: '0.5', assetId: 0 },
      ],
    });
    // All the QORT it paid this account, not its first part.
    expect(fundingFrom(qort, ME)).toMatchObject({
      kind: 'multiPayment',
      amount: '2.50000000',
      assetId: 0,
    });
    const asset = tx('MULTI_PAYMENT', 10, {
      creatorAddress: A,
      payments: [
        { recipient: ME, amount: '3', assetId: 7 },
        { recipient: ME, amount: '1', assetId: 7 },
        { recipient: ME, amount: '9', assetId: 8 },
      ],
    });
    expect(fundingFrom(asset, ME)).toMatchObject({
      kind: 'transferAsset',
      assetId: 7,
      amount: '4.00000000',
    });
  });

  it('a reward share, a level move, an AT’s payout and the genesis block', () => {
    expect(fundingFrom(share(A, ME, 10, '5.00'), ME)).toMatchObject({
      kind: 'rewardShare',
      from: A,
      sharePercent: '5.00',
    });
    expect(fundingFrom(share(ME, ME, 10), ME)).toBeNull();
    expect(
      fundingFrom(tx('TRANSFER_PRIVS', 10, { creatorAddress: B }), ME)
    ).toMatchObject({ kind: 'transferPrivs', from: B });
    expect(
      fundingFrom(
        tx('AT', 10, { atAddress: AT, recipient: ME, amount: '4' }),
        ME
      )
    ).toMatchObject({ kind: 'at', from: AT });
    expect(
      fundingFrom(
        tx('GENESIS', 1, { recipient: ME, amount: '100', assetId: 1 }),
        ME
      )
    ).toMatchObject({ kind: 'genesis', from: null, assetId: 1 });
  });

  it('nothing for a transaction waiting for a block, or of another kind', () => {
    const paid = tx('PAYMENT', 10, { creatorAddress: A, recipient: ME });
    expect(fundingFrom({ ...paid, blockHeight: undefined }, ME)).toBeNull();
    expect(
      fundingFrom(tx('JOIN_GROUP', 10, { creatorAddress: ME }), ME)
    ).toBeNull();
  });
});
