import { describe, expect, it } from 'vitest';
import i18n from '../../i18n/i18n';
import { sentenceText } from '../../components/Explorer/transactions/sentenceText';
import { fundingFrom, linksOf } from './connections';
import {
  exchangeFlow,
  exchangeFlowsFrom,
  exchangeName,
  exchangeSentence,
  KNOWN_EXCHANGES,
} from './exchanges';
import {
  fundingSentence,
  recordedFindings,
  siblingsSentence,
} from './findings';
import { flowAmounts, flowsOf, sortFlows, splitAt } from './money';
import type { TxRow } from './reads';
import { queryWords, textMatches } from './rowSearch';
import type { TxSentenceSpec } from './txWords';

// What Connections says, in the order it says it: payments grouped by the
// other account (exact sums, counted once), the findings list, exchanges,
// where its first QORT came from, and the search over the rows.

const addr = (c: string) => `Q${c.repeat(33)}`;
const ME = addr('m');
const A = addr('a');
const B = addr('b');
const C = addr('c');
const AT = `A${'t'.repeat(33)}`;
const TRADEOGRE = Object.keys(KNOWN_EXCHANGES).find(
  (address) => KNOWN_EXCHANGES[address] === 'TradeOgre'
) as string;

const NAMES: Record<string, string> = { [A]: 'Publisher', [B]: 'Second' };
/** A sentence in English, accounts by their made-up names (or short address). */
const say = (sentence: TxSentenceSpec) =>
  sentenceText(sentence, i18n.getFixedT('en'), 'en', {
    nameOf: (address) => NAMES[address] ?? null,
  });

let n = 0;
const sig = () => {
  n += 1;
  return `${String(n).padStart(6, '1')}${'f'.repeat(82)}`;
};
/** Mid-month, so month words don't depend on the time zone. */
const T0 = Date.UTC(2025, 2, 15, 12);
const DAY = 86_400_000;

function tx(type: string, height: number, extra: Partial<TxRow> = {}): TxRow {
  return {
    type,
    timestamp: T0 + (height - 1_000) * DAY,
    signature: sig(),
    txGroupId: 0,
    blockHeight: height,
    approvalStatus: 'NOT_REQUIRED',
    ...extra,
  };
}
const pay = (from: string, to: string, height: number, amount: string) =>
  tx('PAYMENT', height, { creatorAddress: from, recipient: to, amount });

describe('flowsOf: payments by the other account', () => {
  const rows = [
    pay(ME, A, 1_000, '0.1'),
    pay(ME, A, 1_060, '0.2'),
    pay(B, ME, 1_030, '10'),
    tx('TRANSFER_ASSET', 1_040, {
      creatorAddress: ME,
      recipient: A,
      amount: '3',
      assetId: 7,
      assetName: 'Example Coin',
    }),
    tx('MULTI_PAYMENT', 1_050, {
      creatorAddress: ME,
      payments: [
        { recipient: A, amount: '1', assetId: 0 },
        { recipient: A, amount: '2', assetId: 0 },
        { recipient: C, amount: '4', assetId: 0 },
      ],
    }),
    pay(ME, AT, 1_070, '5'),
  ];

  it('adds exact amounts, counts each transaction once per account, newest first', () => {
    const sent = flowsOf(rows, ME, 'sent');
    const toA = sent.find((flow) => flow.address === A);
    // 0.1 + 0.2 as atomic units: exactly 0.3, never 0.30000000000000004.
    expect(toA?.qort).toBe(330_000_000n);
    // Two payments, a transfer and one multi-payment (paying it twice): 4.
    expect(toA?.count).toBe(4);
    expect(toA?.assets).toEqual([
      { asset: { id: 7, name: 'Example Coin' }, atomic: 300_000_000n },
    ]);
    expect(toA?.txs.map((row) => row.blockHeight)).toEqual([
      1_060, 1_050, 1_040, 1_000,
    ]);
    expect(toA?.first.height).toBe(1_000);
    expect(toA?.last.height).toBe(1_060);
    expect(flowAmounts(toA!)).toEqual([
      { amount: '3.30000000', asset: { id: 0, name: null } },
      { amount: '3.00000000', asset: { id: 7, name: 'Example Coin' } },
    ]);
    const received = flowsOf(rows, ME, 'received');
    expect(received.map((flow) => [flow.address, flow.qort])).toEqual([
      [B, 1_000_000_000n],
    ]);
  });

  it('tells AT addresses apart, and sorts as picked', () => {
    const sent = flowsOf(rows, ME, 'sent');
    const { people, ats } = splitAt(sent);
    expect(ats.map((flow) => flow.address)).toEqual([AT]);
    expect(people.map((flow) => flow.address).sort()).toEqual([A, C].sort());
    expect(sortFlows(people, 'count').map((flow) => flow.address)).toEqual([
      A,
      C,
    ]);
    expect(sortFlows(people, 'total').map((flow) => flow.address)).toEqual([
      C,
      A,
    ]);
    expect(sortFlows(people, 'latest').map((flow) => flow.address)).toEqual([
      A,
      C,
    ]);
    expect(sortFlows(people, 'first').map((flow) => flow.address)).toEqual([
      A,
      C,
    ]);
  });

  it('leaves out rows waiting for a block and amounts that aren’t amounts', () => {
    const waiting = { ...pay(ME, A, 1, '1'), blockHeight: undefined };
    const odd = pay(ME, A, 2, 'lots');
    expect(flowsOf([waiting, odd], ME, 'sent')).toEqual([]);
  });

  it('says what moved in one sentence, with how many and when', () => {
    const [toA] = flowsOf(
      [pay(ME, A, 1_000, '1'), pay(ME, A, 1_040, '2.5')],
      ME,
      'sent'
    );
    const [findingTo] = recordedFindings({ address: ME, sent: [toA] });
    expect(say(findingTo.sentence)).toBe(
      // Intl writes a range with thin spaces around its dash.
      'Paid Publisher 3.5 QORT in 2 payments (Mar\u2009–\u2009Apr 2025)'
    );
    const [one] = flowsOf([pay(B, ME, 1_000, '10')], ME, 'received');
    const [findingFrom] = recordedFindings({ address: ME, received: [one] });
    expect(say(findingFrom.sentence)).toBe(
      'Received 10 QORT from Second in 1 payment (Mar 15, 2025)'
    );
  });
});

describe('recordedFindings: the order Connections lists them in', () => {
  it('level moves, sponsors, minting now, the accounts it sponsored, names, then payments by count', () => {
    const rows = [
      tx('TRANSFER_PRIVS', 1_000, { creatorAddress: A }),
      tx('REWARD_SHARE', 1_010, {
        creatorAddress: B,
        recipient: ME,
        sharePercent: '0.00',
      }),
      tx('REWARD_SHARE', 1_020, {
        creatorAddress: ME,
        recipient: C,
        sharePercent: '5.00',
      }),
      tx('BUY_NAME', 1_030, {
        creatorAddress: ME,
        seller: A,
        name: 'Spare Room',
        amount: '5',
      }),
    ];
    const links = linksOf(rows, ME);
    const payments = [
      pay(ME, C, 1_100, '1'),
      pay(B, ME, 1_101, '1'),
      pay(B, ME, 1_102, '1'),
    ];
    const found = recordedFindings({
      address: ME,
      links,
      mintingWith: links.activeShares,
      sent: flowsOf(payments, ME, 'sent'),
      received: flowsOf(payments, ME, 'received'),
      levels: { [A]: 0 },
    });
    expect(found.map((finding) => finding.kind)).toEqual([
      'levelMove',
      'sponsor',
      'mintingWith',
      'mintingWith',
      'sponsees',
      'nameDeal',
      'paidBy',
      'paidTo',
    ]);
    expect(found.map((finding) => say(finding.sentence))).toEqual([
      'Got its minting level from Publisher',
      'Sponsored by Second at 0%, not removed',
      'Minting with Second now, in their reward share at 0%',
      'Minting with Qccccc…ccccc now, in its reward share at 5%',
      'Sponsored 1 account (Apr 4, 2025)',
      'Bought the name “Spare Room” from Publisher for 5 QORT',
      'Received 2 QORT from Second in 2 payments (Jun 2025)',
      'Paid Qccccc…ccccc 1 QORT in 1 payment (Jun 23, 2025)',
    ]);
    // The account it got its level from: its level now, said under its name.
    expect(found[0].otherLevel).toBe(0);
    expect(found[0].evidence).toHaveLength(1);
    expect(found[6].evidence).toHaveLength(2);
    expect(found[6].evidenceKind).toBe('payments');
  });

  it('the accounts it sponsored, “+” when its minting list was read only in part', () => {
    const links = linksOf(
      [
        tx('REWARD_SHARE', 1_000, {
          creatorAddress: ME,
          recipient: A,
          sharePercent: '0.00',
        }),
      ],
      ME
    );
    const [whole] = recordedFindings({ address: ME, links });
    expect(say(whole.sentence)).toMatch(/^Sponsored 1 account \(/);
    const [part] = recordedFindings({ address: ME, links, mintingShort: true });
    expect(say(part.sentence)).toMatch(/^Sponsored 1\+ accounts \(/);
  });

  it('a removed sponsorship says for how long it ran', () => {
    const links = linksOf(
      [
        tx('REWARD_SHARE', 1_000, {
          creatorAddress: A,
          recipient: ME,
          sharePercent: '0.00',
        }),
        tx('REWARD_SHARE', 8_234, {
          creatorAddress: A,
          recipient: ME,
          sharePercent: '-1.00',
        }),
      ],
      ME
    );
    const [sponsor] = recordedFindings({ address: ME, links });
    expect(say(sponsor.sentence)).toBe(
      'Sponsored by Publisher at 0% for 7,234 blocks'
    );
    expect(sponsor.evidence).toHaveLength(2);
  });

  it('a level move it sent whose recipient couldn’t be read says so', () => {
    const sent = tx('TRANSFER_PRIVS', 1_000, { creatorAddress: ME });
    const links = linksOf([sent], ME, { [sent.signature]: null });
    const [move] = recordedFindings({ address: ME, links });
    expect(move.other).toBeNull();
    expect(say(move.sentence)).toBe(
      'Moved its minting level to another account'
    );
  });

  it('payments to an AT stay out of the findings (they are in Payments)', () => {
    const found = recordedFindings({
      address: ME,
      sent: flowsOf([pay(ME, AT, 1_000, '1')], ME, 'sent'),
    });
    expect(found).toEqual([]);
  });
});

describe('where its first QORT came from, in words', () => {
  it('worded by the kind of transaction', () => {
    const paid = fundingFrom(
      tx('PAYMENT', 1_000, {
        creatorAddress: A,
        recipient: ME,
        amount: '5.4321',
      }),
      ME
    );
    expect(say(fundingSentence(paid!))).toBe(
      'First QORT payment received: 5.4321 QORT from Publisher'
    );
    const share = fundingFrom(
      tx('REWARD_SHARE', 1_000, {
        creatorAddress: B,
        recipient: ME,
        sharePercent: '5.00',
      }),
      ME
    );
    expect(say(fundingSentence(share!))).toBe(
      'Its first incoming transaction: a reward share at 5% from Second'
    );
    const genesis = fundingFrom(
      tx('GENESIS', 1, { recipient: ME, amount: '100' }),
      ME
    );
    expect(say(fundingSentence(genesis!))).toBe(
      'Received 100 QORT in the genesis block'
    );
    const asset = fundingFrom(
      tx('GENESIS', 1, {
        recipient: ME,
        amount: '100',
        assetId: 1,
        assetName: 'Legacy',
      }),
      ME
    );
    expect(say(fundingSentence(asset!))).toBe(
      'Its first incoming transaction: 100 Legacy in the genesis block'
    );
  });

  it('“Also sponsored by A (47 others)”, and “47+” when the list stopped short', () => {
    expect(say(siblingsSentence(A, 47, false))).toBe(
      'Also sponsored by Publisher (47 others)'
    );
    expect(say(siblingsSentence(A, 1, false))).toBe(
      'Also sponsored by Publisher (1 other)'
    );
    expect(say(siblingsSentence(A, 99, true))).toBe(
      'Also sponsored by Publisher (99+ others)'
    );
  });
});

describe('exchanges', () => {
  it('names the known exchanges’ accounts, and nothing else', () => {
    expect(exchangeName(TRADEOGRE)).toBe('TradeOgre');
    expect(exchangeName(A)).toBeNull();
    expect(exchangeName('toString')).toBeNull();
    expect(exchangeName(null)).toBeNull();
  });

  it('adds what an account sent one, and says when and how many', () => {
    const rows = [
      pay(ME, TRADEOGRE, 1_000, '9000'),
      pay(ME, TRADEOGRE, 1_060, '999.99'),
    ];
    const flow = exchangeFlow(TRADEOGRE, 'sent', rows);
    expect(flow?.qort).toBe(999_999_000_000n);
    expect(say(exchangeSentence(flow!))).toBe(
      'Sent 9,999.99 QORT to TradeOgre, an exchange, in 2 payments (Mar\u2009–\u2009May 2025).'
    );
    // A read found older ones.
    const older = exchangeFlow(TRADEOGRE, 'sent', rows, 'older');
    expect(say(exchangeSentence(older!))).toBe(
      'Sent 9,999.99 QORT to TradeOgre, an exchange, in its newest 2 payments (Mar\u2009–\u2009May 2025); there are older ones.'
    );
    // The lists it came from stopped short: it can't say there are.
    const maybe = exchangeFlow(
      TRADEOGRE,
      'received',
      rows.slice(0, 1),
      'maybe'
    );
    expect(say(exchangeSentence(maybe!))).toBe(
      'Received 9,000 QORT from TradeOgre, an exchange, in 1 payment (Mar 15, 2025); there may be older ones.'
    );
    expect(exchangeFlow(A, 'sent', rows)).toBeNull();
    expect(exchangeFlow(TRADEOGRE, 'sent', [])).toBeNull();
  });

  it('on a node without the exact read, from the payments the lists found', () => {
    const payments = [pay(ME, TRADEOGRE, 1_000, '4'), pay(ME, A, 1_001, '1')];
    const found = recordedFindings({
      address: ME,
      sent: flowsOf(payments, ME, 'sent'),
    });
    const flows = exchangeFlowsFrom(found, true);
    expect(
      flows.map((flow) => [flow.exchange, flow.direction, flow.more])
    ).toEqual([['TradeOgre', 'sent', 'maybe']]);
  });
});

describe('the search over the rows', () => {
  it('finds every word typed, ignoring case and accents, and numbers without their separators', () => {
    const text =
      'Paid Publisher 1,200 QORT in 4 payments\nMar – May 2025\nits sponsor';
    expect(textMatches(text, queryWords('publisher'))).toBe(true);
    expect(textMatches(text, queryWords('PUBLISHER may'))).toBe(true);
    expect(textMatches(text, queryWords('1200'))).toBe(true);
    expect(textMatches(text, queryWords('1,200 qort'))).toBe(true);
    expect(textMatches(text, queryWords('second'))).toBe(false);
    expect(textMatches('Café Room', queryWords('cafe'))).toBe(true);
    expect(textMatches(text, queryWords('   '))).toBe(true);
  });
});
